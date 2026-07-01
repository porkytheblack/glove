import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// Parity fixes: the engine should behave like Postgres — and ERROR rather than
// silently mis-answer — for idioms a SQL-fluent agent will inevitably write.

async function seeded() {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE t (id bigint, name text, active boolean, status text)`);
  await b.exec(`INSERT INTO t VALUES (1,'ann',true,'high'),(2,'bob',false,'low')`);
  return b;
}
const rows = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows;
const throws = async (b: MemoryBackend, sql: string, re: RegExp) =>
  assert.rejects(() => b.query(sql), re);

test("boolean = string literal is NOT inverted", async () => {
  const b = await seeded();
  assert.deepEqual(await rows(b, `SELECT id FROM t WHERE active = 'false'`), [{ id: 2 }]);
  assert.deepEqual(await rows(b, `SELECT id FROM t WHERE active = 'true'`), [{ id: 1 }]);
  assert.deepEqual(await rows(b, `SELECT id FROM t WHERE active = 't'`), [{ id: 1 }]);
  await throws(b, `SELECT id FROM t WHERE active = 'maybe'`, /invalid input syntax for type boolean/);
});

test("+ on text throws with a || hint instead of yielding NaN/NULL", async () => {
  const b = await seeded();
  await throws(b, `SELECT 'Verify: ' + name AS x FROM t`, /operator does not exist: text \+ text/);
  await throws(b, `SELECT 'a' + 'b'`, /use \|\| to concatenate/);
  // numeric strings still coerce
  assert.deepEqual(await rows(b, `SELECT '5' + 3 AS x`), [{ x: 8 }]);
  assert.deepEqual(await rows(b, `SELECT 'a' || 'b' AS x`), [{ x: "ab" }]);
});

test("column and table references resolve case-insensitively", async () => {
  const b = await seeded();
  assert.deepEqual(await rows(b, `SELECT ID FROM t WHERE Name = 'ann'`), [{ ID: 1 }]);
  assert.deepEqual(await rows(b, `SELECT id FROM T WHERE STATUS = 'low'`), [{ id: 2 }]);
});

test("unknown column throws instead of silently returning NULL", async () => {
  const b = await seeded();
  await throws(b, `SELECT nope FROM t`, /column "nope" does not exist/);
  await throws(b, `SELECT t.bogus FROM t`, /column "t\.bogus" does not exist/);
});

test("paren-less current_date / current_timestamp resolve (not NULL)", async () => {
  const b = await seeded();
  const r = await rows(b, `SELECT current_date AS d, current_timestamp AS ts`);
  assert.match(String(r[0].d), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(String(r[0].ts).length > 10);
});

test("a leading public. qualifier resolves like the default search_path", async () => {
  const b = await seeded();
  assert.deepEqual(await rows(b, `SELECT id FROM public.t WHERE id = 2`), [{ id: 2 }]);
});

// (ON CONFLICT upsert is covered end-to-end in sql-idioms.test.ts.)
