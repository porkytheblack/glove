/** Session semantics — persistence, print capture, elision, defined/defs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PySession } from "../src/session";

test("top-level names persist across execute calls", async () => {
  const s = PySession.create();
  await s.execute("xs = [1, 2, 3, 4, 5]");
  assert.equal((await s.execute("len(xs)")).value, 5);
  assert.equal((await s.execute("sum(xs)")).value, 15);
});

test("rebinding a top-level name is allowed (REPL ergonomics)", async () => {
  const s = PySession.create();
  await s.execute("x = 1");
  await s.execute("x = 2");
  assert.equal((await s.execute("x")).value, 2);
});

test("a name bound inside a function does NOT leak to the session", async () => {
  const s = PySession.create();
  await s.execute("def f():\n  inner = 1\n  return inner\nf()");
  await assert.rejects(() => s.execute("inner"), /not defined/);
});

test("defined lists new top-level names; defs peeks list values", async () => {
  const s = PySession.create();
  const r = await s.execute("rows = [{'id': 1}, {'id': 2}, {'id': 3}]");
  assert.deepEqual(r.defined, ["rows"]);
  assert.deepEqual(r.defs?.rows, { count: 3, peek: { id: 1 } });
});

test("print is captured into stdout", async () => {
  const s = PySession.create();
  const r = await s.execute("print('hello', 42)\nprint({'a': 1})\n'done'");
  assert.equal(r.value, "done");
  assert.deepEqual(r.stdout, ["hello 42", "{'a': 1}"]);
});

test("stdout resets between calls", async () => {
  const s = PySession.create();
  await s.execute("print('first')");
  const r = await s.execute("2 + 2");
  assert.equal(r.stdout, undefined);
});

test("a large list value is elided with a marker naming the true count", async () => {
  const s = PySession.create();
  const r = await s.execute("[i for i in range(100)]");
  assert.equal(r.elided, true);
  assert.ok(Array.isArray(r.value));
  assert.ok((r.value as unknown[]).length < 100);
  assert.match(String((r.value as unknown[]).at(-1)), /75 more of 100 total/);
});

test("a long string value is truncated", async () => {
  const s = PySession.create();
  const r = await s.execute("'x' * 1000");
  assert.equal(r.elided, true);
  assert.match(String(r.value), /1000 chars total/);
});

test("binding a big list keeps it in the session; only a summary crosses", async () => {
  const s = PySession.create();
  const r = await s.execute("rows = [i for i in range(1000)]");
  // the value returned is None-ish (assignment), the list lives in the session
  assert.deepEqual(r.defined, ["rows"]);
  assert.equal(r.defs?.rows && (r.defs.rows as { count: number }).count, 1000);
  assert.equal((await s.execute("len(rows)")).value, 1000);
});

test("uncaught raise surfaces as an error result", async () => {
  const s = PySession.create();
  await assert.rejects(() => s.execute("raise ValueError('nope')"), /nope/);
});

test("definitions() reports only user names, not builtins or tools", async () => {
  const s = PySession.create();
  await s.execute("a = 1\nb = 2");
  assert.deepEqual(s.definitions().sort(), ["a", "b"]);
});
