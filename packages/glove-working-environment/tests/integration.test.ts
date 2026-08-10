/**
 * End-to-end against a REAL glove-core agent.
 *
 * The package deliberately has no glove-core dependency — `EnvTool` is
 * claimed to be STRUCTURALLY compatible with `GloveFoldArgs`. That claim is
 * only worth anything if it is checked against the real `Glove`, real
 * `Executor`, and real tool-call plumbing rather than a hand-written stand-in.
 *
 * glove-core is consumed through its built `dist/`, so these tests skip
 * (rather than fail) when it hasn't been built — the package's own suite must
 * not depend on another package's build state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment, mountWorkingEnvironment } from "../src/index";

// glove-core is ESM-only, so `require.resolve` can't see it — the honest
// probe is to import it and note whether its dist is actually there.
let core: Record<string, any> | null = null;
try {
  core = (await import("glove-core")) as Record<string, any>;
} catch {
  core = null;
}
const SKIP = { skip: core ? false : "glove-core dist not built — run `pnpm --filter glove-core build`" };

interface ScriptedCall {
  name: string;
  input: unknown;
}

/** A ModelAdapter that replays a fixed tool-call sequence — no API key needed. */
function scriptedModel(calls: ScriptedCall[], seen: { tools: string[] }) {
  let step = 0;
  return {
    name: "scripted-test-model",
    setSystemPrompt(_p: string) {},
    async prompt(
      request: { messages: unknown[]; tools?: Array<{ name: string }> },
      notify?: (event: string, data: unknown) => Promise<void>,
    ) {
      seen.tools = (request.tools ?? []).map((t) => t.name).sort();
      const next = calls[step++];
      if (!next) {
        return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
      }
      // Streaming adapters announce the call before the executor runs it, which
      // is where a UI learns the id it will later match a result against.
      await notify?.("tool_use", { id: `call_${step}`, name: next.name, input: next.input });
      return {
        messages: [
          { sender: "agent", text: "", tool_calls: [{ id: `call_${step}`, tool_name: next.name, input_args: next.input }] },
        ],
        tokens_in: 1,
        tokens_out: 1,
      };
    },
  };
}

async function buildAgent(calls: ScriptedCall[]) {
  const { Glove, Displaymanager, MemoryStore } = core!;
  const env = await createWorkingEnvironment();
  const seen = { tools: [] as string[] };
  const results: Array<{ status: string; data: unknown; message?: string }> = [];
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  const glove = new (Glove as never as new (c: unknown) => any)({
    store: new (MemoryStore as never as new (id: string) => unknown)(`wenv_${calls.length}_${Math.random().toString(36).slice(2)}`),
    model: scriptedModel(calls, seen),
    displayManager: new (Displaymanager as never as new () => unknown)(),
    systemPrompt: "You are a test agent.",
    serverMode: true,
    compaction_config: { compaction_instructions: "summarize" },
  }).build();

  mountWorkingEnvironment(glove, { env });
  glove.addSubscriber({
    async record(event_type: string, data: unknown) {
      events.push({ type: event_type, data: data as Record<string, unknown> });
      if (event_type === "tool_use_result") results.push((data as { result: never }).result);
    },
  });

  return { env, glove, seen, results, events };
}

test("the verb set folds onto a real Glove and the model sees every tool", SKIP, async () => {
  const { glove, seen } = await buildAgent([]);
  await glove.processRequest("hello");
  assert.deepEqual(seen.tools, [
    "checkpoint", "cp", "describe", "diff", "edit_file", "grep", "history", "ls", "mv", "read_file", "redo", "rm", "run_script", "run_tests", "undo", "write_file",
  ]);
  assert.match(glove.getSystemPrompt(), /WORKING ENVIRONMENT/);
});

test("a real agent writes, lists, and runs a script through the real Executor", SKIP, async () => {
  const { env, glove, results } = await buildAgent([
    {
      name: "write_file",
      input: {
        path: "/scripts/tally.js",
        content: `/**\n * Tallies numbers.\n * @param {{ nums: number[] }} args\n * @returns {Promise<{ total: number }>}\n */\nexport default async function tally(args) { return { total: args.nums.reduce((a, b) => a + b, 0) }; }\n`,
      },
    },
    { name: "ls", input: { path: "/scripts" } },
    { name: "run_script", input: { path: "/scripts/tally.js", args: { nums: [1, 2, 3, 4] } } },
  ]);

  await glove.processRequest("tally 1,2,3,4");

  assert.equal(results.length, 3, `expected 3 tool results, got ${results.length}`);
  for (const r of results) assert.equal(r.status, "success", `tool failed: ${r.message}`);

  // The state the agent built is real and inspectable from the host side.
  assert.match(String(results[0].data), /created \/scripts\/tally\.js/);
  assert.match(String(results[1].data), /tally\.js .* — Tallies numbers\./);
  assert.match(String(results[2].data), /"total": 10/);

  const files = (await env.export("/scripts/**")).map((f) => f.path).sort();
  assert.deepEqual(files, ["/scripts/tally.d.ts", "/scripts/tally.js"]);

  const history = await env.tools.find((t) => t.name === "history")!.do({});
  assert.match(String(history.data), /ok\s+\d+ms\s+\/scripts\/tally\.js args=\{"nums":\[1,2,3,4\]\}/);
});

test("a result can be matched to its call on one pair of field names", SKIP, async () => {
  // The trap every host of this package has hit: `tool_use` carries
  // `id`/`name` and `tool_use_result` carried only `call_id`/`tool_name`, so a
  // UI keyed on `id` throughout records the calls, never matches the results,
  // and shows every tool spinning forever — with nothing thrown anywhere.
  const { glove, events } = await buildAgent([
    { name: "ls", input: { path: "/scripts" } },
    { name: "read_file", input: { path: "/skills/README.md" } },
  ]);
  await glove.processRequest("look around");

  const pending = new Map<string, string>();
  for (const { type, data } of events) {
    if (type === "tool_use") pending.set(String(data.id), String(data.name));
    // Deliberately keyed on `id`/`name` only — the same two fields as the call.
    if (type === "tool_use_result") {
      const id = String(data.id);
      assert.equal(pending.get(id), String(data.name), `no open call for result id ${id}`);
      pending.delete(id);
      // The originals are still emitted; nothing that reads them has to change.
      assert.equal(data.call_id, data.id);
      assert.equal(data.tool_name, data.name);
      assert.equal(typeof data.duration_ms, "number");
    }
  }
  assert.deepEqual([...pending.keys()], [], "every call was matched to its result");
});

test("tool errors reach the agent as error results, not thrown exceptions", SKIP, async () => {
  const { glove, results } = await buildAgent([
    { name: "read_file", input: { path: "/nope/missing.txt" } },
    { name: "write_file", input: { path: "/scripts/bad.js", content: "const x = 1;" } },
  ]);

  await glove.processRequest("do two invalid things");

  assert.equal(results.length, 2);
  assert.equal(results[0].status, "error");
  assert.match(String(results[0].message), /no such file/);
  assert.equal(results[1].status, "error");
  assert.match(String(results[1].message), /no default export/);
});
