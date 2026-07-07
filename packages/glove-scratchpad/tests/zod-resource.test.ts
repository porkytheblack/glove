/**
 * Zod-first resource definitions — one schema is the columns AND the row type,
 * flowing end to end into every resolver (this file is type-checked by
 * `pnpm typecheck`, so the resolver signatures below double as compile-time
 * assertions).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Database, defineResource, columnsFromZod } from "../src/index";
import { makeBindings } from "../src/db/provider";

const ctx = () => ({ cache: new Map<string, unknown>() });

test("columnsFromZod maps Zod types to Postgres types", () => {
  const cols = columnsFromZod(
    z.object({
      id: z.number().int().describe("row id"),
      score: z.number(),
      done: z.boolean(),
      title: z.string(),
      role: z.enum(["a", "b"]),
      when: z.date(),
      at: z.iso.datetime(),
      created: z.string().meta({ pgType: "timestamptz" }),
      big: z.bigint(),
      tags: z.array(z.string()),
      meta: z.object({ a: z.number() }),
    }),
    ["id"],
  );
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
  assert.equal(byName.id.type, "bigint");
  assert.equal(byName.id.requiredKey, true);
  assert.equal(byName.id.description, "row id");
  assert.equal(byName.score.type, "double precision");
  assert.equal(byName.done.type, "boolean");
  assert.equal(byName.title.type, "text");
  assert.equal(byName.role.type, "text");
  assert.equal(byName.when.type, "timestamptz"); // z.date() → timestamptz (shape walk)
  assert.equal(byName.at.type, "timestamptz"); // z.iso.datetime() → date-time format
  assert.equal(byName.created.type, "timestamptz"); // .meta({ pgType }) override
  assert.equal(byName.big.type, "bigint"); // z.bigint() → bigint (shape walk)
  assert.equal(byName.tags.type, "jsonb");
  assert.equal(byName.meta.type, "jsonb");
  // Non-key columns carry no requiredKey.
  assert.equal(byName.title.requiredKey, undefined);
});

test("columnsFromZod preserves declaration order", () => {
  const cols = columnsFromZod(z.object({ z: z.string(), a: z.string(), m: z.string() }));
  assert.deepEqual(cols.map((c) => c.name), ["z", "a", "m"]);
});

test("columnsFromZod rejects a key not in the schema", () => {
  assert.throws(() => columnsFromZod(z.object({ a: z.string() }), ["b"]), /key "b" is not a property/);
});

test("defineResource(schema) derives columns and keeps the resolver", async () => {
  const pr = defineResource({
    name: "github_pr",
    volatility: "stable",
    schema: z.object({
      number: z.number().int().describe("PR number"),
      title: z.string(),
      merged: z.boolean(),
    }),
    keys: ["number"],
    // Typed end to end: `b.one("number")` autocompletes; the return must be rows
    // of the schema (key column optional — it's stamped from the WHERE).
    select: async (b) => [{ title: `PR #${b.one("number")}`, merged: true }],
  });
  assert.deepEqual(pr.columns.map((c) => c.name), ["number", "title", "merged"]);
  assert.equal(pr.columns.find((c) => c.name === "number")!.requiredKey, true);
  const rows = await pr.select!(makeBindings(new Map([["number", [42]]])), ctx());
  assert.deepEqual(rows, [{ title: "PR #42", merged: true }]);
});

test("defineResource(schema) errors like the columns form", () => {
  assert.throws(
    () =>
      defineResource({
        name: "x",
        volatility: "stable",
        schema: z.object({ a: z.string() }),
        // no verb
      } as any),
    /at least one of select/,
  );
});

test("a Zod resource runs end to end through the Database (WHERE-pushdown)", async () => {
  let calls = 0;
  const db = await Database.create({ policy: { writes: true } });

  db.register(
    defineResource({
      name: "web",
      volatility: "volatile",
      schema: z.object({
        query: z.string().describe("search terms"),
        title: z.string(),
        url: z.string(),
        score: z.number().int(),
      }),
      keys: ["query"],
      select: async (b) => {
        calls++;
        const q = b.one("query");
        return [
          { title: `${q} — a primer`, url: "https://ex/1", score: 9 },
          { title: `${q} in practice`, url: "https://ex/2", score: 7 },
        ];
      },
    }),
  );

  // Discovery: the schema's columns show up in information_schema with pg types.
  const cols = await db.execute(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'web' ORDER BY ordinal_position`,
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ["query", "title", "url", "score"]);
  assert.equal(cols.rows.find((r) => r.column_name === "score")!.data_type, "bigint");

  // Invoke: `query` is pushed down as an argument; `score` filters the rows in SQL.
  const res = await db.execute(`SELECT title, url FROM web WHERE query = 'sql engines' AND score >= 8`);
  assert.deepEqual(res.rows, [{ title: "sql engines — a primer", url: "https://ex/1" }]);

  // A missing required key is a clear error (never a silent empty result) — and
  // it's caught BEFORE the resolver runs, so no wasted effectful call.
  await assert.rejects(() => db.execute(`SELECT title FROM web`), /requires an equality on "query"/);

  // Volatility: only the one real read resolved `web` (information_schema hits the
  // catalog, not the resolver; the missing-key query threw first) — exactly once.
  assert.equal(calls, 1);
  await db.close();
});

test("a Zod resource stages + fires an INSERT with typed rows", async () => {
  const created: { title: string; url: string }[] = [];
  const db = await Database.create({ policy: { writes: true } });
  db.register(
    defineResource({
      name: "notion_page",
      volatility: "volatile",
      schema: z.object({ title: z.string(), url: z.string() }),
      // `rows` is typed to the schema — a wrong field name would fail typecheck.
      insert: async (rows) => {
        created.push(...rows);
        return { created: rows.length };
      },
    }),
  );
  await db.execute(`BEGIN`);
  const staged = await db.execute(`INSERT INTO notion_page (title, url) VALUES ('hi', 'https://x')`);
  assert.equal(staged.staged?.length, 1);
  assert.equal(created.length, 0); // nothing fired yet
  await db.execute(`COMMIT`);
  assert.deepEqual(created, [{ title: "hi", url: "https://x" }]);
  await db.close();
});
