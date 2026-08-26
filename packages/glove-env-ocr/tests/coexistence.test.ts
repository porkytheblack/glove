/**
 * The three adapters a scanned document takes, in one process.
 *
 * pdfjs resolves its main-thread worker through `globalThis.pdfjsWorker` — a
 * process global. Two copies of pdfjs in one host therefore share whichever
 * worker registered first, and the loser fails every call with
 *
 *     The API version "6.2.108" does not match the Worker version "5.7.284"
 *
 * `glove-env-documents` asked for pdfjs 5 while this package and
 * `glove-env-render` asked for 6, so that is exactly what shipped. Neither
 * package's own suite could see it: each is the only pdfjs in its own test
 * process, and each passed alone right up until a host wired them together.
 *
 * So this file exists to be the one place where they are wired together, and
 * it runs the sequence in **both orders** — the failure is order-dependent,
 * and testing one order would half-cover it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { render } from "glove-env-render";
import { documents } from "glove-env-documents";
import { ocr } from "../src/index";

const LINES = ["ACME LOGISTICS LTD", "Invoice 2024-0731", "Total due 3775.20 EUR"];

/** An image-only PDF: pictures of glyphs, no text layer. */
async function scannedPdf(): Promise<Uint8Array> {
  const canvas = createCanvas(1200, 1600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1200, 1600);
  ctx.fillStyle = "#000000";
  ctx.font = "44px sans-serif";
  LINES.forEach((line, i) => ctx.fillText(line, 90, 160 + i * 70));

  const doc = await PDFDocument.create();
  const img = await doc.embedPng(new Uint8Array(canvas.toBuffer("image/png")));
  const page = doc.addPage([595, 842]);
  const scale = Math.min(595 / img.width, 842 / img.height);
  page.drawImage(img, {
    x: (595 - img.width * scale) / 2,
    y: (842 - img.height * scale) / 2,
    width: img.width * scale,
    height: img.height * scale,
  });
  return await doc.save();
}

async function envWithAll() {
  const t = await createAdapterTestEnv(ocr(), { also: [render(), documents()] });
  await t.fs.writeFile("/inbox/scan.pdf", await scannedPdf());
  return t;
}

const EXTRACT = `import { pdf } from 'env:documents';
   export default async function main() {
     const r = await pdf.extractText('/inbox/scan.pdf');
     return { kind: r.kind, note: r.note };
   }`;

const RECOGNIZE = `import { recognize } from 'env:ocr';
   export default async function main() {
     const r = await recognize('/inbox/scan.pdf');
     return { confidence: r.confidence, text: r.text };
   }`;

const RENDER = `import { render } from 'env:render';
   export default async function main() { return render('/inbox/scan.pdf', '/tmp/shot'); }`;

test("env:documents first, then env:ocr and env:render, all share one pdfjs", async () => {
  const t = await envWithAll();

  const extracted = await t.script<{ kind: string }>(EXTRACT);
  assert.equal(extracted.kind, "scanned");

  // These two are what used to throw once documents' pdfjs had registered.
  const recognized = await t.script<{ confidence: number; text: string }>(RECOGNIZE);
  assert.match(recognized.text, /ACME LOGISTICS/);
  assert.ok(recognized.confidence > 60, `confidence was ${recognized.confidence}`);

  const shot = await t.script<{ pages: Array<{ path: string }> }>(RENDER);
  assert.equal(shot.pages.length, 1);
});

test("env:ocr first, then env:documents — the other order breaks differently", async () => {
  const t = await envWithAll();

  const recognized = await t.script<{ text: string }>(RECOGNIZE);
  assert.match(recognized.text, /ACME LOGISTICS/);

  // This direction used to fail with the versions the other way round.
  const extracted = await t.script<{ kind: string }>(EXTRACT);
  assert.equal(extracted.kind, "scanned");
});

test("the adapters agree on what the document is", async () => {
  // Two libraries reading the same file have to reach the same verdict, or
  // the advice one of them gives about the other is worthless.
  const t = await envWithAll();

  const summary = await t.script<{ needsOcr: boolean; textLayerPages: number[] }>(
    `import { describe } from 'env:ocr';
     export default async function main() { return describe('/inbox/scan.pdf'); }`,
  );
  const extracted = await t.script<{ kind: string; note?: string }>(EXTRACT);

  assert.equal(summary.needsOcr, true);
  assert.deepEqual(summary.textLayerPages, []);
  assert.equal(extracted.kind, "scanned");
  // env:documents sends the caller to env:ocr; that has to remain true.
  assert.match(String(extracted.note), /env:ocr/);
});
