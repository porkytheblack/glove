import { test } from "node:test";
import assert from "node:assert/strict";
import type { IGloveRunnable } from "glove-core/glove";
import type { Message } from "glove-core/core";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { buildScratchpadGraph, runScratchpadGraph, workflowTools, type GraphDef } from "../src/graph";

type Script = (sp: Scratchpad, prompt: string) => Promise<string>;

/**
 * A factory of stub runnables whose processRequest runs a per-name script over
 * the shared scratchpad (standing in for a real subagent working its tools), and
 * a record of the prompts each node received (to assert handoff threading).
 */
function makeFactory(sp: Scratchpad, scripts: Record<string, Script>) {
  const prompts = new Map<string, string[]>();
  const factory = (spec: { name: string }) => {
    const r = {
      setSystemPrompt() {},
      getSystemPrompt() {
        return "";
      },
      fold() {
        return r as unknown as IGloveRunnable;
      },
      async processRequest(req: string | unknown[]): Promise<Message> {
        const text = String(req);
        const seen = prompts.get(spec.name) ?? [];
        seen.push(text);
        prompts.set(spec.name, seen);
        const fn = scripts[spec.name];
        return { sender: "agent", text: fn ? await fn(sp, text) : `[${spec.name}] ok` };
      },
    };
    return r as unknown as IGloveRunnable;
  };
  return { factory, prompts };
}

async function seeded(): Promise<Scratchpad> {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  await sp.ingest(
    Array.from({ length: 6 }, (_, i) => ({
      id: i,
      state: i % 2 ? "open" : "closed",
      priority: i % 3 === 0 ? "P0" : "P1",
    })),
    { name: "issues" },
  );
  return sp;
}

const PIPELINE_SCRIPTS: Record<string, Script> = {
  planner: async (sp) => {
    await sp.query(`SELECT id, priority FROM issues WHERE state = 'open'`, { store: "open" });
    return "stored open issues as 'open'";
  },
  analyst: async (sp) => {
    await sp.query(`SELECT priority, count(*)::int AS n FROM open GROUP BY priority ORDER BY priority`, {
      store: "by_priority",
    });
    return "aggregated into 'by_priority'";
  },
  writer: async (sp) => {
    const m = await sp.materialize({ ref: "by_priority" });
    return "ANSWER: " + JSON.stringify(m.rows);
  },
};

const PIPELINE: GraphDef = {
  name: "triage",
  entry: "planner",
  subagents: [
    { name: "planner", prompt: "plan" },
    { name: "analyst", prompt: "aggregate" },
    { name: "writer", prompt: "summarize" },
  ],
  edges: [
    { from: "planner", to: "analyst" },
    { from: "analyst", to: "writer" },
  ],
};

test("runScratchpadGraph executes in dependency order, threads handoffs, resolves an answer", async () => {
  const sp = await seeded();
  const { factory, prompts } = makeFactory(sp, PIPELINE_SCRIPTS);
  const graph = await buildScratchpadGraph(PIPELINE, { scratchpad: sp, createAgent: factory });

  const result = await runScratchpadGraph(graph, { objective: "open issues by priority" });

  // order + resolution
  assert.deepEqual(result.steps.map((s) => s.subagent), ["planner", "analyst", "writer"]);
  assert.equal(result.resolved, true);

  // terminal answer is the writer's output, computed from the shared store
  assert.match(result.answer, /^ANSWER: /);
  assert.deepEqual(JSON.parse(result.answer.replace("ANSWER: ", "")), [
    { priority: "P0", n: 1 },
    { priority: "P1", n: 2 },
  ]);

  // references accumulated across subagents in the shared scratchpad
  assert.ok(["issues", "open", "by_priority"].every((r) => result.refs.includes(r)));

  // handoff threading: the analyst's prompt carries the planner's note + the ref list
  const analystPrompt = prompts.get("analyst")![0];
  assert.match(analystPrompt, /stored open issues as 'open'/);
  assert.match(analystPrompt, /Scratchpad references available:/);
  // the writer is told it is the final step
  assert.match(prompts.get("writer")![0], /FINAL step/);
  await sp.close();
});

test("workflow_create + workflow_run drive the graph as agent tools", async () => {
  const sp = await seeded();
  const { factory } = makeFactory(sp, PIPELINE_SCRIPTS);
  const tools = workflowTools({ scratchpad: sp, createAgent: factory });
  const create = tools.find((t) => t.name === "workflow_create")!;
  const run = tools.find((t) => t.name === "workflow_run")!;
  const inspect = tools.find((t) => t.name === "workflow_inspect")!;

  const created = await create.do(PIPELINE as never, undefined as never, undefined as never);
  assert.equal(created.status, "success");
  const id = (created.data as { id: string }).id;
  assert.equal(id, "triage");

  const seen = await inspect.do({ id } as never, undefined as never, undefined as never);
  assert.equal((seen.data as { entry: string }).entry, "planner");

  const ran = await run.do(
    { id, objective: "open issues by priority" } as never,
    undefined as never,
    undefined as never,
  );
  assert.equal(ran.status, "success");
  const data = ran.data as { answer: string; resolved: boolean; steps: unknown[]; refs: string[] };
  assert.match(data.answer, /^ANSWER: /);
  assert.equal(data.resolved, true);
  assert.equal(data.steps.length, 3);
  assert.ok(data.refs.includes("by_priority"));
  await sp.close();
});

test("workflow_run errors clearly for an unknown id", async () => {
  const sp = await seeded();
  const { factory } = makeFactory(sp, PIPELINE_SCRIPTS);
  const run = workflowTools({ scratchpad: sp, createAgent: factory }).find((t) => t.name === "workflow_run")!;
  const res = await run.do({ id: "ghost", objective: "x" } as never, undefined as never, undefined as never);
  assert.equal(res.status, "error");
  assert.match(res.message ?? "", /No workflow with id "ghost"/);
  await sp.close();
});

test("diamond topology runs each node after its predecessors", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const scripts: Record<string, Script> = {
    a: async () => "a",
    b: async () => "b",
    c: async () => "c",
    d: async () => "d",
  };
  const { factory } = makeFactory(sp, scripts);
  const def: GraphDef = {
    entry: "a",
    subagents: [
      { name: "a", prompt: "a" },
      { name: "b", prompt: "b" },
      { name: "c", prompt: "c" },
      { name: "d", prompt: "d" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ],
  };
  const graph = await buildScratchpadGraph(def, { scratchpad: sp, createAgent: factory });
  const result = await runScratchpadGraph(graph, { objective: "x" });
  const order = result.steps.map((s) => s.subagent);
  assert.equal(order[0], "a");
  assert.equal(order[3], "d");
  assert.ok(order.indexOf("b") < order.indexOf("d") && order.indexOf("c") < order.indexOf("d"));
  assert.equal(result.answer, "d"); // single terminal
  await sp.close();
});

test("maxSteps caps execution and reports unresolved", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const { factory } = makeFactory(sp, { a: async () => "a", b: async () => "b", c: async () => "c" });
  const def: GraphDef = {
    entry: "a",
    subagents: [
      { name: "a", prompt: "a" },
      { name: "b", prompt: "b" },
      { name: "c", prompt: "c" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  };
  const graph = await buildScratchpadGraph(def, { scratchpad: sp, createAgent: factory });
  const result = await runScratchpadGraph(graph, { objective: "x", maxSteps: 2 });
  assert.equal(result.steps.length, 2);
  assert.equal(result.resolved, false); // terminal "c" never ran
  await sp.close();
});
