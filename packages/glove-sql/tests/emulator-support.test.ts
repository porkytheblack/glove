import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryBackend,
  parse,
  statementKind,
  collectRelations,
  collectCteNames,
  extractEqualityBindings,
} from "../src/index";

// ─── parse() + statementKind ──────────────────────────────────────────────────
test("parse() exposes the AST; statementKind tags it", () => {
  const [s] = parse(`SELECT a FROM t WHERE id = 1`);
  assert.equal(statementKind(s), "select");
  assert.equal(statementKind(parse(`INSERT INTO t (a) VALUES (1)`)[0]), "insert");
  assert.equal(statementKind(parse(`UPDATE t SET a = 1 WHERE id = 2`)[0]), "update");
  assert.equal(statementKind(parse(`DELETE FROM t WHERE id = 3`)[0]), "delete");
  assert.equal(statementKind(parse(`BEGIN`)[0]), "begin");
  assert.equal(statementKind(parse(`COMMIT`)[0]), "commit");
  assert.equal(statementKind(parse(`ROLLBACK`)[0]), "rollback");
  assert.equal(statementKind(parse(`EXPLAIN SELECT 1`)[0]), "explain");
});

test("parse() splits a multi-statement transaction script", () => {
  const stmts = parse(`BEGIN; INSERT INTO emails (to_addr) VALUES ('a@b.com'); COMMIT`);
  assert.deepEqual(stmts.map(statementKind), ["begin", "insert", "commit"]);
});

// ─── collectRelations ──────────────────────────────────────────────────────────
test("collectRelations finds FROM/JOIN/subquery reads", () => {
  const [s] = parse(
    `SELECT * FROM a JOIN b ON a.id = b.aid WHERE a.x IN (SELECT x FROM c)`,
  );
  const names = collectRelations(s).map((r) => `${r.name}:${r.role}`).sort();
  assert.deepEqual(names, ["a:read", "b:read", "c:read"]);
});

test("collectRelations classifies write targets + INSERT…SELECT source", () => {
  const [s] = parse(`INSERT INTO dst (x) SELECT x FROM src WHERE k = 1`);
  const rels = collectRelations(s);
  assert.ok(rels.some((r) => r.name === "dst" && r.role === "insert"));
  assert.ok(rels.some((r) => r.name === "src" && r.role === "read"));
});

test("collectRelations: delete/update target + WHERE subquery reads", () => {
  const del = collectRelations(parse(`DELETE FROM tasks WHERE p IN (SELECT id FROM pr WHERE merged = true)`)[0]);
  assert.ok(del.some((r) => r.name === "tasks" && r.role === "delete"));
  assert.ok(del.some((r) => r.name === "pr" && r.role === "read"));
  const upd = collectRelations(parse(`UPDATE tasks SET done = true WHERE id = 5`)[0]);
  assert.ok(upd.some((r) => r.name === "tasks" && r.role === "update"));
});

test("collectCteNames returns shadowing names", () => {
  const [s] = parse(`WITH recent AS (SELECT * FROM t) SELECT * FROM recent`);
  assert.deepEqual([...collectCteNames(s)], ["recent"]);
});

// ─── extractEqualityBindings ────────────────────────────────────────────────────
test("extractEqualityBindings: qualified + unqualified equalities", () => {
  const [s] = parse(`SELECT url FROM images i WHERE i.prompt = 'cat' AND style = 'watercolor'`);
  const b = extractEqualityBindings(s, "i");
  assert.deepEqual(b.get("prompt"), ["cat"]);
  assert.deepEqual(b.get("style"), ["watercolor"]);
});

test("extractEqualityBindings: resolves $n params", () => {
  const [s] = parse(`SELECT * FROM web WHERE query = $1 AND limit_ = $2`);
  const b = extractEqualityBindings(s, "web", ["sql engines", 10]);
  assert.deepEqual(b.get("query"), ["sql engines"]);
  assert.deepEqual(b.get("limit_"), [10]);
});

test("extractEqualityBindings: IN lists become multi-valued", () => {
  const [s] = parse(`SELECT * FROM t WHERE id IN (1, 2, 3)`);
  assert.deepEqual(extractEqualityBindings(s, "t").get("id"), [1, 2, 3]);
});

test("extractEqualityBindings: column = column is NOT a binding", () => {
  const [s] = parse(`SELECT * FROM a JOIN b ON a.id = b.aid`);
  assert.equal(extractEqualityBindings(s, "a").size, 0);
});

test("extractEqualityBindings: reaches into subquery WHERE", () => {
  const [s] = parse(`DELETE FROM tasks WHERE p IN (SELECT id FROM pr WHERE name = 'x')`);
  assert.deepEqual(extractEqualityBindings(s, "pr").get("name"), ["x"]);
});

// ─── information_schema.tables + catalogProvider ────────────────────────────────
test("information_schema.tables lists base tables", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint)`);
  const r = await b.query(`SELECT table_name, table_type FROM information_schema.tables ORDER BY table_name`);
  assert.deepEqual(r.rows, [{ table_name: "t", table_type: "BASE TABLE" }]);
});

test("catalogProvider tables appear as BASE TABLE (droid-enumerable)", async () => {
  const b = await MemoryBackend.create({
    catalogProvider: () => [
      { name: "github_pr", columns: [{ name: "id", type: "bigint" }, { name: "title", type: "text" }] },
    ],
  });
  await b.exec(`CREATE TABLE "local" ("x" bigint)`);
  const tables = await b.query(`SELECT table_name, table_type FROM information_schema.tables ORDER BY table_name`);
  // Capability tables enumerate as BASE TABLE so the canonical
  // `WHERE table_type = 'BASE TABLE'` discovery filter returns them.
  assert.deepEqual(tables.rows, [
    { table_name: "github_pr", table_type: "BASE TABLE" },
    { table_name: "local", table_type: "BASE TABLE" },
  ]);
  const cols = await b.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'github_pr' ORDER BY ordinal_position`,
  );
  assert.deepEqual(cols.rows, [
    { column_name: "id", data_type: "bigint" },
    { column_name: "title", data_type: "text" },
  ]);
});

test("a materialized table shadows its catalog entry (no dupes)", async () => {
  const b = await MemoryBackend.create({
    catalogProvider: () => [{ name: "github_pr", columns: [{ name: "id", type: "bigint" }] }],
  });
  await b.exec(`CREATE TABLE "github_pr" ("id" bigint, "title" text)`);
  const r = await b.query(`SELECT table_name, table_type FROM information_schema.tables`);
  assert.deepEqual(r.rows, [{ table_name: "github_pr", table_type: "BASE TABLE" }]);
});

// ─── INSERT … SELECT ─────────────────────────────────────────────────────────────
test("INSERT … SELECT copies rows between tables", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "src" ("a" bigint, "b" text)`);
  await b.exec(`CREATE TABLE "dst" ("x" bigint, "y" text)`);
  await b.query(`INSERT INTO "src" ("a","b") VALUES (1,'one'),(2,'two')`);
  await b.query(`INSERT INTO "dst" ("x","y") SELECT a, b FROM "src" WHERE a = 2`);
  const r = await b.query(`SELECT x, y FROM "dst"`);
  assert.deepEqual(r.rows, [{ x: 2, y: "two" }]);
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────────
test("UPDATE … SET … WHERE mutates matching rows", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint, "done" boolean)`);
  await b.query(`INSERT INTO "t" ("id","done") VALUES (1,false),(2,false)`);
  await b.query(`UPDATE "t" SET done = true WHERE id = 1`);
  const r = await b.query(`SELECT id, done FROM "t" ORDER BY id`);
  assert.deepEqual(r.rows, [{ id: 1, done: true }, { id: 2, done: false }]);
});

test("UPDATE rejects an unknown column", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint)`);
  await assert.rejects(() => b.query(`UPDATE "t" SET nope = 1`), /does not exist/);
});

// ─── transaction control is a no-op on the raw backend ──────────────────────────
test("BEGIN/COMMIT/ROLLBACK are accepted no-ops on MemoryBackend", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`BEGIN; CREATE TABLE "t" ("id" bigint); COMMIT`);
  const r = await b.query(`SELECT count(*)::int AS n FROM "t"`);
  assert.deepEqual(r.rows, [{ n: 0 }]);
});

test("EXPLAIN does not execute its inner statement", async () => {
  const b = await MemoryBackend.create();
  await b.exec(`CREATE TABLE "t" ("id" bigint)`);
  const r = await b.query(`EXPLAIN INSERT INTO "t" ("id") VALUES (1)`);
  assert.equal(r.rows.length, 1); // a plan row, not an insert
  const after = await b.query(`SELECT count(*)::int AS n FROM "t"`);
  assert.deepEqual(after.rows, [{ n: 0 }]); // nothing inserted
});
