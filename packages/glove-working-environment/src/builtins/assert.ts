/**
 * `env:assert` — assertions for the agent's own script library.
 *
 * The package's thesis is a compounding library: scripts persist and compose,
 * so an agent accumulates a toolkit. Nothing protected that toolkit from
 * regression. Editing `/scripts/lib/parse_invoice.js` silently changed every
 * script downstream of it, and the only signal was a failure three steps
 * later in an unrelated task. This is the difference between a script
 * directory and a codebase.
 *
 * Every failure formats the actual/expected pair into the message itself.
 * The model reads a message, not a diff — it has no terminal to render one
 * in, and a bare "assertion failed" costs a round trip to discover what the
 * value even was.
 */

export const ASSERT_DESCRIPTION = "Assertions for *.test.js scripts: equal, deepEqual, ok, match, throws, rejects, fail.";

/** Thrown by every assertion, so a runner can tell a failure from a crash. */
export class AssertionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionFailed";
  }
}

/**
 * Render a value for a failure message. Bounded, because an assertion on a
 * 5,000-row array must not paste 5,000 rows into the model's context.
 */
function show(value: unknown, budget = 200): string {
  let text: string;
  if (typeof value === "string") text = JSON.stringify(value);
  else if (typeof value === "bigint") text = `${value}n`;
  else if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else if (value instanceof Uint8Array) text = `Uint8Array(${value.byteLength})`;
  else if (value instanceof Map) text = `Map(${value.size})`;
  else if (value instanceof Set) text = `Set(${value.size})`;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > budget ? `${text.slice(0, budget)}… [${text.length} chars]` : text;
}

/**
 * Structural equality. Cross-realm safe: script values arrive as
 * context-realm objects, so `instanceof` is useless here and everything is
 * decided by shape and `Object.prototype.toString`.
 */
function deepEquals(a: unknown, b: unknown, seen = new Map<unknown, unknown>()): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (seen.get(a) === b) return true; // cycles compare equal once paired
  seen.set(a, b);

  const ta = Object.prototype.toString.call(a);
  if (ta !== Object.prototype.toString.call(b)) return false;

  if (ta === "[object Date]") return Number(a) === Number(b);
  if (ta === "[object RegExp]") return String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEquals(v, b[i], seen));
  }
  if (ta === "[object Map]") {
    const ma = a as Map<unknown, unknown>;
    const mb = b as Map<unknown, unknown>;
    if (ma.size !== mb.size) return false;
    for (const [k, v] of ma) {
      if (!mb.has(k) || !deepEquals(v, mb.get(k), seen)) return false;
    }
    return true;
  }
  if (ta === "[object Set]") {
    const sa = a as Set<unknown>;
    const sb = b as Set<unknown>;
    if (sa.size !== sb.size) return false;
    for (const v of sa) if (!sb.has(v)) return false;
    return true;
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const ba = new Uint8Array((a as Uint8Array).buffer, (a as Uint8Array).byteOffset, (a as Uint8Array).byteLength);
    const bb = new Uint8Array((b as Uint8Array).buffer, (b as Uint8Array).byteOffset, (b as Uint8Array).byteLength);
    return ba.length === bb.length && ba.every((v, i) => v === bb[i]);
  }

  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEquals((a as never)[k], (b as never)[k], seen),
  );
}

function fail(message: string, detail?: string): never {
  throw new AssertionFailed(detail ? `${message}\n  ${detail}` : message);
}

export function createAssertBindings(): Record<string, unknown> {
  return {
    /** Strict equality (`Object.is`). */
    equal(actual: unknown, expected: unknown, message?: string): void {
      if (Object.is(actual, expected)) return;
      fail(message ?? "values are not equal", `actual:   ${show(actual)}\n  expected: ${show(expected)}`);
    },

    /** Strict inequality. */
    notEqual(actual: unknown, expected: unknown, message?: string): void {
      if (!Object.is(actual, expected)) return;
      fail(message ?? "values are equal but should not be", `both: ${show(actual)}`);
    },

    /** Structural equality — arrays, objects, Map/Set, Date, typed arrays, cycles. */
    deepEqual(actual: unknown, expected: unknown, message?: string): void {
      if (deepEquals(actual, expected)) return;
      fail(message ?? "values are not deeply equal", `actual:   ${show(actual, 400)}\n  expected: ${show(expected, 400)}`);
    },

    /** Truthiness. */
    ok(value: unknown, message?: string): void {
      if (value) return;
      fail(message ?? "expected a truthy value", `got: ${show(value)}`);
    },

    /** Regex or substring match against a string. */
    match(actual: unknown, pattern: RegExp | string, message?: string): void {
      const text = String(actual);
      const hit = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
      if (hit) return;
      fail(message ?? "value does not match", `pattern: ${String(pattern)}\n  actual:  ${show(text, 400)}`);
    },

    /** The function must throw; returns the error so a test can inspect it. */
    throws(fn: () => unknown, pattern?: RegExp | string, message?: string): unknown {
      let thrown: unknown;
      let threw = false;
      try {
        fn();
      } catch (e) {
        threw = true;
        thrown = e;
      }
      if (!threw) fail(message ?? "expected the function to throw, but it returned normally");
      if (pattern !== undefined) {
        const text = thrown instanceof Error ? thrown.message : String(thrown);
        const hit = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
        if (!hit) fail(message ?? "thrown error does not match", `pattern: ${String(pattern)}\n  thrown:  ${show(text, 400)}`);
      }
      return thrown;
    },

    /** The async function must reject; resolves to the error. */
    async rejects(fn: () => Promise<unknown>, pattern?: RegExp | string, message?: string): Promise<unknown> {
      let thrown: unknown;
      let threw = false;
      try {
        await fn();
      } catch (e) {
        threw = true;
        thrown = e;
      }
      if (!threw) fail(message ?? "expected the promise to reject, but it resolved");
      if (pattern !== undefined) {
        const text = thrown instanceof Error ? thrown.message : String(thrown);
        const hit = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
        if (!hit) fail(message ?? "rejection does not match", `pattern: ${String(pattern)}\n  thrown:  ${show(text, 400)}`);
      }
      return thrown;
    },

    /** Fail outright — for a branch that should be unreachable. */
    fail(message?: string): never {
      fail(message ?? "assert.fail()");
    },
  };
}

export const ASSERT_TYPES = `/**
 * Assertions for test scripts. Every failure throws an AssertionFailed whose
 * message already contains the actual and expected values.
 *
 * Tests live at /scripts/**‍/*.test.js and follow the same contract as any
 * other script — \`export default async function (args) { ... }\` — but a
 * test's job is to throw, not to return. Run them all with the run_tests
 * verb; a test file is not listed as a capability in ls /scripts.
 *
 *   import * as assert from 'env:assert';
 *   import { total } from './lib/money.js';
 *
 *   /** Checks money totalling. *‍/
 *   export default async function main() {
 *     assert.equal(total([1, 2]), 3);
 *     assert.deepEqual(total([]), 0, 'an empty basket totals zero');
 *   }
 */

/** Strict equality (Object.is). */
export function equal(actual: unknown, expected: unknown, message?: string): void;

/** Strict inequality. */
export function notEqual(actual: unknown, expected: unknown, message?: string): void;

/** Structural equality: arrays, plain objects, Map, Set, Date, typed arrays, cycles. */
export function deepEqual(actual: unknown, expected: unknown, message?: string): void;

/** Truthiness. */
export function ok(value: unknown, message?: string): void;

/** Regex test, or substring containment when given a string. */
export function match(actual: unknown, pattern: RegExp | string, message?: string): void;

/** Assert the function throws. Returns the thrown value so you can inspect it. */
export function throws(fn: () => unknown, pattern?: RegExp | string, message?: string): unknown;

/** Assert the async function rejects. Resolves to the thrown value. */
export function rejects(fn: () => Promise<unknown>, pattern?: RegExp | string, message?: string): Promise<unknown>;

/** Fail outright — for a branch that should be unreachable. */
export function fail(message?: string): never;
`;
