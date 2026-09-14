import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { ModelAdapter } from "../src/core";
import { Glove } from "../src/glove";
import { MemoryStore } from "../src/utils";

const model: ModelAdapter = {
  name: "registry-test",
  setSystemPrompt() {},
  async prompt() {
    return { messages: [{ sender: "agent", text: "ok" }] };
  },
};

function tool(name: string) {
  return {
    name,
    description: name,
    inputSchema: z.object({}),
    async do() {
      return { status: "success" as const, data: name };
    },
  };
}

function glove() {
  return new Glove({
    model,
    displayManager: { push: async () => undefined, pushAndWait: async () => undefined },
    systemPrompt: "test",
    store: new MemoryStore("tool-registry-test"),
    compaction_config: { compaction_instructions: "compact" },
  });
}

test("replaceTools swaps a dynamic tool set without disturbing registration order", () => {
  const runtime = glove()
    .fold(tool("before"))
    .fold(tool("remote_old"))
    .fold(tool("after"));

  const previousArray = runtime.tools;
  runtime.replaceTools(["remote_old"], [tool("remote_new"), tool("remote_extra")]);

  assert.deepEqual(previousArray.map((entry) => entry.name), ["glove_update_tasks", "before", "remote_old", "after"]);
  assert.deepEqual(runtime.tools.map((entry) => entry.name), [
    "glove_update_tasks",
    "before",
    "remote_new",
    "remote_extra",
    "after",
  ]);
});

test("replaceTools is fail-closed for duplicate or foreign names", () => {
  const runtime = glove().fold(tool("owned")).fold(tool("foreign"));

  assert.throws(
    () => runtime.replaceTools(["owned"], [tool("duplicate"), tool("DUPLICATE")]),
    /duplicate tool/i,
  );
  assert.deepEqual(runtime.tools.map((entry) => entry.name), ["glove_update_tasks", "owned", "foreign"]);

  assert.throws(
    () => runtime.replaceTools(["owned"], [tool("FOREIGN")]),
    /owned by another registry/i,
  );
  assert.deepEqual(runtime.tools.map((entry) => entry.name), ["glove_update_tasks", "owned", "foreign"]);
});
