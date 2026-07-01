import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// RETURNING on native tables — the Postgres-native way to read back a write in
// the same statement.

async function seeded() {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE t (id bigint, name text, state text)`);
  return b;
}
const rows = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows;

test("INSERT … RETURNING projects the inserted rows", async () => {
  const b = await seeded();
  assert.deepEqual(
    await rows(b, `INSERT INTO t (id,name,state) VALUES (1,'a','open'),(2,'b','open') RETURNING id, name`),
    [{ id: 1, name: "a" }, { id: 2, name: "b" }],
  );
});

test("INSERT … RETURNING * and expressions", async () => {
  const b = await seeded();
  assert.deepEqual(await rows(b, `INSERT INTO t (id,name,state) VALUES (3,'c','open') RETURNING *`), [
    { id: 3, name: "c", state: "open" },
  ]);
  assert.deepEqual(await rows(b, `INSERT INTO t (id,name) VALUES (9,'z') RETURNING id, upper(name) AS u`), [
    { id: 9, u: "Z" },
  ]);
});

test("UPDATE … RETURNING projects the updated rows", async () => {
  const b = await seeded();
  await b.exec(`INSERT INTO t (id,name,state) VALUES (1,'a','open')`);
  assert.deepEqual(await rows(b, `UPDATE t SET state='done' WHERE id=1 RETURNING id, state`), [
    { id: 1, state: "done" },
  ]);
});

test("DELETE … RETURNING projects the removed rows", async () => {
  const b = await seeded();
  await b.exec(`INSERT INTO t (id,name) VALUES (1,'a'),(2,'b')`);
  assert.deepEqual(await rows(b, `DELETE FROM t WHERE id=2 RETURNING id, name`), [{ id: 2, name: "b" }]);
  assert.deepEqual(await rows(b, `SELECT id FROM t ORDER BY id`), [{ id: 1 }]);
});

test("a write without RETURNING yields no rows", async () => {
  const b = await seeded();
  const r = await b.query(`INSERT INTO t (id) VALUES (1)`);
  assert.deepEqual(r.rows, []);
});

test("RETURNING is not eaten as an implicit alias (no-FROM and FROM forms)", async () => {
  const b = await seeded();
  // `SELECT 'c' RETURNING` used to parse as `'c' AS returning` and derail.
  assert.deepEqual(await rows(b, `INSERT INTO t (id,name,state) SELECT 5,'e','open' RETURNING id`), [{ id: 5 }]);
  assert.deepEqual(await rows(b, `INSERT INTO t (id,name) SELECT id+10, name FROM t RETURNING id`), [{ id: 15 }]);
});

test("WITH … INSERT/UPDATE/DELETE (data-modifying CTE readers)", async () => {
  const b = await seeded();
  await b.exec(`INSERT INTO t VALUES (1,'a','open'),(2,'b','open')`);
  assert.deepEqual(
    await rows(b, `WITH src AS (SELECT id, name FROM t WHERE id = 2) INSERT INTO t (id, name, state) SELECT id+100, name, 'copy' FROM src RETURNING id, state`),
    [{ id: 102, state: "copy" }],
  );
  await b.query(`WITH hot AS (SELECT id FROM t WHERE id > 100) UPDATE t SET state='done' WHERE id IN (SELECT id FROM hot)`);
  assert.deepEqual(await rows(b, `SELECT state FROM t WHERE id = 102`), [{ state: "done" }]);
  assert.deepEqual(
    await rows(b, `WITH victims AS (SELECT id FROM t WHERE state='done') DELETE FROM t WHERE id IN (SELECT id FROM victims) RETURNING id`),
    [{ id: 102 }],
  );
});
