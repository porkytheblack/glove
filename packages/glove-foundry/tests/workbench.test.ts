import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { JsSession } from "glove-js";
import { LispSession } from "glove-lisp";
import { PySession } from "glove-python";
import type { EnvSnapshot } from "glove-working-environment";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import {
  FOUNDRY_EXECUTION_MARKER,
  defineAgent,
  resolveResolvable,
} from "../src/definition.js";
import { MemoryFoundryDataAdapter } from "../src/primitives.js";
import {
  defineRepl,
  defineWorkingEnvironment,
  foundryDataEnvironmentPersistence,
  type FoundryWorkingEnvironmentPersistenceAdapter,
} from "../src/workbench.js";

function envelope(message: string) {
  return {
    [FOUNDRY_EXECUTION_MARKER]: true as const,
    request: {
      agentId: "agent-workbench",
      conversationId: "conversation-workbench",
      workspaceId: "workbench-test",
      message,
      source: { kind: "direct" as const },
    },
    agent: {
      id: "agent-workbench",
      definitionId: "workbench",
      workspaceId: "workbench-test",
      context: {},
      installations: [],
      playbooks: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    conversation: {
      id: "conversation-workbench",
      agentId: "agent-workbench",
      workspaceId: "workbench-test",
      context: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

test("working environments restore their VFS and REPLs mount from lazy context", async () => {
  let saved: EnvSnapshot | null = null;
  const persistence: FoundryWorkingEnvironmentPersistenceAdapter = {
    identifier: "test-snapshots",
    load: () => saved,
    save: (snapshot) => {
      saved = structuredClone(snapshot);
    },
  };
  const definition = defineAgent({
    description: "Foundry workbench fixture",
    workingEnvironment: defineWorkingEnvironment({ persistence }),
    repl: (_agent, { messageText }) => {
      const session = JsSession.create();
      return messageText.includes("compute")
        ? defineRepl({ language: "javascript", session, mount: { prime: false } })
        : undefined;
    },
    run: async (_agent, context) => {
      assert.ok(context.workingEnvironment);
      assert.ok(context.vfs);
      const existed = await context.vfs.exists("/out/state.txt");
      const previous = existed
        ? await context.vfs.readFile("/out/state.txt")
        : null;
      await context.vfs.writeFile("/out/state.txt", context.messageText);
      assert.equal(context.repl?.language, "javascript");
      const computed = context.repl?.language === "javascript"
        ? await context.repl.session.execute("const total = 20 + 22; total")
        : null;
      return { existed, previous, computed: computed?.value };
    },
  });
  const compiled = compileAgentDefinition(definition, "workbench");

  const first = await compiled.handler!(envelope("compute one"));
  assert.deepEqual(first.value, {
    existed: false,
    previous: null,
    computed: 42,
  });
  const firstSnapshot = saved as EnvSnapshot | null;
  assert.ok(firstSnapshot);
  assert.ok(firstSnapshot.files.some((file) => file.path === "/out/state.txt"));

  const second = await compiled.handler!(envelope("compute two"));
  assert.deepEqual(second.value, {
    existed: true,
    previous: "compute one",
    computed: 42,
  });
});

test("working-environment definitions reject ambiguous factories", () => {
  assert.throws(
    () => defineWorkingEnvironment({
      options: {},
      create: async () => {
        throw new Error("unused");
      },
    }),
    /either create or options/,
  );
});

test("Python and Lisp use the same typed REPL assembly field", async () => {
  const definitions = [
    defineRepl({
      language: "python",
      session: PySession.create(),
      mount: { prime: false },
    }),
    defineRepl({
      language: "lisp",
      session: LispSession.create(),
      mount: { prime: false },
    }),
  ] as const;

  for (const repl of definitions) {
    const definition = defineAgent({
      description: `${repl.language} REPL fixture`,
      repl,
      run: (_agent, context) => context.repl?.language,
    });
    const compiled = compileAgentDefinition(definition, `workbench-${repl.language}`);
    const result = await compiled.handler!(envelope(`mount ${repl.language}`));
    assert.equal(result.value, repl.language);
  }
});

test("Foundry data persistence keeps VFS snapshots off public workspace entries", async () => {
  const data = new MemoryFoundryDataAdapter();
  const persistence = foundryDataEnvironmentPersistence({ scope: "agent" });
  const context = {
    definitionId: "workbench",
    agentId: "agent-workbench",
    conversationId: "conversation-workbench",
    workspaceId: "workbench-test",
    runId: "run-workbench",
    data,
    signal: new AbortController().signal,
  };
  const snapshot: EnvSnapshot = {
    version: 1,
    dirs: ["/", "/out"],
    files: [{
      path: "/out/private.txt",
      data: Buffer.from("private working data").toString("base64"),
      mtime: 1,
    }],
  };

  await resolveResolvable(persistence.save(snapshot, context));
  assert.deepEqual(
    await resolveResolvable(persistence.load(context)),
    snapshot,
  );
  assert.deepEqual(
    await Effect.runPromise(data.listWorkspaceEntries(context.workspaceId)),
    [],
  );
});
