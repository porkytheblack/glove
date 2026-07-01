import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/index";

// Unit tests for the pure-JS Postgres-subset emulator: the SQL surface the
// Scratchpad and its agents actually use, exercised directly against the backend.

async function be(): Promise<MemoryBackend> {
  const b = await MemoryBackend.create();
  await b.exec(`
    CREATE TABLE "t" (
      "_rid" bigint PRIMARY KEY,
      "_idx" bigint,
      "id" bigint,
      "name" text,
      "score" double precision,
      "active" boolean,
      "meta" jsonb
    );
  `);
  await b.query(
    `INSERT INTO "t" ("_rid","_idx","id","name","score","active","meta")
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb),($8,$9,$10,$11,$12,$13,$14::jsonb),($15,$16,$17,$18,$19,$20,$21::jsonb)`,
    [
      1, 0, 10, "Ada", 1.5, true, JSON.stringify({ city: "London", tags: ["a", "b"] }),
      2, 1, 20, "Linus", 2.5, false, JSON.stringify({ city: "Helsinki" }),
      3, 2, 30, "Grace", 3.5, true, JSON.stringify({ city: "NYC" }),
    ],
  );
  return b;
}

test("projection, WHERE equality, and string/number literals", async () => {
  const b = await be();
  const r = await b.query(`SELECT name, score FROM "t" WHERE active = true AND id >= 30`);
  assert.deepEqual(r.rows, [{ name: "Grace", score: 3.5 }]);
});

test("ORDER BY desc, LIMIT, OFFSET", async () => {
  const b = await be();
  const r = await b.query(`SELECT name FROM "t" ORDER BY id DESC LIMIT 1 OFFSET 1`);
  assert.deepEqual(r.rows, [{ name: "Linus" }]);
});

test("jsonb -> and ->> access", async () => {
  const b = await be();
  const r = await b.query(`SELECT name, meta->>'city' AS city, meta->'tags'->>0 AS first_tag FROM "t" ORDER BY _idx`);
  assert.deepEqual(r.rows, [
    { name: "Ada", city: "London", first_tag: "a" },
    { name: "Linus", city: "Helsinki", first_tag: null },
    { name: "Grace", city: "NYC", first_tag: null },
  ]);
});

test("aggregates: count(*), sum, avg, min, max with GROUP BY", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT active, count(*)::int AS n, sum(id)::int AS total, max(score) AS top FROM "t" GROUP BY active ORDER BY active`,
  );
  assert.deepEqual(r.rows, [
    { active: false, n: 1, total: 20, top: 2.5 },
    { active: true, n: 2, total: 40, top: 3.5 },
  ]);
});

test("count(*) over empty set still returns a single zero row", async () => {
  const b = await be();
  const r = await b.query(`SELECT count(*)::int AS n FROM "t" WHERE id > 999`);
  assert.deepEqual(r.rows, [{ n: 0 }]);
});

test("HAVING filters groups", async () => {
  const b = await be();
  const r = await b.query(`SELECT active, count(*)::int AS n FROM "t" GROUP BY active HAVING count(*) > 1`);
  assert.deepEqual(r.rows, [{ active: true, n: 2 }]);
});

test("scalar function / operator wrapping an aggregate aggregates over the group", async () => {
  const b = await be();

  // COALESCE(SUM(...)) must sum over the whole group, not collapse to one row's value.
  const r1 = await b.query(`SELECT coalesce(sum(id), 0)::int AS total FROM "t"`);
  assert.deepEqual(r1.rows, [{ total: 60 }]);

  // The canonical reason to write COALESCE(SUM, 0): an empty set yields 0, not null.
  const r2 = await b.query(`SELECT coalesce(sum(id), 0)::int AS total FROM "t" WHERE id > 999`);
  assert.deepEqual(r2.rows, [{ total: 0 }]);

  // Still aggregates per group under GROUP BY.
  const r3 = await b.query(
    `SELECT active, coalesce(sum(id), 0)::int AS total FROM "t" GROUP BY active ORDER BY active`,
  );
  assert.deepEqual(r3.rows, [
    { active: false, total: 20 },
    { active: true, total: 40 },
  ]);

  // Unary minus and abs() over an aggregate recurse into the aggregate too.
  const r4 = await b.query(`SELECT (-sum(id))::int AS neg, abs(0 - sum(id))::int AS mag FROM "t"`);
  assert.deepEqual(r4.rows, [{ neg: -60, mag: 60 }]);
});

test("INNER JOIN ... ON with qualified columns", async () => {
  const b = await be();
  await b.exec(`CREATE TABLE "child" ("_rid" bigint, "_parent" bigint, "_idx" bigint, "kind" text);`);
  await b.query(
    `INSERT INTO "child" ("_rid","_parent","_idx","kind") VALUES ($1,$2,$3,$4),($5,$6,$7,$8)`,
    [100, 1, 0, "primary", 101, 3, 0, "secondary"],
  );
  const r = await b.query(
    `SELECT p.name, c.kind FROM "t" p JOIN "child" c ON c._parent = p._rid ORDER BY p.id`,
  );
  assert.deepEqual(r.rows, [
    { name: "Ada", kind: "primary" },
    { name: "Grace", kind: "secondary" },
  ]);
});

test("LEFT JOIN keeps unmatched left rows with null right columns", async () => {
  const b = await be();
  await b.exec(`CREATE TABLE "child" ("_parent" bigint, "kind" text);`);
  await b.query(`INSERT INTO "child" ("_parent","kind") VALUES ($1,$2)`, [1, "primary"]);
  const r = await b.query(
    `SELECT p.name, c.kind FROM "t" p LEFT JOIN "child" c ON c._parent = p._rid ORDER BY p.id`,
  );
  assert.deepEqual(r.rows, [
    { name: "Ada", kind: "primary" },
    { name: "Linus", kind: null },
    { name: "Grace", kind: null },
  ]);
});

test("WITH (CTE) then select from it", async () => {
  const b = await be();
  const r = await b.query(
    `WITH actives AS (SELECT name, id FROM "t" WHERE active = true) SELECT name FROM actives ORDER BY id DESC`,
  );
  assert.deepEqual(r.rows.map((x) => x.name), ["Grace", "Ada"]);
});

test("LIKE, IN, IS NULL, DISTINCT", async () => {
  const b = await be();
  const like = await b.query(`SELECT name FROM "t" WHERE name LIKE 'A%'`);
  assert.deepEqual(like.rows, [{ name: "Ada" }]);
  const inq = await b.query(`SELECT name FROM "t" WHERE id IN (10, 30) ORDER BY id`);
  assert.deepEqual(inq.rows.map((r) => r.name), ["Ada", "Grace"]);
  const distinct = await b.query(`SELECT DISTINCT active FROM "t" ORDER BY active`);
  assert.deepEqual(distinct.rows, [{ active: false }, { active: true }]);
});

test("subquery in FROM with outer LIMIT (the read-mode wrapper shape)", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT * FROM (SELECT name FROM "t" WHERE active = true ORDER BY id) AS _q LIMIT 1`,
  );
  assert.deepEqual(r.rows, [{ name: "Ada" }]);
});

test("information_schema.columns reports declared types in ordinal order", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    ["t"],
  );
  const byName = Object.fromEntries(r.rows.map((x) => [x.column_name, x.data_type]));
  assert.equal(byName.id, "bigint");
  assert.equal(byName.name, "text");
  assert.equal(byName.score, "double precision");
  assert.equal(byName.active, "boolean");
  assert.equal(byName.meta, "jsonb");
});

test("CREATE TABLE AS persists derived rows with inferred types", async () => {
  const b = await be();
  await b.exec(`CREATE TABLE "derived" AS SELECT id, name FROM "t" WHERE active = true ORDER BY id;`);
  const rows = await b.query(`SELECT * FROM "derived" ORDER BY id`);
  assert.deepEqual(rows.rows, [
    { id: 10, name: "Ada" },
    { id: 30, name: "Grace" },
  ]);
  const cols = await b.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    ["derived"],
  );
  assert.deepEqual(cols.rows, [
    { column_name: "id", data_type: "bigint" },
    { column_name: "name", data_type: "text" },
  ]);
});

test("DELETE ... WHERE removes matching rows", async () => {
  const b = await be();
  await b.query(`DELETE FROM "t" WHERE active = false`);
  const r = await b.query(`SELECT count(*)::int AS n FROM "t"`);
  assert.equal(r.rows[0].n, 2);
});

test("DROP TABLE IF EXISTS is a no-op when absent and removes when present", async () => {
  const b = await be();
  await b.exec(`DROP TABLE IF EXISTS "nope" CASCADE;`);
  await b.exec(`DROP TABLE IF EXISTS "t" CASCADE;`);
  await assert.rejects(() => b.query(`SELECT * FROM "t"`), /does not exist/);
});

test("dump → restore round-trips the whole catalog", async () => {
  const b = await be();
  const bytes = await b.dump();
  const b2 = await MemoryBackend.create({ load: bytes });
  const r = await b2.query(`SELECT name FROM "t" ORDER BY id`);
  assert.deepEqual(r.rows.map((x) => x.name), ["Ada", "Linus", "Grace"]);
});

test("unsupported SQL throws a clear error rather than mis-answering", async () => {
  const b = await be();
  // Outside the emulated subset → a clear error, never a wrong answer.
  await assert.rejects(() => b.query(`SELECT regexp_replace(name, 'a', 'b') FROM "t"`), /unsupported function/i);
});
