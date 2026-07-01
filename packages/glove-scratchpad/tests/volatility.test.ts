import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";

function counting(name: string, volatility: "immutable" | "stable" | "volatile", counter: { n: number }) {
  return defineResource({
    name,
    volatility,
    columns: [{ name: "x", type: "bigint" }],
    select: async () => {
      counter.n++;
      return [{ x: counter.n }];
    },
  });
}

test("a resource is resolved exactly once even when referenced twice in one statement", async () => {
  const c = { n: 0 };
  const db = await Database.create();
  db.register(counting("v", "volatile", c));
  // Self-reference via a subquery — naive lazy resolution would call it per row.
  await db.execute(`SELECT x FROM v WHERE x IN (SELECT x FROM v)`);
  assert.equal(c.n, 1, "volatile resolver invoked exactly once");
});

test("STABLE results are cached within a single execute (transaction script)", async () => {
  const c = { n: 0 };
  const db = await Database.create();
  db.register(counting("s", "stable", c));
  await db.execute(`BEGIN; SELECT x FROM s; SELECT x FROM s; COMMIT`);
  assert.equal(c.n, 1, "stable resolved once across the script");
});

test("VOLATILE results are NOT cached across statements in a script", async () => {
  const c = { n: 0 };
  const db = await Database.create();
  db.register(counting("v", "volatile", c));
  await db.execute(`BEGIN; SELECT x FROM v; SELECT x FROM v; COMMIT`);
  assert.equal(c.n, 2, "volatile re-resolved per statement");
});

test("IMMUTABLE results are cached across separate execute() calls", async () => {
  const c = { n: 0 };
  const db = await Database.create();
  db.register(counting("i", "immutable", c));
  await db.execute(`SELECT x FROM i`);
  await db.execute(`SELECT x FROM i`);
  assert.equal(c.n, 1, "immutable resolved once for the database lifetime");
});
