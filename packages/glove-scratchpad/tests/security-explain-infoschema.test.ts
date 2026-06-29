import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";

function db0(opts?: { writes?: boolean }) {
  return Database.create({ policy: { writes: opts?.writes ?? false } });
}

function readResource(name: string) {
  return defineResource({
    name,
    volatility: "stable",
    columns: [{ name: "id", type: "bigint" }],
    select: async () => [{ id: 1 }],
    insert: async () => ({ ok: true }),
  });
}

// ─── security ────────────────────────────────────────────────────────────────
test("writes are rejected on a read-only database", async () => {
  const db = await db0();
  db.register(readResource("t"));
  await assert.rejects(() => db.execute(`INSERT INTO t (id) VALUES (1)`), /writes are disabled/);
});

test("CREATE / DROP TABLE are never permitted from SQL", async () => {
  const db = await db0({ writes: true });
  await assert.rejects(() => db.execute(`CREATE TABLE x (id bigint)`), /not permitted/);
  await assert.rejects(() => db.execute(`DROP TABLE t`), /not permitted/);
});

test("multi-statement input is rejected unless it is a transaction script", async () => {
  const db = await db0();
  db.register(readResource("t"));
  await assert.rejects(() => db.execute(`SELECT id FROM t; SELECT id FROM t`), /single statement/);
});

test("writing to an unknown relation errors", async () => {
  const db = await db0({ writes: true });
  await assert.rejects(() => db.execute(`INSERT INTO nope (id) VALUES (1)`), /not a writable resource/);
});

// ─── explain ──────────────────────────────────────────────────────────────────
test("explain reports relations + volatility WITHOUT invoking resolvers", async () => {
  let calls = 0;
  const db = await db0();
  db.register(
    defineResource({
      name: "images",
      volatility: "volatile",
      columns: [{ name: "prompt", type: "text", requiredKey: true }, { name: "url", type: "text" }],
      select: async () => {
        calls++;
        return [{ url: "x" }];
      },
    }),
  );
  const plan = await db.explain(`SELECT url FROM images WHERE prompt = 'a cat'`);
  assert.equal(calls, 0, "explain runs no resolvers");
  assert.equal(plan.relations[0].name, "images");
  assert.equal(plan.relations[0].volatility, "volatile");
  assert.deepEqual(plan.relations[0].bindings, { prompt: ["a cat"] });
});

test("explain warns about a missing required key", async () => {
  const db = await db0();
  db.register(
    defineResource({
      name: "images",
      volatility: "volatile",
      columns: [{ name: "prompt", type: "text", requiredKey: true }, { name: "url", type: "text" }],
      select: async () => [{ url: "x" }],
    }),
  );
  const plan = await db.explain(`SELECT url FROM images`);
  assert.ok(plan.relations[0].warnings?.some((w) => /required key/.test(w)));
});

test("EXPLAIN through execute_sql returns a plan and runs nothing", async () => {
  let calls = 0;
  const db = await db0();
  db.register(
    defineResource({
      name: "t",
      volatility: "volatile",
      columns: [{ name: "id", type: "bigint" }],
      select: async () => {
        calls++;
        return [{ id: 1 }];
      },
    }),
  );
  const r = await db.execute(`EXPLAIN SELECT id FROM t`);
  assert.equal(calls, 0);
  assert.equal(r.rows[0].relation, "t");
});

// ─── information_schema discovery ───────────────────────────────────────────────
test("resources are discoverable via information_schema", async () => {
  const db = await db0();
  db.register(
    defineResource({
      name: "tasks",
      volatility: "stable",
      columns: [{ name: "id", type: "bigint" }, { name: "name", type: "text" }],
      select: async () => [],
    }),
  );
  const tables = await db.execute(`SELECT table_name FROM information_schema.tables`);
  assert.deepEqual(tables.rows, [{ table_name: "tasks" }]);
  const cols = await db.execute(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks' ORDER BY ordinal_position`,
  );
  assert.deepEqual(cols.rows, [
    { column_name: "id", data_type: "bigint" },
    { column_name: "name", data_type: "text" },
  ]);
});
