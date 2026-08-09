/**
 * The runtime preflight in front of pdf.js.
 *
 * This exists because the failure it guards is invisible. pdf.js v5+ transfers
 * page buffers with `ArrayBuffer.prototype.transferToFixedLength` (Node 21+),
 * and on an older runtime it catches the resulting TypeError per operator,
 * logs "ignoring errors", and finishes the page anyway. Measured in-container
 * on the Node 20 glovebox base image: rasterizing a Word document returned a
 * path, 893x1263 dimensions and 7224 bytes, every layer above reported
 * success, and the PNG was blank. A byte count is not ink, so no assertion on
 * the returned shape would have caught it.
 *
 * The capability is deleted from the prototype rather than mocked, because
 * what the guard reads is exactly that: whether the running Node has it. The
 * adapter's bindings execute in the host realm (a script calls them by RPC
 * from its worker), so patching here is patching the realm that rasterizes.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { render } from "../src/index";

/** A single-page PDF with real text, so a blank render is distinguishable. */
async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.addPage([595, 842]).drawText("Page 1 heading", { x: 40, y: 762, size: 28, font });
  return new Uint8Array(await doc.save());
}

/** `runScript` takes the source, writes it into the tree, and runs it. */
const CALL = `return await render('/inbox/report.pdf', '/tmp/proof', { pages: [1] });`;

/** Wrap a body as a script module, the way the other suites here do. */
const call = (body: string) => `/** Rasterize. */\nimport { render } from 'env:render';\nexport default async function main() {\n  ${body}\n}\n`;

type Patchable = { transferToFixedLength?: unknown };

/** Run `fn` in a realm where pdf.js's Node-21 dependency is absent. */
async function withoutTransfer(fn: () => Promise<void>): Promise<void> {
  const proto = ArrayBuffer.prototype as Patchable;
  const had = Object.prototype.hasOwnProperty.call(proto, "transferToFixedLength");
  const real = proto.transferToFixedLength;
  delete proto.transferToFixedLength;
  try {
    await fn();
  } finally {
    if (had) proto.transferToFixedLength = real;
  }
}

test("rasterizing a PDF on a pre-Node-21 runtime refuses instead of rendering blank", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/report.pdf", await samplePdf());

    await withoutTransfer(async () => {
      const result = await t.runScript(call(CALL));
      assert.equal(result.ok, false, "a runtime that renders blank pages must not report success");
      assert.match(String(result.error), /Node 21 or newer/);
      // The message has to name the cause, or the reader goes looking in
      // their own code for why the page came out empty.
      assert.match(String(result.error), /transferToFixedLength/);
    });
  } finally {
    await t.env.close();
  }
});

test("a runtime that does have it renders the page for real", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/report.pdf", await samplePdf());

    // Node here is 22+, so the guard must stand aside entirely — and the
    // render that follows must produce actual ink, which is the property the
    // blank-page bug violated while still reporting success.
    const result = await t.runScript(call(CALL));
    assert.equal(result.ok, true, result.error);
    const png = await t.fs.readBytes("/tmp/proof/report-p1.png");
    assert.ok(png.byteLength > 2000, `expected a real render, got ${png.byteLength} bytes`);
  } finally {
    await t.env.close();
  }
});
