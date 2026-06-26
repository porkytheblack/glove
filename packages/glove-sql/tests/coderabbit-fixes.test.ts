import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// Regression tests for issues raised in external (CodeRabbit) review of the
// Scratchpad Computer PR: DROP semantics, INSERT column validation, and
// aggregate grouping strictness.

async function be(): Promise<MemoryBackend> {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint, "name" text, "dept" text);`);
  await b.query(
    `INSERT INTO "t" ("id","name","dept") VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9)`,
    [1, "Ada", "eng", 2, "Linus", "eng", 3, "Grace", "ops"],
  );
  return b;
}

test("DROP TABLE on a missing relation errors without IF EXISTS", async () => {
  const b = await be();
  await assert.rejects(() => b.exec(`DROP TABLE "missing"`), /does not exist/);
});

test("DROP TABLE IF EXISTS on a missing relation is a no-op", async () => {
  const b = await be();
  await b.exec(`DROP TABLE IF EXISTS "missing"`); // must not throw
});

test("INSERT rejects a column the table never declared", async () => {
  const b = await be();
  await assert.rejects(
    () => b.query(`INSERT INTO "t" ("id","bogus") VALUES ($1,$2)`, [9, "x"]),
    /column "bogus" .*does not exist/,
  );
});

test("aggregate: an ungrouped column beside an aggregate is rejected", async () => {
  const b = await be();
  await assert.rejects(
    () => b.query(`SELECT name, count(*) FROM "t"`),
    /must appear in the GROUP BY clause/,
  );
});

test("aggregate: the query is accepted once the column is grouped", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT dept, count(*)::int AS n FROM "t" GROUP BY dept ORDER BY dept`,
  );
  assert.deepEqual(r.rows, [
    { dept: "eng", n: 2 },
    { dept: "ops", n: 1 },
  ]);
});

test("aggregate: a grouped expression (not just a bare column) is accepted", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT upper(dept) AS d, count(*)::int AS n FROM "t" GROUP BY upper(dept) ORDER BY d`,
  );
  assert.deepEqual(r.rows, [
    { d: "ENG", n: 2 },
    { d: "OPS", n: 1 },
  ]);
});
