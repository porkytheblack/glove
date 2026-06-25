import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../src/backends/memory";

// A small known table for SQL-coverage tests.
async function be(): Promise<MemoryBackend> {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint, "name" text, "score" double precision, "active" boolean);`);
  await b.query(
    `INSERT INTO "t" ("id","name","score","active") VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)`,
    [10, "Ada", 1.5, true, 20, "Linus", 2.5, false, 30, "Grace", 3.5, true],
  );
  return b;
}
const col = (rows: Record<string, unknown>[], k: string) => rows.map((r) => r[k]);

// ─── CASE ────────────────────────────────────────────────────────────────────
test("searched CASE WHEN … THEN … ELSE … END", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT name, CASE WHEN id >= 30 THEN 'big' WHEN id >= 20 THEN 'mid' ELSE 'small' END AS sz FROM "t" ORDER BY id`,
  );
  assert.deepEqual(col(r.rows, "sz"), ["small", "mid", "big"]);
});

test("simple CASE operand WHEN value", async () => {
  const b = await be();
  const r = await b.query(`SELECT CASE active WHEN true THEN 'on' ELSE 'off' END AS s FROM "t" ORDER BY id`);
  assert.deepEqual(col(r.rows, "s"), ["on", "off", "on"]);
});

test("CASE with no ELSE yields null", async () => {
  const b = await be();
  const r = await b.query(`SELECT CASE WHEN id = 10 THEN 'ten' END AS s FROM "t" ORDER BY id`);
  assert.deepEqual(col(r.rows, "s"), ["ten", null, null]);
});

test("aggregate over CASE: SUM(CASE WHEN … THEN 1 ELSE 0 END)", async () => {
  const b = await be();
  const r = await b.query(`SELECT SUM(CASE WHEN active THEN 1 ELSE 0 END)::int AS active_count FROM "t"`);
  assert.equal(r.rows[0].active_count, 2);
});

// ─── BETWEEN ─────────────────────────────────────────────────────────────────
test("BETWEEN and NOT BETWEEN", async () => {
  const b = await be();
  const inRange = await b.query(`SELECT name FROM "t" WHERE id BETWEEN 15 AND 35 ORDER BY id`);
  assert.deepEqual(col(inRange.rows, "name"), ["Linus", "Grace"]);
  const out = await b.query(`SELECT name FROM "t" WHERE id NOT BETWEEN 15 AND 35`);
  assert.deepEqual(col(out.rows, "name"), ["Ada"]);
});

// ─── CAST(expr AS type) ──────────────────────────────────────────────────────
test("CAST(expr AS type) function syntax mirrors ::type", async () => {
  const b = await be();
  const r = await b.query(`SELECT CAST(id AS text) AS s FROM "t" WHERE id = 10`);
  assert.equal(r.rows[0].s, "10");
  const n = await b.query(`SELECT CAST('42' AS bigint) AS n`);
  assert.equal(n.rows[0].n, 42);
});

// ─── aggregate FILTER ────────────────────────────────────────────────────────
test("COUNT(*) FILTER (WHERE …) and SUM(...) FILTER (WHERE …)", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE active) AS active_count,
            SUM(id) FILTER (WHERE active)::int AS active_id_sum
       FROM "t"`,
  );
  assert.equal(r.rows[0].total, 3);
  assert.equal(r.rows[0].active_count, 2);
  assert.equal(r.rows[0].active_id_sum, 40); // 10 + 30
});

test("FILTER composes with GROUP BY", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT active, COUNT(*) FILTER (WHERE score > 2.0)::int AS hi FROM "t" GROUP BY active ORDER BY active`,
  );
  assert.deepEqual(r.rows, [
    { active: false, hi: 1 }, // Linus 2.5
    { active: true, hi: 1 }, // Grace 3.5 (Ada 1.5 excluded)
  ]);
});

// ─── scalar functions ────────────────────────────────────────────────────────
test("numeric functions: round, floor, ceil, abs, mod, power, sqrt, greatest, least", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT round(2.7) AS rnd, floor(2.7) AS flr, ceil(2.1) AS cl, abs(-5) AS ab,
            mod(17, 5) AS md, power(2, 10) AS pw, sqrt(144) AS sq,
            greatest(3, 9, 4) AS gr, least(3, 9, 4) AS ls`,
  );
  assert.equal(r.rows[0].rnd, 3);
  assert.equal(r.rows[0].flr, 2);
  assert.equal(r.rows[0].cl, 3);
  assert.equal(r.rows[0].ab, 5);
  assert.equal(r.rows[0].md, 2);
  assert.equal(r.rows[0].pw, 1024);
  assert.equal(r.rows[0].sq, 12);
  assert.equal(r.rows[0].gr, 9);
  assert.equal(r.rows[0].ls, 3);
});

test("string functions: trim, substr, replace, nullif", async () => {
  const b = await be();
  const r = await b.query(
    `SELECT trim('  hi  ') AS t, substr('hello', 2, 3) AS s, replace('a-b-c', '-', '_') AS rp,
            nullif('x', 'x') AS n1, nullif('x', 'y') AS n2`,
  );
  assert.equal(r.rows[0].t, "hi");
  assert.equal(r.rows[0].s, "ell");
  assert.equal(r.rows[0].rp, "a_b_c");
  assert.equal(r.rows[0].n1, null);
  assert.equal(r.rows[0].n2, "x");
});
