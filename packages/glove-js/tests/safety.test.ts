/** The sandbox boundary — budgets, aborts, and escape attempts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsSession } from "../src/session";
import { defineFn } from "glove-scratchpad/fns";

async function expectError(code: string, re: RegExp, opts?: { signal?: AbortSignal }): Promise<void> {
  const s = JsSession.create();
  await assert.rejects(() => s.execute(code, opts), re);
}

// ── budgets ──────────────────────────────────────────────────────────────────

test("while (true) {} hits the fuel budget", async () => {
  await expectError("while (true) {}", /computation budget exceeded/);
});

test("unbounded recursion hits the depth cap or fuel", async () => {
  await expectError("function f() { return f(); } f()", /call stack too deep|computation budget/);
});

test("a huge loop hits the fuel budget rather than hanging", async () => {
  await expectError("let s = 0; for (let i = 0; i < 1e9; i++) s += i; s", /computation budget exceeded/);
});

test("AbortSignal aborts a running loop", async () => {
  const s = JsSession.create();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => s.execute("while (true) {}", { signal: ac.signal }), /aborted/);
});

test("AbortSignal aborts mid-tool-call", async () => {
  const s = JsSession.create();
  const ac = new AbortController();
  s.register(
    defineFn({
      name: "hang",
      handler: async (_a, ctx) => {
        ac.abort();
        // simulate work that respects the signal
        if (ctx.signal?.aborted) throw new Error("cancelled");
        return 1;
      },
    }),
  );
  await assert.rejects(() => s.execute("hang(); while (true) {}", { signal: ac.signal }), /aborted|cancelled/);
});

// ── escape attempts ──────────────────────────────────────────────────────────

test("constructor / __proto__ / prototype are blocked on read and call", async () => {
  await expectError("({}).constructor", /not allowed/);
  await expectError("[].constructor", /not allowed/);
  await expectError("({}).__proto__", /not allowed/);
  await expectError("(() => {}).constructor", /not allowed/);
  await expectError("[].constructor.constructor('return 1')()", /not allowed/);
  await expectError("'x'.constructor", /not allowed/);
});

test("call / apply / bind are blocked", async () => {
  await expectError("const f = x => x; f.call(null, 1)", /not allowed/);
  await expectError("const f = x => x; f.bind(null)", /not allowed/);
});

test("destructuring cannot reach a forbidden key (member gate covers patterns)", async () => {
  // The classic escape: const { constructor: O } = {}; const { constructor: F } = O; F("…")()
  await expectError("const { constructor: O } = {}; O", /not allowed/);
  await expectError('const { constructor: c } = "str"; c', /not allowed/);
  await expectError("const { constructor: c } = [1, 2]; c", /not allowed/);
  await expectError("const { __proto__: p } = {}; p", /not allowed/);
  // destructuring-assignment form too
  await expectError("let O; ({ constructor: O } = {}); O", /not allowed/);
  // and normal destructuring still works
  const s = JsSession.create();
  assert.deepEqual((await s.execute("const { a, b = 5 } = { a: 1 }; [a, b]")).value, [1, 5]);
  assert.equal((await s.execute("const { x: { y } } = { x: { y: 42 } }; y")).value, 42);
  assert.equal((await s.execute("const { length } = 'hello'; length")).value, 5);
});

test("object-rest cannot smuggle __proto__ from parsed data", async () => {
  const s = JsSession.create();
  const r = await s.execute("const { ...rest } = JSON.parse('{\"__proto__\":{\"x\":1}}'); typeof rest.x");
  assert.equal(r.value, "undefined");
});

test("banned globals are rejected as references", async () => {
  await expectError("eval('1+1')", /eval is not available/);
  await expectError("new Function('return 1')", /Function constructor is not available/);
  await expectError("globalThis", /globalThis is not available/);
  await expectError("process.exit(0)", /process is not available/);
  await expectError("require('fs')", /require is not available/);
});

test("unsupported syntax is rejected at parse time with a targeted message", async () => {
  await expectError("class X {}", /classes are not supported/);
  await expectError("import x from 'y'", /import is not supported/);
  await expectError("var x = 1", /var is not supported/);
  await expectError("for (const k in {}) {}", /for…in is not supported/);
  await expectError("function* g() {}", /generator/);
  await expectError("this.x", /this is not available/);
  await expectError("label: for (;;) {}", /labeled statements/);
});

test("in / instanceof operators are rejected with guidance", async () => {
  await expectError("'a' in { a: 1 }", /'in' operator is not supported/);
  await expectError("[] instanceof Object", /'instanceof' operator is not supported/);
});

test("calling a missing method throws did-you-mean; reading it is undefined", async () => {
  await expectError("[1, 2].reduse((a, b) => a + b)", /no method 'reduse' — did you mean 'reduce'/);
  const s = JsSession.create();
  assert.equal((await s.execute("typeof [1, 2].nope")).value, "undefined");
});

test("a program cannot mutate a frozen global namespace", async () => {
  await expectError("Math.PI = 4", /read-only|cannot assign/);
});

test("object literals cannot smuggle a prototype via __proto__ key", async () => {
  const s = JsSession.create();
  // __proto__ in an object literal is rejected as a key
  await assert.rejects(() => s.execute("({ __proto__: { polluted: 1 } })"), /cannot be used as an object key/);
  // and a plain object stays a plain object
  assert.equal((await s.execute("const o = {}; typeof o.polluted")).value, "undefined");
});

test("Object.assign does not copy __proto__", async () => {
  const s = JsSession.create();
  const r = await s.execute("const o = Object.assign({}, JSON.parse('{\"__proto__\":{\"x\":1}}')); typeof o.x");
  assert.equal(r.value, "undefined");
});
