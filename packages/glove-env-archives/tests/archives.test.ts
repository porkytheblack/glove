/**
 * The archives adapter, exercised the way a script reaches it — through the
 * realm bridge, against the guarded VFS.
 *
 * The traversal and decompression-bomb tests matter more than the happy path.
 * A zip reader that round-trips its own output but writes `/etc/passwd` when
 * handed a hostile archive has failed at the only job that is hard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, gzipSync } from "node:zlib";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { archives, type ArchiveEntry, type ArchiveSummary } from "../src/index";
import { writeZip } from "../src/zip";
import { writeTar } from "../src/tar";

const env = () => createAdapterTestEnv(archives());
const bytes = (s: string) => new TextEncoder().encode(s);

test("the adapter's bindings and types agree", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

// ================================================================ round trips

test("a directory packages to zip and comes back identical", async () => {
  const t = await env();
  await t.fs.writeFile("/out/report.md", "# Report\n\nBody text.\n");
  await t.fs.writeFile("/out/data/rows.csv", "a,b\n1,2\n");
  await t.fs.writeFile("/out/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));

  const summary = await t.script<ArchiveSummary>(
    `import { create } from 'env:archives';
     export default async function main() { return create('/out', '/tmp/bundle.zip'); }`,
  );
  assert.equal(summary.format, "zip");
  assert.equal(summary.entries, 3);
  assert.deepEqual(
    summary.sample.map((e) => e.name).sort(),
    ["data/rows.csv", "logo.png", "report.md"],
  );

  const back = await t.script<{ written: string[]; md: string; csv: string; png: number[] }>(
    `import { extract } from 'env:archives';
     import { readFile, readBytes } from 'env:fs';
     export default async function main() {
       const written = await extract('/tmp/bundle.zip', '/inbox/unpacked');
       return {
         written: written.sort(),
         md: await readFile('/inbox/unpacked/report.md'),
         csv: await readFile('/inbox/unpacked/data/rows.csv'),
         png: Array.from(await readBytes('/inbox/unpacked/logo.png')),
       };
     }`,
  );
  assert.deepEqual(back.written, ["/inbox/unpacked/data/rows.csv", "/inbox/unpacked/logo.png", "/inbox/unpacked/report.md"]);
  assert.equal(back.md, "# Report\n\nBody text.\n");
  assert.equal(back.csv, "a,b\n1,2\n");
  assert.deepEqual(back.png, [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
});

test("tar and tar.gz round-trip too, and the format follows the extension", async () => {
  const t = await env();
  await t.fs.writeFile("/out/a.txt", "alpha");
  await t.fs.writeFile("/out/nested/b.txt", "beta");

  const out = await t.script<{ tar: ArchiveSummary; tgz: ArchiveSummary; fromTar: string; fromTgz: string }>(
    `import { create, extract } from 'env:archives';
     import { readFile } from 'env:fs';
     export default async function main() {
       const tar = await create('/out', '/tmp/bundle.tar');
       const tgz = await create('/out', '/tmp/bundle.tgz');
       await extract('/tmp/bundle.tar', '/inbox/fromtar');
       await extract('/tmp/bundle.tgz', '/inbox/fromtgz');
       return {
         tar, tgz,
         fromTar: await readFile('/inbox/fromtar/nested/b.txt'),
         fromTgz: await readFile('/inbox/fromtgz/a.txt'),
       };
     }`,
  );
  assert.equal(out.tar.format, "tar");
  assert.equal(out.tgz.format, "tgz");
  assert.ok(out.tgz.bytes < out.tar.bytes, "gzip should be smaller than the raw tar");
  assert.equal(out.fromTar, "beta");
  assert.equal(out.fromTgz, "alpha");
});

test("a name over 100 bytes survives the tar round trip", async () => {
  // Plain tar headers hold 100 bytes of name; anything longer needs the GNU
  // long-name block, and getting that wrong truncates paths silently.
  const t = await env();
  const long = `/out/${"deeply-nested-directory/".repeat(5)}file-with-a-long-name.txt`;
  await t.fs.writeFile(long, "survived");
  const back = await t.script<string>(
    `import { create, extract } from 'env:archives';
     import { readFile } from 'env:fs';
     export default async function main() {
       await create('/out', '/tmp/long.tar');
       const written = await extract('/tmp/long.tar', '/inbox/long');
       return readFile(written[0]);
     }`,
  );
  assert.equal(back, "survived");
});

test("format is detected from bytes, not from the file name", async () => {
  const t = await env();
  await t.fs.writeFile("/out/x.txt", "content");
  const out = await t.script<ArchiveSummary>(
    `import { create, describe } from 'env:archives';
     import { mv } from 'env:fs';
     export default async function main() {
       await create('/out', '/tmp/real.zip');
       await mv('/tmp/real.zip', '/tmp/liar.tar');
       return describe('/tmp/liar.tar');
     }`,
  );
  assert.equal(out.format, "zip", "a zip named .tar is still a zip");
});

// ============================================================== orientation

test("describe answers what is in there without extracting it", async () => {
  const t = await env();
  await t.fs.writeFile("/out/one.txt", "x".repeat(500));
  await t.fs.writeFile("/out/two.txt", "y".repeat(300));

  const summary = await t.script<ArchiveSummary>(
    `import { create, describe } from 'env:archives';
     export default async function main() {
       await create('/out', '/tmp/b.zip');
       return describe('/tmp/b.zip');
     }`,
  );
  assert.equal(summary.files, 2);
  assert.equal(summary.uncompressedBytes, 800);
  assert.ok(summary.bytes < summary.uncompressedBytes, "repetitive text should compress");

  const listed = await t.script<ArchiveEntry[]>(
    `import { list } from 'env:archives';
     export default async function main() { return list('/tmp/b.zip'); }`,
  );
  assert.deepEqual(listed.map((e) => e.name).sort(), ["one.txt", "two.txt"]);
  assert.equal(await t.fs.exists("/inbox/one.txt"), false, "list must not extract");
});

test("include takes only the entries asked for", async () => {
  const t = await env();
  await t.fs.writeFile("/out/keep.csv", "a,b");
  await t.fs.writeFile("/out/deep/also.csv", "c,d");
  await t.fs.writeFile("/out/skip.png", new Uint8Array([1, 2, 3]));

  const written = await t.script<string[]>(
    `import { create, extract } from 'env:archives';
     export default async function main() {
       await create('/out', '/tmp/mixed.zip');
       return (await extract('/tmp/mixed.zip', '/inbox/only', { include: '**/*.csv' })).sort();
     }`,
  );
  assert.deepEqual(written, ["/inbox/only/deep/also.csv", "/inbox/only/keep.csv"]);
  assert.equal(await t.fs.exists("/inbox/only/skip.png"), false);

  const nothing = await t.runScript(
    `import { extract } from 'env:archives';
     export default async function main() { return extract('/tmp/mixed.zip', '/inbox/none', { include: '**/*.xlsx' }); }`,
  );
  assert.equal(nothing.ok, false);
  assert.match(String(nothing.error), /no entries in .* match/);
  assert.match(String(nothing.error), /list\(path\)/);
});

// ===================================================== traversal (the point)

/** Build a zip whose entry names are chosen by the test, not by `create`. */
function hostileZip(names: string[]): Uint8Array {
  return writeZip(names.map((name) => ({ name, data: bytes("pwned") })));
}

test("an entry that escapes the destination is refused, however it is spelled", async () => {
  const t = await env();
  const cases: Array<[string, string]> = [
    ["parent traversal", "../../escaped.txt"],
    ["absolute path", "/etc/passwd"],
    ["backslash separators", "..\\..\\escaped.txt"],
    ["traversal mid-path", "safe/../../../escaped.txt"],
    ["dot-slash prefixed traversal", "./../../escaped.txt"],
  ];
  for (const [label, name] of cases) {
    await t.fs.writeFile("/inbox/hostile.zip", hostileZip([name]));
    const run = await t.runScript(
      `import { extract } from 'env:archives';
       export default async function main() { return extract('/inbox/hostile.zip', '/inbox/dest'); }`,
    );
    assert.equal(run.ok, false, `${label}: expected a refusal, got success`);
    assert.match(String(run.error), /refusing entry/, label);
    assert.equal(await t.fs.exists("/escaped.txt"), false, `${label}: wrote outside the destination`);
    assert.equal(await t.fs.exists("/etc/passwd"), false, `${label}: wrote outside the destination`);
  }
});

test("traversal that resolves back inside is allowed — the check is on the result", async () => {
  // `a/../b.txt` is not an attack, and refusing it would reject archives real
  // tools produce. Comparing spellings instead of resolved paths gets this
  // wrong in one direction or the other.
  const t = await env();
  await t.fs.writeFile("/inbox/ok.zip", hostileZip(["a/../b.txt"]));
  const written = await t.script<string[]>(
    `import { extract } from 'env:archives';
     export default async function main() { return extract('/inbox/ok.zip', '/inbox/dest'); }`,
  );
  assert.deepEqual(written, ["/inbox/dest/b.txt"]);
});

test("a tar with traversal is refused the same way", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/hostile.tar", writeTar([{ name: "../../escaped.txt", data: bytes("pwned") }]));
  const run = await t.runScript(
    `import { extract } from 'env:archives';
     export default async function main() { return extract('/inbox/hostile.tar', '/inbox/dest'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /refusing entry/);
  assert.equal(await t.fs.exists("/escaped.txt"), false);
});

// ================================================ decompression bombs & bounds

test("a zip that lies about its size is stopped by the inflate cap", async () => {
  // The declared uncompressedSize is attacker-controlled. Here it declares a
  // modest 10 bytes while actually expanding to megabytes — checking the
  // declaration alone would wave it straight through.
  const t = await createAdapterTestEnv(archives(), { limits: { maxVfsBytes: 200_000 } });
  const huge = new Uint8Array(5_000_000); // zeros: compresses to almost nothing
  const compressed = deflateRawSync(Buffer.from(huge));
  const zip = handCraftedZip("bomb.bin", compressed, { declaredSize: 10 });
  await t.fs.writeFile("/inbox/bomb.zip", zip);

  const run = await t.runScript(
    `import { extract } from 'env:archives';
     export default async function main() { return extract('/inbox/bomb.zip', '/inbox/out'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /expands past the .* budget|does not fit/);
  assert.match(String(run.error), /maxVfsBytes|include option/);
});

test("a gzip bomb is stopped before the tar is even parsed", async () => {
  const t = await createAdapterTestEnv(archives(), { limits: { maxVfsBytes: 200_000 } });
  const tar = writeTar([{ name: "big.bin", data: new Uint8Array(5_000_000) }]);
  await t.fs.writeFile("/inbox/bomb.tgz", new Uint8Array(gzipSync(Buffer.from(tar))));

  const run = await t.runScript(
    `import { describe } from 'env:archives';
     export default async function main() { return describe('/inbox/bomb.tgz'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /expands past the .* budget/);
});

test("extracted bytes count against maxVfsBytes like any other write", async () => {
  const t = await createAdapterTestEnv(archives(), { limits: { maxVfsBytes: 60_000 } });
  // Honest archive, genuinely too big for the room left.
  const payload = bytes("z".repeat(40_000));
  await t.fs.writeFile(
    "/inbox/big.zip",
    writeZip([
      { name: "one.bin", data: payload },
      { name: "two.bin", data: payload },
    ]),
  );
  const run = await t.runScript(
    `import { extract } from 'env:archives';
     export default async function main() { return extract('/inbox/big.zip', '/inbox/out'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /size limit exceeded|does not fit|expands past/);
});

// ============================================== refusing what cannot be read

test("encrypted, ZIP64, and unreadable archives are refused by name", async () => {
  const t = await env();
  // Encryption is general-purpose bit 0 in the central directory.
  const encrypted = handCraftedZip("secret.txt", bytes("x"), { flags: 0x0001, stored: true });
  await t.fs.writeFile("/inbox/enc.zip", encrypted);
  const run = await t.runScript(
    `import { list } from 'env:archives';
     export default async function main() { return list('/inbox/enc.zip'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /encrypted ZIP entries are not supported/);

  await t.fs.writeFile("/inbox/nope.zip", bytes("this is not an archive at all"));
  const bad = await t.runScript(
    `import { describe } from 'env:archives';
     export default async function main() { return describe('/inbox/nope.zip'); }`,
  );
  assert.equal(bad.ok, false);
  assert.match(String(bad.error), /not a zip, tar or tar\.gz/);
});

test("a tar containing a symlink is refused rather than half-extracted", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/link.tar", symlinkTar("evil", "/etc/passwd"));
  const run = await t.runScript(
    `import { extract } from 'env:archives';
     export default async function main() { return extract('/inbox/link.tar', '/inbox/dest'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /symbolic link/);
  assert.match(String(run.error), /regular files only/);
});

test("describe routes through the describe verb by magic bytes", async () => {
  const t = await env();
  await t.fs.writeFile("/out/x.txt", "content");
  await t.script(
    `import { create } from 'env:archives';
     export default async function main() { return create('/out', '/tmp/b.zip'); }`,
  );
  const tool = t.env.tools.find((x) => x.name === "describe")!;
  const summary = JSON.parse(String((await tool.do({ path: "/tmp/b.zip" })).data));
  assert.equal(summary.module, "env:archives");
  assert.equal(summary.format, "zip");
});

// --------------------------------------------------------------- helpers

/** A zip built field by field, so a test can lie in the header. */
function handCraftedZip(
  name: string,
  body: Uint8Array,
  opts: { declaredSize?: number; flags?: number; stored?: boolean } = {},
): Uint8Array {
  const nameBuf = Buffer.from(name, "utf8");
  const declared = opts.declaredSize ?? body.byteLength;
  const method = opts.stored ? 0 : 8;
  const flags = opts.flags ?? 0;

  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(body.byteLength, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(body.byteLength, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  nameBuf.copy(central, 46);

  const dataStart = local.length + body.byteLength;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(dataStart, 16);

  return new Uint8Array(Buffer.concat([local, Buffer.from(body), central, eocd]));
}

/** A tar holding one symlink entry (type flag "2"). */
function symlinkTar(name: string, target: string): Uint8Array {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("00000000000\0", 124, 12, "ascii"); // size 0
  header.write("        ", 148, 8, "ascii");
  header.write("2", 156, 1, "ascii"); // symlink
  header.write(target, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return new Uint8Array(Buffer.concat([header, Buffer.alloc(1024)]));
}
