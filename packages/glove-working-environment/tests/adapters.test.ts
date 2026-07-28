/**
 * The stdlib adapter authoring contract: defineAdapter, capability error
 * tagging, the /std documentation surface, and the testing harness adapter
 * authors are expected to build on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineAdapter, type EnvFsHandle, type StdlibAdapter } from "../src/index";
import { assertAdapterOk, auditAdapter, createAdapterTestEnv } from "../src/testing";
import { makeEnv, script, scriptErr, callOk } from "./helpers";

/** A minimal well-formed adapter used as the baseline throughout. */
const textkit = () =>
  defineAdapter({
    name: "textkit",
    description: "Toy adapter: shout a file, describe it.",
    types: `export function describe(path: string): Promise<{ path: string; format: string; bytes: number; words: number }>;
export function shout(input: string, output: string): Promise<string>;
export const nested: { reverse(input: string, output: string): Promise<string> };
`,
    docs: "# textkit\n\n```js\nimport { shout } from 'env:textkit';\nawait shout('/inbox/a.txt', '/out/a.txt');\n```\n",
    create: (vfs) => ({
      async describe(path: string) {
        const text = await vfs.readFile(path);
        return { path, format: "txt", bytes: (await vfs.stat(path))?.size ?? 0, words: text.split(/\s+/).filter(Boolean).length };
      },
      async shout(input: string, output: string) {
        await vfs.writeFile(output, (await vfs.readFile(input)).toUpperCase());
        return output;
      },
      nested: {
        async reverse(input: string, output: string) {
          await vfs.writeFile(output, [...(await vfs.readFile(input))].reverse().join(""));
          return output;
        },
      },
    }),
  });

// ==================================================== defineAdapter checks

test("defineAdapter rejects malformed specs at definition time", async () => {
  const base = { name: "ok", description: "d", types: "export const x: number;", create: () => ({ x: 1 }) };
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["uppercase name", { ...base, name: "Documents" }, /name must match/],
    ["name starting with a digit", { ...base, name: "3d" }, /name must match/],
    ["builtin name", { ...base, name: "fs" }, /builtin module name/],
    ["blank description", { ...base, description: "  " }, /description is required/],
    ["missing types", { ...base, types: "" }, /types is required/],
    ["non-string docs", { ...base, docs: 42 }, /docs must be a string/],
    ["missing create", { ...base, create: undefined }, /create\(vfs, ctx\) is required/],
  ];
  for (const [label, spec, pattern] of cases) {
    assert.throws(() => defineAdapter(spec as never), pattern, label);
  }
});

test("defineAdapter reports the module name in its errors", () => {
  assert.throws(
    () => defineAdapter({ name: "docs", description: "", types: "x", create: () => ({}) } as never),
    /stdlib adapter "docs"/,
  );
});

test("create receives its module name and whether the instance is read-only", async () => {
  const seen: Array<{ name: string; readOnly: boolean }> = [];
  const spy = defineAdapter({
    name: "spy",
    description: "records its context",
    types: "export function ping(): string;",
    create: (_vfs, ctx) => {
      seen.push({ name: ctx.name, readOnly: ctx.readOnly });
      return { ping: () => "pong" };
    },
  });
  await makeEnv({ stdlib: [spy] });
  // Two instances: normal execution, and the read-only one backing write-time
  // validation. Adapter authors must be able to tell them apart.
  assert.deepEqual(seen, [
    { name: "spy", readOnly: false },
    { name: "spy", readOnly: true },
  ]);
});

test("an adapter whose create returns a non-object fails loudly at registration", async () => {
  const broken: StdlibAdapter = {
    name: "broken",
    description: "d",
    types: "export const x: number;",
    create: () => undefined as never,
  };
  await assert.rejects(() => makeEnv({ stdlib: [broken] }), /must return an object of bindings, got undefined/);
});

// ======================================================== error tagging

test("adapter failures name the capability, at any nesting depth", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  const top = await scriptErr(
    env,
    `import { shout } from 'env:textkit';
     export default async function main() { return shout('/inbox/missing.txt', '/out/a.txt'); }`,
  );
  assert.match(top, /^env:textkit\.shout: /, top);

  const nested = await scriptErr(
    env,
    `import { nested } from 'env:textkit';
     export default async function main() { return nested.reverse('/inbox/missing.txt', '/out/a.txt'); }`,
  );
  assert.match(nested, /^env:textkit\.nested\.reverse: /, nested);
});

test("tagging leaves a message that already names a capability alone", async () => {
  const passthrough = defineAdapter({
    name: "passthrough",
    description: "rethrows a pre-tagged error",
    types: "export function boom(): Promise<void>;",
    create: (vfs) => ({
      // vfs.readFile is itself tagged when reached through env:fs; here the
      // adapter surfaces the host error verbatim.
      async boom() {
        await vfs.readFile("/tmp/definitely-missing");
      },
    }),
  });
  const env = await makeEnv({ stdlib: [passthrough] });
  const err = await scriptErr(
    env,
    `import { boom } from 'env:passthrough';
     export default async function main() { return boom(); }`,
  );
  assert.match(err, /^env:passthrough\.boom: /, err);
  assert.equal(err.match(/env:/g)?.length, 1, `the prefix must not stack: ${err}`);
});

test("tagging is transparent for sync throws, arity, and successful calls", async () => {
  const shapes = defineAdapter({
    name: "shapes",
    description: "sync and async surfaces",
    types: "export function syncBoom(): never;\nexport function arity(a: number, b: number): number;\nexport function ok(): number;",
    create: () => ({
      syncBoom() {
        throw new Error("immediate");
      },
      arity(a: number, b: number) {
        return a + b;
      },
      ok: () => 7,
    }),
  });
  const env = await makeEnv({ stdlib: [shapes] });
  const out = await script<Record<string, unknown>>(
    env,
    `import { syncBoom, arity, ok } from 'env:shapes';
     export default async function main() {
       let caught = '';
       try { syncBoom(); } catch (e) { caught = e.message; }
       return { caught, sum: arity(2, 3), ok: ok(), length: arity.length };
     }`,
  );
  assert.equal(out.caught, "env:shapes.syncBoom: immediate");
  assert.equal(out.sum, 5);
  assert.equal(out.ok, 7);
  assert.equal(out.length, 2, "a wrapper that loses fn.length changes an observable API detail");
});

test("limit failures keep a name a script can branch on", async () => {
  const env = await makeEnv({ limits: { maxFileBytes: 512 } });
  const out = await script<{ name: string; message: string }>(
    env,
    `import { writeFile } from 'env:fs';
     export default async function main() {
       try { await writeFile('/tmp/x', 'y'.repeat(2000)); }
       catch (e) { return { name: e.name, message: e.message }; }
       throw new Error('expected a limit failure');
     }`,
  );
  assert.equal(out.name, "EnvLimitError");
  assert.match(out.message, /maxFileBytes/);
});

// ================================================= /std documentation

test("registering an adapter materializes its types, docs, and the /std index", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });

  const types = await env.fs.readFile("/std/textkit/index.d.ts");
  assert.match(types, /export function shout/);
  const docs = await env.fs.readFile("/std/textkit/README.md");
  assert.match(docs, /env:textkit/);

  const index = await env.fs.readFile("/std/README.md");
  for (const mod of ["env:fs", "env:std", "env:textkit"]) {
    assert.ok(index.includes(mod), `/std/README.md must list ${mod}`);
  }
  assert.match(index, /Toy adapter: shout a file/, "the index carries each module's one-liner");
  assert.match(index, /\/std\/textkit\/README\.md/, "and points at the worked examples");
});

test("/std is read-only to scripts and rebuilt from a restored snapshot", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  const err = await scriptErr(
    env,
    `import { writeFile } from 'env:fs';
     export default async function main() { return writeFile('/std/textkit/index.d.ts', 'lies'); }`,
  );
  assert.match(err, /env:fs\.writeFile/);

  const snap = await env.snapshot();
  const { createWorkingEnvironment, fromSnapshot } = await import("../src/index");
  // Restored without the adapter: its stale docs must not linger and claim a
  // capability that is no longer registered.
  const env2 = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) });
  assert.equal(await env2.fs.exists("/std/textkit/index.d.ts"), false);
  assert.equal(await env2.fs.exists("/std/fs/index.d.ts"), true);
});

test("a description of every module reaches the model without reading /std", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  const run = env.tools.find((t) => t.name === "run_script")!;
  assert.match(run.description, /env:textkit/);
  assert.match(run.description, /Toy adapter/);
});

// ===================================================== the test harness

test("createAdapterTestEnv runs a script against the adapter under test", async () => {
  const t = await createAdapterTestEnv(textkit());
  await t.fs.writeFile("/inbox/a.txt", "hello brave world");

  const summary = await t.script<{ format: string; words: number }>(
    `import { describe } from 'env:textkit';
     export default async function main() { return describe('/inbox/a.txt'); }`,
  );
  assert.equal(summary.format, "txt");
  assert.equal(summary.words, 3);

  await t.script(
    `import { shout } from 'env:textkit';
     export default async function main() { return shout('/inbox/a.txt', '/out/a.txt'); }`,
  );
  assert.equal(await t.fs.readFile("/out/a.txt"), "HELLO BRAVE WORLD");
});

test("the harness surfaces failures instead of swallowing them", async () => {
  const t = await createAdapterTestEnv(textkit());
  await assert.rejects(
    () =>
      t.script(
        `import { shout } from 'env:textkit';
         export default async function main() { return shout('/inbox/gone.txt', '/out/x'); }`,
      ),
    /script failed: env:textkit\.shout/,
  );

  // runScript reports the same thing without throwing, for pinning messages.
  const run = await t.runScript(
    `import { shout } from 'env:textkit';
     export default async function main() { return shout('/inbox/gone.txt', '/out/x'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /env:textkit\.shout/);

  // A script rejected at write time is reported in the same shape.
  const invalid = await t.runScript(`export const notDefault = 1;`);
  assert.equal(invalid.ok, false);
  assert.match(invalid.error ?? "", /export default/);
});

test("harness scripts see console output and args like any other run", async () => {
  const t = await createAdapterTestEnv(textkit());
  const run = await t.runScript(
    `export default async function main(args) { console.log('got', args.n); return args.n * 2; }`,
    { n: 21 },
  );
  assert.equal(run.ok, true);
  assert.equal(run.result, 42);
  assert.match(run.stdout, /got 21/);
});

// ============================================================== audit

test("audit passes a well-formed adapter", async () => {
  const report = await auditAdapter(textkit());
  assertAdapterOk(report);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.bindings.sort(), ["describe", "nested", "shout"]);
});

test("audit catches a binding the types never mention", async () => {
  const report = await auditAdapter({
    name: "gap",
    description: "d",
    types: "export function known(): void;",
    docs: "x",
    create: () => ({ known: () => {}, describe: () => {}, secret: () => {} }),
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /`secret` is not mentioned in types/.test(e)), report.errors.join("; "));
});

test("audit catches types that promise a binding create never returns", async () => {
  const report = await auditAdapter({
    name: "phantom",
    description: "d",
    types: "export function real(): void;\nexport function imaginary(): void;",
    docs: "x",
    create: () => ({ real: () => {}, describe: () => {} }),
  });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => /declares `imaginary` but create\(\) does not return it/.test(e)),
    report.errors.join("; "),
  );
});

test("audit catches a binding named default, which the namespace overwrites", async () => {
  const report = await auditAdapter({
    name: "clash",
    description: "d",
    types: "export const def: number;\nexport function describe(): void;",
    docs: "x",
    create: () => ({ default: 1, describe: () => {}, def: 1 }),
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /`default`/.test(e)), report.errors.join("; "));
});

test("audit warns about missing docs and a missing describe", async () => {
  const report = await auditAdapter({
    name: "bare",
    description: "d",
    types: "export function go(): void;",
    create: () => ({ go: () => {} }),
  });
  assert.equal(report.ok, true, "warnings are advisory, not failures");
  assert.equal(report.warnings.length, 2);
  assert.ok(report.warnings.some((w) => /no docs/.test(w)));
  assert.ok(report.warnings.some((w) => /describe\(path\)/.test(w)));
});

test("audit reports a create that throws rather than crashing the suite", async () => {
  const report = await auditAdapter({
    name: "throws",
    description: "d",
    types: "export function go(): void;",
    docs: "x",
    create: () => {
      throw new Error("bad init");
    },
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /create\(\) threw: bad init/.test(e)), report.errors.join("; "));
});

test("assertAdapterOk renders every problem it found", async () => {
  const report = await auditAdapter({
    name: "messy",
    description: "",
    types: "export function ghost(): void;",
    create: () => ({ actual: () => {} }),
  });
  assert.throws(
    () => assertAdapterOk(report),
    (e: Error) => {
      assert.match(e.message, /adapter "messy" failed its audit/);
      assert.match(e.message, /description is empty/);
      assert.match(e.message, /`actual` is not mentioned/);
      assert.match(e.message, /declares `ghost`/);
      return true;
    },
  );
});

test("the harness audit checks the adapter it was given", async () => {
  const t = await createAdapterTestEnv(textkit());
  assertAdapterOk(await t.audit());
});

// ============================================== adapters and the gateway

test("an adapter writing a script has it validated like any other write", async () => {
  const emitter = defineAdapter({
    name: "emitter",
    description: "writes scripts",
    types: "export function emit(path: string, body: string): Promise<void>;\nexport function describe(p: string): Promise<null>;",
    docs: "x",
    create: (vfs: EnvFsHandle) => ({
      emit: (path: string, body: string) => vfs.writeFile(path, body),
      describe: async () => null,
    }),
  });
  const env = await makeEnv({ stdlib: [emitter] });

  const err = await scriptErr(
    env,
    `import { emit } from 'env:emitter';
     export default async function main() { return emit('/scripts/bad.js', 'export const x = 1;'); }`,
  );
  assert.match(err, /export default/, `adapters do not get a bypass: ${err}`);
  assert.equal(await env.fs.exists("/scripts/bad.js"), false);

  await script(
    env,
    `import { emit } from 'env:emitter';
     export default async function main() {
       return emit('/scripts/good.js', '/** Ok. */\\nexport default async function ok(){ return 1 }\\n');
     }`,
  );
  assert.equal(await env.fs.exists("/scripts/good.d.ts"), true);
});

test("adapter bytes cross the realm boundary intact in both directions", async () => {
  const bytesAdapter = defineAdapter({
    name: "bytesy",
    description: "byte echo",
    types: "export function make(): Promise<Uint8Array>;\nexport function sum(b: Uint8Array): Promise<number>;\nexport function describe(): Promise<null>;",
    docs: "x",
    create: () => ({
      // A Buffer is a Uint8Array subclass; the bridge must copy it as bytes,
      // not walk it as an object.
      make: async () => Buffer.from([1, 2, 3, 250]),
      sum: async (b: Uint8Array) => Array.from(b).reduce((a, x) => a + x, 0),
      describe: async () => null,
    }),
  });
  const env = await makeEnv({ stdlib: [bytesAdapter] });
  const out = await script<Record<string, unknown>>(
    env,
    `import { make, sum } from 'env:bytesy';
     export default async function main() {
       const b = await make();
       return { isBytes: b instanceof Uint8Array, values: Array.from(b), echoed: await sum(new Uint8Array([1, 2])) };
     }`,
  );
  assert.equal(out.isBytes, true);
  assert.deepEqual(out.values, [1, 2, 3, 250]);
  assert.equal(out.echoed, 3);
});

test("arguments reach an adapter as host-realm values", async () => {
  // The defect this pins: an array literal written inside a script is a
  // context-realm Array. `Array.isArray` still recognises it but
  // `instanceof Array` does not, and real libraries use both — exceljs reads
  // `instanceof Array` as "a row of cells" and anything else as "a map of
  // column names", which turned a script's rows into an empty spreadsheet.
  let seen: Record<string, unknown> = {};
  const inspector = defineAdapter({
    name: "inspector",
    description: "reports what the host actually receives",
    types: "export function inspect(value: unknown): Promise<void>;\nexport function describe(): Promise<null>;",
    docs: "x",
    create: () => ({
      async inspect(value: { rows: unknown[]; when: unknown; bytes: unknown; nested: { deep: unknown[] } }) {
        seen = {
          isArray: Array.isArray(value.rows),
          instanceofArray: value.rows instanceof Array,
          rowInstanceofArray: value.rows[0] instanceof Array,
          plainObject: Object.getPrototypeOf(value) === Object.prototype,
          date: value.when instanceof Date,
          bytes: value.bytes instanceof Uint8Array,
          nestedInstanceof: value.nested.deep instanceof Array,
          values: JSON.parse(JSON.stringify(value.rows)),
        };
      },
      describe: async () => null,
    }),
  });
  const env = await makeEnv({ stdlib: [inspector] });
  await script(
    env,
    `import { inspect } from 'env:inspector';
     export default async function main() {
       return inspect({
         rows: [['a', 'b'], [1, 2]],
         when: new Date(0),
         bytes: new Uint8Array([1, 2]),
         nested: { deep: [1] },
       });
     }`,
  );
  assert.deepEqual(seen, {
    isArray: true,
    instanceofArray: true,
    rowInstanceofArray: true,
    plainObject: true,
    date: true,
    bytes: true,
    nestedInstanceof: true,
    values: [
      ["a", "b"],
      [1, 2],
    ],
  });
});

test("hostified arguments are copies, cycles and all", async () => {
  let captured: { list: number[]; self?: unknown } | undefined;
  let cyclic = false;
  const keeper = defineAdapter({
    name: "keeper",
    description: "retains what it is given",
    types: "export function keep(value: unknown): Promise<void>;\nexport function describe(): Promise<null>;",
    docs: "x",
    create: () => ({
      async keep(value: { list: number[]; self?: unknown }) {
        captured = value;
        cyclic = value.self === value;
      },
      describe: async () => null,
    }),
  });
  const env = await makeEnv({ stdlib: [keeper] });
  await script(
    env,
    `import { keep } from 'env:keeper';
     export default async function main() {
       const payload = { list: [1, 2] };
       payload.self = payload;          // a cycle must not hang the copy
       await keep(payload);
       payload.list.push(999);          // must not reach the host's copy
     }`,
  );
  // Inspected host-side: sending it back through the bridge would only prove
  // that the outbound copy works.
  assert.ok(cyclic, "a self-reference must survive as a self-reference");
  assert.deepEqual(captured?.list, [1, 2], "the host holds a snapshot, not a live view");
});

test("an adapter cannot mutate the tree during write-time validation", async () => {
  const eager = defineAdapter({
    name: "eager",
    description: "writes on call",
    types: "export function touch(): Promise<void>;\nexport function describe(): Promise<null>;",
    docs: "x",
    create: (vfs) => ({
      touch: () => vfs.writeFile("/out/touched.txt", "x"),
      describe: async () => null,
    }),
  });
  const env = await makeEnv({ stdlib: [eager] });

  await assert.rejects(
    () =>
      env.fs.writeFile(
        "/scripts/toplevel.js",
        `import { touch } from 'env:eager';
         await touch();
         export default async function main() { return 1; }`,
      ),
    /not available while a script is being validated/,
  );
  assert.equal(await env.fs.exists("/out/touched.txt"), false);

  // The same call from inside the default export is fine.
  await script(
    env,
    `import { touch } from 'env:eager';
     export default async function main() { return touch(); }`,
  );
  assert.equal(await env.fs.exists("/out/touched.txt"), true);
});

test("ls /std reads as a capability catalogue", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  const listing = await callOk(env, "ls", { path: "/std", depth: 2 });
  for (const expected of ["fs", "std", "textkit", "index.d.ts", "README.md"]) {
    assert.ok(listing.includes(expected), `ls /std should mention ${expected}:\n${listing}`);
  }
});
