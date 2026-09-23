import assert from "node:assert/strict";
import { test } from "node:test";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import { defineAgent, FOUNDRY_EXECUTION_MARKER } from "../src/definition.js";
import { JsSession, mountJs } from "glove-js";

function envelope() {
  const now = new Date().toISOString();
  return {
    [FOUNDRY_EXECUTION_MARKER]: true,
    request: { agentId: "agent", conversationId: "conversation", workspaceId: "workspace", message: "do work", source: { kind: "direct" } },
    agent: { id: "agent", definitionId: "execution", workspaceId: "workspace", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
    conversation: { id: "conversation", agentId: "agent", workspaceId: "workspace", context: {}, createdAt: now, updatedAt: now },
  };
}

test("configure mounts capabilities per run with generic teardown", async () => {
  const closed: string[] = [];
  const sessions = new Map<string, JsSession>();
  const definition = defineAgent({
    id: "execution", description: "Explicit mount",
    configure: (agent, context) => {
      const session = JsSession.create();
      sessions.set(context.conversationId, session);
      context.onCleanup(() => { sessions.delete(context.conversationId); closed.push("session"); });
      mountJs(agent, { session });
      context.onCleanup(async () => { closed.push("last-mounted"); });
    },
    run: async (_agent, context) => {
      const session = sessions.get(context.conversationId)!;
      assert.equal((await session.execute("const answer = 6 * 7; answer")).value, 42);
      return "done";
    },
  });
  for (let i = 0; i < 2; i++) await compileAgentDefinition(definition, "execution").handler!(envelope());
  assert.deepEqual(closed, ["last-mounted", "session", "last-mounted", "session"]);
  assert.equal(sessions.size, 0);
});

test("failed configure or execution releases explicitly registered mounts", async () => {
  for (const stage of ["configure", "run"] as const) {
    const closed: string[] = [];
    const definition = defineAgent({ id: "execution", description: "Failure cleanup",
      configure: (_agent, context) => {
        context.onCleanup(() => { closed.push("mounted"); });
        if (stage === "configure") throw new Error("configure unavailable");
      },
      run: () => { throw new Error("run unavailable"); },
    });
    await assert.rejects(compileAgentDefinition(definition, "execution").handler!(envelope()), new RegExp(`${stage} unavailable`));
    assert.deepEqual(closed, ["mounted"]);
  }
});

test("a failed teardown does not prevent other mounts from closing", async () => {
  const closed: string[] = [];
  const definition = defineAgent({ id: "execution", description: "Cleanup failure",
    configure: (_agent, context) => {
      context.onCleanup(() => { closed.push("first"); });
      context.onCleanup(() => { closed.push("second"); throw new Error("close failed"); });
    },
    run: () => "done",
  });
  await assert.rejects(compileAgentDefinition(definition, "execution").handler!(envelope()), /cleanup failed/);
  assert.deepEqual(closed, ["second", "first"]);
});
