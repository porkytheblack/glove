/**
 * env:render.
 *
 * The PDF and image paths are exercised for real — a PDF is generated, then
 * rasterized, then the bytes are checked to be a PNG of plausible size. The
 * Office path needs LibreOffice *with its import filters*, which CI does not
 * have, so that test announces itself as skipped rather than quietly passing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { assertAdapterOk, createAdapterTestEnv } from "glove-working-environment/testing";
import { render } from "../src/index";

const run = promisify(execFile);
const call = (body: string) => `import { render } from 'env:render';\nexport default async function () { ${body} }\n`;

/** A PDF with a heading, a figure and a coloured block on every page. */
async function samplePdf(pages = 1, size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(size);
    page.drawText(`Page ${i} heading`, { x: 40, y: size[1] - 80, size: 28, font });
    page.drawText("East    $163,200", { x: 40, y: size[1] - 140, size: 16 });
    page.drawRectangle({ x: 40, y: size[1] - 240, width: 300, height: 40, color: rgb(0.62, 0.83, 0.72) });
  }
  return new Uint8Array(await doc.save());
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/**
 * LibreOffice present AND able to open a deck. `libreoffice-core` on its own
 * satisfies `--version` and then fails every conversion, so probing the
 * binary alone would give a false positive.
 */
async function libreOfficeWorks(): Promise<boolean> {
  try {
    await run("soffice", ["--version"], { timeout: 30_000 });
    const { stdout } = await run("bash", ["-lc", "ls /usr/lib/libreoffice/program/ 2>/dev/null | grep -c simpress"], {
      timeout: 15_000,
    });
    return Number(stdout.trim()) > 0;
  } catch {
    return false;
  }
}

const officeReady = await libreOfficeWorks();

test("rasterizes a PDF page to a real PNG", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/report.pdf", await samplePdf());
    const out = await t.script<{ pages: Array<{ path: string; width: number }>; format: string; totalPages: number }>(
      call(`return await render('/inbox/report.pdf', '/tmp/proof');`),
    );

    assert.equal(out.format, "pdf");
    assert.equal(out.totalPages, 1);
    assert.deepEqual(out.pages.map((p) => p.path), ["/tmp/proof/report-p1.png"]);

    const png = await t.fs.readBytes(out.pages[0].path);
    assert.ok(isPng(png), "output must be a PNG");
    assert.ok(png.byteLength > 2000, `expected a real render, got ${png.byteLength} bytes`);
    assert.ok(out.pages[0].width > 500 && out.pages[0].width <= 1600, `width was ${out.pages[0].width}`);
  } finally {
    await t.env.close();
  }
});

test("renders the pages asked for, and reports the document's true length", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/long.pdf", await samplePdf(5));
    const out = await t.script<{ pages: Array<{ page: number; path: string }>; totalPages: number }>(
      call(`return await render('/inbox/long.pdf', '/tmp/proof', { pages: [2, 4] });`),
    );
    assert.equal(out.totalPages, 5, "totalPages is the document, not the render");
    assert.deepEqual(out.pages.map((p) => p.page), [2, 4]);
    assert.deepEqual(out.pages.map((p) => p.path), ["/tmp/proof/long-p2.png", "/tmp/proof/long-p4.png"]);
  } finally {
    await t.env.close();
  }
});

test("'all' renders every page", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/three.pdf", await samplePdf(3));
    const out = await t.script<{ pages: unknown[] }>(call(`return await render('/inbox/three.pdf', '/tmp/proof', { pages: 'all' });`));
    assert.equal(out.pages.length, 3);
  } finally {
    await t.env.close();
  }
});

test("a page that does not exist is reported, not silently dropped", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/one.pdf", await samplePdf(1));
    const result = await t.runScript(call(`return await render('/inbox/one.pdf', '/tmp/proof', { pages: [7] });`));
    assert.equal(result.ok, false);
    assert.match(String(result.error), /no pages produced/);
    assert.match(String(result.error), /1 page/, "the error must say how long the document actually is");
  } finally {
    await t.env.close();
  }
});

test("caps the long edge instead of shipping every pixel", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/wide.pdf", await samplePdf(1, [2400, 600]));
    const first = await t.script<{ pages: Array<{ path: string; width: number }> }>(
      call(`return await render('/inbox/wide.pdf', '/tmp/a', { maxWidth: 1600 });`),
    );
    assert.ok(first.pages[0].width <= 1600, `maxWidth must cap the long edge, got ${first.pages[0].width}`);

    // Feed the render back in: that exercises the image branch on real bytes.
    const second = await t.script<{ pages: Array<{ width: number }>; format: string }>(
      call(`return await render('${first.pages[0].path}', '/tmp/b', { maxWidth: 400 });`),
    );
    assert.equal(second.format, "image");
    assert.ok(second.pages[0].width <= 400, `expected <=400, got ${second.pages[0].width}`);
  } finally {
    await t.env.close();
  }
});

test("refuses a format it cannot rasterize, and says what it takes", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    await t.fs.writeFile("/inbox/notes.txt", "plain text");
    const result = await t.runScript(call(`return await render('/inbox/notes.txt', '/tmp/proof');`));
    assert.equal(result.ok, false);
    assert.match(String(result.error), /cannot render/);
    assert.match(String(result.error), /\.pdf/, "the error must name what it does accept");
  } finally {
    await t.env.close();
  }
});

test("a missing file fails as a missing file, not as a render error", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    const result = await t.runScript(call(`return await render('/inbox/ghost.pdf', '/tmp/p');`));
    assert.equal(result.ok, false);
    assert.match(String(result.error), /no such file/);
  } finally {
    await t.env.close();
  }
});

test("magic bytes beat the extension", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    // A PDF wearing a .pptx name must not be sent to LibreOffice.
    await t.fs.writeFile("/inbox/liar.pptx", await samplePdf());
    const out = await t.script<{ format: string }>(call(`return await render('/inbox/liar.pptx', '/tmp/proof');`));
    assert.equal(out.format, "pdf");
  } finally {
    await t.env.close();
  }
});

test("the declared types match the real bindings", async () => {
  const t = await createAdapterTestEnv(render());
  try {
    assertAdapterOk(await t.audit());
  } finally {
    await t.env.close();
  }
});

test(
  "renders a .pptx through LibreOffice",
  { skip: officeReady ? false : "LibreOffice import filters not installed" },
  async () => {
    const t = await createAdapterTestEnv(render());
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.addSlide().addText("Q2 Regional Review", { x: 0.6, y: 0.5, fontSize: 34, bold: true });
      const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
      await t.fs.writeFile("/inbox/deck.pptx", new Uint8Array(buf));

      const out = await t.script<{ pages: Array<{ path: string }>; format: string }>(
        call(`return await render('/inbox/deck.pptx', '/tmp/proof');`),
      );
      assert.equal(out.format, "office");
      assert.ok(isPng(await t.fs.readBytes(out.pages[0].path)));
    } finally {
      await t.env.close();
    }
  },
);
