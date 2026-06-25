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
