import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// Regression tests for issues found by the SQL test team.

const val = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows[0];

// ─── Batch 1: NULL three-valued logic, IN, deep equality, operators ──────────

test("comparison / arithmetic / concat with NULL yields NULL", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await val(b, `SELECT (NULL = 1) AS x`)).x, null);
  assert.equal((await val(b, `SELECT (1 = NULL) AS x`)).x, null);
  assert.equal((await val(b, `SELECT (NULL + 1) AS x`)).x, null);
  assert.equal((await val(b, `SELECT (NULL <> 1) AS x`)).x, null);
  assert.equal((await val(b, `SELECT ('a' || NULL) AS x`)).x, null);
});

test("WHERE drops rows whose predicate is NULL (not false)", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint, "tag" text)`);
  await b.query(`INSERT INTO "t" VALUES ($1,$2),($3,$4)`, [1, "a", 2, null]);
  const r = await b.query(`SELECT id FROM "t" WHERE tag = 'a'`);
  assert.deepEqual(r.rows.map((x) => x.id), [1]); // row 2 (tag NULL) excluded, not matched
});

test("three-valued IN / NOT IN with a NULL in the list", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint)`);
  await b.query(`INSERT INTO "t" VALUES (1),(2),(3)`);
  const notin = await b.query(`SELECT id FROM "t" WHERE id NOT IN (1, NULL) ORDER BY id`);
  assert.deepEqual(notin.rows.map((x) => x.id), []); // NOT IN with NULL → empty set
  const inlist = await b.query(`SELECT id FROM "t" WHERE id IN (2, NULL) ORDER BY id`);
  assert.deepEqual(inlist.rows.map((x) => x.id), [2]); // only the real match
});

test("jsonb / array equality is by value, not reference", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await val(b, `SELECT ('[1,2]'::jsonb = '[1,2]'::jsonb) AS eq`)).eq, true);
  assert.equal((await val(b, `SELECT ('{"a":1}'::jsonb = '{"a":2}'::jsonb) AS eq`)).eq, false);
});

test("modulo operator works; division/modulo by zero errors", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await val(b, `SELECT 17 % 5 AS m`)).m, 2);
  await b.exec(`CREATE TABLE "t" ("k" bigint)`);
  await b.query(`INSERT INTO "t" VALUES (1),(2),(3),(4)`);
  const g = await b.query(`SELECT k % 2 AS par, count(*)::int AS c FROM "t" GROUP BY k % 2 ORDER BY par`);
  assert.deepEqual(g.rows, [{ par: 0, c: 2 }, { par: 1, c: 2 }]);
  await assert.rejects(() => b.query(`SELECT 1 / 0`), /division by zero/);
  await assert.rejects(() => b.query(`SELECT 5 % 0`), /division by zero/);
});

// ─── Batch 2: aggregates ─────────────────────────────────────────────────────

test("ORDER BY after GROUP BY sorts the aggregated rows, not pre-aggregation rows", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "s" ("region" text, "amt" bigint)`);
  await b.query(`INSERT INTO "s" VALUES ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10),($11,$12)`,
    ["west", 10, "west", 20, "east", 5, "north", 7, "north", 8, "north", 9]);
  const byRegion = await b.query(`SELECT region, sum(amt)::int AS total FROM "s" GROUP BY region ORDER BY region`);
  assert.deepEqual(byRegion.rows, [
    { region: "east", total: 5 },
    { region: "north", total: 24 },
    { region: "west", total: 30 },
  ]);
  const byTotal = await b.query(`SELECT region, sum(amt)::int AS total FROM "s" GROUP BY region ORDER BY sum(amt) DESC`);
  assert.deepEqual(byTotal.rows.map((r) => r.region), ["west", "north", "east"]);
});

test("DISTINCT inside count/sum/avg is honoured (and composes with GROUP BY)", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("grp" text, "score" double precision)`);
  await b.query(`INSERT INTO "t" VALUES ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)`,
    ["a", 10, "a", 10, "a", 20, "b", 30, "b", null]);
  const r = await b.query(
    `SELECT count(DISTINCT score)::int AS c, sum(DISTINCT score)::int AS s, avg(DISTINCT score) AS a, count(DISTINCT grp)::int AS g FROM "t"`,
  );
  assert.deepEqual(r.rows[0], { c: 3, s: 60, a: 20, g: 2 });
  const byGrp = await b.query(`SELECT grp, count(DISTINCT score)::int AS c FROM "t" GROUP BY grp ORDER BY grp`);
  assert.deepEqual(byGrp.rows, [{ grp: "a", c: 2 }, { grp: "b", c: 1 }]);
});

// ─── Batch 3: CTE scope, set-ops + WITH, scalar subquery cardinality ─────────

test("CTEs are visible inside subqueries (IN / EXISTS)", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint, "big" boolean)`);
  await b.query(`INSERT INTO "t" VALUES (1,false),(2,true),(3,true)`);
  const inq = await b.query(
    `WITH bigs AS (SELECT id FROM "t" WHERE big) SELECT id FROM "t" WHERE id IN (SELECT id FROM bigs) ORDER BY id`,
  );
  assert.deepEqual(inq.rows.map((x) => x.id), [2, 3]);
  const ex = await b.query(
    `WITH bigs AS (SELECT id FROM "t" WHERE big) SELECT id FROM "t" t1 WHERE EXISTS (SELECT 1 FROM bigs WHERE bigs.id = t1.id) ORDER BY id`,
  );
  assert.deepEqual(ex.rows.map((x) => x.id), [2, 3]);
});

test("WITH applies across UNION branches", async () => {
  const b = await MemoryBackend.create();
  const r = await b.query(`WITH c AS (SELECT 1 AS n) SELECT n FROM c UNION SELECT 2 ORDER BY n`);
  assert.deepEqual(r.rows.map((x) => x.n), [1, 2]);
});

test("scalar subquery returning more than one row errors", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint)`);
  await b.query(`INSERT INTO "t" VALUES (1),(2)`);
  await assert.rejects(() => b.query(`SELECT (SELECT id FROM "t") AS x`), /more than one row/);
});
