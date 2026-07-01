import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "glove-sql";
import { materializeTable } from "../src/db/materialize";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";

// Regression: a virtual table left behind by an earlier (partially failed)
// materialization used to make the next statement's CREATE throw "relation
// already exists", derailing the agent. Materialization is now idempotent
// (DROP IF EXISTS before CREATE) and the table is tracked for teardown BEFORE
// it is created.

test("materializeTable is idempotent — a leaked table does not block re-create", async () => {
  const backend = await MemoryBackend.create();
  const cols = [
    { name: "id", type: "bigint" },
    { name: "t", type: "text" },
  ];
  await materializeTable(backend, "x", cols, [{ id: 1, t: "a" }]);
  // Simulate a leak: do NOT drop, then re-materialize the same name.
  await materializeTable(backend, "x", cols, [{ id: 2, t: "b" }]);
  const r = await backend.query(`SELECT id, t FROM "x"`);
  assert.deepEqual(r.rows, [{ id: 2, t: "b" }]); // fresh contents, no throw
});

test("a virtual table can be queried across consecutive statements", async () => {
  const db = await Database.create({ policy: { writes: false } });
  let calls = 0;
  db.register(
    defineResource({
      name: "widgets",
      volatility: "stable",
      columns: [
        { name: "id", type: "bigint" },
        { name: "name", type: "text" },
      ],
      select: async () => {
        calls++;
        return [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
        ];
      },
    }),
  );
  const a = await db.execute(`SELECT COUNT(*) AS n FROM widgets`);
  const b = await db.execute(`SELECT name FROM widgets WHERE id = 2`);
  assert.equal(Number(a.rows[0].n), 2);
  assert.deepEqual(b.rows, [{ name: "b" }]);
  assert.equal(calls, 2); // materialized + torn down cleanly each statement
});
