import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// Aggregate + date/time function library — common Postgres idioms a droid reaches
// for (report rollups, "group by month") that used to throw "unsupported".

async function seeded() {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE e (id bigint, who text, flag boolean, at text)`);
  await b.exec(
    `INSERT INTO e VALUES
      (1,'ann',true,'2026-03-15T10:00:00Z'),
      (2,'bob',false,'2026-03-20T12:00:00Z'),
      (3,'ann',true,'2025-11-01T00:00:00Z')`,
  );
  return b;
}
const one = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows[0];
const all = async (b: MemoryBackend, sql: string) => (await b.query(sql)).rows;

test("string_agg / array_agg / json_agg collect a group", async () => {
  const b = await seeded();
  assert.equal((await one(b, `SELECT string_agg(who, ',') AS s FROM e`)).s, "ann,bob,ann");
  assert.deepEqual((await one(b, `SELECT array_agg(id) AS a FROM e`)).a, [1, 2, 3]);
  assert.deepEqual((await one(b, `SELECT json_agg(who) AS j FROM e`)).j, ["ann", "bob", "ann"]);
});

test("bool_or / bool_and", async () => {
  const b = await seeded();
  const r = await one(b, `SELECT bool_or(flag) AS o, bool_and(flag) AS a FROM e`);
  assert.equal(r.o, true);
  assert.equal(r.a, false);
});

test("string_agg respects FILTER (WHERE …)", async () => {
  const b = await seeded();
  assert.equal((await one(b, `SELECT string_agg(who, '|') FILTER (WHERE flag) AS s FROM e`)).s, "ann|ann");
});

test("date_trunc groups by month", async () => {
  const b = await seeded();
  const r = await all(b, `SELECT date_trunc('month', at) AS m, count(*) AS n FROM e GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(r, [
    { m: "2025-11-01T00:00:00.000Z", n: 1 },
    { m: "2026-03-01T00:00:00.000Z", n: 2 },
  ]);
});

test("date_part and EXTRACT(field FROM ts)", async () => {
  const b = await seeded();
  assert.equal((await one(b, `SELECT date_part('year', at) AS y FROM e WHERE id = 1`)).y, 2026);
  assert.equal((await one(b, `SELECT extract(month FROM at) AS mo FROM e WHERE id = 1`)).mo, 3);
  assert.equal((await one(b, `SELECT extract(day FROM at) AS d FROM e WHERE id = 2`)).d, 20);
});
