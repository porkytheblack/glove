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
  const s = LispSession.create({ policy: { writes: true } });
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
  const s = LispSession.create({ policy: { writes: true } });
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

test("effect iteration: doall/run!/doseq/map-indexed all work", async () => {
  const s = LispSession.create({ policy: { writes: true } });
  const sent: unknown[] = [];
  s.register(
    defineResource({
      name: "emails",
      volatility: "volatile",
      columns: [{ name: "body", type: "text" }],
      select: async () => [],
      insert: async (rows: Record<string, unknown>[]) => void sent.push(...rows),
    }),
  );
  const w = { allowWrites: true };
  await s.execute(`(doall (map #(insert! :emails {:body (str "a" %)}) [1 2]))`, w);
  await s.execute(`(run! #(insert! :emails {:body (str "b" %)}) [1 2])`, w);
  await s.execute(`(doseq [x [1 2]] (insert! :emails {:body (str "c" x)}))`, w);
  assert.equal(sent.length, 6);
  const r = await s.execute(`(map-indexed (fn [i x] [i x]) ["p" "q"])`);
  assert.deepEqual(r.value, [[0, "p"], [1, "q"]]);
});

test("bulk insert from (map …) is one call with the full count", async () => {
  const s = LispSession.create({ policy: { writes: true } });
  const sent: unknown[] = [];
  s.register(
    defineResource({
      name: "issues",
      volatility: "volatile",
      columns: [{ name: "title", type: "text" }],
      select: async () => [],
      insert: async (rows: Record<string, unknown>[]) => void sent.push(...rows),
    }),
  );
  const r = await s.execute(`(insert! :issues (map (fn [t] {:title (str "Verify: " t)}) ["a" "b" "c"]))`, { allowWrites: true });
  assert.equal(sent.length, 3);
  assert.match(JSON.stringify(r.value), /"count":3/);
});

test("into/set/vec/assoc-in behave like Clojure", async () => {
  const s = await session();
  assert.deepEqual(await val(s, `(into {} [[:a 1] [:b 2]])`), { a: 1, b: 2 });
  assert.deepEqual(await val(s, `(into [] (map :id (issues)))`), ["A", "B", "C"]);
  assert.deepEqual(await val(s, `(set [1 2 2 3 1])`), [1, 2, 3]);
  assert.equal(await val(s, `(contains? (set (map :id (issues))) "B")`), true);
  assert.deepEqual(await val(s, `(assoc-in {:a {:b 1}} [:a :c] 2)`), { a: { b: 1, c: 2 } });
});

test("Java interop and tool-name symbols get targeted errors", async () => {
  const s = await session();
  await assert.rejects(() => s.execute(`(.startsWith "ab" "a")`), /Java interop is not available/);
  await assert.rejects(() => s.execute(`(explain_lisp "(tables)")`), /is a TOOL, not a function/);
});

test("a re-read after a fired write does not double-count (overlay dedup)", async () => {
  const world: Record<string, unknown>[] = [];
  const s = LispSession.create({ policy: { writes: true } });
  s.register(
    defineResource({
      name: "issues2",
      volatility: "volatile",
      columns: [
        { name: "title", type: "text" },
        { name: "repo", type: "text" },
      ],
      select: async () => world.slice(), // upstream REFLECTS writes
      insert: async (rows: Record<string, unknown>[]) => void world.push(...rows.map((r) => ({ ...r, number: world.length + 1 }))),
    }),
  );
  await s.execute(`(insert! :issues2 [{:title "Verify: x" :repo "w"} {:title "Verify: y" :repo "w"}])`, { allowWrites: true });
  const n = await s.execute(`(count (filter #(starts-with? (:title %) "Verify:") (issues2)))`);
  assert.equal(n.value, 2); // was 4: live + overlay copies
});

test("(count write-result) is the ROW count, not the map's key count", async () => {
  const s = LispSession.create({ policy: { writes: true } });
  const sent: unknown[] = [];
  s.register(
    defineResource({
      name: "gh",
      volatility: "volatile",
      columns: [{ name: "title", type: "text" }],
      select: async () => [],
      insert: async (rows: Record<string, unknown>[]) => void sent.push(...rows),
    }),
  );
  const r = await s.execute(`(count (insert! :gh (map (fn [t] {:title t}) ["a" "b" "c" "d"])))`, { allowWrites: true });
  assert.equal(r.value, 4); // was 5 — the result map's key count
  const plain = await s.execute(`(count {:a 1 :b 2})`);
  assert.equal(plain.value, 2); // ordinary maps still count entries
});

test("def echoes a peek of real values (anti-fabrication)", async () => {
  const s = await session();
  const r = await s.execute(`(def xs (issues))`);
  const v = r.value as Record<string, unknown>;
  assert.equal(v.count, 3);
  assert.equal((v.peek as Record<string, unknown>).id, "A"); // real data to quote
});

test("results carry per-def peeks even when the last form is a scalar", async () => {
  const s = await session();
  const r = await s.execute(`(def hits (filter :link (issues))) (count hits)`);
  assert.equal(r.value, 1);
  const defs = r.defs as Record<string, { count: number; peek: Record<string, unknown> }>;
  assert.equal(defs.hits.count, 1);
  assert.equal(defs.hits.peek.id, "B"); // real values to quote, not fabricate
});

test("destructuring in fn/let/doseq — the group-by pipeline idiom", async () => {
  const s = await session();
  // (map (fn [[k v]] …) (group-by …)) — qwen30b's exact shape
  const r = await s.execute(`(->> (issues) (group-by :id) (map (fn [[id rows]] [id (count rows)])) (apply max-key second))`);
  assert.deepEqual(r.value, ["A", 1]);
  assert.equal(await (await s.execute(`(let [[a b] [10 20]] (+ a b))`)).value, 30);
  assert.equal(await (await s.execute(`(let [{:keys [id count]} (first (issues))] (str id "/" count))`)).value, "A/220");
  const out = await s.execute(`(def acc []) (doseq [[k v] {:a 1 :b 2}] nil) "ok"`);
  assert.equal(out.value, "ok");
});

test("second / mapv / filterv exist", async () => {
  const s = await session();
  assert.equal((await s.execute(`(second [1 2 3])`)).value, 2);
  assert.deepEqual((await s.execute(`(mapv :id (filterv :link (issues)))`)).value, ["B"]);
});

test("an error AFTER a fired write names the writes that already fired", async () => {
  const s = LispSession.create({ policy: { writes: true } });
  s.register(
    defineResource({
      name: "emails",
      volatility: "volatile",
      columns: [{ name: "body", type: "text" }],
      select: async () => [],
      insert: async () => {},
    }),
  );
  await assert.rejects(
    () => s.execute(`(do (insert! :emails {:body "x"}) (bogus-fn))`, { allowWrites: true }),
    /ALREADY FIRED in this program before the error .*insert! on "emails".*WITHOUT repeating/s,
  );
});
