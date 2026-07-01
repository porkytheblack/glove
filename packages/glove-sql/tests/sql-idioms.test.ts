import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// Common SQL idioms a droid reaches for — string/date functions, regex, upsert,
// interval math, DISTINCT ON. Each used to throw "unsupported" or mis-parse.

const one = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows[0];
const rows = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows;

test("string function library", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await one(b, `SELECT split_part('a,b,c', ',', 2) AS x`)).x, "b");
  assert.equal((await one(b, `SELECT left('abcd', 2) AS x`)).x, "ab");
  assert.equal((await one(b, `SELECT right('abcd', 2) AS x`)).x, "cd");
  assert.equal((await one(b, `SELECT initcap('hello world') AS x`)).x, "Hello World");
  assert.equal((await one(b, `SELECT repeat('ab', 3) AS x`)).x, "ababab");
  assert.equal((await one(b, `SELECT lpad('7', 3, '0') AS x`)).x, "007");
  assert.equal((await one(b, `SELECT rpad('7', 3, '0') AS x`)).x, "700");
  assert.equal((await one(b, `SELECT char_length('abc') AS x`)).x, 3);
  assert.equal((await one(b, `SELECT concat_ws('-', 'a', NULL, 'c') AS x`)).x, "a-c");
  assert.equal((await one(b, `SELECT reverse('abc') AS x`)).x, "cba");
  // ltrim/rtrim/btrim honor the chars argument (was silently ignored)
  assert.equal((await one(b, `SELECT ltrim('xxhi', 'x') AS x`)).x, "hi");
  assert.equal((await one(b, `SELECT btrim('xxhixx', 'x') AS x`)).x, "hi");
});

test("SQL-standard substring/position syntax", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await one(b, `SELECT substring('abcdef' FROM 2 FOR 3) AS x`)).x, "bcd");
  assert.equal((await one(b, `SELECT substring('abcdef' FROM 4) AS x`)).x, "def");
  assert.equal((await one(b, `SELECT position('c' IN 'abcdef') AS x`)).x, 3);
});

test("date/time functions", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await one(b, `SELECT make_date(2026, 3, 5) AS x`)).x, "2026-03-05");
  assert.equal((await one(b, `SELECT to_char('2026-03-15T10:00:00Z', 'YYYY-MM-DD') AS x`)).x, "2026-03-15");
  assert.equal((await one(b, `SELECT to_char('2026-03-15T14:05:00Z', 'Mon YYYY HH24:MI') AS x`)).x, "Mar 2026 14:05");
});

test("regex operators and regexp_replace", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE t (id bigint, name text)`);
  await b.exec(`INSERT INTO t VALUES (1,'Ann'),(2,'bob')`);
  assert.deepEqual(await rows(b, `SELECT id FROM t WHERE name ~ 'nn'`), [{ id: 1 }]);
  assert.deepEqual(await rows(b, `SELECT id FROM t WHERE name ~* 'ANN'`), [{ id: 1 }]);
  assert.deepEqual(await rows(b, `SELECT id FROM t WHERE name !~ 'nn' ORDER BY id`), [{ id: 2 }]);
  assert.equal((await one(b, `SELECT regexp_replace('a1b2', '[0-9]', '#', 'g') AS x`)).x, "a#b#");
  assert.equal((await one(b, `SELECT regexp_replace('a1b2', '[0-9]', '#') AS x`)).x, "a#b2"); // first only w/o g
});

test("IS [NOT] DISTINCT FROM is null-safe", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await one(b, `SELECT (NULL IS DISTINCT FROM 1) AS x`)).x, true);
  assert.equal((await one(b, `SELECT (NULL IS DISTINCT FROM NULL) AS x`)).x, false);
  assert.equal((await one(b, `SELECT (NULL IS NOT DISTINCT FROM NULL) AS x`)).x, true);
  assert.equal((await one(b, `SELECT (1 IS DISTINCT FROM 1) AS x`)).x, false);
});

test("interval arithmetic on dates and timestamps", async () => {
  const b = await MemoryBackend.create();
  assert.equal((await one(b, `SELECT '2026-03-15'::date - interval '1 month' AS x`)).x, "2026-02-15");
  assert.equal((await one(b, `SELECT '2026-03-15'::date + interval '1 year 2 months' AS x`)).x, "2027-05-15");
  assert.equal(
    (await one(b, `SELECT '2026-03-15T10:00:00Z'::timestamp + interval '7 days' AS x`)).x,
    "2026-03-22T10:00:00.000Z",
  );
});

test("ON CONFLICT upsert", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE t (id bigint, name text, hits bigint)`);
  await b.exec(`INSERT INTO t VALUES (1,'a',1)`);
  await b.query(`INSERT INTO t (id,name,hits) VALUES (1,'dup',9) ON CONFLICT (id) DO NOTHING`);
  assert.deepEqual(await one(b, `SELECT name, hits FROM t WHERE id=1`), { name: "a", hits: 1 });
  await b.query(`INSERT INTO t (id,name,hits) VALUES (1,'A',5) ON CONFLICT (id) DO UPDATE SET name=excluded.name, hits=t.hits+1`);
  assert.deepEqual(await one(b, `SELECT name, hits FROM t WHERE id=1`), { name: "A", hits: 2 });
});

test("DISTINCT ON keeps the first row per key (latest-per-group)", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE ev (user_id bigint, at text, action text)`);
  await b.exec(`INSERT INTO ev VALUES (1,'2026-03-01','login'),(1,'2026-03-05','click'),(2,'2026-03-02','login')`);
  assert.deepEqual(await rows(b, `SELECT DISTINCT ON (user_id) user_id, action FROM ev ORDER BY user_id, at DESC`), [
    { user_id: 1, action: "click" },
    { user_id: 2, action: "login" },
  ]);
});
