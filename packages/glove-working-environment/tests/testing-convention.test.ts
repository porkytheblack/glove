/**
 * The test convention: env:assert, *.test.js discovery, and the run_tests
 * verb. The point of the feature is regression safety for an accumulating
 * script library — a library module changes and every script downstream
 * inherits it silently — so the tests here exercise exactly that shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, callErr, callOk, makeEnv, script, scriptErr } from "./helpers";

const MONEY_LIB = `/** Totals a list of amounts. */
export function total(amounts) {
  return amounts.reduce((a, b) => a + b, 0);
}
`;

const MONEY_TEST = `import * as assert from 'env:assert';
import { total } from './lib/money.js';

/** Checks money totalling. */
export default async function main() {
  assert.equal(total([1, 2, 3]), 6);
  assert.equal(total([]), 0, 'an empty basket totals zero');
}
`;

test("a passing test suite reports pass and the count", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/money.js", content: MONEY_LIB });
  const written = await callOk(env, "write_file", { path: "/scripts/money.test.js", content: MONEY_TEST });
  assert.match(written, /validated; run it with run_tests/);

  const out = await callOk(env, "run_tests", {});
  assert.match(out, /1\/1 test file\(s\) passed/);
  assert.match(out, /PASS {2}\/scripts\/money\.test\.js/);
});

test("editing a library module surfaces the regression — the whole point", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/money.js", content: MONEY_LIB });
  await callOk(env, "write_file", { path: "/scripts/money.test.js", content: MONEY_TEST });
  await callOk(env, "run_tests", {});

  // A plausible "improvement" that silently changes every caller.
  await callOk(env, "edit_file", {
    path: "/scripts/lib/money.js",
    old_str: "amounts.reduce((a, b) => a + b, 0)",
    new_str: "amounts.reduce((a, b) => a + b, 1)",
  });

  const failure = await callErr(env, "run_tests", {});
  assert.match(failure, /0\/1 test file\(s\) passed/);
  const detail = String((await call(env, "run_tests", {})).data);
  assert.match(detail, /FAIL {2}\/scripts\/money\.test\.js/);
  assert.match(detail, /values are not equal/);
  assert.match(detail, /actual: {3}7/, "the failure must carry the actual value");
  assert.match(detail, /expected: 6/);
});

test("a named assertion message survives into the report", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/named.test.js",
    content: `import * as assert from 'env:assert';\n\n/** Named. */\nexport default async function main() { assert.ok(false, 'the invoice must have a total'); }\n`,
  });
  const detail = String((await call(env, "run_tests", {})).data);
  assert.match(detail, /the invoice must have a total/);
});

test("assertions cover the shapes a script actually produces", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, string>>(
    env,
    `import * as assert from 'env:assert';
     export default async function main() {
       const caught = {};
       const grab = (k, fn) => { try { fn(); caught[k] = 'no throw'; } catch (e) { caught[k] = e.name + ': ' + e.message.split('\\n')[0]; } };

       // These must all pass silently.
       assert.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
       assert.deepEqual(new Map([['k', 1]]), new Map([['k', 1]]));
       assert.deepEqual(new Set([1, 2]), new Set([1, 2]));
       assert.deepEqual(new Date(0), new Date(0));
       assert.deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]));
       assert.notEqual(1, 2);
       assert.match('invoice-2024.pdf', /^invoice/);
       assert.match('invoice-2024.pdf', '2024');
       assert.throws(() => { throw new Error('boom'); }, /boom/);
       await assert.rejects(async () => { throw new Error('async boom'); }, 'async boom');

       // And these must all fail.
       grab('deep', () => assert.deepEqual({ a: 1 }, { a: 2 }));
       grab('match', () => assert.match('abc', /xyz/));
       grab('throws', () => assert.throws(() => 1));
       grab('fail', () => assert.fail('unreachable'));
       return caught;
     }`,
  );
  assert.match(out.deep, /^AssertionFailed: env:assert\.deepEqual: values are not deeply equal/);
  assert.match(out.match, /^AssertionFailed: env:assert\.match: value does not match/);
  assert.match(out.throws, /^AssertionFailed: env:assert\.throws: expected the function to throw/);
  assert.match(out.fail, /^AssertionFailed: env:assert\.fail: unreachable/);
});

test("a failure message is bounded — a big value must not flood the context", async () => {
  const env = await makeEnv();
  const err = await scriptErr(
    env,
    `import * as assert from 'env:assert';
     export default async function main() {
       assert.equal(Array.from({ length: 5000 }, (_, i) => i).join(','), 'nope');
     }`,
  );
  assert.match(err, /chars\]/, "the oversized side must be elided with its true length");
  assert.ok(err.length < 1500, `assertion message should stay small, got ${err.length}`);
});

test("a test file is validated but is not a capability", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/thing.test.js",
    content: `import * as assert from 'env:assert';\n\n/** Checks the thing. */\nexport default async function main() { assert.ok(true); }\n`,
  });
  assert.equal(await env.fs.exists("/scripts/thing.d.ts"), false, "tests get no .d.ts");
  assert.equal(await env.fs.exists("/scripts/thing.test.d.ts"), false);

  // But it IS held to the contract, at write time like everything else.
  const bad = await callErr(env, "write_file", {
    path: "/scripts/broken.test.js",
    content: `export const x = 1;\n`,
  });
  assert.match(bad, /export default/);

  // And ls labels it so it does not read as a tool.
  assert.match(await callOk(env, "ls", { path: "/scripts" }), /thing\.test\.js \(\d+B\) — \[test\] Checks the thing\./);
});

test("run_tests scopes to a directory or a single file, and says so when there is nothing", async () => {
  const env = await makeEnv();
  assert.match(await callErr(env, "run_tests", {}), /no tests found under \/scripts/);
  assert.match(await callErr(env, "run_tests", {}), /env:assert/, "and shows how to write one");

  await callOk(env, "write_file", {
    path: "/scripts/a/one.test.js",
    content: `import * as assert from 'env:assert';\n\n/** One. */\nexport default async function main() { assert.ok(true); }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/b/two.test.js",
    content: `import * as assert from 'env:assert';\n\n/** Two. */\nexport default async function main() { assert.ok(true); }\n`,
  });
  assert.match(await callOk(env, "run_tests", {}), /2\/2 test file\(s\) passed/);
  assert.match(await callOk(env, "run_tests", { path: "/scripts/a" }), /1\/1 test file\(s\) passed/);
  assert.match(await callOk(env, "run_tests", { path: "/scripts/a/one.test.js" }), /1\/1 test file\(s\) passed/);

  await callOk(env, "write_file", { path: "/scripts/plain.js", content: `/** P. */\nexport default async function p() { return 1; }\n` });
  assert.match(await callErr(env, "run_tests", { path: "/scripts/plain.js" }), /is not a test file/);
});

test("test runs are tagged in history so they don't look like real work", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/t.test.js",
    content: `import * as assert from 'env:assert';\n\n/** T. */\nexport default async function main() { assert.ok(true); }\n`,
  });
  await callOk(env, "write_file", { path: "/scripts/real.js", content: `/** R. */\nexport default async function r() { return 1; }\n` });
  await callOk(env, "run_tests", {});
  await callOk(env, "run_script", { path: "/scripts/real.js" });

  const hist = await callOk(env, "history", {});
  assert.match(hist, /test .*\/scripts\/t\.test\.js/);
  assert.match(hist, /ok {2}.*\/scripts\/real\.js/);
});

test("a test obeys the same deadline as any other script", async () => {
  const env = await makeEnv({ limits: { runTimeoutMs: 200 } });
  await callOk(env, "write_file", {
    path: "/scripts/slow.test.js",
    content: `/** Loops. */\nexport default async function main() { while (true) {} }\n`,
  });
  const detail = String((await call(env, "run_tests", {})).data);
  assert.match(detail, /FAIL/);
  assert.match(detail, /wall-clock limit.*runTimeoutMs/);
});
