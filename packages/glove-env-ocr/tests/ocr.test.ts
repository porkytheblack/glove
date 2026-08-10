/**
 * The OCR adapter, exercised the way a script reaches it — through the realm
 * bridge, against the guarded VFS.
 *
 * **The fixtures are the interesting part.** A test that asserts "a result came
 * back" would pass against an adapter that returns an empty string, and an OCR
 * adapter that returns an empty string is worse than no adapter at all. So the
 * scans here are built from text this file chose, and the assertions are that
 * the exact words come back out.
 *
 * They are also hermetic: the page is typeset by pdf-lib with a PDF standard
 * font, rasterised by the same renderer `env:render` uses, and the pixels are
 * then re-embedded as an image-only PDF — a real scan, in the sense that
 * matters (there is no text layer, only pictures of glyphs), without a single
 * system font involved. A fixture that depended on whatever `sans-serif`
 * resolves to would read differently on every machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { rasterizePdf } from "glove-env-render/raster";
import { render } from "glove-env-render";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { ocr, type OcrResult, type OcrSummary } from "../src/index";
import { resolveLangPath } from "../src/engine";

const LINES = [
  "ACME LOGISTICS LTD",
  "Invoice 2024-0731",
  "Freight forwarding Rotterdam to Hamburg",
  "Subtotal 3120.00 EUR",
  "Total due 3775.20 EUR",
];

const env = () => createAdapterTestEnv(ocr());

/**
 * A born-digital PDF: real glyphs, real text layer.
 *
 * Every page is stamped with its own number so a test can prove *which* pages
 * were read, and the body is deliberately over 100 characters — the floor both
 * this adapter and `env:documents` use to call a page "already text". A
 * shorter fixture would read as a scan and quietly test the wrong branch.
 */
async function typeset(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    let y = 760;
    for (const line of LINES) {
      page.drawText(`${line} (page ${p + 1})`, { x: 60, y, size: 22, font });
      y -= 46;
    }
  }
  return doc.save();
}

/**
 * Flatten a typeset PDF into an image-only PDF — i.e. manufacture a scan.
 *
 * Every page becomes a picture of itself, so nothing is left for
 * `getTextContent()` to find. This is what a document out of a scanner is.
 */
async function flatten(source: Uint8Array, degrade?: (png: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const { rendered } = await rasterizePdf(source, "all", { scale: 2, maxWidth: 2000 });
  const out = await PDFDocument.create();
  for (const page of rendered) {
    const embedded = await out.embedPng(degrade ? await degrade(page.png) : page.png);
    out.addPage([595, 842]).drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
  }
  return out.save();
}

/** A page of pixels with no marks on it. */
function blankPng(width = 1200, height = 900): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx: SKRSContext2D = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/**
 * Salt-and-pepper noise over a fraction of the pixels, from a fixed seed.
 *
 * A deterministic LCG rather than `Math.random`, because a test that is
 * *usually* below the confidence floor is a test that fails on Tuesdays.
 */
function speckle(fraction: number) {
  return async (png: Uint8Array): Promise<Uint8Array> => {
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height);
    const ctx: SKRSContext2D = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    let seed = 7;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if ((seed % 1000) / 1000 >= fraction) continue;
      const v = seed % 2 === 0 ? 0 : 255;
      pixels.data[i] = v;
      pixels.data[i + 1] = v;
      pixels.data[i + 2] = v;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toBuffer("image/png");
  };
}

test("the adapter's bindings and types agree", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

// =========================================================== the actual job

test("a scanned PDF comes back as the text that was printed on it", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(2)));

  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf'); }`,
  );

  assert.equal(out.source, "pdf");
  assert.equal(out.language, "eng");
  assert.equal(out.totalPages, 2);
  assert.equal(out.pages.length, 2);

  const flat = out.text.replace(/\s+/g, " ");
  for (const line of LINES) {
    assert.ok(flat.includes(`${line} (page 1)`), `page 1 is missing ${JSON.stringify(line)} — got: ${flat}`);
    assert.ok(flat.includes(`${line} (page 2)`), `page 2 is missing ${JSON.stringify(line)} — got: ${flat}`);
  }
  // The number is the thing a person would actually ask for, so it gets its
  // own assertion rather than hiding inside a substring check.
  assert.match(out.text, /Total due 3775\.20 EUR/);

  for (const page of out.pages) {
    assert.ok(page.confidence > 80, `page ${page.page} confidence was ${page.confidence}, expected a clean read`);
    assert.ok(page.words >= 12, `page ${page.page} read only ${page.words} words`);
    assert.equal(page.textLayer, undefined, "a flattened page has no text layer");
  }
  assert.ok(out.confidence > 80);
  assert.equal(out.note, undefined, `a clean scan should carry no warning, got: ${out.note}`);
});

test("pages selects which pages are read, and the rest are not", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(3)));

  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf', { pages: [2] }); }`,
  );
  assert.deepEqual(out.pages.map((p) => p.page), [2]);
  assert.equal(out.totalPages, 3, "totalPages describes the document, not the request");
  assert.match(out.text, /\(page 2\)/);
  assert.doesNotMatch(out.text, /\(page 1\)/);
  assert.doesNotMatch(out.text, /\(page 3\)/);
});

test("an image is read directly, without a PDF anywhere", async () => {
  const t = await env();
  // Rasterise a typeset page and hand over the PNG itself — a photo, as far
  // as the adapter is concerned.
  const { rendered } = await rasterizePdf(await typeset(1), [1], { scale: 2, maxWidth: 2000 });
  await t.fs.writeFile("/inbox/receipt.png", rendered[0].png);

  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/receipt.png'); }`,
  );
  assert.equal(out.source, "image");
  assert.equal(out.totalPages, 1);
  assert.match(out.text, /Total due 3775\.20 EUR/);
  assert.ok(out.confidence > 80);
});

// ===================================================== reusing env:render

test("recognizing a PDF page agrees with OCR of the PNG env:render wrote for it", async () => {
  // This is the reuse claim, made checkable: if the adapter had its own
  // rasterizer, these two paths would drift — different scale handling,
  // different fonts, eventually different text. Same pixels, same words.
  const t = await createAdapterTestEnv(ocr(), { also: [render()] });
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(1)));

  const both = await t.script<{ fromPdf: OcrResult; fromPng: OcrResult }>(
    `import { recognize } from 'env:ocr';
     import { render } from 'env:render';
     export default async function main() {
       const shot = await render('/inbox/scan.pdf', '/tmp/look', { pages: [1], scale: 3, maxWidth: 3000 });
       return {
         fromPdf: await recognize('/inbox/scan.pdf', { pages: [1], scale: 3 }),
         fromPng: await recognize(shot.pages[0].path),
       };
     }`,
  );
  assert.equal(both.fromPdf.text, both.fromPng.text, "the PDF path and the render path read different text");
  assert.equal(both.fromPdf.pages[0].confidence, both.fromPng.pages[0].confidence);
});

// ============================================== knowing when NOT to be used

test("describe says whether OCR is needed at all, without recognizing anything", async () => {
  const t = await env();
  const digital = await typeset(2);
  await t.fs.writeFile("/inbox/digital.pdf", digital);
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(digital));

  const born = await t.script<OcrSummary>(
    `import { describe } from 'env:ocr';
     export default async function main() { return describe('/inbox/digital.pdf'); }`,
  );
  assert.equal(born.format, "pdf");
  assert.equal(born.totalPages, 2);
  assert.deepEqual(born.textLayerPages, [1, 2]);
  assert.equal(born.needsOcr, false);
  assert.ok(born.languages.includes("eng"), "English is bundled and must always be available");

  const scan = await t.script<OcrSummary>(
    `import { describe } from 'env:ocr';
     export default async function main() { return describe('/inbox/scan.pdf'); }`,
  );
  assert.deepEqual(scan.textLayerPages, []);
  assert.equal(scan.needsOcr, true);
});

test("OCR over a page that already has text runs, but says it was a downgrade", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/digital.pdf", await typeset(1));

  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/digital.pdf'); }`,
  );
  assert.equal(out.pages[0].textLayer, true);
  assert.match(String(out.note), /already have a real text layer/);
  assert.match(String(out.note), /documents\.extractText/);
});

// ============================================ saying so when it cannot read

test("a blank page reports nothing read rather than an empty success", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/blank.png", blankPng());

  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/blank.png'); }`,
  );
  assert.equal(out.text, "");
  assert.equal(out.pages[0].words, 0);
  assert.equal(out.confidence, 0);
  assert.match(String(out.note), /nothing readable/);
});

test("a scan too degraded to trust comes back with a warning, not a clean-looking answer", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/dirty.pdf", await flatten(await typeset(1), speckle(0.3)));

  // Read at scale 1 on purpose: Tesseract spends its time proportionally to
  // how much it thinks might be text, and noise looks like text everywhere.
  // At the default scale this one page takes ~14s, which is a slow test for
  // no extra signal — the confidence is the same either way.
  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/dirty.pdf', { scale: 1 }); }`,
  );
  assert.ok(out.confidence < 65, `expected a low score on a heavily speckled scan, got ${out.confidence}`);
  assert.ok(out.note, "a result this unreliable must carry a note");
  assert.match(String(out.note), /unverified|nothing readable/);
});

// ================================================================ refusals

test("a language with no data on this host is refused by name", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(1)));

  const run = await t.runScript(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf', { lang: 'deu' }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /@tesseract\.js-data\/deu/);
  assert.match(String(run.error), /Nothing is downloaded at run time/);

  const nonsense = await t.runScript(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf', { lang: '../etc' }); }`,
  );
  assert.equal(nonsense.ok, false);
  assert.match(String(nonsense.error), /not a language code/);
});

test("something that is not a PDF or an image is refused with the alternatives", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/notes.txt", "just some text");
  const run = await t.runScript(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/notes.txt'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /neither a PDF nor an image/);
  assert.match(String(run.error), /env:documents|env:slides/);

  const missing = await t.runScript(
    `import { describe } from 'env:ocr';
     export default async function main() { return describe('/inbox/nope.pdf'); }`,
  );
  assert.equal(missing.ok, false);
  assert.match(String(missing.error), /no such file/);
});

test("more pages than the per-call budget is refused, and the budget is explained", async () => {
  const t = await createAdapterTestEnv(ocr({ maxPages: 2 }));
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(1)));
  const run = await t.runScript(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf', { pages: [1, 2, 3] }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /limit is 2 per call/);
  assert.match(String(run.error), /a second a page/);
});

// ================================================================ plumbing

test("the format is decided by magic bytes, not by the file name", async () => {
  const t = await env();
  // A PDF that claims to be a PNG must still be paged, not fed to the image
  // path where it would produce nothing.
  await t.fs.writeFile("/inbox/liar.png", await flatten(await typeset(2)));
  const out = await t.script<OcrSummary>(
    `import { describe } from 'env:ocr';
     export default async function main() { return describe('/inbox/liar.png'); }`,
  );
  assert.equal(out.format, "pdf");
  assert.equal(out.totalPages, 2);
});

test("it does not claim describe dispatch for PDFs or images", async () => {
  // env:documents describes a PDF better than this adapter can, and env:images
  // owns PNGs. Registering `handles` here would silently take the `describe`
  // verb away from them — the mistake env:render documents avoiding.
  const adapter = ocr();
  assert.equal(adapter.handles, undefined);
});

// ================================================== the training data is local

test("the bundled training data resolves to a file on disk, never to a URL", async () => {
  // This is the offline claim, stated as an invariant instead of a hope.
  // tesseract.js only reaches for the network when `langPath` is a URL; it
  // reads from disk otherwise. So the thing to pin is that the path we hand it
  // is a real local file, with no configuration of any kind.
  const source = await resolveLangPath("eng");
  assert.equal(source.gzip, true);
  assert.ok(isAbsolute(source.path), `expected an absolute local path, got ${source.path}`);
  assert.doesNotMatch(source.path, /^[a-z]+:\/\//i, "a URL here would mean a download at recognise time");
  const stats = await stat(join(source.path, "eng.traineddata.gz"));
  assert.ok(stats.size > 1_000_000, `training data looks wrong at ${stats.size} bytes`);
});

test("a host can point at its own tessdata directory, and a wrong one says so", async () => {
  const bundled = await resolveLangPath("eng");
  const dir = await mkdtemp(join(tmpdir(), "glove-ocr-lang-"));
  await copyFile(join(bundled.path, "eng.traineddata.gz"), join(dir, "eng.traineddata.gz"));

  const t = await createAdapterTestEnv(ocr({ langPath: dir }));
  await t.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(1)));
  const out = await t.script<OcrResult>(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf'); }`,
  );
  assert.match(out.text, /Total due 3775\.20 EUR/, "a vendored tessdata directory must work like the bundled one");
  await rm(dir, { recursive: true, force: true });

  const broken = await createAdapterTestEnv(ocr({ langPath: join(tmpdir(), "glove-ocr-not-here") }));
  await broken.fs.writeFile("/inbox/scan.pdf", await flatten(await typeset(1)));
  const run = await broken.runScript(
    `import { recognize } from 'env:ocr';
     export default async function main() { return recognize('/inbox/scan.pdf'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /no eng\.traineddata/);
  assert.match(String(run.error), /glove-ocr-not-here/, "the message must name the path that was wrong");
});

test("languages() reports what the host can actually run", async () => {
  const t = await env();
  const langs = await t.script<string[]>(
    `import { languages } from 'env:ocr';
     export default async function main() { return languages(); }`,
  );
  assert.deepEqual(langs, ["eng"], "only the bundled language is installed in this repo");
});
