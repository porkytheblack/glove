import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";

// Last-mile affordances for weak models, each traced to a real benchmark failure:
// - a write result must carry the row count (a model that sees `rows: []` after
//   INSERT … SELECT concludes it wrote nothing),
// - WITH … INSERT and INSERT … SELECT … RETURNING must work on virtual tables,
// - a 0-row read should nudge a filter re-check,
// - a BEGIN-wrapped SELECT script must not silently discard the rows.

function world() {
  const sent: Record<string, unknown>[] = [];
  const issues = defineResource({
    name: "issues",
    volatility: "stable",
    columns: [
      { name: "id", type: "text" },
      { name: "count", type: "bigint" },
      { name: "status", type: "text", description: "unresolved | resolved" },
    ],
    select: async () => [
      { id: "S-1", count: 10, status: "unresolved" },
      { id: "S-2", count: 99, status: "unresolved" },
      { id: "S-3", count: 5, status: "resolved" },
    ],
  });
  const emails = defineResource({
    name: "emails",
    volatility: "volatile",
    columns: [
      { name: "to_addr", type: "text" },
      { name: "subject", type: "text" },
      { name: "body", type: "text" },
    ],
    select: async () => [],
    insert: async (rows: Record<string, unknown>[]) => {
      sent.push(...rows);
    },
  });
  return { issues, emails, sent };
}

async function db() {
  const w = world();
  const d = await Database.create({ policy: { writes: true } });
  d.register(w.issues).register(w.emails);
  return { d, ...w };
}

test("INSERT … SELECT result carries the row count (command tag)", async () => {
  const { d, sent } = await db();
  const r = await d.execute(`INSERT INTO emails (to_addr, subject, body) SELECT 'x@y.io', 'S', id FROM issues WHERE status = 'unresolved'`);
  assert.equal(r.rowCount, 2);
  assert.match(r.message ?? "", /fired — 2 row\(s\)/);
  assert.equal(sent.length, 2);
});

test("WITH … INSERT works on virtual tables", async () => {
  const { d, sent } = await db();
  const r = await d.execute(
    `WITH top AS (SELECT id FROM issues WHERE status = 'unresolved' ORDER BY count DESC LIMIT 1)
     INSERT INTO emails (to_addr, subject, body) SELECT 'x@y.io', 'S', 'top: ' || id FROM top`,
  );
  assert.equal(r.rowCount, 1);
  assert.equal(sent[0].body, "top: S-2");
});

test("INSERT … SELECT … RETURNING works on virtual tables (subquery source)", async () => {
  const { d } = await db();
  const r = await d.execute(
    `INSERT INTO emails (to_addr, subject, body)
     SELECT 'x@y.io', 'S', 'b: ' || id FROM (SELECT id FROM issues WHERE status='unresolved' ORDER BY count DESC LIMIT 1) AS sub
     RETURNING to_addr, body`,
  );
  assert.deepEqual(r.rows, [{ to_addr: "x@y.io", body: "b: S-2" }]);
});

test("a 0-row read carries a re-check nudge; non-empty reads don't", async () => {
  const { d } = await db();
  const empty = await d.execute(`SELECT id FROM issues WHERE id LIKE 'billing-%'`);
  assert.match(empty.note ?? "", /re-check your filter values/);
  assert.match(empty.note ?? "", /issues/); // names the table to inspect
  const full = await d.execute(`SELECT id FROM issues WHERE status = 'unresolved'`);
  assert.equal(full.note, undefined);
});

test("a BEGIN-wrapped SELECT script returns the SELECT's rows", async () => {
  const { d } = await db();
  const r = await d.execute(`BEGIN; SELECT count(*) AS n FROM issues WHERE status = 'unresolved'; COMMIT;`);
  assert.deepEqual(r.rows, [{ n: 2 }]);
  assert.match(r.note ?? "", /script's last SELECT/);
});

test("the multi-statement error steers to one-per-call, not BEGIN", async () => {
  const { d } = await db();
  await assert.rejects(() => d.execute(`SELECT 1; SELECT 2;`), /ONE statement per call/);
});

test("staged and committed writes report counts", async () => {
  const { d } = await db();
  await d.execute(`BEGIN`);
  const staged = await d.execute(`INSERT INTO emails (to_addr, subject, body) SELECT 'x@y.io', 'S', id FROM issues`);
  assert.equal(staged.rowCount, 3);
  assert.match(staged.message ?? "", /staged insert .* 3 row\(s\)/);
  const commit = await d.execute(`COMMIT`);
  assert.match(commit.message ?? "", /insert on "emails" \(3 rows\)/);
});
