import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";
import type { Bindings, ResourceColumn, ResourceTable } from "../src/db/provider";

function reads(
  name: string,
  columns: ResourceColumn[],
  rows: Record<string, unknown>[] | ((b: Bindings) => Record<string, unknown>[]),
  volatility: "immutable" | "stable" | "volatile" = "stable",
): ResourceTable {
  return defineResource({
    name,
    columns,
    volatility,
    select: async (b) => (typeof rows === "function" ? rows(b) : rows),
  });
}

test("SELECT pushes WHERE equalities down to the resolver", async () => {
  const seen: Array<string | undefined> = [];
  const db = await Database.create();
  db.register(
    defineResource({
      name: "web",
      volatility: "volatile",
      columns: [{ name: "query", type: "text", requiredKey: true }, { name: "title", type: "text" }],
      select: async (b) => {
        seen.push(b.one("query") as string);
        return [{ title: `re: ${b.one("query")}` }];
      },
    }),
  );
  const r = await db.execute(`SELECT title FROM web WHERE query = 'sql engines'`);
  assert.deepEqual(seen, ["sql engines"]);
  assert.deepEqual(r.rows, [{ title: "re: sql engines" }]);
  assert.equal(r.touched[0].name, "web");
  assert.equal(r.touched[0].invocations, 1);
});

test("a missing required-key column is a clear error", async () => {
  const db = await Database.create();
  db.register(
    defineResource({
      name: "images",
      volatility: "volatile",
      columns: [{ name: "prompt", type: "text", requiredKey: true }, { name: "url", type: "text" }],
      select: async () => [{ url: "x" }],
    }),
  );
  await assert.rejects(() => db.execute(`SELECT url FROM images`), /requires an equality on "prompt"/);
});

test("a non-key WHERE clause is applied by the engine as a filter", async () => {
  const db = await Database.create();
  db.register(
    reads("prs", [{ name: "id", type: "bigint" }, { name: "merged", type: "boolean" }], [
      { id: 1, merged: true },
      { id: 2, merged: false },
    ]),
  );
  const r = await db.execute(`SELECT id FROM prs WHERE merged = true`);
  assert.deepEqual(r.rows, [{ id: 1 }]);
});

test("JOIN composes two resources, each resolved once", async () => {
  const db = await Database.create();
  db.register(reads("a", [{ name: "id", type: "bigint" }, { name: "val", type: "text" }], [
    { id: 1, val: "one" },
    { id: 2, val: "two" },
  ]));
  db.register(reads("b", [{ name: "id", type: "bigint" }, { name: "label", type: "text" }], [
    { id: 1, label: "X" },
    { id: 2, label: "Y" },
  ]));
  const r = await db.execute(`SELECT a.val, b.label FROM a JOIN b ON a.id = b.id ORDER BY a.id`);
  assert.deepEqual(r.rows, [{ val: "one", label: "X" }, { val: "two", label: "Y" }]);
  assert.deepEqual(r.touched.map((t) => t.name).sort(), ["a", "b"]);
});

test("ephemeral tables are torn down after the query", async () => {
  const db = await Database.create();
  db.register(reads("a", [{ name: "id", type: "bigint" }], [{ id: 1 }]));
  await db.execute(`SELECT id FROM a`);
  // After teardown, the materialized table is gone; only the catalog entry remains
  // (advertised as BASE TABLE so a droid's table_type filter finds it).
  const tables = await db.execute(`SELECT table_name, table_type FROM information_schema.tables`);
  assert.deepEqual(tables.rows, [{ table_name: "a", table_type: "BASE TABLE" }]);
});

test("result rows are bounded and truncation is reported", async () => {
  const db = await Database.create();
  const many = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  db.register(reads("nums", [{ name: "id", type: "bigint" }], many));
  const r = await db.execute(`SELECT id FROM nums`, { limit: 3 });
  assert.equal(r.rows.length, 3);
  assert.equal(r.truncated, true);
});

test("INSERT … SELECT composes a read resource into a write resource (no rows in context)", async () => {
  const created: Record<string, unknown>[] = [];
  const db = await Database.create({ policy: { writes: true } });
  db.register(reads("github_pr", [
    { name: "title", type: "text" },
    { name: "merged", type: "boolean" },
  ], [
    { title: "feat: x", merged: true },
    { title: "wip: y", merged: false },
  ]));
  db.register(
    defineResource({
      name: "notion_page",
      volatility: "volatile",
      columns: [{ name: "title", type: "text" }],
      insert: async (rows) => {
        created.push(...rows);
        return { inserted: rows.length };
      },
    }),
  );
  const r = await db.execute(
    `INSERT INTO notion_page (title) SELECT title FROM github_pr WHERE merged = true`,
  );
  assert.deepEqual(created, [{ title: "feat: x" }]);
  assert.equal(r.touched.some((t) => t.name === "notion_page" && t.access === "write"), true);
});

test("two aliases of one relation with different predicates fetch broadly (no cross-alias narrowing)", async () => {
  const db = await Database.create();
  db.register(
    reads("issues", [{ name: "id", type: "text" }, { name: "state", type: "text" }], [
      { id: "A", state: "done" },
      { id: "B", state: "done" },
      { id: "D", state: "todo" },
    ]),
  );
  db.register(
    reads("prs", [{ name: "n", type: "bigint" }, { name: "closes", type: "text" }, { name: "state", type: "text" }], [
      { n: 1, closes: "A", state: "merged" },
      { n: 2, closes: "B", state: "open" },
    ]),
  );
  // ghost = done, claimed, but never by a MERGED pr → B
  const r = await db.execute(
    `SELECT i.id FROM issues i WHERE i.state = 'done'
       AND EXISTS (SELECT 1 FROM prs p WHERE p.closes = i.id)
       AND NOT EXISTS (SELECT 1 FROM prs p2 WHERE p2.closes = i.id AND p2.state = 'merged')`,
  );
  assert.deepEqual(r.rows, [{ id: "B" }]); // was []: p2's state='merged' starved p's fetch
});
