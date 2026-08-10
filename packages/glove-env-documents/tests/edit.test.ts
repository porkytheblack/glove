/**
 * Editing an existing .docx, rather than rebuilding one.
 *
 * The property under test is not "the text changed" — that is easy and a
 * regenerate cycle achieves it too. It is that **everything else did not**. So
 * these tests hash every part of the package before and after and assert on
 * the set that moved, which is the only way to catch an edit that quietly
 * costs the document its header, its logo or its styles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { documents } from "../src/index";
import type { DocxEdit, DocxText } from "../src/index";
import { readZip, readZipEntry, rewriteZip } from "../src/zip";
import { normalizeRules, replaceInPart, WORD_TAGS } from "../src/ooxml";
import { makePng } from "./png";

async function env(): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(documents());
}

/**
 * A contract with the three things a regenerate cycle loses: a header, a run
 * with its own colour and weight, and an embedded image.
 */
const CONTRACT = `
  import { Document, Packer, Paragraph, TextRun, Header, Footer, ImageRun, HeadingLevel } from 'env:documents';
  import { writeFile, readBytes } from 'env:fs';
  export default async function main() {
    const doc = new Document({ sections: [{
      headers: { default: new Header({ children: [new Paragraph({ text: 'ACME LEGAL — CONFIDENTIAL' })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ text: 'Northwind Traders engagement' })] }) },
      children: [
        new Paragraph({ text: 'Master Services Agreement', heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [
          new TextRun({ text: 'This agreement is between ' }),
          new TextRun({ text: 'Northwind Traders', bold: true, color: 'C00000' }),
          new TextRun({ text: ' and the supplier.' }),
        ] }),
        new Paragraph({ children: [new ImageRun({
          type: 'png', data: await readBytes('/tmp/logo.png'),
          transformation: { width: 40, height: 30 },
        })] }),
      ],
    }] });
    await writeFile('/inbox/contract.docx', await Packer.toBuffer(doc));
    return '/inbox/contract.docx';
  }
`;

async function stageContract(t: AdapterTestEnv): Promise<void> {
  await t.fs.writeFile("/tmp/logo.png", makePng(40, 30));
  await t.script(CONTRACT);
}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Every part of a .docx, by name, hashed on its uncompressed bytes. */
function partHashes(archive: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const entries = readZip(archive);
  for (const [name, entry] of entries) out.set(name, digest(readZipEntry(archive, entry)));
  return out;
}

function partText(archive: Uint8Array, name: string): string {
  return readZipEntry(archive, readZip(archive).get(name)!).toString("utf8");
}

// ======================================================= preserving the rest

test("a find/replace rewrites only the parts that matched, byte for byte elsewhere", async () => {
  const t = await env();
  await stageContract(t);
  const before = partHashes(await t.fs.readBytes("/inbox/contract.docx"));

  const edit = await t.script<DocxEdit>(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { 'Northwind Traders': 'Contoso Ltd' }, { output: '/out/contract.docx' });
     }`,
  );

  const after = partHashes(await t.fs.readBytes("/out/contract.docx"));

  // Nothing added, nothing dropped. The regenerate route loses four parts here.
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());

  const changed = [...before.keys()].filter((name) => before.get(name) !== after.get(name));
  assert.deepEqual(
    changed.sort(),
    ["word/document.xml", "word/footer1.xml"],
    `only the parts carrying the matched text may change, but these did: ${changed.join(", ")}`,
  );
  assert.equal(edit.replacements, 2);
  assert.deepEqual(edit.unmatched, []);
  assert.deepEqual(edit.parts, [
    { part: "word/document.xml", replacements: 1 },
    { part: "word/footer1.xml", replacements: 1 },
  ]);
});

test("the header, the styles and the embedded image survive the edit", async () => {
  const t = await env();
  await stageContract(t);
  const before = await t.fs.readBytes("/inbox/contract.docx");

  await t.script(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { 'Northwind Traders': 'Contoso Ltd' });
     }`,
  );
  const after = await t.fs.readBytes("/inbox/contract.docx");

  // The header never mentioned the client, so it must come through untouched.
  assert.match(partText(after, "word/header1.xml"), /ACME LEGAL/);
  assert.equal(digest(Buffer.from(partText(after, "word/header1.xml"))), digest(Buffer.from(partText(before, "word/header1.xml"))));

  // Styles carry the heading definitions; losing them flattens the document.
  assert.equal(partHashes(after).get("word/styles.xml"), partHashes(before).get("word/styles.xml"));

  // The logo, byte for byte. A regenerated document has no word/media at all.
  const media = [...readZip(after).keys()].filter((n) => n.startsWith("word/media/") && n.endsWith(".png"));
  assert.equal(media.length, 1, "the embedded image should still be in the package");
  assert.equal(partHashes(after).get(media[0]), partHashes(before).get(media[0]));
});

test("the replacement inherits the formatting of the run it replaced", async () => {
  // The client name is a bold, red run inside a plain sentence. A replacement
  // that lands anywhere else — a new run, or the neighbouring plain one —
  // silently restyles the document.
  const t = await env();
  await stageContract(t);
  await t.script(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { 'Northwind Traders': 'Contoso Ltd' });
     }`,
  );

  const xml = partText(await t.fs.readBytes("/inbox/contract.docx"), "word/document.xml");
  const run = /<w:r>(?:(?!<\/w:r>)[\s\S])*?Contoso Ltd[\s\S]*?<\/w:r>/.exec(xml);
  assert.ok(run, "expected a run containing the replacement");
  assert.match(run[0], /<w:b\/>/, "the replacement should still be bold");
  assert.match(run[0], /<w:color w:val="C00000"\/>/, "the replacement should still be red");
  // And the sentence around it is still one paragraph of three runs.
  assert.match(xml, /This agreement is between/);
  assert.match(xml, /and the supplier\./);
});

test("the edited file is a valid archive our own reader can open again", async () => {
  const t = await env();
  await stageContract(t);
  const back = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() {
       await docx.replaceText('/inbox/contract.docx', { 'Northwind Traders': 'Contoso Ltd' });
       return docx.extractText('/inbox/contract.docx');
     }`,
  );
  assert.deepEqual(back.paragraphs, [
    "Master Services Agreement",
    "This agreement is between Contoso Ltd and the supplier.",
  ]);
});

// ============================================================ finding things

test("text split across formatting runs is still found", async () => {
  // Word breaks a sentence at every formatting change, so the phrase below
  // spans three <w:t> elements and no per-element replace can see it.
  const t = await env();
  await stageContract(t);
  const edit = await t.script<DocxEdit>(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', {
         'between Northwind Traders and': 'between Contoso Ltd and',
       }, { parts: 'body' });
     }`,
  );
  assert.equal(edit.replacements, 1);

  const back = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.extractText('/inbox/contract.docx'); }`,
  );
  assert.match(back.text, /between Contoso Ltd and the supplier\./);
});

test("parts: 'body' leaves headers and footers alone", async () => {
  const t = await env();
  await stageContract(t);
  const edit = await t.script<DocxEdit>(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { 'Northwind Traders': 'Contoso Ltd' }, { parts: 'body' });
     }`,
  );
  assert.equal(edit.replacements, 1);
  assert.deepEqual(edit.parts.map((p) => p.part), ["word/document.xml"]);
  assert.match(partText(await t.fs.readBytes("/inbox/contract.docx"), "word/footer1.xml"), /Northwind Traders/);
});

test("a search that matches nothing throws instead of writing an identical file", async () => {
  // The expensive failure: the model asks for a rename, the case is wrong, the
  // call reports success and the document is unchanged.
  const t = await env();
  await stageContract(t);
  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { 'northwind traders': 'Contoso Ltd' });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /nothing to replace/);
  assert.match(String(run.error), /"northwind traders"/);
  assert.match(String(run.error), /literal and case-sensitive/);
});

test("a rule that missed is named while the others still apply", async () => {
  const t = await env();
  await stageContract(t);
  const edit = await t.script<DocxEdit>(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', {
         'Northwind Traders': 'Contoso Ltd',
         'Fabrikam': 'Initech',
       });
     }`,
  );
  assert.equal(edit.replacements, 2);
  assert.deepEqual(edit.unmatched, ["Fabrikam"]);
});

test("renames do not cascade through one another", async () => {
  // Applied one rule after another, the first rule's output feeds the second
  // and 'Northwind' would arrive as 'Initech'. One pass is what stops that.
  const t = await env();
  await stageContract(t);
  await t.script(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', [
         { find: 'Northwind Traders', replace: 'Contoso Ltd' },
         { find: 'Contoso Ltd', replace: 'Initech' },
       ], { parts: 'body' });
     }`,
  );
  const back = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.extractText('/inbox/contract.docx'); }`,
  );
  assert.match(back.text, /Contoso Ltd/);
  assert.doesNotMatch(back.text, /Initech/);
});

test("XML metacharacters in a replacement are escaped, not injected", async () => {
  const t = await env();
  await stageContract(t);
  await t.script(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { 'the supplier': 'Smith & Jones <Holdings>' }, { parts: 'body' });
     }`,
  );
  const bytes = await t.fs.readBytes("/inbox/contract.docx");
  const xml = partText(bytes, "word/document.xml");
  assert.match(xml, /Smith &amp; Jones &lt;Holdings&gt;/);

  const back = await t.script<DocxText>(
    `import { docx } from 'env:documents';
     export default async function main() { return docx.extractText('/inbox/contract.docx'); }`,
  );
  assert.match(back.text, /Smith & Jones <Holdings>/);
});

test("an empty search string is refused rather than spliced between every character", async () => {
  const t = await env();
  await stageContract(t);
  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/contract.docx', { '': 'x' });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /non-empty string/);
});

test("replaceText refuses a file that is not a Word document", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/notes.txt", "Northwind Traders");
  const run = await t.runScript(
    `import { docx } from 'env:documents';
     export default async function main() {
       return docx.replaceText('/inbox/notes.txt', { 'Northwind Traders': 'Contoso Ltd' });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /could not be read as a \.docx/);
});

// ======================================================== the pieces, direct

test("run splicing keeps the surrounding runs and their attributes", () => {
  const xml =
    "<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Hello </w:t></w:r>" +
    '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">wor</w:t></w:r>' +
    "<w:r><w:t>ld</w:t></w:r></w:p>";
  const { xml: out, count } = replaceInPart(xml, [{ find: "world", replace: "planet" }], WORD_TAGS);
  assert.equal(count, 1);
  // The whole replacement lands in the run the match started in — the bold one.
  assert.match(out, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">planet<\/w:t>/);
  // The italic run before it is untouched, and the trailing run is emptied.
  assert.match(out, /<w:rPr><w:i\/><\/w:rPr><w:t>Hello <\/w:t>/);
  assert.match(out, /<w:r><w:t><\/w:t><\/w:r>/);
});

test("a match cannot cross a paragraph boundary", () => {
  const xml = "<w:p><w:r><w:t>Northwind</w:t></w:r></w:p><w:p><w:r><w:t> Traders</w:t></w:r></w:p>";
  const { count } = replaceInPart(xml, [{ find: "Northwind Traders", replace: "Contoso" }], WORD_TAGS);
  assert.equal(count, 0, "joining paragraphs would let a replacement swallow the paragraph mark");
});

test("a text box's own paragraphs are not joined to the paragraph holding it", () => {
  // <w:p> nests: a text box lives inside a run and carries paragraphs. A
  // non-greedy <w:p>…</w:p> match ends the outer paragraph at the inner
  // </w:p>, which would splice "Nor" onto "thwind" across a boundary that is
  // not there and match a phrase the document does not contain.
  const xml =
    "<w:p><w:r><w:t>Nor</w:t></w:r>" +
    "<w:r><w:txbxContent><w:p><w:r><w:t>thwind</w:t></w:r></w:p></w:txbxContent></w:r>" +
    "<w:r><w:t> ends</w:t></w:r></w:p>";
  const { count } = replaceInPart(xml, [{ find: "Northwind", replace: "Contoso" }], WORD_TAGS);
  assert.equal(count, 0, "the text box's text is its own paragraph, not a continuation of the outer one");
});

test("a run left with edge whitespace gets xml:space, so Word keeps it", () => {
  // Word collapses leading and trailing whitespace in a <w:t> unless the
  // element opts out, so a replacement that puts a space at the edge of a run
  // loses it — and the two words run together in the rendered document while
  // extractText still reads them apart.
  const xml = "<w:p><w:r><w:t>Q3</w:t></w:r><w:r><w:t>review</w:t></w:r></w:p>";
  const { xml: out, count } = replaceInPart(xml, [{ find: "Q3", replace: "Q3 " }], WORD_TAGS);
  assert.equal(count, 1);
  assert.match(out, /<w:t xml:space="preserve">Q3 <\/w:t>/);

  // Interior whitespace never needed it, and the attribute is not added for it.
  const interior = replaceInPart("<w:p><w:r><w:t>a-b</w:t></w:r></w:p>", [{ find: "-", replace: " to " }], WORD_TAGS);
  assert.match(interior.xml, /<w:t>a to b<\/w:t>/);
});

test("normalizeRules accepts both shapes and rejects the rest", () => {
  assert.deepEqual(normalizeRules({ a: "b" }), [{ find: "a", replace: "b" }]);
  assert.deepEqual(normalizeRules([{ find: "a", replace: "b" }]), [{ find: "a", replace: "b" }]);
  assert.throws(() => normalizeRules({}), /is empty/);
  assert.throws(() => normalizeRules("a"), /must be/);
  assert.throws(() => normalizeRules({ a: 1 as unknown as string }), /must be a string/);
});

test("rewriteZip refuses to invent an entry that was not in the archive", async () => {
  const t = await env();
  await stageContract(t);
  const bytes = await t.fs.readBytes("/inbox/contract.docx");
  assert.throws(
    () => rewriteZip(bytes, new Map([["word/nothere.xml", Buffer.from("<x/>")]])),
    /no such entry/,
  );
});
