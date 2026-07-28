/**
 * The base adapters — `env:fs` and `env:std`.
 *
 * These are exercised the way a script reaches them: through the realm
 * bridge, with marshalled arguments and results. Calling the host-side
 * bindings directly would test an object the model never touches, and would
 * miss exactly the failures that matter (typed arrays crossing realms,
 * host errors arriving as context-realm errors, frozen namespaces).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, script, scriptErr, callOk } from "./helpers";

// ============================================================== env:fs

test("env:fs round-trips text and bytes across the realm boundary", async () => {
  const env = await makeEnv();
  const out = await script<{ text: string; bytes: number[]; same: boolean }>(
    env,
    `import { writeFile, readFile, readBytes } from 'env:fs';
     export default async function main() {
       await writeFile('/tmp/a.txt', 'héllo wörld');
       const text = await readFile('/tmp/a.txt');
       const raw = new Uint8Array([0, 1, 2, 250, 255]);
       await writeFile('/tmp/a.bin', raw);
       const back = await readBytes('/tmp/a.bin');
       return { text, bytes: Array.from(back), same: back instanceof Uint8Array };
     }`,
  );
  assert.equal(out.text, "héllo wörld");
  assert.deepEqual(out.bytes, [0, 1, 2, 250, 255]);
  assert.ok(out.same, "readBytes must hand the script a context-realm Uint8Array");
});

test("env:fs appendFile creates then appends", async () => {
  const env = await makeEnv();
  const out = await script<string>(
    env,
    `import { appendFile, readFile } from 'env:fs';
     export default async function main() {
       await appendFile('/tmp/log.txt', 'one\\n');
       await appendFile('/tmp/log.txt', 'two\\n');
       return readFile('/tmp/log.txt');
     }`,
  );
  assert.equal(out, "one\ntwo\n");
});

test("env:fs readdir reports kind and size; stat distinguishes file and dir", async () => {
  const env = await makeEnv();
  const out = await script<{
    entries: Array<{ name: string; kind: string; size: number }>;
    file: { kind: string; size: number };
    dir: { kind: string };
    missing: unknown;
  }>(
    env,
    `import { writeFile, mkdir, readdir, stat } from 'env:fs';
     export default async function main() {
       await writeFile('/tmp/d/a.txt', 'abc');
       await mkdir('/tmp/d/sub');
       const entries = (await readdir('/tmp/d')).map(e => ({ name: e.name, kind: e.kind, size: e.size }));
       return {
         entries,
         file: await stat('/tmp/d/a.txt'),
         dir: await stat('/tmp/d/sub'),
         missing: await stat('/tmp/d/nope'),
       };
     }`,
  );
  assert.deepEqual(
    out.entries.map((e) => [e.name, e.kind]).sort(),
    [
      ["a.txt", "file"],
      ["sub", "dir"],
    ],
  );
  assert.equal(out.entries.find((e) => e.name === "a.txt")?.size, 3);
  assert.equal(out.file.kind, "file");
  assert.equal(out.file.size, 3);
  assert.equal(out.dir.kind, "dir");
  assert.equal(out.missing, null, "stat of a missing path is null, not a throw");
});

test("env:fs glob honours **, * and ?", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, string[]>>(
    env,
    `import { writeFile, glob } from 'env:fs';
     export default async function main() {
       for (const p of ['/inbox/a.csv','/inbox/b.csv','/inbox/deep/c.csv','/inbox/deep/d.txt','/inbox/e1.csv'])
         await writeFile(p, 'x');
       return {
         deep: await glob('/inbox/**/*.csv'),
         flat: await glob('/inbox/*.csv'),
         single: await glob('/inbox/?1.csv'),
       };
     }`,
  );
  assert.deepEqual(out.flat, ["/inbox/a.csv", "/inbox/b.csv", "/inbox/e1.csv"]);
  assert.ok(out.deep.includes("/inbox/deep/c.csv"), "** must cross directory boundaries");
  assert.ok(!out.deep.includes("/inbox/deep/d.txt"));
  assert.deepEqual(out.single, ["/inbox/e1.csv"]);
});

test("env:fs exists, mkdir nesting, rm of a file and of a tree", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, boolean>>(
    env,
    `import { writeFile, mkdir, exists, rm } from 'env:fs';
     export default async function main() {
       await mkdir('/tmp/deep/a/b');
       await writeFile('/tmp/deep/a/b/f.txt', 'x');
       await writeFile('/tmp/solo.txt', 'x');
       const before = await exists('/tmp/deep/a/b/f.txt');
       await rm('/tmp/solo.txt');
       await rm('/tmp/deep');
       return {
         before,
         soloGone: !(await exists('/tmp/solo.txt')),
         treeGone: !(await exists('/tmp/deep/a/b/f.txt')),
         rootGone: !(await exists('/tmp/deep')),
       };
     }`,
  );
  assert.deepEqual(out, { before: true, soloGone: true, treeGone: true, rootGone: true });
});

test("env:fs mv and cp move whole subtrees", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, unknown>>(
    env,
    `import { writeFile, mv, cp, readFile, exists } from 'env:fs';
     export default async function main() {
       await writeFile('/tmp/src/one.txt', '1');
       await writeFile('/tmp/src/nested/two.txt', '2');
       await cp('/tmp/src', '/tmp/copy');
       await mv('/tmp/src', '/tmp/moved');
       return {
         copyOne: await readFile('/tmp/copy/one.txt'),
         copyTwo: await readFile('/tmp/copy/nested/two.txt'),
         movedTwo: await readFile('/tmp/moved/nested/two.txt'),
         sourceGone: !(await exists('/tmp/src/one.txt')),
       };
     }`,
  );
  assert.deepEqual(out, { copyOne: "1", copyTwo: "2", movedTwo: "2", sourceGone: true });
});

test("env:fs errors name the capability that raised them", async () => {
  const env = await makeEnv();
  const missing = await scriptErr(
    env,
    `import { readFile } from 'env:fs';
     export default async function main() { return readFile('/tmp/nope.txt'); }`,
  );
  assert.match(missing, /^env:fs\.readFile: /, `expected a tagged message, got: ${missing}`);
  assert.match(missing, /nope\.txt/);
});

test("env:fs refuses the zones the model verbs refuse", async () => {
  const env = await makeEnv();
  for (const [path, why] of [
    ["/std/fs/index.d.ts", "/std is generated"],
    ["/.env/history.jsonl", "/.env is the environment's own state"],
  ] as const) {
    const err = await scriptErr(
      env,
      `import { writeFile } from 'env:fs';
       export default async function main() { return writeFile(${JSON.stringify(path)}, 'x'); }`,
    );
    assert.match(err, /^env:fs\.writeFile: /, why);
    assert.match(err, /read-only|not writable|maintained|reserved/i, `${path}: ${err}`);
  }
});

test("env:fs writes to /scripts go through the script pipeline", async () => {
  const env = await makeEnv();
  // A script written by a script is validated and gets its .d.ts, exactly as
  // if the model had used write_file.
  await script(
    env,
    `import { writeFile } from 'env:fs';
     export default async function main() {
       await writeFile('/scripts/generated.js',
         '/** Doubles n. @param {{n:number}} args */\\nexport default async function double(args){ return args.n*2 }\\n');
     }`,
  );
  const listing = await callOk(env, "ls", { path: "/scripts" });
  assert.match(listing, /generated\.js/);
  assert.match(listing, /generated\.d\.ts/, "the derived sibling must exist");
  assert.match(listing, /Doubles n/, "the JSDoc one-liner belongs in the catalogue");

  const bad = await scriptErr(
    env,
    `import { writeFile } from 'env:fs';
     export default async function main() {
       return writeFile('/scripts/nodefault.js', 'export const x = 1;\\n');
     }`,
  );
  assert.match(bad, /export default/, `contract violation must be reported: ${bad}`);
});

test("env:fs enforces the file size limit from inside a script", async () => {
  const env = await makeEnv({ limits: { maxFileBytes: 4096 } });
  const err = await scriptErr(
    env,
    `import { writeFile } from 'env:fs';
     export default async function main() { return writeFile('/tmp/big.txt', 'x'.repeat(9000)); }`,
  );
  assert.match(err, /maxFileBytes/, `the failure must name the limit: ${err}`);
});

test("env:fs namespace is frozen against a script trying to reshape it", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, boolean>>(
    env,
    `import * as fs from 'env:fs';
     export default async function main() {
       let replaced = false, added = false;
       try { fs.readFile = () => 'pwned'; replaced = fs.readFile() === 'pwned'; } catch (e) {}
       try { fs.injected = 1; added = fs.injected === 1; } catch (e) {}
       return { replaced, added };
     }`,
  );
  assert.deepEqual(out, { replaced: false, added: false });
});

// ============================================================== env:std

test("env:std json parses, pretty-prints, and reports bad input clearly", async () => {
  const env = await makeEnv();
  const out = await script<{ parsed: { a: number }; pretty: string; compact: string }>(
    env,
    `import { json } from 'env:std';
     export default async function main() {
       return {
         parsed: json.parse('{"a":1}'),
         pretty: json.stringify({ a: 1 }),
         compact: json.stringify({ a: 1 }, false),
       };
     }`,
  );
  assert.deepEqual(out.parsed, { a: 1 });
  assert.equal(out.pretty, '{\n  "a": 1\n}');
  assert.equal(out.compact, '{"a":1}');

  const err = await scriptErr(
    env,
    `import { json } from 'env:std';
     export default async function main() { return json.parse('{nope'); }`,
  );
  assert.match(err, /^env:std\.json\.parse: invalid JSON/, `nested bindings must be tagged too: ${err}`);
});

test("env:std csv.parse handles quotes, embedded separators, and CRLF", async () => {
  const env = await makeEnv();
  const out = await script<Array<Record<string, string>>>(
    env,
    `import { csv } from 'env:std';
     export default async function main() {
       return csv.parse('name,note,amount\\r\\n"Doe, Jane","said ""hi""",10\\r\\nBob,"two\\nlines",20\\r\\n');
     }`,
  );
  assert.deepEqual(out, [
    { name: "Doe, Jane", note: 'said "hi"', amount: "10" },
    { name: "Bob", note: "two\nlines", amount: "20" },
  ]);
});

test("env:std csv.rows keeps the header row; csv.parse never does", async () => {
  const env = await makeEnv();
  const out = await script<{ rows: string[][]; records: Array<Record<string, string>> }>(
    env,
    `import { csv } from 'env:std';
     export default async function main() {
       const text = 'a,b\\n1,2\\n';
       return { rows: csv.rows(text), records: csv.parse(text) };
     }`,
  );
  assert.deepEqual(out.rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(out.records, [{ a: "1", b: "2" }]);
});

test("env:std csv round-trips records and honours delimiter and column order", async () => {
  const env = await makeEnv();
  const out = await script<{ round: Array<Record<string, string>>; ordered: string; tsv: Array<Record<string, string>> }>(
    env,
    `import { csv } from 'env:std';
     export default async function main() {
       const records = [{ a: '1', b: 'x,y' }, { a: '2', b: 'plain' }];
       const round = csv.parse(csv.stringify(records));
       const ordered = csv.stringify(records, { headers: ['b', 'a'] });
       const tsv = csv.parse('a\\tb\\n1\\t2\\n', { delimiter: '\\t' });
       return { round, ordered, tsv };
     }`,
  );
  assert.deepEqual(out.round, [
    { a: "1", b: "x,y" },
    { a: "2", b: "plain" },
  ]);
  assert.equal(out.ordered.split("\n")[0], "b,a");
  assert.deepEqual(out.tsv, [{ a: "1", b: "2" }]);
});

test("env:std csv.stringify accepts raw rows and quotes what needs quoting", async () => {
  const env = await makeEnv();
  const out = await script<string>(
    env,
    `import { csv } from 'env:std';
     export default async function main() {
       return csv.stringify([['plain', 'has,comma'], ['has"quote', 'has\\nnewline']]);
     }`,
  );
  assert.equal(out, 'plain,"has,comma"\n"has""quote","has\nnewline"\n');
});

test("env:std text helpers", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, unknown>>(
    env,
    `import { text } from 'env:std';
     export default async function main() {
       return {
         lines: text.lines('a\\r\\nb\\nc'),
         joined: text.joinLines(['a', 'b']),
         short: text.truncate('abcdefghij', 5),
         untouched: text.truncate('abc', 5),
         dedented: text.dedent('\\n    title\\n      indented\\n\\n    tail\\n'),
       };
     }`,
  );
  assert.deepEqual(out.lines, ["a", "b", "c"]);
  assert.equal(out.joined, "a\nb");
  assert.equal(out.short, "abcd…");
  assert.equal(out.untouched, "abc");
  assert.equal(out.dedented, "\ntitle\n  indented\n\ntail\n");
});

test("env:std bytes bridge round-trips non-ASCII and base64", async () => {
  const env = await makeEnv();
  const out = await script<Record<string, unknown>>(
    env,
    `import { bytes } from 'env:std';
     export default async function main() {
       const b = bytes.fromText('héllo ✓');
       const b64 = bytes.toBase64(b);
       return {
         text: bytes.toText(b),
         b64,
         roundTrip: bytes.toText(bytes.fromBase64(b64)),
         isBytes: b instanceof Uint8Array,
         length: b.length,
       };
     }`,
  );
  assert.equal(out.text, "héllo ✓");
  assert.equal(out.roundTrip, "héllo ✓");
  assert.equal(out.b64, Buffer.from("héllo ✓", "utf8").toString("base64"));
  assert.ok(out.isBytes);
  assert.equal(out.length, Buffer.byteLength("héllo ✓", "utf8"));
});

test("env:std base64 survives a slice of a larger buffer", async () => {
  // A Buffer view over a pooled allocation encodes the whole pool if the
  // offset is ignored — the classic way this helper goes wrong.
  const env = await makeEnv();
  const out = await script<string>(
    env,
    `import { bytes } from 'env:std';
     export default async function main() {
       const all = bytes.fromText('AAAABBBB');
       return bytes.toBase64(all.subarray(4));
     }`,
  );
  assert.equal(Buffer.from(out, "base64").toString("utf8"), "BBBB");
});

// ===================================================== validation-time view

test("both builtins are present during write-time validation, but env:fs cannot mutate", async () => {
  const env = await makeEnv();
  await env.fs.writeFile("/inbox/seed.csv", "a,b\n1,2\n");

  // Reading and env:std at module top level is fine — that is how a script
  // legitimately derives a constant.
  await env.fs.writeFile(
    "/scripts/reads.js",
    `import { readFile } from 'env:fs';
     import { csv } from 'env:std';
     const seeded = csv.parse(await readFile('/inbox/seed.csv')).length;
     export default async function main() { return seeded; }`,
  );
  assert.equal((await env.runScript("/scripts/reads.js")).result, 1);

  // Mutating at top level is refused, and the refusal explains the fix.
  await assert.rejects(
    () =>
      env.fs.writeFile(
        "/scripts/writes.js",
        `import { writeFile } from 'env:fs';
         await writeFile('/tmp/side-effect.txt', 'x');
         export default async function main() { return 1; }`,
      ),
    (e: Error) => {
      assert.match(e.message, /not available while a script is being validated/);
      assert.match(e.message, /inside the default export/);
      return true;
    },
  );
  assert.equal(await env.fs.exists("/tmp/side-effect.txt"), false, "a rejected write must leave no trace");
});
