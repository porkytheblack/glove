/**
 * The `docx` library itself, driven from inside a script.
 *
 * `docx.create(path, spec)` is our API and covers the common document;
 * everything here is what it cannot express. Each document is read back
 * through the package's own ZIP + XML path rather than through `docx`, so a
 * writer bug that is symmetric cannot hide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { documents } from "../src/index";
import { parseDocumentXml } from "../src/docx";
import { readZip, readZipText } from "../src/zip";
import { makePng } from "./png";

async function env(): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(documents());
}

/** The document part, straight out of the package — not via `docx`. */
async function documentXml(t: AdapterTestEnv, path: string): Promise<string> {
  const xml = readZipText(await t.fs.readBytes(path), "word/document.xml");
  assert.ok(xml, `${path} has no word/document.xml — it is not a Word document`);
  return xml!;
}

test("a document is assembled from constructors and written through env:fs", async () => {
  const t = await env();
  const bytes = await t.script<number>(
    `import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'env:documents';
     import { writeFile } from 'env:fs';
     export default async function main() {
       const doc = new Document({
         sections: [{
           children: [
             new Paragraph({ text: 'Q3 Revenue Review', heading: HeadingLevel.TITLE }),
             new Paragraph({
               children: [
                 new TextRun({ text: 'Revenue rose ' }),
                 new TextRun({ text: '18%', bold: true, color: 'C00000' }),
                 new TextRun({ text: ' against plan.' }),
               ],
             }),
           ],
         }],
       });
       const out = await Packer.toBuffer(doc);
       await writeFile('/out/review.docx', out);
       return out.byteLength;
     }`,
  );
  assert.ok(bytes > 0);

  const xml = await documentXml(t, "/out/review.docx");
  const { paragraphs } = parseDocumentXml(xml);
  const text = paragraphs.map((p) => p.text).filter((s) => s.trim() !== "");
  assert.deepEqual(text, ["Q3 Revenue Review", "Revenue rose 18% against plan."]);
  // The styling a spec-shaped API has no room for: a coloured, bold run
  // inside a sentence that is otherwise plain.
  assert.match(xml, /<w:color w:val="C00000"\/>/);
  assert.match(xml, /<w:b\/>/);
});

test("a nested constructor inside an argument survives the boundary", async () => {
  // The whole reason a family shares one recording. A recorder proxy has no
  // own keys, so without ref substitution the TextRun would arrive as `{}`
  // and the paragraph would come out empty — silently.
  const t = await env();
  await t.script(
    `import { Document, Packer, Paragraph, TextRun } from 'env:documents';
     import { writeFile } from 'env:fs';
     export default async function main() {
       const runs = ['alpha', 'beta', 'gamma'].map((w) => new TextRun({ text: w + ' ' }));
       const doc = new Document({ sections: [{ children: [new Paragraph({ children: runs })] }] });
       await writeFile('/out/nested.docx', await Packer.toBuffer(doc));
     }`,
  );
  const { paragraphs } = parseDocumentXml(await documentXml(t, "/out/nested.docx"));
  assert.equal(paragraphs.map((p) => p.text).join("").trim(), "alpha beta gamma");
});

test("tables, alignment and page orientation — none of which the spec API reaches", async () => {
  const t = await env();
  await t.script(
    `import {
       Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
       AlignmentType, PageOrientation, WidthType,
     } from 'env:documents';
     import { writeFile } from 'env:fs';
     export default async function main() {
       const cell = (text, bold) => new TableCell({
         children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
       });
       const doc = new Document({
         sections: [{
           properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
           children: [
             new Paragraph({ text: 'By region', alignment: AlignmentType.CENTER }),
             new Table({
               width: { size: 100, type: WidthType.PERCENTAGE },
               rows: [
                 new TableRow({ children: [cell('Region', true), cell('Revenue', true)] }),
                 new TableRow({ children: [cell('EMEA', false), cell('9,600', false)] }),
               ],
             }),
           ],
         }],
       });
       await writeFile('/out/table.docx', await Packer.toBuffer(doc));
     }`,
  );
  const xml = await documentXml(t, "/out/table.docx");
  const { paragraphs, tables } = parseDocumentXml(xml);
  assert.equal(tables, 1);
  assert.ok(paragraphs.some((p) => p.text === "EMEA"));
  assert.match(xml, /w:val="center"/);
  assert.match(xml, /w:orient="landscape"/);
});

test("an image read from the tree goes into the document as bytes", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/chart.png", makePng(60, 40));
  await t.script(
    `import { Document, Packer, Paragraph, ImageRun } from 'env:documents';
     import { readBytes, writeFile } from 'env:fs';
     export default async function main() {
       const data = await readBytes('/inbox/chart.png');
       const doc = new Document({
         sections: [{
           children: [new Paragraph({
             children: [new ImageRun({ type: 'png', data, transformation: { width: 200, height: 120 } })],
           })],
         }],
       });
       await writeFile('/out/withimage.docx', await Packer.toBuffer(doc));
     }`,
  );
  const entries = readZip(await t.fs.readBytes("/out/withimage.docx"));
  assert.ok(
    [...entries.keys()].some((name) => name.startsWith("word/media/") && !name.endsWith("/")),
    "the image should be packaged into word/media/",
  );
});

test("enums arrive as values, not as recorders", async () => {
  const t = await env();
  const seen = await t.script<{ heading: unknown; align: unknown }>(
    `import { HeadingLevel, AlignmentType } from 'env:documents';
     export default async function main() {
       return { heading: HeadingLevel.HEADING_1, align: AlignmentType.CENTER };
     }`,
  );
  assert.equal(seen.heading, "Heading1");
  assert.equal(seen.align, "center");
});

test("Packer.toBuffer given something that is not a Document says so", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Packer, Paragraph } from 'env:documents';
     export default async function main() {
       return Packer.toBuffer(new Paragraph({ text: 'not a document' }));
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /needs a Document/);
});

test("a document that is never packed produces nothing, quietly and correctly", async () => {
  const t = await env();
  await t.script(
    `import { Document, Paragraph } from 'env:documents';
     export default async function main() {
       new Document({ sections: [{ children: [new Paragraph({ text: 'x' })] }] });
       return 'built but not packed';
     }`,
  );
  assert.deepEqual(await t.fs.readdir("/out"), []);
});

test("two documents in one script do not bleed into each other", async () => {
  // Each terminal call spends its recording; the next `new` starts a fresh
  // one. Without that, the second document would inherit the first's ops.
  const t = await env();
  await t.script(
    `import { Document, Packer, Paragraph } from 'env:documents';
     import { writeFile } from 'env:fs';
     export default async function main() {
       for (const name of ['first', 'second']) {
         const doc = new Document({ sections: [{ children: [new Paragraph({ text: name })] }] });
         await writeFile('/out/' + name + '.docx', await Packer.toBuffer(doc));
       }
     }`,
  );
  const first = parseDocumentXml(await documentXml(t, "/out/first.docx"));
  const second = parseDocumentXml(await documentXml(t, "/out/second.docx"));
  const textOf = (p: { paragraphs: Array<{ text: string }> }) =>
    p.paragraphs.map((x) => x.text).filter((s) => s.trim() !== "");
  assert.deepEqual(textOf(first), ["first"]);
  assert.deepEqual(textOf(second), ["second"]);
});

test("the prototype chain is not a way out", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Paragraph } from 'env:documents';
     export default async function main() {
       const p = new Paragraph({ text: 'x' });
       return typeof p.constructor.constructor('return process')();
     }`,
  );
  assert.equal(run.ok, false);
  assert.doesNotMatch(String(run.result ?? ""), /object/);
});
