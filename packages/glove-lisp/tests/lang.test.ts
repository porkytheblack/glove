/** Reader + evaluator + stdlib — the pure language layer. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LispSession } from "../src/session";

const session = () => LispSession.create();

async function evalOne(code: string): Promise<unknown> {
  const s = session();
  const r = await s.execute(code);
  return r.value;
}

test("literals and arithmetic", async () => {
  assert.equal(await evalOne("(+ 1 2 3)"), 6);
  assert.equal(await evalOne("(- 10 4)"), 6);
  assert.equal(await evalOne("(* 2 3 4)"), 24);
  assert.equal(await evalOne("(/ 10 4)"), 2.5);
  assert.equal(await evalOne("(mod 10 3)"), 1);
  assert.equal(await evalOne("-3.5"), -3.5);
  assert.equal(await evalOne('"hi"'), "hi");
  assert.equal(await evalOne("nil"), null);
  assert.equal(await evalOne("true"), true);
});

test("vectors, maps, keywords", async () => {
  assert.deepEqual(await evalOne("[1 2 (+ 1 2)]"), [1, 2, 3]);
  assert.deepEqual(await evalOne('{:a 1 :b "x"}'), { a: 1, b: "x" });
  assert.equal(await evalOne('(:a {:a 41})'), 41);
  assert.equal(await evalOne('(:missing {:a 1} "dflt")'), "dflt");
  // commas are whitespace
  assert.deepEqual(await evalOne("{:a 1, :b 2}"), { a: 1, b: 2 });
});

test("keyword/string equality mercy", async () => {
  assert.equal(await evalOne('(= :open "open")'), true);
  assert.equal(await evalOne('(= "open" :open)'), true);
  assert.equal(await evalOne('(not= :open "closed")'), true);
});

test("if / when / cond / and / or / truthiness", async () => {
  assert.equal(await evalOne("(if (> 2 1) :yes :no)"), "yes");
  assert.equal(await evalOne("(if false :yes)"), null);
  assert.equal(await evalOne("(when true 1 2 3)"), 3);
  assert.equal(await evalOne('(cond (< 2 1) "a" (< 1 2) "b" :else "c")'), "b");
  assert.equal(await evalOne("(and 1 2 3)"), 3);
  assert.equal(await evalOne("(and 1 nil 3)"), null);
  assert.equal(await evalOne("(or nil false 7)"), 7);
  // 0 and "" are truthy (Clojure semantics)
  assert.equal(await evalOne('(if 0 :t :f)'), "t");
  assert.equal(await evalOne('(if "" :t :f)'), "t");
});

test("let / fn / defn / closures / rest args", async () => {
  assert.equal(await evalOne("(let [a 2 b (* a 3)] (+ a b))"), 8);
  assert.equal(await evalOne("((fn [x y] (+ x y)) 3 4)"), 7);
  const s = session();
  await s.execute("(defn add2 [x] (+ x 2))");
  assert.equal((await s.execute("(add2 40)")).value, 42);
  assert.deepEqual(await evalOne("((fn [a & more] [a more]) 1 2 3)"), [1, [2, 3]]);
});

test("#(…) lambda shorthand", async () => {
  assert.deepEqual(await evalOne("(map #(* % %) [1 2 3])"), [1, 4, 9]);
  assert.deepEqual(await evalOne("(filter #(= (:s %) \"a\") [{:s \"a\"} {:s \"b\"}])"), [{ s: "a" }]);
  assert.equal(await evalOne("(reduce #(+ %1 %2) 0 [1 2 3 4])"), 10);
});

test("threading macros", async () => {
  assert.equal(await evalOne("(->> [1 2 3 4] (filter #(> % 1)) (map inc) (sum))"), 12);
  assert.equal(await evalOne('(-> {:a {:b 5}} (get-in [:a :b]) inc)'), 6);
});

test("seq library", async () => {
  assert.equal(await evalOne("(count [1 2 3])"), 3);
  assert.equal(await evalOne("(first [7 8])"), 7);
  assert.equal(await evalOne("(last [7 8])"), 8);
  assert.deepEqual(await evalOne("(take 2 [1 2 3])"), [1, 2]);
  assert.deepEqual(await evalOne("(drop 2 [1 2 3])"), [3]);
  assert.deepEqual(await evalOne("(distinct [1 1 2 2 3])"), [1, 2, 3]);
  assert.deepEqual(await evalOne("(sort [3 1 2])"), [1, 2, 3]);
  assert.deepEqual(await evalOne("(sort-by :n [{:n 2} {:n 1}])"), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(await evalOne("(sort-by :n :desc [{:n 2} {:n 1} {:n 9}])"), [{ n: 9 }, { n: 2 }, { n: 1 }]);
  assert.deepEqual(await evalOne('(group-by :s [{:s "a" :n 1} {:s "b" :n 2} {:s "a" :n 3}])'), {
    a: [{ s: "a", n: 1 }, { s: "a", n: 3 }],
    b: [{ s: "b", n: 2 }],
  });
  assert.deepEqual(await evalOne('(frequencies ["x" "y" "x"])'), { x: 2, y: 1 });
  assert.deepEqual(await evalOne('(frequencies :s [{:s "a"} {:s "a"} {:s "b"}])'), { a: 2, b: 1 });
  assert.deepEqual(await evalOne("(max-key :n [{:n 1} {:n 9} {:n 5}])"), { n: 9 });
  assert.equal(await evalOne("(sum [1 2 3])"), 6);
  assert.equal(await evalOne("(avg [2 4])"), 3);
  assert.equal(await evalOne("(some #(> % 2) [1 2 3])"), true);
  assert.equal(await evalOne("(every? #(> % 0) [1 2 3])"), true);
  assert.equal(await evalOne("(empty? [])"), true);
  assert.equal(await evalOne('(contains? ["a" "b"] "a")'), true);
  assert.equal(await evalOne("(apply max [3 9 1])"), 9);
  assert.deepEqual(await evalOne("(mapcat :xs [{:xs [1]} {:xs [2 3]}])"), [1, 2, 3]);
});

test("map library", async () => {
  assert.deepEqual(await evalOne("(assoc {:a 1} :b 2)"), { a: 1, b: 2 });
  assert.deepEqual(await evalOne("(dissoc {:a 1 :b 2} :a)"), { b: 2 });
  assert.deepEqual(await evalOne("(merge {:a 1} {:b 2} {:a 3})"), { a: 3, b: 2 });
  assert.deepEqual(await evalOne("(select-keys {:a 1 :b 2 :c 3} [:a :c])"), { a: 1, c: 3 });
  assert.deepEqual(await evalOne("(update {:n 1} :n inc)"), { n: 2 });
  assert.deepEqual(await evalOne("(keys {:a 1 :b 2})"), ["a", "b"]);
  assert.deepEqual(await evalOne("(vals {:a 1 :b 2})"), [1, 2]);
});

test("string library incl. str/ and clojure.string/ aliases", async () => {
  assert.equal(await evalOne('(str "PR #" 42 ": " :open)'), "PR #42: open");
  assert.equal(await evalOne('(upper-case "abc")'), "ABC");
  assert.equal(await evalOne('(str/lower-case "ABC")'), "abc");
  assert.equal(await evalOne('(clojure.string/includes? "hello" "ell")'), true);
  assert.equal(await evalOne('(join ", " ["a" "b"])'), "a, b");
  assert.deepEqual(await evalOne('(split "a,b" ",")'), ["a", "b"]);
  assert.equal(await evalOne('(replace "a-b-c" "-" "+")'), "a+b+c");
  assert.equal(await evalOne('(starts-with? "Verify: x" "Verify: ")'), true);
});

test("def persists across execute calls; def echoes a summary, not the value", async () => {
  const s = session();
  const r1 = await s.execute("(def xs [1 2 3 4 5])");
  assert.deepEqual(r1.value, { defined: "xs", count: 5, peek: [1, 2, 3] });
  assert.deepEqual(r1.defined, ["xs"]);
  const r2 = await s.execute("(sum xs)");
  assert.equal(r2.value, 15);
});

test("comments and multiple top-level forms", async () => {
  assert.equal(await evalOne("; hello\n(+ 1 1) ; trailing\n(+ 2 2)"), 4);
});

test("quote", async () => {
  assert.deepEqual(await evalOne("'(a b 1)"), ["a", "b", 1]);
});

test("println lands on stdout, returns nil", async () => {
  const s = session();
  const r = await s.execute('(do (println "step" 1) (println "step" 2) :done)');
  assert.deepEqual(r.stdout, ["step 1", "step 2"]);
  assert.equal(r.value, "done");
});

// ── error UX: every error names the fix ─────────────────────────────────────

async function errOf(code: string): Promise<string> {
  try {
    await session().execute(code);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`expected ${code} to throw`);
}

test("unknown symbol suggests the closest name", async () => {
  const msg = await errOf("(cont [1 2])");
  assert.match(msg, /unknown symbol 'cont'/);
  assert.match(msg, /did you mean/);
});

test("unbalanced parens name the fix", async () => {
  assert.match(await errOf("(+ 1 2"), /unclosed '\('/);
  assert.match(await errOf("(+ 1 2))"), /no matching opener/);
});

test("keyword applied to a list suggests map", async () => {
  const msg = await errOf("(:title [{:title \"x\"}])");
  assert.match(msg, /did you mean \(map :title/);
});

test("calling a non-function suggests vector syntax", async () => {
  const msg = await errOf("(1 2 3)");
  assert.match(msg, /not callable/);
  assert.match(msg, /\[ … \]/);
});

test("fuel budget stops runaway work loudly", async () => {
  const s = LispSession.create({ fuel: 500 });
  await assert.rejects(
    () => s.execute("(reduce (fn [acc x] (concat acc (range 100))) [] (range 100))"),
    /computation budget exceeded/,
  );
});

test("recursion depth is capped with a helpful message", async () => {
  const s = LispSession.create({ fuel: 1_000_000, maxDepth: 30 });
  await assert.rejects(
    () => s.execute("(defn boom [n] (boom (inc n))) (boom 0)"),
    /recursion too deep/,
  );
});

test("large results are elided, with the true count named", async () => {
  const s = session();
  const r = await s.execute("(range 100)");
  assert.equal(r.elided, true);
  const arr = r.value as unknown[];
  assert.equal(arr.length, 26); // 25 items + elision marker
  assert.match(String(arr[25]), /\+75 more of 100 total/);
});
