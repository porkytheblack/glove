import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { JsSession } from "glove-js";
import { z } from "zod";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import {
  defineAgentApplication,
  installRegistry,
  type FoundryInstalledApp,
} from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import { FOUNDRY_EXECUTION_MARKER, defineAgent } from "../src/definition.js";
import { defineRepl } from "../src/workbench.js";
import { FoundryEchoModel } from "./fixtures/echo-model.js";

const here = dirname(fileURLToPath(import.meta.url));

const mailServer = {
  name: "Mail",
  description: "The person's mailbox",
  transport: {
    kind: "stdio" as const,
    command: process.execPath,
    args: ["--import", "tsx", resolve(here, "fixtures/mail-mcp-server.ts")],
    cwd: resolve(here, ".."),
  },
  connectTimeoutMs: 15_000,
};

const mail = defineAgentApplication({
  id: "mail",
  description: "Mail for the person who connected it",
  config: z.object({ hideDestructive: z.boolean().default(true) }),
  mcp: {
    entry: mailServer,
    auth: (session) => ({ MAIL_TOKEN: (session as { readonly token: string }).token }),
    tools: (tool, { config }) =>
      config.hideDestructive && tool.destructive ? "hide" : tool.readOnly ? "allow" : "ask",
  },
});

function runnable() {
  return new Glove({
    model: new FoundryEchoModel(),
    store: new MemoryStore("foundry-app-mcp-test"),
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: "Test",
    compaction_config: { compaction_instructions: "Test" },
  }).build();
}

const message = { sender: "user" as const, text: "check mail" };
const sessions = (seen: string[]) => ({
  identifier: "test-sessions",
  withSession: <A>(
    request: { readonly accountId: string; readonly operation: string },
    use: (session: unknown) => Effect.Effect<A, unknown, never>,
  ) => {
    seen.push(`${request.accountId}:${request.operation}`);
    return use({ token: `token-for-${request.accountId}` });
  },
});

function context(glove: ReturnType<typeof runnable>) {
  return {
    definitionId: "assistant",
    agentId: "agent-1",
    conversationId: "conversation-1",
    workspaceId: "test",
    runId: "app-mcp-run",
    input: {},
    request: { agentId: "agent-1", conversationId: "conversation-1", workspaceId: "test", message: "check mail" },
    message,
    messageInput: "check mail",
    messageText: "check mail",
    history: [],
    messages: [message],
    glove,
    store: glove.store,
    emit: () => undefined,
  };
}

const registry = { tools: [], applications: [mail], mcp: [], memory: [] };

test("an app's MCP tools open with the installation's account and follow the app's tool policy", async () => {
  const glove = runnable();
  const seen: string[] = [];
  const apps: FoundryInstalledApp[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  await Effect.runPromise(installRegistry({
    registry,
    installations: [{ kind: "application", id: "mail", accountId: "ada-google" }],
    context: context(glove),
    accountSessions: sessions(seen),
    onApp: (app) => { apps.push(app); },
    onCleanup: (cleanup) => { cleanups.push(cleanup); },
  }));

  const tools = new Map(glove.tools.map((tool) => [tool.name, tool]));
  assert.equal(tools.get("mail__search_mail")?.requiresPermission, false, "read-only tools run");
  assert.equal(tools.get("mail__send_mail")?.requiresPermission, true, "writes wait for approval");
  assert.equal(tools.has("mail__delete_mail"), false, "hidden tools never reach the agent");
  assert.deepEqual(seen, ["ada-google:mcp:connect"]);

  const result = await tools.get("mail__search_mail")!.run({ query: "invoice" });
  assert.equal(result.status, "success");
  assert.match(String(result.data), /token-for-ada-google/);

  assert.equal(apps.length, 1);
  assert.equal(apps[0]!.accountId, "ada-google");
  assert.deepEqual(
    apps[0]!.tools.filter((tool) => !tool.name.includes("list_")).map(({ name, readOnly }) => ({ name, readOnly })),
    [{ name: "mail__search_mail", readOnly: true }, { name: "mail__send_mail", readOnly: false }],
  );

  assert.equal(cleanups.length, 1);
  for (const cleanup of cleanups) await cleanup();
  assert.equal(glove.tools.some((tool) => tool.name.startsWith("mail__")), false, "cleanup closes the connection");
});

test("an app that connects with an account refuses an installation without one", async () => {
  const glove = runnable();
  await assert.rejects(
    Effect.runPromise(installRegistry({
      registry,
      installations: [{ kind: "application", id: "mail" }],
      context: context(glove),
      accountSessions: sessions([]),
    })),
    /App "mail" connects with an account/,
  );
});

test("the REPL sees installed apps as groups and can keep their tools out of context", async () => {
  const session = JsSession.create();
  const definition = defineAgent({
    description: "App REPL fixture",
    components: composeAgent(mail),
    accountSessions: sessions([]),
    repl: () => defineRepl({
      language: "javascript",
      session,
      programmaticTools: {
        select: ({ apps }) => apps.flatMap((app) => app.tools),
        keepDirect: false,
      },
    }),
    run: async (agent, ctx) => {
      if (ctx.repl?.language !== "javascript") throw new Error("missing JavaScript REPL");
      const found = await ctx.repl.session.execute(
        'const found = mail.search_mail({ query: "invoice" }); found.messages[0].subject',
      );
      return {
        found: found.value,
        direct: agent.tools.map((tool) => tool.name).filter((name) => name.startsWith("mail__")),
        functions: ctx.repl.session.list().map((fn) => fn.name).filter((name) => name.startsWith("mail__")),
      };
    },
  });
  const compiled = compileAgentDefinition(definition, "app-repl");
  const result = await compiled.handler!({
    [FOUNDRY_EXECUTION_MARKER]: true as const,
    request: {
      agentId: "agent-apps",
      conversationId: "conversation-apps",
      workspaceId: "apps-test",
      message: "find the invoice",
      source: { kind: "direct" as const },
    },
    agent: {
      id: "agent-apps",
      definitionId: "app-repl",
      workspaceId: "apps-test",
      context: {},
      installations: [{ kind: "application" as const, id: "mail", accountId: "ada-google", config: { hideDestructive: true } }],
      playbooks: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    conversation: {
      id: "conversation-apps",
      agentId: "agent-apps",
      workspaceId: "apps-test",
      context: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  const value = result.value as { found: unknown; direct: string[]; functions: string[] };
  assert.equal(value.found, "Invoice");
  assert.deepEqual(value.direct, ["mail__send_mail"], "only the tool that asks first stays direct");
  assert.ok(value.functions.includes("mail__search_mail"));
  assert.ok(value.functions.includes("mail__send_mail"));
});
