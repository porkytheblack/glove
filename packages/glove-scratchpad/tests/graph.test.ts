import { test } from "node:test";
import assert from "node:assert/strict";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { buildScratchpadGraph, parseGraphDef, type GraphDef } from "../src/graph";
import { SCRATCHPAD_PREAMBLE } from "../src/tools/mount";

/** A minimal fake runnable that records what the adapter wires onto it. */
function fakeRunnable() {
  const tools: GloveFoldArgs<unknown>[] = [];
  let prompt = "";
  const runnable = {
    tools,
    get folded() {
      return tools.map((t) => t.name);
    },
    get prompt() {
      return prompt;
    },
    toolNamed(name: string) {
      return tools.find((t) => t.name === name);
    },
    setSystemPrompt(p: string) {
      prompt = p;
    },
    getSystemPrompt() {
      return prompt;
    },
    fold(tool: GloveFoldArgs<unknown>) {
      tools.push(tool);
      return runnable as unknown as IGloveRunnable;
    },
  };
  return runnable;
}

async function freshSp(): Promise<Scratchpad> {
  return Scratchpad.create(await MemoryBackend.create());
}

const tool = (name: string): GloveFoldArgs<Record<string, never>> => ({
  name,
  description: name,
  async do() {
    return { status: "success", data: null };
  },
});

const DEF: GraphDef = {
  name: "triage",
  entry: "planner",
  subagents: [
    { name: "planner", prompt: "You plan.", tools: ["issues__search"] },
    { name: "reader", prompt: "You read.", prime: false, scratchpad: false },
  ],
  edges: [{ from: "planner", to: "reader", when: "after narrowing" }],
};

test("builds nodes, entry, and edge topology from the definition", async () => {
  const sp = await freshSp();
  const fakes = new Map<string, ReturnType<typeof fakeRunnable>>();
  const graph = await buildScratchpadGraph(DEF, {
    scratchpad: sp,
    tools: { issues__search: tool("issues__search") as GloveFoldArgs<unknown> },
    createAgent: (spec) => {
      const f = fakeRunnable();
      fakes.set(spec.name, f);
      return f as unknown as IGloveRunnable;
    },
  });

  assert.equal(graph.entry.spec.name, "planner");
  assert.deepEqual([...graph.nodes.keys()], ["planner", "reader"]);
  assert.deepEqual(graph.next("planner").map((n) => n.spec.name), ["reader"]);
  assert.deepEqual(graph.next("reader"), []);
  await sp.close();
});

test("partitions tools per subagent and mounts the scratchpad surface (interface disclosure)", async () => {
  const sp = await freshSp();
  const fakes = new Map<string, ReturnType<typeof fakeRunnable>>();
  await buildScratchpadGraph(DEF, {
    scratchpad: sp,
    tools: { issues__search: tool("issues__search") as GloveFoldArgs<unknown> },
    createAgent: (spec) => {
      const f = fakeRunnable();
      fakes.set(spec.name, f);
      return f as unknown as IGloveRunnable;
    },
  });

  // planner: its slice + the 4 scratchpad surface tools.
  const planner = fakes.get("planner")!;
  assert.ok(planner.folded.includes("issues__search"));
  assert.ok(planner.folded.includes("scratchpad_query"));
  assert.ok(planner.folded.includes("scratchpad_materialize"));
  assert.equal(planner.folded.filter((n) => n.startsWith("scratchpad_")).length, 4);
  // prime default true → preamble prepended.
  assert.ok(planner.prompt.startsWith(SCRATCHPAD_PREAMBLE));
  assert.ok(planner.prompt.endsWith("You plan."));

  // reader: scratchpad disabled and prime:false → no scratchpad tools, raw prompt.
  const reader = fakes.get("reader")!;
  assert.equal(reader.folded.filter((n) => n.startsWith("scratchpad_")).length, 0);
  assert.equal(reader.prompt, "You read.");
  await sp.close();
});

test("requesting an unknown tool fails fast", async () => {
  const sp = await freshSp();
  await assert.rejects(
    () =>
      buildScratchpadGraph(
        { entry: "a", subagents: [{ name: "a", prompt: "x", tools: ["missing"] }] },
        { scratchpad: sp, createAgent: () => fakeRunnable() as unknown as IGloveRunnable },
      ),
    /unknown tool "missing"/,
  );
  await sp.close();
});

test("parseGraphDef enforces shape and cross-field invariants", () => {
  // entry not a declared subagent
  assert.throws(
    () => parseGraphDef({ entry: "ghost", subagents: [{ name: "a", prompt: "p" }] }),
    /entry "ghost" is not a declared subagent/,
  );
  // duplicate names
  assert.throws(
    () =>
      parseGraphDef({
        entry: "a",
        subagents: [
          { name: "a", prompt: "p" },
          { name: "a", prompt: "q" },
        ],
      }),
    /duplicate subagent name "a"/,
  );
  // edge endpoint missing
  assert.throws(
    () =>
      parseGraphDef({
        entry: "a",
        subagents: [{ name: "a", prompt: "p" }],
        edges: [{ from: "a", to: "b" }],
      }),
    /edge.to "b" is not a declared subagent/,
  );
  // empty subagents
  assert.throws(() => parseGraphDef({ entry: "a", subagents: [] }), /Invalid graph definition/);
});

test("provenance: a tool mounted on a node stamps the subagent name as actor", async () => {
  const sp = await freshSp();
  const fakes = new Map<string, ReturnType<typeof fakeRunnable>>();
  await buildScratchpadGraph(DEF, {
    scratchpad: sp,
    tools: { issues__search: tool("issues__search") as GloveFoldArgs<unknown> },
    createAgent: (spec) => {
      const f = fakeRunnable();
      fakes.set(spec.name, f);
      return f as unknown as IGloveRunnable;
    },
  });

  // Invoke the planner's mounted scratchpad_query (store mode) and confirm the
  // resulting record's provenance carries the subagent's name as actor.
  const planner = fakes.get("planner")!;
  const query = planner.toolNamed("scratchpad_query") as GloveFoldArgs<{ sql: string; store?: string }>;
  assert.ok(query, "planner has a mounted scratchpad_query");
  await query.do({ sql: "SELECT 1 AS x", store: "via_planner" }, undefined as never, undefined as never);

  const d = await sp.describe("via_planner");
  assert.equal(d.provenance.actor, "planner");
  assert.equal(d.provenance.source, "query");
  await sp.close();
});
