/**
 * Embedded fonts and AcroForms.
 *
 * Every claim about text on a page is checked by reading the glyphs back out
 * with pdfjs, which shares no code with the pdf-lib writer. That matters more
 * here than anywhere else in this package: a font can be embedded, referenced
 * and drawn with, and still put the wrong characters on the page — the failure
 * mode is a document that looks structurally perfect and reads as boxes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { documents } from "../src/index";
import type { ExtractedText, FilledForm, PdfFormContents, PdfSummary } from "../src/index";
import { liberationSans, liberationSansBold, makeAcroForm } from "./fixtures";
import { makePng } from "./png";

async function env(): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(documents());
}

/** Cyrillic and Greek: outside WinAnsi, inside Liberation Sans. */
const RUSSIAN = "Договор — Иван Петров";
const GREEK = "Σύμβαση παροχής υπηρεσιών";

async function withFont(t: AdapterTestEnv): Promise<void> {
  await t.fs.writeFile("/fonts/sans.ttf", liberationSans());
}

// ================================================================== fonts

test("without a font, non-Latin text is transliterated to question marks", async () => {
  // Pinning the old behaviour on purpose: it is the fallback, it is lossy, and
  // the docs promise exactly this. A test that only covered the good path
  // would let the fallback drift into throwing.
  const t = await env();
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/plain.pdf', { content: [{ text: ${JSON.stringify(RUSSIAN)} }] });
       return pdf.extractText('/out/plain.pdf');
     }`,
  );
  assert.match(out.text, /\?\?\?\?\?\?\?/, `expected question marks, got ${JSON.stringify(out.text)}`);
  assert.doesNotMatch(out.text, /Иван/);
  // The em dash still transliterates to a hyphen rather than failing the render.
  assert.match(out.text, /-/);
});

test("with an embedded font, non-Latin text survives the round trip", async () => {
  const t = await env();
  await withFont(t);
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/ru.pdf', {
         font: '/fonts/sans.ttf',
         content: [{ heading: ${JSON.stringify(GREEK)} }, { text: ${JSON.stringify(RUSSIAN)} }],
       });
       return pdf.extractText('/out/ru.pdf');
     }`,
  );
  // Read back by pdfjs from the embedded font's own ToUnicode map.
  assert.match(out.text, /Иван Петров/);
  assert.match(out.text, /Σύμβαση παροχής υπηρεσιών/);
  assert.doesNotMatch(out.text, /\?/, `nothing should have been transliterated: ${JSON.stringify(out.text)}`);
});

test("only the glyphs used are embedded, so a large font makes a small PDF", async () => {
  const t = await env();
  await withFont(t);
  const font = liberationSans();
  const summary = await t.script<PdfSummary>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/ru.pdf', { font: '/fonts/sans.ttf', content: [{ text: ${JSON.stringify(RUSSIAN)} }] });
       return pdf.describe('/out/ru.pdf');
     }`,
  );
  assert.ok(
    summary.bytes < font.byteLength / 4,
    `subsetting should keep the PDF far under the ${font.byteLength}-byte font, got ${summary.bytes}`,
  );
});

test("a separate bold face is used for headings", async () => {
  const t = await env();
  await withFont(t);
  await t.fs.writeFile("/fonts/sans-bold.ttf", liberationSansBold());
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/two.pdf', {
         font: { regular: '/fonts/sans.ttf', bold: '/fonts/sans-bold.ttf' },
         content: [{ heading: ${JSON.stringify(GREEK)} }, { text: ${JSON.stringify(RUSSIAN)} }],
       });
       return pdf.extractText('/out/two.pdf');
     }`,
  );
  assert.match(out.text, /Σύμβαση/);
  assert.match(out.text, /Иван Петров/);
});

test("a font with no glyph for the text is refused, naming the characters", async () => {
  // The alternative is glyph 0 — a blank box that looks like success to the
  // producer and like a broken file to the reader.
  const t = await env();
  await withFont(t);
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.create('/out/jp.pdf', { font: '/fonts/sans.ttf', content: [{ text: '契約書' }] });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /has no glyph for 3 characters/);
  assert.match(String(run.error), /U\+5951/);
  assert.match(String(run.error), /blank boxes/);
  assert.equal(await t.fs.exists("/out/jp.pdf"), false, "nothing should be written when the render is refused");
});

test("coverage is checked against table cells and bullets too, not just paragraphs", async () => {
  const t = await env();
  await withFont(t);
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.create('/out/t.pdf', {
         font: '/fonts/sans.ttf',
         content: [{ table: { headers: ['Region'], rows: [['東京']] } }],
       });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /no glyph/);
});

test("a file that is not a font is refused as one", async () => {
  const t = await env();
  await t.fs.writeFile("/fonts/notafont.ttf", makePng(4, 4));
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.create('/out/x.pdf', { font: '/fonts/notafont.ttf', content: [{ text: 'hi' }] });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /is not a font fontkit can read/);
});

test("a font path that is not in the tree says so, rather than reaching the host", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.create('/out/x.pdf', { font: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', content: [{ text: 'hi' }] });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /could not read the font/);
  assert.match(String(run.error), /this environment's filesystem/);
});

test("metadata carries any script without a font at all", async () => {
  // PDF text strings are UTF-16; only drawn glyphs need a font. Transliterating
  // metadata was costing a title its characters for nothing.
  const t = await env();
  const summary = await t.script<PdfSummary>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/meta.pdf', { title: ${JSON.stringify(RUSSIAN)}, content: [{ text: 'body' }] });
       await pdf.setMetadata('/out/meta.pdf', { author: '山田太郎', keywords: ['契約'] });
       return pdf.describe('/out/meta.pdf');
     }`,
  );
  assert.equal(summary.title, RUSSIAN);
  assert.equal(summary.author, "山田太郎");
});

test("stamp takes a font, so a watermark is not limited to Latin-1", async () => {
  const t = await env();
  await withFont(t);
  const out = await t.script<ExtractedText>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/base.pdf', { content: [{ text: 'body text goes here' }] });
       await pdf.stamp('/out/base.pdf', '/out/stamped.pdf', { text: 'ЧЕРНОВИК', font: '/fonts/sans.ttf', position: 'center' });
       return pdf.extractText('/out/stamped.pdf');
     }`,
  );
  assert.match(out.text, /ЧЕРНОВИК/);
});

// =================================================================== forms

test("readForm reports every field's name, kind, value and choices", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const form = await t.script<PdfFormContents>(
    `import { pdf } from 'env:documents';
     export default async function main() { return pdf.readForm('/inbox/application.pdf'); }`,
  );

  assert.equal(form.xfa, false);
  assert.equal(form.note, undefined);
  const byName = new Map(form.fields.map((f) => [f.name, f]));
  assert.deepEqual([...byName.keys()].sort(), [
    "applicant.agree",
    "applicant.contact",
    "applicant.name",
    "applicant.plan",
  ]);
  assert.equal(byName.get("applicant.name")!.type, "text");
  assert.equal(byName.get("applicant.agree")!.type, "checkbox");
  assert.equal(byName.get("applicant.agree")!.value, false);
  assert.equal(byName.get("applicant.plan")!.type, "dropdown");
  assert.deepEqual(byName.get("applicant.plan")!.options, ["Basic", "Pro", "Enterprise"]);
  assert.deepEqual(byName.get("applicant.contact")!.options, ["Email", "Phone"]);
});

test("fillForm sets the values and readForm reads them back", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const result = await t.script<{ filled: FilledForm; after: PdfFormContents; page: string }>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       const values = {
         'applicant.name': 'Ada Lovelace',
         'applicant.agree': true,
         'applicant.plan': 'Pro',
         'applicant.contact': 'Email',
       };
       const filled = await pdf.fillForm('/inbox/application.pdf', values, { output: '/out/application.pdf' });
       const after = await pdf.readForm('/out/application.pdf');
       // A filled field lives in a widget annotation, and pdfjs's text
       // extraction reads page content streams — so the only way to check the
       // value with an independent reader is to flatten it onto the page.
       await pdf.fillForm('/inbox/application.pdf', values, { output: '/out/flattened.pdf', flatten: true });
       const page = await pdf.extractText('/out/flattened.pdf');
       return { filled, after, page: page.text };
     }`,
  );

  assert.equal(result.filled.path, "/out/application.pdf");
  assert.deepEqual(result.filled.filled, [
    "applicant.name",
    "applicant.agree",
    "applicant.plan",
    "applicant.contact",
  ]);

  const byName = new Map(result.after.fields.map((f) => [f.name, f.value]));
  assert.equal(byName.get("applicant.name"), "Ada Lovelace");
  assert.equal(byName.get("applicant.agree"), true);
  assert.equal(byName.get("applicant.plan"), "Pro");
  assert.equal(byName.get("applicant.contact"), "Email");

  // And the value is really drawn, not just recorded: pdfjs reads the ink the
  // flattened appearance stream left on the page.
  assert.match(result.page, /Ada Lovelace/);
  assert.match(result.page, /Pro/);
});

test("an unknown field name is an error that lists the real ones", async () => {
  // A name that is nearly right is how form filling fails. Reporting success
  // while setting nothing is the outcome this refusal exists to prevent.
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.fillForm('/inbox/application.pdf', { 'applicant.nmae': 'Ada' });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /has no form field named "applicant.nmae"/);
  assert.match(String(run.error), /"applicant.name"/);
});

test("a value of the wrong kind for its field is refused", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  for (const [values, pattern] of [
    [`{ 'applicant.agree': 'yes' }`, /is a checkbox — give it true or false/],
    [`{ 'applicant.plan': 'pro' }`, /"pro" is not one of the choices/],
    [`{ 'applicant.name': ['a'] }`, /is a text field — give it a string/],
  ] as const) {
    const run = await t.runScript(
      `import { pdf } from 'env:documents';
       export default async function main() { return pdf.fillForm('/inbox/application.pdf', ${values}); }`,
    );
    assert.equal(run.ok, false, `${values} should have been refused`);
    assert.match(String(run.error), pattern);
  }
});

test("flatten bakes the values in and leaves no fields behind", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const out = await t.script<{ form: PdfFormContents; page: string }>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.fillForm('/inbox/application.pdf', { 'applicant.name': 'Grace Hopper' }, {
         output: '/out/flat.pdf', flatten: true,
       });
       const form = await pdf.readForm('/out/flat.pdf');
       const page = await pdf.extractText('/out/flat.pdf');
       return { form, page: page.text };
     }`,
  );
  assert.deepEqual(out.form.fields, []);
  assert.match(String(out.form.note), /no form fields/);
  // The answer is still on the page — flattening keeps the ink, not the field.
  assert.match(out.page, /Grace Hopper/);
});

test("a non-Latin value needs a font, and says so before it reaches the page", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() {
       return pdf.fillForm('/inbox/application.pdf', { 'applicant.name': 'Иван Петров' }, { output: '/out/ru.pdf' });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /WinAnsi|encode/i);
});

test("with a font, a non-Latin value fills and reads back", async () => {
  const t = await env();
  await withFont(t);
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const out = await t.script<{ value: unknown; page: string }>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       const values = { 'applicant.name': 'Иван Петров' };
       await pdf.fillForm('/inbox/application.pdf', values, { output: '/out/ru.pdf', font: '/fonts/sans.ttf' });
       const form = await pdf.readForm('/out/ru.pdf');
       // Flattened, so the characters can be read back off the page itself
       // rather than out of the field dictionary that recorded them.
       await pdf.fillForm('/inbox/application.pdf', values, {
         output: '/out/ru-flat.pdf', font: '/fonts/sans.ttf', flatten: true,
       });
       const page = await pdf.extractText('/out/ru-flat.pdf');
       return { value: form.fields.find(f => f.name === 'applicant.name').value, page: page.text };
     }`,
  );
  assert.equal(out.value, "Иван Петров");
  assert.match(out.page, /Иван Петров/, "the Cyrillic value should be drawn, not transliterated");
});

test("a PDF with no form says it is not a form, rather than returning an empty list", async () => {
  const t = await env();
  const form = await t.script<PdfFormContents>(
    `import { pdf } from 'env:documents';
     export default async function main() {
       await pdf.create('/out/flat.pdf', { content: [{ text: 'just a document' }] });
       return pdf.readForm('/out/flat.pdf');
     }`,
  );
  assert.deepEqual(form.fields, []);
  assert.match(String(form.note), /no form fields/);
  assert.match(String(form.note), /printed on the page/);
});

test("fillForm with no values at all is refused", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/application.pdf", await makeAcroForm());
  const run = await t.runScript(
    `import { pdf } from 'env:documents';
     export default async function main() { return pdf.fillForm('/inbox/application.pdf', {}); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /no values/);
});
