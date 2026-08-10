/**
 * Editing a deck that already exists.
 *
 * The claim under test is not "the typo is gone" — regenerating the deck
 * achieves that too, and loses the design doing it. It is that **nothing else
 * moved**: every part of the package is hashed before and after and the set
 * that changed is asserted exactly. A master, a theme or an image that
 * disappears is the failure this is written to catch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { slides, type DeckEdit } from "../src/index";
import { readDeck, readPartBytes, readZip, rewriteZip } from "../src/pptx";
import { normalizeRules, parseSlides, replaceInPart } from "../src/edit";

/** Inflation budget for the assertions here — larger than any fixture part. */
const BUDGET = 64 * 1024 * 1024;

/** A 1x1 PNG, so a deck fixture can embed media without an image dependency. */
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const DECK = `{
  title: 'Q3 Review',
  subtitle: 'Board copy',
  footer: 'Confidential',
  slides: [
    { title: 'Headline', metric: { value: '$4.2M', caption: 'revenue' } },
    {
      title: 'Pipeline',
      bullets: ['Nortwind renewed early', 'Contoso slipped'],
      notes: 'Nortwind closed on the 12th.',
      image: '/tmp/chart.png',
    },
  ],
}`;

async function stageDeck(): Promise<AdapterTestEnv> {
  const t = await createAdapterTestEnv(slides());
  await t.fs.writeFile("/tmp/chart.png", PNG);
  await t.script(`
    import { create } from 'env:slides';
    export default async function main() { return create(${DECK}, '/inbox/q3.pptx'); }
  `);
  return t;
}

/** Every part of a deck, by name, hashed on its uncompressed bytes. */
function partHashes(deck: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, entry] of readZip(deck)) {
    out.set(name, createHash("sha256").update(readPartBytes(deck, entry, BUDGET)).digest("hex"));
  }
  return out;
}

// ================================================ preserving what was not edited

test("a single-slide edit rewrites one part and copies every other one", async () => {
  const t = await stageDeck();
  const before = partHashes(await t.fs.readBytes("/inbox/q3.pptx"));

  const edit = await t.script<DeckEdit>(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, { slides: 3, output: '/out/q3.pptx' });
    }
  `);

  const after = partHashes(await t.fs.readBytes("/out/q3.pptx"));
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), "no part may appear or vanish");

  const changed = [...before.keys()].filter((n) => before.get(n) !== after.get(n));
  assert.deepEqual(
    changed,
    ["ppt/slides/slide3.xml"],
    `only the edited slide may change, but these did: ${changed.join(", ")}`,
  );
  assert.equal(edit.replacements, 1);
  assert.deepEqual(edit.slides, [{ slide: 3, replacements: 1 }]);
  assert.deepEqual(edit.unmatched, []);
});

test("the master, the theme and the embedded image survive the edit", async () => {
  const t = await stageDeck();
  const before = partHashes(await t.fs.readBytes("/inbox/q3.pptx"));
  await t.script(`
    import { replaceText } from 'env:slides';
    export default async function main() { return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }); }
  `);
  const bytes = await t.fs.readBytes("/inbox/q3.pptx");
  const after = partHashes(bytes);

  for (const part of [
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/theme/theme1.xml",
    "ppt/slideLayouts/slideLayout2.xml", // the footer layout the rebuild loses
    "ppt/media/image-3-1.png",
    "ppt/presentation.xml",
    "[Content_Types].xml",
  ]) {
    assert.ok(before.has(part), `fixture should contain ${part}`);
    assert.equal(after.get(part), before.get(part), `${part} must come through unchanged`);
  }
  assert.deepEqual(readDeck(bytes).media, ["ppt/media/image-3-1.png"]);
});

test("the edited deck is a valid archive the reader opens again, with the other slides intact", async () => {
  const t = await stageDeck();
  await t.script(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind renewed': 'Northwind renewed' }, { slides: 3 });
    }
  `);
  const deck = readDeck(await t.fs.readBytes("/inbox/q3.pptx"));
  assert.equal(deck.slides.length, 3);
  assert.deepEqual(deck.slides.map((s) => s.title), ["Q3 Review", "Headline", "Pipeline"]);
  assert.deepEqual(deck.slides[2].body, ["Northwind renewed early", "Contoso slipped"]);
  // The untouched slide is untouched.
  assert.deepEqual(deck.slides[1].body, ["$4.2M", "revenue"]);
});

// ================================================================== scoping

test("notes are left alone unless asked for, and edited when they are", async () => {
  const t = await stageDeck();
  const scoped = await t.script<DeckEdit>(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, { slides: 3, output: '/out/a.pptx' });
    }
  `);
  assert.equal(scoped.replacements, 1);
  assert.match(readDeck(await t.fs.readBytes("/out/a.pptx")).slides[2].notes, /Nortwind closed/);

  const withNotes = await t.script<DeckEdit>(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, { slides: 3, notes: true, output: '/out/b.pptx' });
    }
  `);
  assert.equal(withNotes.replacements, 2);
  assert.match(readDeck(await t.fs.readBytes("/out/b.pptx")).slides[2].notes, /Northwind closed/);
});

test("a slide number out of range says how many slides there are", async () => {
  const t = await stageDeck();
  const run = await t.runScript(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, { slides: 9 });
    }
  `);
  assert.equal(run.ok, false);
  assert.match(String(run.error), /slide 9 is out of range/);
  assert.match(String(run.error), /the deck has 3 slides/);
});

test("scoping to the wrong slide reports nothing found, rather than editing another", async () => {
  const t = await stageDeck();
  const run = await t.runScript(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, { slides: 2 });
    }
  `);
  assert.equal(run.ok, false);
  assert.match(String(run.error), /nothing to replace/);
  assert.match(String(run.error), /on slide 2/);
});

// ================================================================ matching

test("text split across formatting runs is still found", async () => {
  // PowerPoint starts a new run wherever formatting changes, so this bullet is
  // three <a:t> elements in the file and a per-element replace sees none of it.
  const t = await createAdapterTestEnv(slides());
  await t.script(`
    import { PptxGenJS } from 'env:slides';
    export default async function main() {
      const pptx = new PptxGenJS();
      const s = pptx.addSlide();
      s.addText([
        { text: 'Revenue grew ' },
        { text: '12%', options: { bold: true } },
        { text: ' against plan' },
      ], { x: 0.5, y: 1, w: 8 });
      return pptx.writeFile({ fileName: '/inbox/runs.pptx' });
    }
  `);
  const edit = await t.script<DeckEdit>(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/runs.pptx', { 'grew 12% against plan': 'grew 14% against plan' });
    }
  `);
  assert.equal(edit.replacements, 1);
  // The slide has one paragraph, so the reader calls it the title.
  assert.equal(readDeck(await t.fs.readBytes("/inbox/runs.pptx")).slides[0].title, "Revenue grew 14% against plan");
});

test("a search that matches nothing throws instead of writing an identical deck", async () => {
  const t = await stageDeck();
  const run = await t.runScript(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'nortwind': 'Northwind' });
    }
  `);
  assert.equal(run.ok, false);
  assert.match(String(run.error), /nothing to replace/);
  assert.match(String(run.error), /literal and case-sensitive/);
});

test("a rule that missed is named while the others still apply", async () => {
  const t = await stageDeck();
  const edit = await t.script<DeckEdit>(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind', 'Fabrikam': 'Initech' });
    }
  `);
  assert.equal(edit.replacements, 1);
  assert.deepEqual(edit.unmatched, ["Fabrikam"]);
});

test("replaceText refuses a file that is not a deck", async () => {
  const t = await createAdapterTestEnv(slides());
  await t.fs.writeFile("/inbox/notes.txt", "Nortwind");
  const run = await t.runScript(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/notes.txt', { 'Nortwind': 'Northwind' });
    }
  `);
  assert.equal(run.ok, false);
  assert.match(String(run.error), /not a PowerPoint deck/);
});

test("a slide's notes are found through its relationships, not by matching numbers", async () => {
  // `slide7.xml` ↔ `notesSlide7.xml` holds for decks this package writes and
  // for very little else: PowerPoint numbers notes parts in creation order, so
  // a deck where slide 2 got notes first has `notesSlide1.xml` on slide 2.
  // This deck has the two swapped, and the rels are the only thing that knows.
  const t = await stageDeck();
  const original = await t.fs.readBytes("/inbox/q3.pptx");
  const entries = readZip(original);
  const relsOf = (n: number) => readPartBytes(original, entries.get(`ppt/slides/_rels/slide${n}.xml.rels`)!, BUDGET);
  const swap = (xml: string, from: string, to: string) => xml.replace(`notesSlide${from}.xml`, `notesSlide${to}.xml`);

  const rels2 = new TextDecoder().decode(relsOf(2));
  const rels3 = new TextDecoder().decode(relsOf(3));
  assert.match(rels2, /notesSlide2\.xml/, "the fixture should start out following the numeric convention");
  assert.match(rels3, /notesSlide3\.xml/);

  await t.fs.writeFile(
    "/inbox/swapped.pptx",
    rewriteZip(
      original,
      new Map([
        ["ppt/slides/_rels/slide2.xml.rels", Buffer.from(swap(rels2, "2", "3"), "utf8")],
        ["ppt/slides/_rels/slide3.xml.rels", Buffer.from(swap(rels3, "3", "2"), "utf8")],
      ]),
    ),
  );

  const deck = readDeck(await t.fs.readBytes("/inbox/swapped.pptx"));
  assert.match(deck.slides[1].notes, /Nortwind closed on the 12th/, "slide 2 now points at the notes slide 3 had");
  assert.doesNotMatch(deck.slides[2].notes, /Nortwind closed/);

  // And the editor follows the same route, so scoping to a slide edits that
  // slide's notes and not a different slide's.
  const edit = await t.script<DeckEdit>(`
    import { replaceText } from 'env:slides';
    export default async function main() {
      return replaceText('/inbox/swapped.pptx', { 'Nortwind closed': 'Northwind closed' }, { slides: 2, notes: true });
    }
  `);
  assert.equal(edit.replacements, 1);
  assert.match(readDeck(await t.fs.readBytes("/inbox/swapped.pptx")).slides[1].notes, /Northwind closed/);
});

// ========================================================= the pieces, direct

test("the replacement stays in the run its match started in", () => {
  const xml =
    '<a:p><a:r><a:rPr lang="en"/><a:t>Revenue grew </a:t></a:r>' +
    '<a:r><a:rPr b="1"/><a:t>12%</a:t></a:r>' +
    "<a:r><a:t> QoQ</a:t></a:r></a:p>";
  const { xml: out, count } = replaceInPart(xml, [{ find: "12% QoQ", replace: "14% YoY" }]);
  assert.equal(count, 1);
  // The bold run keeps its properties and takes the whole replacement.
  assert.match(out, /<a:rPr b="1"\/><a:t>14% YoY<\/a:t>/);
  // The run before it is untouched; the one after is emptied, not deleted.
  assert.match(out, /<a:rPr lang="en"\/><a:t>Revenue grew <\/a:t>/);
  assert.match(out, /<a:r><a:t><\/a:t><\/a:r>/);
});

test("a match cannot cross a paragraph boundary", () => {
  const xml = "<a:p><a:r><a:t>Northwind</a:t></a:r></a:p><a:p><a:r><a:t> Traders</a:t></a:r></a:p>";
  assert.equal(replaceInPart(xml, [{ find: "Northwind Traders", replace: "Contoso" }]).count, 0);
});

test("a table cell's paragraphs are not joined to the shape's own text", () => {
  // <a:p> nests inside table cells and grouped shapes. Closing the outer
  // paragraph at the inner </a:p> would splice unrelated text together and
  // match a phrase that is nowhere on the slide.
  const xml =
    "<a:p><a:r><a:t>Nor</a:t></a:r>" +
    "<a:tbl><a:tc><a:txBody><a:p><a:r><a:t>thwind</a:t></a:r></a:p></a:txBody></a:tc></a:tbl>" +
    "<a:r><a:t> ends</a:t></a:r></a:p>";
  assert.equal(replaceInPart(xml, [{ find: "Northwind", replace: "Contoso" }]).count, 0);
});

test("XML metacharacters in a replacement are escaped", () => {
  const { xml } = replaceInPart("<a:p><a:r><a:t>A and B</a:t></a:r></a:p>", [
    { find: "and", replace: "&" },
  ]);
  assert.match(xml, /<a:t>A &amp; B<\/a:t>/);
});

test("renames do not cascade through one another", () => {
  const { xml } = replaceInPart("<a:p><a:r><a:t>Acme</a:t></a:r></a:p>", [
    { find: "Acme", replace: "Globex" },
    { find: "Globex", replace: "Initech" },
  ]);
  assert.match(xml, /<a:t>Globex<\/a:t>/);
});

test("parseSlides validates against the deck it is given", () => {
  assert.deepEqual(parseSlides(undefined, 3), [0, 1, 2]);
  assert.deepEqual(parseSlides(2, 3), [1]);
  assert.deepEqual(parseSlides([3, 1, 1], 3), [0, 2], "duplicates collapse and order is normalised");
  assert.throws(() => parseSlides(0, 3), /out of range/);
  assert.throws(() => parseSlides(1.5, 3), /whole numbers/);
  assert.throws(() => parseSlides([], 3), /selected no slides/);
});

test("normalizeRules accepts both shapes and rejects the rest", () => {
  assert.deepEqual(normalizeRules({ a: "b" }), [{ find: "a", replace: "b" }]);
  assert.deepEqual(normalizeRules([{ find: "a", replace: "b" }]), [{ find: "a", replace: "b" }]);
  assert.throws(() => normalizeRules({}), /is empty/);
  assert.throws(() => normalizeRules({ "": "x" }), /non-empty string/);
});
