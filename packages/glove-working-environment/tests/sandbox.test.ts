/**
 * Realm-isolation regression tests.
 *
 * `typeof process === "undefined"` is NOT a sufficient check — it only asks
 * whether a global is bound. The actual threat is REACHABILITY: any
 * host-realm object crossing the boundary exposes
 * `value.constructor.constructor` === the host `Function` constructor, and
 * `Function("return process")()` then escapes the sandbox completely.
 *
 * Two real escapes were found by exactly that route and are pinned here:
 *   1. injected host functions/objects (env:fs, env:std, adapters, console,
 *      module namespaces, thrown host errors, returned host arrays);
 *   2. `vm.createContext({})` — a host sandbox object leaves
 *      `globalThis.constructor` pointing at the host `Object`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment, type StdlibAdapter } from "../src/index";
import { callOk, makeEnv } from "./helpers";

/** Walks an object graph looking for any constructor chain that can see `process`. */
const HUNTER = `
  const seen = new Set(); const found = [];
  const hunt = (v, path, depth) => {
    if (depth > 4 || v === null || v === undefined) return;
    const t = typeof v;
    if (t !== 'object' && t !== 'function') return;
    if (seen.has(v)) return; seen.add(v);
    try {
      const C = v.constructor;
      if (typeof C === 'function' && typeof C.constructor === 'function') {
        if (C.constructor('return typeof process')() !== 'undefined') found.push(path + ' [.constructor.constructor]');
      }
    } catch (e) {}
    try {
      const p = Object.getPrototypeOf(v);
      if (p && p.constructor && p.constructor.constructor &&
          p.constructor.constructor('return typeof process')() !== 'undefined') found.push(path + ' [prototype]');
    } catch (e) {}
    if (depth < 3) {
      let keys = []; try { keys = Object.keys(v); } catch (e) {}
      for (const k of keys.slice(0, 30)) { try { hunt(v[k], path + '.' + k, depth + 1); } catch (e) {} }
    }
  };
`;

/** An adapter returning the awkward shapes: class instances, functions, dates, nested graphs. */
function hostShapes(): StdlibAdapter {
  return {
    name: "shapes",
    description: "returns host-realm shapes across the boundary",
    types: "export function classInstance(): Promise<unknown>;\n",
    create(vfs) {
      class Thing {
        constructor(public v: number) {}
      }
      return {
        classInstance: async () => new Thing(1),
        returnsFunction: async () => () => "from host",
        returnsDate: async () => new Date(0),
        deep: { inner: { fn: async () => ({ a: [1, { b: 2 }] }) } },
        throwsNonError: async () => {
          throw { weird: "not an Error" };
        },
        vfsRef: vfs,
      };
    },
  };
}

async function runProbe(env: Awaited<ReturnType<typeof makeEnv>>, name: string, body: string): Promise<any> {
  await callOk(env, "write_file", { path: `/scripts/${name}.js`, content: `export default async function ${name}(){\n${body}\n}` });
  const r = await env.runScript(`/scripts/${name}.js`);
  assert.equal(r.ok, true, `probe ${name} failed to run: ${r.error}`);
  return r.result;
}

test("no host-realm object is reachable from any global", async () => {
  const env = await makeEnv();
  const out = await runProbe(
    env,
    "sweepGlobals",
    `${HUNTER}
    for (const k of Object.getOwnPropertyNames(globalThis)) { try { hunt(globalThis[k], 'globalThis.' + k, 0); } catch (e) {} }
    hunt(globalThis, 'globalThis', 0);
    return { found };`,
  );
  assert.deepEqual(out.found, [], `host realm reachable from globals: ${out.found.join(", ")}`);
});

test("no host-realm object is reachable through env modules, adapters, or their return values", async () => {
  const env = await makeEnv({ stdlib: [hostShapes()] });
  const out = await runProbe(
    env,
    "sweepModules",
    `${HUNTER}
    const fs = await import('env:fs');
    const std = await import('env:std');
    const shapes = await import('env:shapes');
    hunt(fs, 'env:fs', 0); hunt(std, 'env:std', 0); hunt(shapes, 'env:shapes', 0);
    hunt(await shapes.classInstance(), 'classInstance', 0);
    // returnsFunction is deliberately absent: a capability cannot hand a
    // script a function any more, and the refusal is asserted below.
    hunt(await shapes.returnsDate(), 'returnedDate', 0);
    hunt(await shapes.deep.inner.fn(), 'deepReturn', 0);
    hunt(shapes.vfsRef, 'vfsRef', 0);
    hunt(await fs.readdir('/'), 'readdirResult', 0);
    hunt(std.json.parse('{"a":1}'), 'jsonParseResult', 0);
    return { found };`,
  );
  assert.deepEqual(out.found, [], `host realm reachable via modules: ${out.found.join(", ")}`);
});

test("a capability cannot hand a script a function, and says so", async () => {
  // Scripts run in a worker, so a capability result is structured-cloned on
  // its way in. A function cannot be cloned — which closes the last route by
  // which a live host callable could reach sandboxed code, and is why the
  // sweep above no longer probes returnsFunction.
  //
  // The failure mode that matters is the one this replaced: the serialization
  // error was swallowed, no reply was ever sent, and the script sat until the
  // wall-clock limit with nothing naming the cause.
  const env = await makeEnv({ stdlib: [hostShapes()] });
  const out = await runProbe(
    env,
    "fnReturn",
    `const shapes = await import('env:shapes');
     try { await shapes.returnsFunction(); return { caught: null }; }
     catch (e) { return { caught: e.message }; }`,
  );
  assert.match(String(out.caught), /env:shapes\.returnsFunction returned a value that cannot cross/);
  assert.match(String(out.caught), /must return data/);
});

test("host errors crossing the boundary are re-thrown as sandbox-realm errors", async () => {
  const env = await makeEnv({ stdlib: [hostShapes()] });
  const out = await runProbe(
    env,
    "sweepErrors",
    `${HUNTER}
    const fs = await import('env:fs');
    const shapes = await import('env:shapes');
    let caught = 0;
    try { await fs.readFile('/definitely/missing'); } catch (e) { caught++; hunt(e, 'fsError', 0); var isErr = e instanceof Error; }
    try { await shapes.throwsNonError(); } catch (e) { caught++; hunt(e, 'nonError', 0); var isErr2 = e instanceof Error; }
    return { found, caught, isErr, isErr2 };`,
  );
  assert.equal(out.caught, 2);
  assert.equal(out.isErr, true, "host error must be re-thrown as a sandbox-realm Error");
  assert.equal(out.isErr2, true, "non-Error host throw must arrive as a sandbox-realm Error");
  assert.deepEqual(out.found, [], `host realm reachable via errors: ${out.found.join(", ")}`);
});

test("module namespaces and promises are sandbox-realm", async () => {
  const env = await makeEnv();
  const out = await runProbe(
    env,
    "sweepNs",
    `${HUNTER}
    const self = await import('./sweepNs.js');
    hunt(self, 'selfNamespace', 0);
    const p = (await import('env:fs')).readdir('/');
    hunt(p, 'promise', 0);
    hunt(await p, 'awaited', 0);
    return { found, promiseIsSandbox: p instanceof Promise };`,
  );
  assert.equal(out.promiseIsSandbox, true);
  assert.deepEqual(out.found, [], `host realm reachable via namespaces/promises: ${out.found.join(", ")}`);
});

test("the direct escape payloads all fail", async () => {
  const env = await makeEnv();
  const out = await runProbe(
    env,
    "payloads",
    `
    const results = {};
    const fs = await import('env:fs');
    const attempts = {
      viaInjectedFn: () => fs.readFile.constructor('return typeof process')(),
      viaGlobalThis: () => globalThis.constructor.constructor('return typeof process')(),
      viaObjectLiteral: () => ({}).constructor.constructor('return typeof process')(),
      viaFunction: () => (function(){}).constructor('return typeof process')(),
      viaAsyncFn: () => (async function(){}).constructor('return typeof process')(),
      viaArray: () => [].constructor.constructor('return typeof process')(),
      viaConsole: () => console.log.constructor('return typeof process')(),
      viaCurrent: () => globalThis.__glove_current.__glove_import.constructor('return typeof process')(),
    };
    for (const [k, fn] of Object.entries(attempts)) {
      // AsyncFunction-built probes resolve to their value — await before judging.
      try { results[k] = String(await fn()); } catch (e) { results[k] = 'threw'; }
    }
    return results;`,
  );
  for (const [vector, result] of Object.entries(out as Record<string, string>)) {
    assert.ok(result === "undefined" || result === "threw", `escape vector ${vector} reached the host realm (got ${result})`);
  }
});

test("host filesystem, network, and process APIs stay unreachable", async () => {
  const env = await makeEnv();
  const out = await runProbe(
    env,
    "capabilities",
    `
    const names = ['process','require','fetch','XMLHttpRequest','WebSocket','Buffer','WebAssembly',
                   'setTimeout','setInterval','setImmediate','queueMicrotask','module','exports','global'];
    const present = names.filter(n => { try { return eval('typeof ' + n) !== 'undefined'; } catch (e) { return false; } });
    let hostRead = 'blocked';
    try { hostRead = globalThis.constructor.constructor('return require("fs").readFileSync("/etc/hostname","utf8")')(); } catch (e) { hostRead = 'blocked'; }
    return { present, hostRead };`,
  );
  assert.deepEqual(out.present, [], `these host capabilities are reachable: ${out.present.join(", ")}`);
  assert.equal(out.hostRead, "blocked", "a script read a real host file");
});

test("escape is blocked at WRITE time too (validation executes module top-level code)", async () => {
  const env = await makeEnv();
  const write = env.tools.find((t) => t.name === "write_file")!;
  const r = await write.do({
    path: "/scripts/writetime.js",
    content: `const fs = await import('env:fs');
const leaked = fs.readFile.constructor('return typeof process')();
export default async function writetime() { return leaked; }`,
  });
  assert.equal(r.status, "success");
  const run = await env.runScript("/scripts/writetime.js");
  assert.equal(run.result, "undefined", "top-level code at write time reached the host realm");
});

test("a run cannot poison state seen by a later run (fresh context per operation)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/poison.js",
    content: `export default async function poison() {
      Object.prototype.__poisoned = true;
      globalThis.__leftover = 'from previous run';
      return 'ok';
    }`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/check.js",
    content: `export default async function check() {
      return { poisoned: {}.__poisoned === true, leftover: typeof globalThis.__leftover };
    }`,
  });
  await env.runScript("/scripts/poison.js");
  const after = await env.runScript("/scripts/check.js");
  assert.deepEqual(after.result, { poisoned: false, leftover: "undefined" });
});

test("injected namespaces are frozen against tampering", async () => {
  const env = await makeEnv();
  const out = await runProbe(
    env,
    "tamperNs",
    `
    const fs = await import('env:fs');
    let mutated = false;
    try { fs.readFile = () => 'pwned'; mutated = fs.readFile() === 'pwned'; } catch (e) {}
    const fs2 = await import('env:fs');
    return { mutated, frozen: Object.isFrozen(fs2), stable: typeof fs2.readFile === 'function' };`,
  );
  assert.deepEqual(out, { mutated: false, frozen: true, stable: true });
});

test("values still cross the boundary correctly after realm isolation", async () => {
  const env = await createWorkingEnvironment({ stdlib: [hostShapes()] });
  const write = env.tools.find((t) => t.name === "write_file")!;
  await write.do({
    path: "/scripts/roundtrip.js",
    content: `import { writeFile, readBytes, readdir, stat } from 'env:fs';
import { csv, json, bytes } from 'env:std';
import { returnsDate, deep } from 'env:shapes';
export default async function roundtrip() {
  await writeFile('/tmp/b.bin', new Uint8Array([1, 2, 3, 250]));
  const back = await readBytes('/tmp/b.bin');
  const entries = await readdir('/tmp');
  const s = await stat('/tmp/b.bin');
  const parsed = csv.parse('a,b\\n1,2\\n');
  const d = await returnsDate();
  return {
    bytesOk: back instanceof Uint8Array && Array.from(back).join(',') === '1,2,3,250',
    entriesOk: Array.isArray(entries) && entries.some(e => e.name === 'b.bin' && e.kind === 'file'),
    statOk: s.kind === 'file' && s.size === 4,
    csvOk: parsed[0].a === '1' && parsed[0].b === '2',
    jsonOk: json.stringify({ x: 1 }, 0) === '{"x":1}',
    base64Ok: bytes.toBase64(bytes.fromText('hi')) === 'aGk=',
    dateOk: d instanceof Date && d.getTime() === 0,
    deepOk: JSON.stringify(await deep.inner.fn()) === '{"a":[1,{"b":2}]}',
  };
}`,
  });
  const run = await env.runScript("/scripts/roundtrip.js");
  assert.equal(run.ok, true, run.error);
  for (const [k, v] of Object.entries(run.result as Record<string, boolean>)) {
    assert.equal(v, true, `${k} broke when values were marshalled across realms`);
  }
});

test("a host stack frame never reaches the model, whatever the host is called", async () => {
  // The sandbox's premise is that the host does not exist from inside. A
  // stack trace that names host files breaks that quietly: it discloses the
  // deployment's filesystem layout and module structure to the one party the
  // design exists to keep it from.
  //
  // The earlier filter matched `/(scripts|tmp|inbox|out)/` as a substring
  // anywhere in the frame, meaning "a VFS path". `out/` and `scripts/` are
  // ordinary directory names in a real deployment, and host `/tmp` collides
  // with VFS `/tmp` exactly — so host frames sailed through.
  const env = await makeEnv();
  await env.fs.writeFile(
    "/scripts/boom.js",
    `export default async function main() { throw new Error("business logic failed"); }`,
  );
  const run = await env.runScript("/scripts/boom.js");
  assert.equal(run.ok, false);
  const error = String(run.error);

  assert.match(error, /business logic failed/);
  assert.match(error, /at main \(\/scripts\/boom\.js:/, "the script's own frames are useful and stay");

  // Every retained frame must name a file the executor actually loaded.
  // Anchored, and parenthesised form tried first — an unanchored alternation
  // captures `main (/scripts/boom.js` out of `at main (/scripts/boom.js:1:31)`.
  for (const line of error.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    const path =
      /^at .*\((.+):\d+:\d+\)$/.exec(trimmed)?.[1] ?? /^at (.+):\d+:\d+$/.exec(trimmed)?.[1] ?? null;
    assert.ok(path !== null, `unparseable frame reached the model: ${trimmed}`);
    assert.ok(path.startsWith("/scripts/"), `leaked a non-script frame: ${trimmed}`);
  }
  // This test file itself is a host frame in the throwing stack — the clearest
  // proof the filter is exact rather than approximate.
  assert.doesNotMatch(error, /\.test\.ts/);
  assert.doesNotMatch(error, /node_modules/);
  assert.doesNotMatch(error, /node:internal/);
});

test("describeError yields no frames at all when it cannot tell script from host", async () => {
  const { describeError } = await import("../src/executor/executor");
  const err = new Error("something failed");
  err.stack = "Error: something failed\n    at handler (/srv/app/out/server.js:10:5)\n    at /tmp/x.js:1:1";
  // No module set: the safe answer is the message alone, never a guess.
  assert.equal(describeError(err), "something failed");
  // With one, only the known file survives — note /tmp/x.js is NOT kept even
  // though the VFS also has a /tmp.
  assert.equal(describeError(err, new Set(["/scripts/a.js"])), "something failed");
  err.stack = "Error: something failed\n    at main (/scripts/a.js:2:3)\n    at h (/srv/app/out/server.js:10:5)";
  assert.equal(describeError(err, new Set(["/scripts/a.js"])), "something failed\n  at main (/scripts/a.js:2:3)");
});
