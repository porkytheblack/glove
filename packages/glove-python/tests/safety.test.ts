/** The sandbox boundary — budgets, aborts, and escape attempts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PySession } from "../src/session";
import { defineFn } from "glove-scratchpad/fns";

async function expectError(code: string, re: RegExp, opts?: { signal?: AbortSignal }): Promise<void> {
  const s = PySession.create();
  await assert.rejects(() => s.execute(code, opts), re);
}

// ── budgets ──────────────────────────────────────────────────────────────────

test("while True: pass hits the fuel budget", async () => {
  await expectError("while True:\n  pass", /computation budget exceeded/);
});

test("unbounded recursion hits the depth cap", async () => {
  await expectError("def f():\n  return f()\nf()", /recursion too deep|computation budget/);
});

test("a huge loop hits the fuel budget rather than hanging", async () => {
  await expectError("s = 0\nfor i in range(1000000000):\n  s += i\ns", /computation budget exceeded/);
});

test("a huge comprehension hits the fuel budget", async () => {
  await expectError("[x for x in range(1000000000)]", /computation budget exceeded/);
});

test("AbortSignal aborts a running loop", async () => {
  const s = PySession.create();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => s.execute("while True:\n  pass", { signal: ac.signal }), /aborted/);
});

test("AbortSignal aborts mid-tool-call", async () => {
  const s = PySession.create();
  const ac = new AbortController();
  s.register(
    defineFn({
      name: "hang",
      handler: async (_a, ctx) => {
        ac.abort();
        if (ctx.signal?.aborted) throw new Error("cancelled");
        return 1;
      },
    }),
  );
  await assert.rejects(() => s.execute("hang()\nwhile True:\n  pass", { signal: ac.signal }), /aborted|cancelled/);
});

// ── escape attempts ──────────────────────────────────────────────────────────

test("the dunder-chain escape is blocked at every hop", async () => {
  // The classic CPython sandbox escape: climb from any value to os.system.
  await expectError("().__class__", /not allowed/);
  await expectError("''.__class__", /not allowed/);
  await expectError("[].__class__", /not allowed/);
  await expectError("{}.__class__", /not allowed/);
  await expectError("(1).__class__.__bases__", /not allowed/);
  await expectError("().__class__.__bases__[0].__subclasses__()", /not allowed/);
  await expectError("[].__class__.__mro__", /not allowed/);
  await expectError("(lambda: 0).__globals__", /not allowed/);
  await expectError("(lambda: 0).__code__", /not allowed/);
});

test("dunder access via subscript-style attribute is also blocked", async () => {
  await expectError("x = []\nx.__class__", /not allowed/);
  await expectError("x = {}\nx.__init__", /not allowed/);
});

test("setting a dunder attribute is blocked", async () => {
  await expectError("d = {}\nd.__class__ = 1", /not allowed/);
});

test("import and other out-of-subset statements reject at parse time", async () => {
  await expectError("import os", /import/i);
  await expectError("import os\nos.system('ls')", /import/i);
  await expectError("from os import system", /import/i);
  await expectError("class X:\n  pass", /class/i);
  await expectError("with open('f') as fh:\n  pass", /with/i);
  await expectError("global x", /global/i);
  await expectError("del x", /del/i);
  await expectError("@decorator\ndef f():\n  pass", /decorator|not supported/i);
  await expectError("async def f():\n  pass", /async/i);
  await expectError("def g():\n  yield 1", /yield/i);
});

test("open / eval / exec / __import__ / getattr are not defined", async () => {
  await expectError("open('/etc/passwd')", /not defined/);
  await expectError("eval('1+1')", /not defined/);
  await expectError("exec('x=1')", /not defined/);
  await expectError("__import__('os')", /not allowed|not defined/);
  await expectError("getattr([], 'append')", /not defined/);
  await expectError("globals()", /not defined/);
  await expectError("vars()", /not defined/);
});

test("calling a missing method throws did-you-mean / attribute error", async () => {
  await expectError("[1, 2].appnd(3)", /has no attribute 'appnd'|no method 'appnd'/);
  await expectError("'x'.uppr()", /has no attribute 'uppr'|no method 'uppr'/);
});

test("a missing name is reported with a did-you-mean", async () => {
  await expectError("open_prs = [1]\nopen_prss", /name 'open_prss' is not defined — did you mean 'open_prs'/);
});

// ── allocation metering ──────────────────────────────────────────────────────

test("bulk allocation is metered / capped, not free", async () => {
  await expectError("'a' * 500000000", /too large/);
  await expectError("[0] * 500000000", /too large/);
  // exponential string doubling hits the fuel budget, not a host OOM
  await expectError("s = 'a'\nfor i in range(40):\n  s = s + s\ns", /computation budget exceeded/);
  // normal sizes still work
  const s = PySession.create();
  assert.equal((await s.execute("'ab' * 3")).value, "ababab");
  assert.deepEqual((await s.execute("[1, 2] * 2")).value, [1, 2, 1, 2]);
});

test("normal attribute access on plain data is unaffected", async () => {
  const s = PySession.create();
  assert.equal((await s.execute("p = {'count': 5}\np.count")).value, 5);
  assert.equal((await s.execute("'hello'.upper()")).value, "HELLO");
  assert.deepEqual((await s.execute("[3, 1, 2]\n[3, 1, 2].copy()")).value, [3, 1, 2]);
});
