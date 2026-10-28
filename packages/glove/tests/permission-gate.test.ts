import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { Glove, MemoryStore, Displaymanager, type ModelAdapter, type ToolResult } from "../src/index";

function run(gate: (input: { path: string }) => boolean | Promise<boolean>) {
  const results: ToolResult[] = [];
  let calls = 0; let ran = 0;
  const model: ModelAdapter = { name: "test", setSystemPrompt() {}, async prompt(request) {
    if (calls++ === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "w", tool_name: "write", input_args: { path: "/etc/hosts" } }] }], tokens_in: 1, tokens_out: 1 };
    results.push(...(request.messages.at(-1)!.tool_results ?? []));
    return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
  } };
  const store = new MemoryStore("gate");
  const builder = new Glove({ model, store, displayManager: new Displaymanager(), systemPrompt: "s", compaction_config: { compaction_instructions: "c" } });
  builder.fold({ name: "write", description: "Write", inputSchema: z.object({ path: z.string() }), requiresPermission: gate,
    do: async () => { ran++; return { status: "success", data: "written" }; } });
  return { agent: builder.build(), store, results, ran: () => ran };
}

test("an async requiresPermission predicate is awaited", async () => {
  // Resolves false: no permission check, the tool runs.
  const open = run(async () => { await new Promise((r) => setTimeout(r, 1)); return false; });
  await open.agent.processRequest("go");
  assert.equal(open.ran(), 1);

  // Resolves true: the stored denial applies. A pending Promise must not be
  // mistaken for a truthy gate that skips the lookup, nor for "no gate".
  const gated = run(async ({ path }) => path.startsWith("/etc"));
  await gated.store.setPermission!("write", "denied", { path: "/etc/hosts" });
  await gated.agent.processRequest("go");
  assert.equal(gated.ran(), 0);
  assert.match(gated.results[0].result.message!, /Permission denied/);
});

test("a synchronous predicate still works", async () => {
  const gated = run(({ path }) => path.startsWith("/etc"));
  await gated.store.setPermission!("write", "denied", { path: "/etc/hosts" });
  await gated.agent.processRequest("go");
  assert.equal(gated.ran(), 0);
});
