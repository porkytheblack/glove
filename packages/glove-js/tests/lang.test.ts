/** Language semantics — the supported JS subset. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsSession } from "../src/session";

async function run(code: string): Promise<unknown> {
  const s = JsSession.create();
  return (await s.execute(code)).value;
}

test("literals, arithmetic, and operator precedence", async () => {
  assert.equal(await run("1 + 2 * 3"), 7);
  assert.equal(await run("2 ** 10"), 1024);
  assert.equal(await run("17 % 5"), 2);
  assert.equal(await run("true && 'yes'"), "yes");
  assert.equal(await run("null ?? 'fallback'"), "fallback");
  assert.equal(await run("1 < 2 ? 'a' : 'b'"), "a");
});

test("template literals interpolate", async () => {
  assert.equal(await run("const n = 3; `n is ${n} and ${n * 2}`"), "n is 3 and 6");
});

test("const/let, arrays, objects", async () => {
  assert.deepEqual(await run("const xs = [1, 2, 3]; xs.map(x => x * 2)"), [2, 4, 6]);
  assert.deepEqual(await run("const o = { a: 1, b: 2 }; Object.keys(o)"), ["a", "b"]);
  assert.equal(await run("let x = 1; x = x + 4; x"), 5);
});

test("destructuring with defaults and rest", async () => {
  assert.deepEqual(await run("const [a, b, ...rest] = [1, 2, 3, 4]; [a, b, rest]"), [1, 2, [3, 4]]);
  assert.deepEqual(await run("const { x, y = 9 } = { x: 1 }; [x, y]"), [1, 9]);
  assert.equal(await run("const f = ({ a, b = 2 }) => a + b; f({ a: 10 })"), 12);
});

test("spread in arrays, objects, and calls", async () => {
  assert.deepEqual(await run("const a = [1, 2]; [...a, 3]"), [1, 2, 3]);
  assert.deepEqual(await run("const o = { a: 1 }; ({ ...o, b: 2 })"), { a: 1, b: 2 });
  assert.equal(await run("const add = (...ns) => ns.reduce((a, b) => a + b, 0); add(...[1, 2, 3])"), 6);
});

test("optional chaining short-circuits", async () => {
  assert.equal(await run("const o = { a: { b: 5 } }; o?.a?.b"), 5);
  // A final `undefined` value is normalized to null by elision (JSON can't
  // carry undefined across the tool boundary); intermediate undefined is real.
  assert.equal(await run("const o = {}; o?.a?.b"), null);
  assert.equal(await run("const o = null; o?.foo()"), null);
  assert.equal(await run("const o = {}; typeof o?.a?.b"), "undefined");
});

test("array methods: map/filter/reduce/find/some/every/flatMap/sort", async () => {
  assert.deepEqual(await run("[1, 2, 3, 4].filter(x => x % 2 === 0)"), [2, 4]);
  assert.equal(await run("[1, 2, 3, 4].reduce((a, b) => a + b, 0)"), 10);
  assert.equal(await run("[1, 2, 3].find(x => x > 1)"), 2);
  assert.equal(await run("[1, 2, 3].some(x => x > 2)"), true);
  assert.equal(await run("[1, 2, 3].every(x => x > 0)"), true);
  assert.deepEqual(await run("[[1], [2, 3]].flatMap(x => x)"), [1, 2, 3]);
  assert.deepEqual(await run("[3, 1, 2].sort((a, b) => a - b)"), [1, 2, 3]);
  assert.deepEqual(await run("[3, 1, 2].sort((a, b) => b - a)"), [3, 2, 1]);
});

test("string methods", async () => {
  assert.equal(await run("'Hello World'.toLowerCase()"), "hello world");
  assert.deepEqual(await run("'a,b,c'.split(',')"), ["a", "b", "c"]);
  assert.equal(await run("'  hi  '.trim()"), "hi");
  assert.equal(await run("'abc'.includes('b')"), true);
  assert.equal(await run("'abc'.replace('b', 'X')"), "aXc");
  assert.equal(await run("'x'.repeat(3)"), "xxx");
});

test("Math, JSON, Number, Object helpers", async () => {
  assert.equal(await run("Math.max(1, 9, 3)"), 9);
  assert.equal(await run("Math.floor(3.7)"), 3);
  assert.deepEqual(await run("JSON.parse('{\"a\":1}')"), { a: 1 });
  assert.equal(await run("JSON.stringify({ a: 1 })"), '{"a":1}');
  assert.equal(await run("Number.isInteger(4)"), true);
  assert.equal(await run("Number('42')"), 42);
  assert.deepEqual(await run("Object.entries({ a: 1 })"), [["a", 1]]);
});

test("new Set / Map / Date / RegExp", async () => {
  assert.equal(await run("new Set([1, 1, 2]).size"), 2);
  assert.equal(await run("const m = new Map(); m.set('a', 1); m.get('a')"), 1);
  assert.equal(await run("/ab+c/.test('abbbc')"), true);
  assert.equal(await run("typeof Date.now()"), "number");
});

test("for-of, for, while loops", async () => {
  assert.equal(await run("let s = 0; for (const x of [1, 2, 3]) s += x; s"), 6);
  assert.equal(await run("let s = 0; for (let i = 0; i < 5; i++) s += i; s"), 10);
  assert.equal(await run("let n = 0; while (n < 3) n++; n"), 3);
});

test("closures and recursion", async () => {
  assert.equal(
    await run("function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); } fib(10)"),
    55,
  );
  assert.equal(await run("const adder = x => y => x + y; adder(3)(4)"), 7);
});

test("try/catch/finally and throw", async () => {
  assert.equal(await run("let r; try { throw 'boom'; } catch (e) { r = e } r"), "boom");
  assert.equal(await run("let done = false; try { throw 1; } catch { } finally { done = true; } done"), true);
  assert.equal(
    await run("let m; try { null.foo; } catch (e) { m = e.message.includes('null') } m"),
    true,
  );
});

test("switch with fallthrough and break", async () => {
  assert.equal(
    await run("function g(x) { switch (x) { case 1: return 'one'; case 2: return 'two'; default: return '?'; } } g(2)"),
    "two",
  );
});

test("implicit await of a promise-returning host function", async () => {
  const s = JsSession.create();
  const { defineFn } = await import("glove-scratchpad/fns");
  s.register(defineFn({ name: "slow", handler: async () => ({ ok: true }) }));
  assert.deepEqual((await s.execute("const r = slow(); r.ok")).value, true);
  assert.deepEqual((await s.execute("slow()")).value, { ok: true });
});

test("the last top-level expression is the returned value", async () => {
  const s = JsSession.create();
  const r = await s.execute("const a = 1; const b = 2; a + b");
  assert.equal(r.value, 3);
});
