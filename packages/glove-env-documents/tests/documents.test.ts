/**
 * env:documents, exercised from inside scripts.
 *
 * Every fixture is produced by the adapter itself and read back through an
 * independent path — a PDF written by pdf-lib is inspected with pdfjs, a
 * DOCX written by `docx` is unpacked with our own ZIP reader — so a bug that
 * is symmetric in the writer cannot hide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAdapterOk, createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { documents } from "../src/index";
import type { DocxSummary, DocxText, ExtractedText, PdfSummary } from "../src/index";
import { parsePages, toWinAnsi } from "../src/pdf";
import { parseDocumentXml } from "../src/docx";
import { readZip } from "../src/zip";
import { makeFakeWebp, makePng } from "./png";

async function env(): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(documents());
}

const SPEC = `{
  title: 'Q3 Revenue Review',
  author: 'analysis agent',
  content: [
    { heading: 'Summary' },
    { text: 'Revenue grew 11% quarter over quarter, driven by EMEA.' },
    { bullets: ['EMEA +18%', 'AMER +4%'] },
    { heading: 'By region', level: 2 },
    { table: { headers: ['Region', 'Revenue'], rows: [['EMEA', 91000], ['AMER', 51000]] } },
  ],
}`;

const png = (width = 60, height = 40): Uint8Array => makePng(width, height);

test("the adapter passes its own audit", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

// ================================================================== PDF

test("pdf.create renders a spec and describe reports its structure", async () => {
  const t = await env();
  const out = await t.script<{ path: string; summary: PdfSummary }>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       const path = await pdf.create('/out/review.pdf', ${SPEC});
       return { path, summary: await pdf.describe(path) };
     }`,
  );
  assert.equal(out.path, "/out/review.pdf");
  assert.equal(out.summary.format, "pdf");
  assert.equal(out.summary.pages, 1);
  assert.equal(out.summary.title, "Q3 Revenue Review");
  assert.equal(out.summary.author, "analysis agent");
  assert.equal(out.summary.encrypted, false);
  assert.deepEqual(out.summary.pageSizes[0], { width: 595.28, height: 841.89 });

  const bytes = await t.fs.readBytes("/out/review.pdf");
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "%PDF");
});

test("the rendered PDF actually contains the authored text", async () => {
  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/review.pdf', ${SPEC});
       return pdf.extractText('/out/review.pdf');
     }`,
  );
  // Read back by pdfjs, which shares no code with the pdf-lib writer.
  const text = out.text.replace(/\s+/g, " ");
  for (const expected of ["Q3 Revenue Review", "Summary", "Revenue grew 11%", "EMEA +18%", "By region", "91000"]) {
    assert.ok(text.includes(expected), `expected the PDF to contain ${JSON.stringify(expected)}, got: ${text}`);
  }
  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].page, 1);
  assert.ok(out.characters > 100);
});

test("long text paginates instead of running off the page", async () => {
  const t = await env();
  const summary = await t.script<PdfSummary>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       const content = [];
       for (let i = 0; i < 120; i++) content.push({ text: 'Paragraph ' + i + ' ' + 'lorem ipsum dolor sit amet '.repeat(4) });
       await pdf.create('/out/long.pdf', { content });
       return pdf.describe('/out/long.pdf');
     }`,
  );
  assert.ok(summary.pages > 3, `expected several pages, got ${summary.pages}`);
});

test("pageBreak starts a new page and pageSize is honoured", async () => {
  const t = await env();
  const summary = await t.script<PdfSummary>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/breaks.pdf', {
         pageSize: 'letter',
         content: [{ text: 'one' }, { pageBreak: true }, { text: 'two' }, { pageBreak: true }, { text: 'three' }],
       });
       return pdf.describe('/out/breaks.pdf');
     }`,
  );
  assert.equal(summary.pages, 3);
  assert.deepEqual(summary.pageSizes[0], { width: 612, height: 792 });
});

test("a spec can embed an image from the tree", async () => {
  const t = await env();
  await t.fs.writeFile("/tmp/chart.png", png(120, 80));
  const summary = await t.script<PdfSummary>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/withimage.pdf', { content: [{ text: 'chart:' }, { image: '/tmp/chart.png', width: 200 }] });
       return pdf.describe('/out/withimage.pdf');
     }`,
  );
  assert.equal(summary.pages, 1);
  assert.ok(summary.bytes > 1000, "an embedded image should make the file substantially bigger");
});

test("an unsupported image format is refused with a pointer to env:images", async () => {
  const t = await env();
  await t.fs.writeFile("/tmp/chart.webp", makeFakeWebp());
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.create('/out/x.pdf', { content: [{ image: '/tmp/chart.webp' }] });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /neither PNG nor JPEG/);
  assert.match(run.error ?? "", /env:images/);
});

test("merge concatenates in order and extractPages selects 1-based pages", async () => {
  const t = await env();
  const out = await t.script<{ merged: number; picked: ExtractedText }>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/a.pdf', { content: [{ text: 'ALPHA' }] });
       await pdf.create('/tmp/b.pdf', { content: [{ text: 'BETA' }, { pageBreak: true }, { text: 'GAMMA' }] });
       await pdf.merge(['/tmp/a.pdf', '/tmp/b.pdf'], '/out/merged.pdf');
       await pdf.extractPages('/out/merged.pdf', '/out/picked.pdf', '1,3');
       return {
         merged: (await pdf.describe('/out/merged.pdf')).pages,
         picked: await pdf.extractText('/out/picked.pdf'),
       };
     }`,
  );
  assert.equal(out.merged, 3);
  assert.equal(out.picked.pages.length, 2);
  assert.match(out.picked.pages[0].text, /ALPHA/);
  assert.match(out.picked.pages[1].text, /GAMMA/, "page 3 of the merge is GAMMA");
});

test("split writes one file per page, named after the source", async () => {
  const t = await env();
  const paths = await t.script<string[]>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/big.pdf', { content: [{ text: 'one' }, { pageBreak: true }, { text: 'two' }] });
       return pdf.split('/tmp/big.pdf', '/out/pages');
     }`,
  );
  assert.deepEqual(paths, ["/out/pages/big-1.pdf", "/out/pages/big-2.pdf"]);
  for (const p of paths) assert.equal(await t.fs.exists(p), true);
});

test("an out-of-range page says how many there are", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/one.pdf', { content: [{ text: 'only' }] });
       return pdf.extractPages('/tmp/one.pdf', '/out/x.pdf', '4');
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /^env:documents\.pdf\.extractPages: /, "nested namespaces are tagged too");
  assert.match(run.error ?? "", /page 4 is out of range/);
  assert.match(run.error ?? "", /has 1 page\b/);
});

test("parsePages accepts ranges, lists and arrays; rejects nonsense", () => {
  assert.deepEqual(parsePages("1-3,7", 10), [0, 1, 2, 6]);
  assert.deepEqual(parsePages([1, 3], 3), [0, 2]);
  assert.deepEqual(parsePages(undefined, 3), [0, 1, 2]);
  assert.throws(() => parsePages("3-1", 5), /runs backwards/);
  assert.throws(() => parsePages("abc", 5), /cannot parse/);
  assert.throws(() => parsePages("", 5), /selected no pages/);
  assert.throws(() => parsePages([1.5], 5), /whole numbers/);
});

test("setMetadata rewrites in place or to a new path", async () => {
  const t = await env();
  const out = await t.script<{ inPlace: PdfSummary; copy: PdfSummary; original: PdfSummary }>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/m.pdf', { title: 'Original', content: [{ text: 'x' }] });
       await pdf.create('/tmp/n.pdf', { title: 'Original', content: [{ text: 'x' }] });
       await pdf.setMetadata('/tmp/m.pdf', { title: 'Renamed', author: 'someone', keywords: ['a', 'b'] });
       await pdf.setMetadata('/tmp/n.pdf', { title: 'Copy' }, '/out/copy.pdf');
       return {
         inPlace: await pdf.describe('/tmp/m.pdf'),
         copy: await pdf.describe('/out/copy.pdf'),
         original: await pdf.describe('/tmp/n.pdf'),
       };
     }`,
  );
  assert.equal(out.inPlace.title, "Renamed");
  assert.equal(out.inPlace.author, "someone");
  assert.equal(out.copy.title, "Copy");
  assert.equal(out.original.title, "Original", "writing to an output path leaves the input alone");
});

test("stamp draws on the pages it is told to", async () => {
  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/s.pdf', { content: [{ text: 'one' }, { pageBreak: true }, { text: 'two' }] });
       await pdf.stamp('/tmp/s.pdf', '/out/stamped.pdf', { text: 'DRAFT', position: 'center', pages: [2] });
       return pdf.extractText('/out/stamped.pdf');
     }`,
  );
  assert.ok(!out.pages[0].text.includes("DRAFT"), "page 1 was not selected");
  assert.match(out.pages[1].text, /DRAFT/);
});

test("stamp requires text", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/s.pdf', { content: [{ text: 'x' }] });
       return pdf.stamp('/tmp/s.pdf', '/out/s.pdf', {});
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /stamp needs \{ text \}/);
});

test("characters outside the standard font are transliterated, not fatal", async () => {
  assert.equal(toWinAnsi("“smart” — quotes… ✓"), '"smart" - quotes... ?');

  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/uni.pdf', { content: [{ text: 'He said “hello” — then left…' }] });
       return pdf.extractText('/out/uni.pdf');
     }`,
  );
  assert.match(out.text, /"hello"/);
  assert.match(out.text, /- then left\.\.\./);
});

test("extractText can select pages", async () => {
  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/p.pdf', { content: [{ text: 'ONE' }, { pageBreak: true }, { text: 'TWO' }, { pageBreak: true }, { text: 'THREE' }] });
       return pdf.extractText('/tmp/p.pdf', { pages: '2-3' });
     }`,
  );
  assert.deepEqual(out.pages.map((p) => p.page), [2, 3]);
  assert.match(out.pages[0].text, /TWO/);
});

test("a file that is not a PDF fails with the path and the reason", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/fake.pdf", "not a pdf at all");
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() { return pdf.describe('/inbox/fake.pdf'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /\/inbox\/fake\.pdf could not be read as a PDF/);
});

// ================================================================= DOCX

test("docx.create renders the same spec, and describe returns its outline", async () => {
  const t = await env();
  const out = await t.script<{ path: string; summary: DocxSummary }>(
    `import { docx } from 'env:documents';
     export default async function main() {
       const path = await docx.create('/out/review.docx', ${SPEC});
       return { path, summary: await docx.describe(path) };
     }`,
  );
  assert.equal(out.path, "/out/review.docx");
  assert.equal(out.summary.format, "docx");
  assert.deepEqual(out.summary.headings, [
    { level: 1, text: "Summary" },
    { level: 2, text: "By region" },
  ]);
  assert.equal(out.summary.tables, 1);
  assert.ok(out.summary.words > 10);
  assert.ok(out.summary.preview.length > 0);
  assert.ok(JSON.stringify(out.summary).length < 1200, "describe must stay tokens-cheap");
});

test("docx.extractText recovers the authored content", async () => {
  const t = await env();
  const out = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() {
       await docx.create('/out/review.docx', ${SPEC});
       return docx.extractText('/out/review.docx');
     }`,
  );
  for (const expected of ["Q3 Revenue Review", "Summary", "Revenue grew 11% quarter over quarter, driven by EMEA.", "EMEA +18%", "91000"]) {
    assert.ok(out.text.includes(expected), `expected ${JSON.stringify(expected)} in:\n${out.text}`);
  }
  assert.ok(out.paragraphs.includes("EMEA +18%"), "bullets are paragraphs of their own");
});

test("the .docx really is an OOXML package", async () => {
  const t = await env();
  await t.script(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.create('/out/z.docx', { content: [{ text: 'hi' }] }); }`,
  );
  const entries = readZip(await t.fs.readBytes("/out/z.docx"));
  assert.ok(entries.has("word/document.xml"));
  assert.ok(entries.has("[Content_Types].xml"));
});

test("authored newlines survive as line breaks, XML entities are decoded", async () => {
  const t = await env();
  const out = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() {
       await docx.create('/out/e.docx', { content: [{ text: 'first line\\nsecond line' }, { text: 'a < b & c > d' }] });
       return docx.extractText('/out/e.docx');
     }`,
  );
  assert.ok(out.paragraphs.some((p) => p.includes("first line\nsecond line")), out.paragraphs.join(" | "));
  assert.ok(out.text.includes("a < b & c > d"), `entities must round-trip: ${out.text}`);
});

test("docx keeps full Unicode where PDF transliterates", async () => {
  const t = await env();
  const out = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() {
       await docx.create('/out/u.docx', { content: [{ text: 'quotes “here” — check ✓ éàü' }] });
       return docx.extractText('/out/u.docx');
     }`,
  );
  assert.match(out.text, /quotes “here” — check ✓ éaü|quotes “here” — check ✓ éàü/);
});

test("a .docx with an embedded image is still readable", async () => {
  const t = await env();
  await t.fs.writeFile("/tmp/chart.png", png());
  const out = await t.script<DocxSummary>(
    `import { docx } from 'env:documents';
     export default async function main() {
       await docx.create('/out/img.docx', { content: [{ text: 'see below' }, { image: '/tmp/chart.png', width: 200, height: 130 }] });
       return docx.describe('/out/img.docx');
     }`,
  );
  assert.ok(out.preview.includes("see below"));
  assert.ok(out.bytes > 1000);
});

test("a ZIP that is not a Word document says so", async () => {
  const t = await env();
  await t.script(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.create('/tmp/real.docx', { content: [{ text: 'x' }] }); }`,
  );
  const bytes = await t.fs.readBytes("/tmp/real.docx");
  // Corrupt the archive by truncating the central directory away.
  await t.fs.writeFile("/inbox/broken.docx", bytes.subarray(0, Math.floor(bytes.length / 2)));

  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.describe('/inbox/broken.docx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /could not be read as a \.docx/);
});

test("parseDocumentXml handles tabs, breaks and self-closing paragraphs", () => {
  const xml = `<w:body><w:p><w:r><w:t>a</w:t></w:r><w:tab/><w:r><w:t xml:space="preserve">b</w:t></w:r></w:p>` +
    `<w:p/><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Head</w:t></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>`;
  const { paragraphs, tables } = parseDocumentXml(xml);
  assert.equal(paragraphs[0].text, "a\tb");
  assert.equal(paragraphs[1].text, "");
  assert.equal(paragraphs[2].headingLevel, 2);
  assert.equal(paragraphs[2].text, "Head");
  assert.equal(tables, 1);
});

// =========================================================== dispatch

test("describe sniffs the format from the bytes, not the extension", async () => {
  const t = await env();
  const out = await t.script<{ pdf: PdfSummary; docx: DocxSummary; mislabelled: PdfSummary }>(
    `import { describe, pdf, docx } from 'env:documents';
     import { cp } from 'env:fs';
     export default async function main() {
       await pdf.create('/tmp/a.pdf', { content: [{ text: 'x' }] });
       await docx.create('/tmp/b.docx', { content: [{ text: 'y' }] });
       await cp('/tmp/a.pdf', '/tmp/mislabelled.docx');
       return {
         pdf: await describe('/tmp/a.pdf'),
         docx: await describe('/tmp/b.docx'),
         mislabelled: await describe('/tmp/mislabelled.docx'),
       };
     }`,
  );
  assert.equal(out.pdf.format, "pdf");
  assert.equal(out.docx.format, "docx");
  assert.equal(out.mislabelled.format, "pdf", "a PDF named .docx is still a PDF");
});

test("an unrecognisable file is refused by describe", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/mystery.bin", "neither one nor the other");
  const run = await t.runScript(
    `import { describe } from 'env:documents';
     export default async function main() { return describe('/inbox/mystery.bin'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /cannot tell what kind of document/);
  assert.match(run.error ?? "", /\.pdf, \.docx/);
});

// ===================================================== spec validation

test("a malformed spec is rejected with the offending block named", async () => {
  const t = await env();
  for (const [spec, pattern] of [
    ["{}", /needs a `content` array/],
    ["{ content: [{ nope: 1 }] }", /content\[0\] is not a recognised block/],
    ["{ content: [{ text: 'ok' }, { bogus: true }] }", /content\[1\]/],
    ["{ content: [{ table: { rows: 'not rows' } }] }", /not a recognised block/],
    ["{ content: [{ pageSize: 'a4' }] }", /not a recognised block/],
  ] as const) {
    const run = await t.runScript(
      `import { pdf } from 'env:documents';
       export default async function main() { return pdf.create('/out/x.pdf', ${spec}); }`,
    );
    assert.equal(run.ok, false, `expected ${spec} to be rejected`);
    assert.match(run.error ?? "", pattern);
  }
});

test("an unknown pageSize lists the ones that work", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() { return pdf.create('/out/x.pdf', { pageSize: 'a3', content: [] }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /unknown pageSize "a3"/);
  assert.match(run.error ?? "", /"a4", "letter"/);
});

// ============================================================ gateway

test("documents obey the environment's limits and leave no partial file", async () => {
  const t = await createAdapterTestEnv(documents(), { limits: { maxFileBytes: 2048 } });
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       const content = [];
       for (let i = 0; i < 400; i++) content.push({ text: 'padding '.repeat(20) });
       return pdf.create('/out/big.pdf', { content });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /maxFileBytes/);
  assert.equal(await t.fs.exists("/out/big.pdf"), false);
});

test("a full inbox → analysis → deliverable pass works end to end", async () => {
  const t = await env();
  const out = await t.script<{ outputs: string[]; pages: number; words: number }>(
    `import { pdf, docx, describe } from 'env:documents';
     import { glob } from 'env:fs';

     export default async function main() {
       // Two source documents arrive in the inbox.
       await pdf.create('/inbox/one.pdf', { title: 'Contract A', content: [{ text: 'Term: 24 months. Value: 91000.' }] });
       await pdf.create('/inbox/two.pdf', { title: 'Contract B', content: [{ text: 'Term: 12 months. Value: 51000.' }] });

       const found = [];
       for (const path of (await glob('/inbox/*.pdf')).sort()) {
         const meta = await describe(path);
         const { text } = await pdf.extractText(path);
         const value = Number(/Value: (\\d+)/.exec(text)?.[1] ?? 0);
         const months = Number(/Term: (\\d+)/.exec(text)?.[1] ?? 0);
         found.push({ title: meta.title, months, value });
       }

       const spec = {
         title: 'Contract summary',
         content: [
           { heading: 'Findings' },
           { text: 'Reviewed ' + found.length + ' contracts.' },
           { table: {
               headers: ['Contract', 'Months', 'Value'],
               rows: found.map(f => [f.title, f.months, f.value]),
           } },
         ],
       };
       await pdf.create('/out/summary.pdf', spec);
       await docx.create('/out/summary.docx', spec);

       return {
         outputs: ['/out/summary.pdf', '/out/summary.docx'],
         pages: (await pdf.describe('/out/summary.pdf')).pages,
         words: (await docx.describe('/out/summary.docx')).words,
       };
     }`,
  );
  assert.deepEqual(out.outputs, ["/out/summary.pdf", "/out/summary.docx"]);
  assert.equal(out.pages, 1);
  assert.ok(out.words > 5);

  const text = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() { return pdf.extractText('/out/summary.pdf'); }`,
  );
  assert.match(text.text.replace(/\s+/g, " "), /Reviewed 2 contracts/);
  assert.match(text.text, /Contract A/);
  assert.match(text.text, /91000/);
});

test("extractText says a page is a scan rather than leaving it to be inferred", async () => {
  // `characters: 3` on a document that visibly has words is indistinguishable
  // from a bug in the caller's own code. A page that draws an image and
  // carries no text layer IS a scan, and saying so is the whole difference
  // between a dead end and a next step.
  const t = await env();
  await t.fs.writeFile("/inbox/page.png", png(400, 300));

  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/scan.pdf', { content: [{ image: '/inbox/page.png', width: 400 }] });
       return pdf.extractText('/out/scan.pdf');
     }`,
  );
  assert.equal(out.kind, "scanned");
  assert.equal(out.pages[0].kind, "scanned");
  assert.ok(out.characters < 100);
  assert.match(String(out.note), /images of text, not text/);
  assert.match(String(out.note), /vision model|OCR/);
});

test("a real text document is reported as text, with no advice attached", async () => {
  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/words.pdf', ${SPEC});
       return pdf.extractText('/out/words.pdf');
     }`,
  );
  assert.equal(out.kind, "text");
  assert.equal(out.pages[0].kind, "text");
  assert.equal(out.note, undefined, "a document that read fine needs no note");
});

test("a document that mixes scanned and text pages reports mixed", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/shot.png", png(400, 300));
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/tmp/text.pdf', ${SPEC});
       await pdf.create('/tmp/scan.pdf', { content: [{ image: '/inbox/shot.png', width: 400 }] });
       await pdf.merge(['/tmp/text.pdf', '/tmp/scan.pdf'], '/out/both.pdf');
       return pdf.extractText('/out/both.pdf');
     }`,
  );
  assert.equal(out.kind, "mixed");
  assert.deepEqual(
    out.pages.map((p) => p.kind),
    ["text", "scanned"],
  );
  assert.match(String(out.note), /1 page\(s\) are images of text/);
  assert.match(String(out.note), /: 2\./, "and names which page");
});

test("a blank page is called blank, not a scan", async () => {
  // Without the image check, "few characters" alone would label an empty page
  // a scan, and the advice that follows would send the caller after an OCR
  // pass on nothing.
  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/blank.pdf', { content: [] });
       return pdf.extractText('/out/blank.pdf');
     }`,
  );
  assert.equal(out.kind, "empty");
  assert.match(String(out.note), /blank, not unreadable/);
});
