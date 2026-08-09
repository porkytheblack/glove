/**
 * A .docx built to be hostile rather than to be read.
 *
 * Every other test here hands the reader a file this package wrote. These
 * hand the reader a file an attacker wrote: nothing in a ZIP header is
 * trustworthy, and the two that matter are the declared uncompressed size —
 * which is what a decompression bomb lies about — and the encryption flag,
 * which turns every part into ciphertext the reader would otherwise inflate
 * into garbage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { documents } from "../src/index";
import { readZip, readZipEntry } from "../src/zip";

const DOCUMENT_PART = "word/document.xml";

test("a part that lies about its size is stopped by the inflate cap, not by the declaration", async () => {
  // 512 declared, five megabytes delivered. A reader that believes the
  // declaration lets the whole thing through, which is why the bound has to
  // be on the output of the inflate rather than on the number in the header.
  const bomb = craftedZip(DOCUMENT_PART, deflateRawSync(Buffer.alloc(5_000_000)), { declaredSize: 512 });
  const entry = readZip(bomb).get(DOCUMENT_PART)!;
  assert.throws(
    () => readZipEntry(bomb, entry, 64 * 1024),
    /expands past the 65536-byte inflation budget/,
  );
  // The same bytes under a budget that fits are still readable — the cap is a
  // ceiling, not a refusal to inflate anything large.
  assert.equal(readZipEntry(bomb, entry, 8 * 1024 * 1024).byteLength, 5_000_000);
});

test("describe refuses a zip-bomb .docx instead of inflating it onto the host heap", async () => {
  // The reported scenario end to end: a small upload, gigabytes of output,
  // during a `describe` that was only ever asked for a page count. The
  // document reader has no VFS handle to read a limit from, so this pins the
  // default budget as well — a bomb has to clear it to be refused by it.
  const t = await createAdapterTestEnv(documents());
  const bomb = craftedZip(DOCUMENT_PART, deflateRawSync(Buffer.alloc(140 * 1024 * 1024)), { declaredSize: 4096 });
  assert.ok(bomb.byteLength < 500_000, `the fixture must be small to be a bomb, it is ${bomb.byteLength} bytes`);
  await t.fs.writeFile("/inbox/bomb.docx", bomb);

  const run = await t.runScript(
    `import { describe } from 'env:documents';
     export default async function main() { return describe('/inbox/bomb.docx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /expands past the \d+-byte inflation budget/);
  assert.match(String(run.error), /maxVfsBytes/);
});

test("replaceText inflates through the same cap, so an edit is not a way past it", async () => {
  // The edit path opens parts of its own — document.xml plus every header and
  // footer. A read path added without the budget would be a hole reopened one
  // release after it was closed, and nothing about a find/replace looks like a
  // place to check for a zip bomb.
  const t = await createAdapterTestEnv(documents(), { limits: { maxVfsBytes: 200_000 } });
  const bomb = craftedZip(DOCUMENT_PART, deflateRawSync(Buffer.alloc(5_000_000)), { declaredSize: 512 });
  await t.fs.writeFile("/inbox/bomb.docx", bomb);

  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.replaceText('/inbox/bomb.docx', { a: 'b' }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /expands past the 200000-byte inflation budget/);
  assert.match(String(run.error), /maxVfsBytes/);
});

test("replaceText refuses an encrypted .docx rather than splicing ciphertext", async () => {
  const t = await createAdapterTestEnv(documents());
  const locked = craftedZip(DOCUMENT_PART, Buffer.from("<w:document/>"), { flags: 0x0001, stored: true });
  await t.fs.writeFile("/inbox/locked.docx", locked);

  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.replaceText('/inbox/locked.docx', { a: 'b' }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /encrypted ZIP entries are not supported/);
});

test("an encrypted .docx is refused by name, not misread as a broken document", async () => {
  const t = await createAdapterTestEnv(documents());
  const locked = craftedZip(DOCUMENT_PART, Buffer.from("<w:document/>"), { flags: 0x0001, stored: true });
  await t.fs.writeFile("/inbox/locked.docx", locked);

  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.extractText('/inbox/locked.docx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /encrypted ZIP entries are not supported/);
  assert.match(String(run.error), /without a password/);
});

/**
 * A one-entry ZIP whose headers can lie.
 *
 * Built here rather than committed as a fixture: the point of a bomb is that
 * a few hundred bytes claim to be megabytes, and a checked-in binary would
 * hide both numbers.
 */
function craftedZip(
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
  central.writeUInt32LE(body.byteLength, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  nameBuf.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + body.byteLength, 16);

  return new Uint8Array(Buffer.concat([local, Buffer.from(body), central, eocd]));
}
