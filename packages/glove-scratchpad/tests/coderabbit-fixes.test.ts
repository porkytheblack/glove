import { test } from "node:test";
import assert from "node:assert/strict";
import type { IGloveRunnable } from "glove-core/glove";
import type { Message } from "glove-core/core";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { buildScratchpadGraph, runScratchpadGraph, type GraphDef } from "../src/graph";

// Regression tests for issues raised in external (CodeRabbit) review of the
// Scratchpad Computer PR: read-only guards, ref allocation across physical child
// tables, normalization fidelity, and workflow cycle handling.

async function sp(): Promise<Scratchpad> {
  return Scratchpad.create(await MemoryBackend.create());
}

// ── read-only guards (data-modifying CTEs + store mode) ─────────────────────

test("query() rejects a data-modifying CTE and leaves the store intact", async () => {
  const s = await sp();
  await s.ingest([{ id: 1 }, { id: 2 }], { name: "rec" });
  await assert.rejects(
    () => s.query(`WITH gone AS (DELETE FROM rec RETURNING *) SELECT * FROM gone`),
    /data-modifying/i,
  );
  const after = await s.materialize({ ref: "rec" });
  assert.equal(after.rows.length, 2); // nothing was deleted
});

test("materialize({ sql }) rejects a data-modifying CTE", async () => {
  const s = await sp();
  await s.ingest([{ id: 1 }], { name: "rec" });
  await assert.rejects(
    () => s.materialize({ sql: `WITH x AS (DELETE FROM rec RETURNING *) SELECT * FROM x` }),
    /data-modifying/i,
  );
});

test("store mode enforces the single-statement / read-only guard", async () => {
  const s = await sp();
  await s.ingest([{ id: 1 }], { name: "rec" });
  await assert.rejects(
    () => s.query(`SELECT 1; DROP TABLE rec`, { store: "derived" }),
    /single statement/i,
  );
  assert.ok((await s.refs()).includes("rec")); // rec survives
});

// ── ref allocation across physical child tables ─────────────────────────────

test("ingest never reuses a name that collides with an existing child table", async () => {
  const s = await sp();
  // a nested array creates the physical child table `doc__authors`
  await s.ingest([{ id: 1, authors: ["ada", "linus"] }], { name: "doc" });
  // a later record explicitly named after that child table must not collide
  const stub = await s.ingest([{ id: 2 }], { name: "doc__authors" });
  assert.notEqual(stub.ref, "doc__authors");
});

// ── normalization fidelity ──────────────────────────────────────────────────

test("a heterogeneous array/scalar field is kept (no data loss)", async () => {
  const s = await sp();
  const stub = await s.ingest([{ tags: ["a"] }, { tags: "b" }], { name: "rec" });
  // kept as a single root table (jsonb column), not split into a child table
  assert.equal(stub.descriptor.tables.length, 1);
  const rows = await s.materialize({ ref: "rec" });
  assert.equal(rows.rows.length, 2); // the scalar "b" row is preserved
});

test("child _idx resets per parent row", async () => {
  const s = await sp();
  await s.ingest(
    [
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: ["c"] },
    ],
    { name: "rec" },
  );
  const child = await s.materialize({
    sql: `SELECT "value", "_idx" FROM "rec__tags" ORDER BY "_parent", "_idx"`,
  });
  const idxOf = Object.fromEntries(child.rows.map((r) => [r.value, Number(r._idx)]));
  assert.equal(idxOf["a"], 0);
  assert.equal(idxOf["b"], 1);
  assert.equal(idxOf["c"], 0); // first child of parent 2 → idx 0, not the global 2
});

// ── workflow runner: a no-terminal cycle must not report success ────────────

function factory(scripts: Record<string, () => Promise<string>>) {
  return (spec: { name: string }) => {
    const r = {
      setSystemPrompt() {},
      getSystemPrompt() {
        return "";
      },
      fold() {
        return r as unknown as IGloveRunnable;
      },
      async processRequest(): Promise<Message> {
        const fn = scripts[spec.name];
        return { sender: "agent", text: fn ? await fn() : `[${spec.name}] ok` };
      },
    };
    return r as unknown as IGloveRunnable;
  };
}

test("a graph with no terminal node (a → b → a) never reports resolved", async () => {
  const s = await sp();
  const CYCLE: GraphDef = {
    name: "loop",
    entry: "a",
    subagents: [
      { name: "a", prompt: "step a" },
      { name: "b", prompt: "step b" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  };
  const graph = await buildScratchpadGraph(CYCLE, {
    scratchpad: s,
    createAgent: factory({ a: async () => "a ran", b: async () => "b ran" }),
  });
  const result = await runScratchpadGraph(graph, { objective: "loop", maxSteps: 5 });
  assert.equal(result.resolved, false);
  await s.close();
});
