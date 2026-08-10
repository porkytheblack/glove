/**
 * A deck built to be hostile rather than to be drawn.
 *
 * The schematic path is reached precisely when LibreOffice has already
 * refused the file, so it sees more crafted decks than the real renderer ever
 * will. Nothing in a ZIP header is trustworthy there: the declared
 * uncompressed size is what a decompression bomb lies about, and the
 * encryption flag turns every part into ciphertext that inflates to garbage
 * rather than to an error.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { render } from "../src/index";
import { readLayout } from "../src/pptx-layout";

const SLIDE_PART = "ppt/slides/slide1.xml";
/** No LibreOffice can possibly run, so every deck takes the schematic path. */
const noOffice = () => createAdapterTestEnv(render({ sofficePath: "/nonexistent/soffice" }));

test("a slide part that lies about its size is stopped by the inflate cap", async () => {
  // 512 declared, five megabytes delivered. Believing the declaration lets the
  // whole thing through, which is why the bound is on the inflate's output.
  const bomb = craftedZip(SLIDE_PART, deflateRawSync(Buffer.alloc(5_000_000)), { declaredSize: 512 });
  assert.throws(() => readLayout(bomb, 200_000), /expands past the 200000-byte inflation budget/);
  assert.throws(() => readLayout(bomb, 200_000), /maxVfsBytes/);
});

test("the schematic refuses a zip-bomb deck instead of inflating it onto the host heap", async () => {
  // End to end, and it pins the default budget too: this reader is handed
  // bytes with no VFS handle to read a limit from, so a bomb has to clear the
  // default to be refused by it.
  const t = await noOffice();
  try {
    const bomb = craftedZip(SLIDE_PART, deflateRawSync(Buffer.alloc(140 * 1024 * 1024)), { declaredSize: 4096 });
    assert.ok(bomb.byteLength < 500_000, `the fixture must be small to be a bomb, it is ${bomb.byteLength} bytes`);
    await t.fs.writeFile("/inbox/bomb.pptx", bomb);

    const result = await t.runScript(
      `import { render } from 'env:render';
       export default async function () { return render('/inbox/bomb.pptx', '/tmp/proof'); }`,
    );
    assert.equal(result.ok, false);
    assert.match(String(result.error), /expands past the \d+-byte inflation budget/);
    assert.match(String(result.error), /maxVfsBytes/);
  } finally {
    await t.env.close();
  }
});

test("an encrypted deck is refused by name rather than drawn as an empty schematic", async () => {
  const t = await noOffice();
  try {
    await t.fs.writeFile(
      "/inbox/locked.pptx",
      craftedZip(SLIDE_PART, Buffer.from("<p:sld/>"), { flags: 0x0001, stored: true }),
    );
    const result = await t.runScript(
      `import { render } from 'env:render';
       export default async function () { return render('/inbox/locked.pptx', '/tmp/proof'); }`,
    );
    assert.equal(result.ok, false);
    assert.match(String(result.error), /encrypted ZIP entries are not supported/);
    assert.match(String(result.error), /without a password/);
  } finally {
    await t.env.close();
  }
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
