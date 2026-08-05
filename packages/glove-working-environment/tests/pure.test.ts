/**
 * Pure modules: a host package exposed to scripts synchronously.
 *
 * The property under test throughout is the one the mechanism exists for —
 * that there is NO wrong syntax. A model that awaits loses nothing (`await`
 * on a value is a no-op); a model that doesn't await gets the value; a model
 * that calls inside a `.map()` callback gets the value. The adapter route
 * fails the last two silently, which is why this route exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createWorkingEnvironment, definePureModule } from "../src/index";
import { assertAdapterOk, auditAdapter } from "../src/testing";
import type { WorkingEnvironment } from "../src/index";

const MATHKIT_URL = new URL("./fixtures/mathkit.mjs", import.meta.url).href;
const TEXTKIT_PATH = fileURLToPath(new URL("./fixtures/textkit.cjs", import.meta.url));

function mathkit() {
  return definePureModule({
    name: "mathkit",
    description: "Synchronous math and text helpers (test fixture).",
    from: MATHKIT_URL,
    pick: ["double", "titleCase", "sumBy", "groupBy", "VERSION"],
  });
}

async function env(): Promise<WorkingEnvironment> {
  return createWorkingEnvironment({
    stdlib: [mathkit()],
    execution: { onWarning: () => {} },
  });
}

async function run<T>(e: WorkingEnvironment, source: string): Promise<T> {
  const path = `/scripts/p_${Math.random().toString(36).slice(2, 8)}.js`;
  await e.fs.writeFile(path, source);
  const r = await e.runScript(path, {});
  if (!r.ok) throw new Error(`script failed: ${r.error}`);
  return r.result as T;
}

test("calls are synchronous — including inside a .map() callback", async () => {
  const e = await env();
  const out = await run<{ names: string[]; total: number }>(
    e,
    `import { titleCase, sumBy } from 'env:mathkit';
     export default async function main() {
       // No await anywhere. This is the shape muscle memory produces, and
       // the shape the adapter route silently corrupts.
       const names = ['ada lovelace', 'alan turing'].map((n) => titleCase(n));
       const total = sumBy([{ n: 3 }, { n: 9 }], 'n');
       return { names, total };
     }`,
  );
  assert.deepEqual(out, { names: ["Ada Lovelace", "Alan Turing"], total: 12 });
  await e.close();
});

test("await is harmless — both spellings produce the same value", async () => {
  // The forgiving-direction property, stated as an executable fact.
  const e = await env();
  const out = await run<{ bare: number; awaited: number }>(
    e,
    `import { double } from 'env:mathkit';
     export default async function main() {
       return { bare: double(21), awaited: await double(21) };
     }`,
  );
  assert.deepEqual(out, { bare: 42, awaited: 42 });
  await e.close();
});

test("function arguments cross inward — iteratee callbacks work", async () => {
  const e = await env();
  const out = await run<number>(
    e,
    `import { sumBy } from 'env:mathkit';
     export default async function main() {
       return sumBy([{ a: 2 }, { a: 5 }], (r) => r.a * 10);
     }`,
  );
  assert.equal(out, 70);
  await e.close();
});

test("returned objects are usable context values, and constants read as values", async () => {
  const e = await env();
  const out = await run<{ keys: string[]; spread: Record<string, number>; version: string }>(
    e,
    `import { groupBy, VERSION } from 'env:mathkit';
     export default async function main() {
       const grouped = groupBy([{ r: 'a', n: 1 }, { r: 'b', n: 2 }, { r: 'a', n: 3 }], 'r');
       // Ordinary object operations must work on the result — spread,
       // Object.keys, JSON round-trips.
       return { keys: Object.keys(grouped), spread: { ...{ a: grouped.a.length, b: grouped.b.length } }, version: VERSION };
     }`,
  );
  assert.deepEqual(out, { keys: ["a", "b"], spread: { a: 2, b: 1 }, version: "1.2.3" });
  await e.close();
});

test("a CJS package works through the default-wrapping interop", async () => {
  const e = await createWorkingEnvironment({
    stdlib: [
      definePureModule({
        name: "textkit",
        description: "CJS fixture, imported like lodash would be.",
        from: TEXTKIT_PATH, // absolute path, exercising that resolution route
        pick: ["shout", "initials"],
      }),
    ],
    execution: { onWarning: () => {} },
  });
  const out = await run<{ a: string; b: string }>(
    e,
    `import { shout, initials } from 'env:textkit';
     export default async function main() {
       return { a: shout('works'), b: initials('grace brewster hopper') };
     }`,
  );
  assert.deepEqual(out, { a: "WORKS!", b: "gbh" });
  await e.close();
});

test("generated /std docs declare the module synchronous, with correct kinds", async () => {
  const e = await env();
  const types = await e.fs.readFile("/std/mathkit/index.d.ts");
  assert.match(types, /SYNCHRONOUS/);
  assert.match(types, /`await` is allowed and changes nothing/);
  assert.match(types, /export function double\(/);
  assert.match(types, /export const VERSION: any;/);
  // And the README exists with the import line — the #1 measured friction.
  const readme = await e.fs.readFile("/std/mathkit/README.md");
  assert.match(readme, /import \{ .* \} from 'env:mathkit'/);
  await e.close();
});

test("the prototype chain is not a way out of the sandbox", async () => {
  const e = await env();
  const path = "/scripts/esc.js";
  await e.fs.writeFile(
    path,
    `import { double } from 'env:mathkit';
     export default async function main() {
       return typeof double.constructor('return process')();
     }`,
  );
  const r = await e.runScript(path, {});
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.result ?? ""), /object/);
  await e.close();
});

test("a returned function crosses as a guarded wrapper, not as an escape", async () => {
  // Better than designed for: the marshal wraps a returned function into a
  // context-realm closure — the same machinery every capability uses — so
  // factory-style utilities (memoize, curry) actually work. What must NOT
  // work is using that wrapper's own constructor chain to reach the host
  // realm, which is the half this test exists to hold.
  const e = await createWorkingEnvironment({
    stdlib: [
      definePureModule({
        name: "mk",
        description: "fixture",
        from: MATHKIT_URL,
        pick: ["makeCounter"],
      }),
    ],
    execution: { onWarning: () => {} },
  });
  await e.fs.writeFile(
    "/scripts/fn.js",
    `import { makeCounter } from 'env:mk';
     export default async function main() {
       const counter = makeCounter();
       return { first: counter(), second: counter() };
     }`,
  );
  const r = await e.runScript("/scripts/fn.js", {});
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result, { first: 1, second: 2 });

  // The wrapper's constructor is the CONTEXT Function, so this must fail.
  await e.fs.writeFile(
    "/scripts/fnesc.js",
    `import { makeCounter } from 'env:mk';
     export default async function main() {
       return typeof makeCounter().constructor('return process')();
     }`,
  );
  const esc = await e.runScript("/scripts/fnesc.js", {});
  assert.equal(esc.ok, false);
  assert.doesNotMatch(String(esc.result ?? ""), /object/);
  await e.close();
});

test("a wrong name is corrected at WRITE time, before a run is spent", async () => {
  // Even earlier than the run-time guard: write-time validation loads the
  // module graph, so the guessed import is refused before the script is
  // even stored — the same guarantee every adapter gets.
  const e = await env();
  await assert.rejects(
    e.fs.writeFile(
      "/scripts/wrong.js",
      `import { tripple } from 'env:mathkit';
       export default async function main() { return tripple(2); }`,
    ),
    /has no export "tripple".*double/s,
  );
  await e.close();
});

test("definition-time checks: empty pick, suspicious names, duplicates", () => {
  const base = { name: "x", description: "d", from: MATHKIT_URL };
  assert.throws(() => definePureModule({ ...base, pick: [] }), /pick.*required/s);
  assert.throws(() => definePureModule({ ...base, pick: ["constructor"] }), /not an allowlist/);
  assert.throws(() => definePureModule({ ...base, pick: ["__proto__"] }), /not an allowlist/);
  assert.throws(() => definePureModule({ ...base, pick: ["double", "double"] }), /duplicates/);
});

test("a guessed pick fails at creation, naming what the module does export", async () => {
  await assert.rejects(
    createWorkingEnvironment({
      stdlib: [
        definePureModule({ name: "mk", description: "d", from: MATHKIT_URL, pick: ["parseRows"] }),
      ],
    }),
    /no export "parseRows".*Available:.*double/s,
  );
});

test("an unresolvable package names the fix", async () => {
  await assert.rejects(
    createWorkingEnvironment({
      stdlib: [
        definePureModule({ name: "ghost", description: "d", from: "package-that-does-not-exist-xyz", pick: ["a"] }),
      ],
    }),
    /could not resolve.*import\.meta\.resolve/s,
  );
});

test("the adapter audit passes, and a Promise-typed pure binding is refused", async () => {
  assertAdapterOk(await auditAdapter(mathkit()));

  // The inverse of the adapter rule: declaring Promise on a sync binding is
  // the lie that teaches a model the wrong shape.
  const lying = definePureModule({
    name: "mk",
    description: "fixture",
    from: MATHKIT_URL,
    pick: ["double"],
    types: `export function double(n: number): Promise<number>;`,
  });
  const audit = await auditAdapter(lying);
  assert.equal(audit.ok, false);
  assert.match(audit.errors.join("\n"), /pure modules are synchronous/);
});

test("pure modules survive a worker being killed and replaced", async () => {
  const e = await createWorkingEnvironment({
    stdlib: [mathkit()],
    limits: { runTimeoutMs: 900 },
    execution: { graceMs: 100, onWarning: () => {} },
  });
  await e.fs.writeFile("/scripts/spin.js", `export default async function main() { for (;;) {} }`);
  const killed = await e.runScript("/scripts/spin.js", {});
  assert.equal(killed.ok, false);

  // The replacement worker re-imports pure modules from its start message.
  const out = await run<number>(
    e,
    `import { double } from 'env:mathkit';
     export default async function main() { return double(4); }`,
  );
  assert.equal(out, 8);
  await e.close();
});
