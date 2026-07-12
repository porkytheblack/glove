/** Session semantics — persistence, console capture, elision, defined/defs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsSession } from "../src/session";

test("top-level const persists across execute calls", async () => {
  const s = JsSession.create();
  await s.execute("const xs = [1, 2, 3, 4, 5]");
  assert.equal((await s.execute("xs.length")).value, 5);
  assert.equal((await s.execute("xs.reduce((a, b) => a + b, 0)")).value, 15);
});

test("top-level redeclaration is allowed (REPL ergonomics)", async () => {
  const s = JsSession.create();
  await s.execute("const x = 1");
  await s.execute("const x = 2");
  assert.equal((await s.execute("x")).value, 2);
});

test("a const declared inside a block does NOT leak to the session", async () => {
  const s = JsSession.create();
  await s.execute("{ const inner = 1; }");
  await assert.rejects(() => s.execute("inner"), /not defined/);
});

test("defined lists new top-level names; defs peeks array values", async () => {
  const s = JsSession.create();
  const r = await s.execute("const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]");
  assert.deepEqual(r.defined, ["rows"]);
  assert.deepEqual(r.defs?.rows, { count: 3, peek: { id: 1 } });
});

test("console.log is captured into stdout", async () => {
  const s = JsSession.create();
  const r = await s.execute("console.log('hello', 42); console.log({ a: 1 }); 'done'");
  assert.equal(r.value, "done");
  assert.deepEqual(r.stdout, ["hello 42", '{"a":1}']);
});

test("stdout resets between calls", async () => {
  const s = JsSession.create();
  await s.execute("console.log('first')");
  const r = await s.execute("2 + 2");
  assert.equal(r.stdout, undefined);
});

test("a large array value is elided with a marker naming the true count", async () => {
  const s = JsSession.create();
  const r = await s.execute("Array.from({ length: 100 }).map((_, i) => i)");
  assert.equal(r.elided, true);
  assert.ok(Array.isArray(r.value));
  assert.ok((r.value as unknown[]).length < 100);
  assert.match(String((r.value as unknown[]).at(-1)), /\+75 more of 100 total/);
});

test("a long string value is truncated", async () => {
  const s = JsSession.create();
  const r = await s.execute("'x'.repeat(1000)");
  assert.equal(r.elided, true);
  assert.match(String(r.value), /1000 chars total/);
});

test("uncaught throw surfaces as an error result", async () => {
  const s = JsSession.create();
  await assert.rejects(() => s.execute("throw new Error('nope')"), /nope/);
});

test("definitions() reports only user names, not globals or tools", async () => {
  const s = JsSession.create();
  await s.execute("const a = 1; const b = 2");
  assert.deepEqual(s.definitions().sort(), ["a", "b"]);
});
