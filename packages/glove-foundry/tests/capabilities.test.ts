import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { z } from "zod";
import {
  defineAgentApplication,
  defineMcp,
  defineMemory,
  defineSharedTool,
  installRegistry,
  mountAgentDefinitionMemory,
  type AgentInstallation,
} from "../src/capabilities.js";
import { FoundryEchoModel } from "./fixtures/echo-model.js";

function runnable() {
  return new Glove({
    model: new FoundryEchoModel(),
    store: new MemoryStore("foundry-capability-test"),
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: "Test",
    compaction_config: { compaction_instructions: "Test" },
  }).build();
}

const shared = defineSharedTool<{ value: string }>({
  id: "shared-echo",
  description: "Shared test tool",
  tool: {
    name: "shared_echo",
    description: "Echo",
    inputSchema: z.object({ value: z.string() }),
    async do(input) {
      return { status: "success", data: input.value };
    },
  },
});

const application = defineAgentApplication({
  id: "notes",
  description: "Installable notes app",
  config: z.object({ namespace: z.string() }),
  install: ({ config }) =>
    Effect.sync(() => {
      const { namespace } = config as { namespace: string };
      return { tools: [{
          name: "notes_namespace",
          description: "Notes namespace",
          inputSchema: z.object({}),
          async do() {
            return { status: "success" as const, data: namespace };
          },
        }] };
    }),
});

const memory = defineMemory({
  id: "test-memory",
  description: "Test profile",
  mount: ({ glove }) =>
    Effect.sync(() => {
      glove.fold({
        name: "memory_marker",
        description: "Memory marker",
        inputSchema: z.object({}),
        async do() {
          return { status: "success", data: true };
        },
      });
    }),
});

const mcp = defineMcp({
  id: "uninstalled-mcp",
  entry: {
    name: "Never connected",
    description: "Proves catalogue entries are inert",
    url: "https://example.invalid/mcp",
  },
});

const registry = {
  tools: [shared],
  applications: [application],
  mcp: [mcp],
  memory: [memory],
} as const;

const messageContext = {
  request: {
    agentId: "assistant",
    conversationId: "conversation-1",
    workspaceId: "test",
    message: "test",
  },
  message: { sender: "user" as const, text: "test" },
  messageInput: "test",
  messageText: "test",
  history: [],
  messages: [{ sender: "user" as const, text: "test" }],
};

test("registered capabilities are inert until explicitly installed", async () => {
  const glove = runnable();
  const baseline = glove.tools.map((tool) => tool.name);
  let mcpAdapterCalls = 0;
  await Effect.runPromise(
    installRegistry({
      registry,
      installations: [],
      context: {
        ...messageContext,
        definitionId: "assistant",
        agentId: "assistant",
        conversationId: "conversation-1",
        workspaceId: "test",
        runId: "run-empty",
        input: {},
        glove,
        store: glove.store,
        emit: () => {},
      },
      mcpAdapter: () =>
        Effect.sync(() => {
          mcpAdapterCalls++;
          throw new Error("must not run");
        }),
    }),
  );
  assert.deepEqual(glove.tools.map((tool) => tool.name), baseline);
  assert.equal(mcpAdapterCalls, 0);
});

test("only instance-installable tools and applications install from desired state", async () => {
  const glove = runnable();
  const events: string[] = [];
  const installations: AgentInstallation[] = [
    { kind: "tool", id: "shared-echo" },
    {
      kind: "application",
      id: "notes",
      config: { namespace: "releases" },
    },
  ];
  const installed = await Effect.runPromise(
    installRegistry({
      registry,
      installations,
      context: {
        ...messageContext,
        definitionId: "assistant",
        agentId: "assistant",
        conversationId: "conversation-1",
        workspaceId: "test",
        runId: "run-installed",
        input: {},
        glove,
        store: glove.store,
        emit: (event) => events.push(event.type),
      },
    }),
  );
  const names = glove.tools.map((tool) => tool.name);
  assert.ok(names.includes("shared_echo"));
  assert.ok(names.includes("notes_namespace"));
  assert.equal(names.includes("memory_marker"), false);
  assert.equal(installed.length, 2);
  assert.equal(events.length, 2);
});

test("memory profiles mount from the agent definition", async () => {
  const glove = runnable();
  const events: string[] = [];
  await Effect.runPromise(mountAgentDefinitionMemory({
    registry,
    memory: [memory],
    context: {
      ...messageContext,
      definitionId: "assistant",
      agentId: "assistant",
      conversationId: "conversation-1",
      workspaceId: "test",
      runId: "run-definition-surfaces",
      input: {},
      glove,
      store: glove.store,
      emit: (event) => events.push(event.type),
    },
  }));
  assert.ok(glove.tools.some((tool) => tool.name === "memory_marker"));
  assert.deepEqual(events, ["foundry.definition.memory.mounted"]);
});

test("application config is validated before its installer runs", async () => {
  const glove = runnable();
  await assert.rejects(
    Effect.runPromise(
      installRegistry({
        registry,
        installations: [
          { kind: "application", id: "notes", config: { namespace: 42 } },
        ],
        context: {
          ...messageContext,
          definitionId: "assistant",
          agentId: "assistant",
          conversationId: "conversation-1",
          workspaceId: "test",
          runId: "bad-config",
          input: {},
          glove,
          store: glove.store,
          emit: () => {},
        },
      }),
    ),
    /Invalid config/,
  );
});

test("application sessions use instance-selected account ids without credential handling", async () => {
  const glove = runnable();
  let opened = "";
  let seen = "";
  const accountApp = defineAgentApplication({
    id: "account-app",
    description: "Account scoped app",
    config: z.object({}),
    install: ({ accountId, withAccountSession }) =>
      withAccountSession!("resolve-tools", (session) => Effect.sync(() => {
        seen = `${accountId}:${String(session)}`;
        return { tools: [] };
      })),
  });
  await Effect.runPromise(installRegistry({
    registry: { ...registry, applications: [...registry.applications, accountApp] },
    installations: [{ kind: "application", id: "account-app", accountId: "account-42", config: {} }],
    context: {
      ...messageContext,
      definitionId: "assistant", agentId: "agent-1", conversationId: "conversation-1", workspaceId: "test",
      runId: "account-run", input: {}, glove, store: glove.store, emit: () => undefined,
    },
    accountSessions: {
      identifier: "test-sessions",
      withSession: (request, use) => {
        opened = `${request.accountId}:${request.operation}`;
        return use("opaque-session");
      },
    },
  }));
  assert.equal(opened, "account-42:resolve-tools");
  assert.equal(seen, "account-42:opaque-session");
});
