import { test } from "node:test";
import assert from "node:assert/strict";
import { LispSession } from "../src/session";
import { defineResource } from "glove-scratchpad";

// Fluency regressions from the first live A/B — each of these is a program a
// real model wrote (correct Clojure) that the surface mis-handled.

function issues() {
  return defineResource({
    name: "issues",
    volatility: "stable",
    columns: [
      { name: "id", type: "text" },
      { name: "count", type: "bigint" },
      { name: "link", type: "text" },
    ],
    select: async () => [
      { id: "A", count: 220, link: null },
      { id: "B", count: 4665, link: "L-1" },
      { id: "C", count: 838, link: null },
    ],
  });
}

async function session() {
  const s = new LispSession({ policy: { writes: true } });
  s.register(issues());
  return s;
}
const val = async (s: LispSession, code: string) => (await s.execute(code)).value;

test("(sort-by k > coll) sorts DESCENDING — the comparator is honored", async () => {
  const s = await session();
  assert.deepEqual(await val(s, `(map :count (sort-by :count > (issues)))`), [4665, 838, 220]);
  assert.deepEqual(await val(s, `(map :count (sort-by :count < (issues)))`), [220, 838, 4665]);
  assert.equal(await val(s, `(:id (first (sort-by :count > (issues))))`), "B"); // the real max
  // keyword form still works
  assert.deepEqual(await val(s, `(map :count (sort-by :count :desc (issues)))`), [4665, 838, 220]);
});

test("sort-by with a non-comparator middle arg errors with the fix", async () => {
  const s = await session();
  await assert.rejects(() => s.execute(`(sort-by :count (issues) >)`), /expected a list|comparator/);
});

test("max-key/min-key are variadic — (apply max-key k coll) works", async () => {
  const s = await session();
  assert.equal(await val(s, `(:id (apply max-key :count (issues)))`), "B");
  assert.equal(await val(s, `(:id (apply min-key :count (issues)))`), "A");
  assert.equal(await val(s, `(:id (max-key :count (issues)))`), "B"); // 2-arg coll form kept
});

test("(apply max-key val (frequencies …)) — the canonical most-common idiom", async () => {
  const s = await session();
  const r = await val(s, `(key (apply max-key val (frequencies ["a" "b" "b" "b" "c"])))`);
  assert.equal(r, "b");
});

test("rows omit nil columns — contains?/filter mean 'has a value'", async () => {
  const s = await session();
  assert.equal(await val(s, `(count (filter #(contains? % :link) (issues)))`), 1);
  assert.equal(await val(s, `(count (filter :link (issues)))`), 1);
  assert.equal(await val(s, `(:link (first (issues)))`), null); // keyword access still nil
});

test("get/get-in against a list of maps errors with the two likely intents", async () => {
  const s = await session();
  await assert.rejects(() => s.execute(`(get (issues) :id)`), /did you mean \(map/);
  await assert.rejects(() => s.execute(`(get-in (issues) [:id])`), /did you mean \(map/);
});

test("if-let / when-let bind and branch", async () => {
  const s = await session();
  assert.equal(await val(s, `(if-let [x (first (issues))] (:id x) "none")`), "A");
  assert.equal(await val(s, `(if-let [x (first [])] (:id x) "none")`), "none");
  assert.equal(await val(s, `(when-let [n (count (issues))] (* n 10))`), 30);
});

test("juxt builds a tuple fn", async () => {
  const s = await session();
  assert.deepEqual(await val(s, `((juxt :id :count) (first (issues)))`), ["A", 220]);
});

test("stage with no write calls errors loudly instead of no-op success", async () => {
  const s = await session();
  await assert.rejects(
    () => s.execute(`(stage {:type :issues :data {:id "x"}})`),
    /no writes were staged/,
  );
});

test("rollback! with nothing staged errors like commit!", async () => {
  const s = await session();
  await assert.rejects(() => s.execute(`(rollback!)`), /nothing is staged/);
});

test("a tool-side validation failure is one readable line", async () => {
  const s = new LispSession({ policy: { writes: true } });
  s.register(
    defineResource({
      name: "emails",
      volatility: "volatile",
      columns: [
        { name: "to_addr", type: "text" },
        { name: "body", type: "text" },
      ],
      select: async () => [],
      insert: async () => {
        throw new Error(
          `MCP error -32602: Input validation error: Invalid arguments for tool send: [\n {\n "expected": "string",\n "code": "invalid_type",\n "path": [\n "body"\n ],\n "message": "Required"\n }\n]`,
        );
      },
    }),
  );
  await assert.rejects(
    () => s.execute(`(insert! :emails {:to_addr "a@b.io"})`, { allowWrites: true }),
    (e: Error) => /insert! on "emails": the tool rejected the row — :body expected string/.test(e.message) && !e.message.includes("\n"),
  );
});
