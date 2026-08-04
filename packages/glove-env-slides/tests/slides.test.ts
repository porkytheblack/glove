/**
 * Every assertion here reads the deck back with this package's own ZIP+XML
 * reader, never with pptxgenjs. Verifying a writer with its own library
 * proves only self-consistency: a title written into the wrong placeholder,
 * or a bullet silently dropped, round-trips perfectly through the library
 * that made the mistake. Opening the file independently is what catches it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAdapterOk, createAdapterTestEnv } from "glove-working-environment/testing";
import { slides, type DeckSummary, type SlideText } from "../src/index";
import { readDeck } from "../src/pptx";

const deckSpec = `{
  title: 'Q3 Review',
  subtitle: 'Prepared for the board',
  footer: 'Confidential',
  slides: [
    { title: 'Headline', metric: { value: '$4.2M', caption: 'revenue, up 12% QoQ' } },
    { title: 'By region', table: [['Region', 'Revenue'], ['EMEA', '$1.8M'], ['AMER', '$2.4M']] },
    {
      title: 'What changed',
      bullets: ['EMEA renewals landed early', '  two slipped from Q2', 'AMER added 14 logos'],
      notes: 'Mention the Q2 slip explicitly.',
    },
  ],
}`;

test("the adapter passes its own audit", async () => {
  const t = await createAdapterTestEnv(slides());
  assertAdapterOk(await t.audit());
});

test("a deck round-trips: titles, bullets, table cells and notes all survive", async () => {
  const t = await createAdapterTestEnv(slides());
  const out = await t.script<string>(`
    import { create } from 'env:slides';
    export default async function main() { return create(${deckSpec}, '/out/q3.pptx'); }
  `);
  assert.equal(out, "/out/q3.pptx");

  // Independent read: straight from the bytes, not through the adapter.
  const deck = readDeck(await t.fs.readBytes("/out/q3.pptx"));

  // Cover slide, then one per spec entry.
  assert.equal(deck.slides.length, 4);
  assert.equal(deck.slides[0].title, "Q3 Review");
  assert.deepEqual(
    deck.slides.slice(1).map((s) => s.title),
    ["Headline", "By region", "What changed"],
  );

  const metric = deck.slides[1].body.join(" ");
  assert.match(metric, /\$4\.2M/);
  assert.match(metric, /up 12% QoQ/);

  const region = deck.slides[2].body.join(" ");
  for (const cell of ["Region", "Revenue", "EMEA", "$1.8M", "AMER", "$2.4M"]) {
    assert.ok(region.includes(cell), `table cell ${cell} did not survive the round trip: ${region}`);
  }

  const changed = deck.slides[3];
  assert.deepEqual(changed.body, ["EMEA renewals landed early", "two slipped from Q2", "AMER added 14 logos"]);
  assert.match(changed.notes, /Mention the Q2 slip/);
});

test("describe answers the outline question without reading the deck", async () => {
  const t = await createAdapterTestEnv(slides());
  const summary = await t.script<DeckSummary>(`
    import { create, describe } from 'env:slides';
    export default async function main() {
      await create(${deckSpec}, '/out/q3.pptx');
      return describe('/out/q3.pptx');
    }
  `);

  assert.equal(summary.format, "pptx");
  assert.equal(summary.slides, 4);
  assert.deepEqual(summary.titles, ["Q3 Review", "Headline", "By region", "What changed"]);
  assert.ok(summary.bytes > 1000, "a real deck is not a few hundred bytes");
  assert.ok(summary.words > 20, `expected a word count, got ${summary.words}`);
  assert.equal(summary.media, 0);
});

test("a bullet split across formatting runs comes back as one line, not three", async () => {
  // PowerPoint splits a visual line into several <a:t> runs wherever
  // formatting changes. Joining on run boundaries instead of paragraph
  // boundaries turns one bullet into three, and every count assertion
  // downstream is then wrong.
  const t = await createAdapterTestEnv(slides());
  await t.script(`
    import { create } from 'env:slides';
    export default async function main() {
      return create({
        title: 'Runs',
        slides: [{ title: 'One', bullets: ['Revenue grew 12% against a 4% plan'] }],
      }, '/out/runs.pptx');
    }
  `);
  const deck = readDeck(await t.fs.readBytes("/out/runs.pptx"));
  assert.deepEqual(deck.slides[1].body, ["Revenue grew 12% against a 4% plan"]);
});

test("outline flattens a deck into something greppable", async () => {
  const t = await createAdapterTestEnv(slides());
  const text = await t.script<string>(`
    import { create, outline } from 'env:slides';
    export default async function main() {
      await create(${deckSpec}, '/out/q3.pptx');
      return outline('/out/q3.pptx');
    }
  `);
  assert.match(text, /## Slide 3: By region/);
  assert.match(text, /## Slide 4: What changed/);
  assert.match(text, /> notes: Mention the Q2 slip/);
});

test("extract reads a deck the environment did not write", async () => {
  // The case that matters for review work: bytes arrive from outside and the
  // adapter has no memory of building them.
  const t = await createAdapterTestEnv(slides());
  await t.script(`
    import { create } from 'env:slides';
    export default async function main() { return create(${deckSpec}, '/tmp/source.pptx'); }
  `);
  const bytes = await t.fs.readBytes("/tmp/source.pptx");

  const fresh = await createAdapterTestEnv(slides());
  await fresh.fs.writeFile("/inbox/mystery.pptx", bytes);
  const extracted = await fresh.script<SlideText[]>(`
    import { extract } from 'env:slides';
    export default async function main() { return extract('/inbox/mystery.pptx'); }
  `);
  assert.equal(extracted.length, 4);
  assert.equal(extracted[3].title, "What changed");
  assert.match(extracted[3].notes, /Q2 slip/);
});

test("an image generated in the VFS can be placed on a slide", async () => {
  const t = await createAdapterTestEnv(slides());
  // A 1x1 PNG, written as bytes — no image adapter needed for the wiring test.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await t.fs.writeFile("/tmp/chart.png", new Uint8Array(png));
  const summary = await t.script<DeckSummary>(`
    import { create, describe } from 'env:slides';
    export default async function main() {
      await create({
        title: 'With art',
        slides: [{ title: 'Chart', bullets: ['see right'], image: '/tmp/chart.png' }],
      }, '/out/art.pptx');
      return describe('/out/art.pptx');
    }
  `);
  assert.equal(summary.media, 1, "the embedded image should appear as a media part");
});

test("a table longer than a slide continues onto more slides", async () => {
  // The silent-breakage case. Without auto-paging, all 40 rows are drawn on
  // one slide with most of them past the bottom edge — and because the text
  // is still in the file, `extract()` finds every row and nothing looks wrong
  // until someone opens the deck. An unreadable deliverable that passes every
  // text assertion is the worst outcome available.
  const t = await createAdapterTestEnv(slides());
  const rows = Array.from({ length: 40 }, (_, i) => `['Row ${i + 1}', '$${i}00']`).join(",");
  await t.script(`
    import { create } from 'env:slides';
    export default async function main() {
      return create({ title: 'T', slides: [{ title: 'Big', table: [['A', 'B'], ${rows}] }] }, '/out/big.pptx');
    }
  `);

  const deck = readDeck(await t.fs.readBytes("/out/big.pptx"));
  assert.ok(deck.slides.length > 2, `a 40-row table must not fit on one slide, got ${deck.slides.length} slides`);

  // Nothing may be dropped on the way.
  const seen = new Set(deck.slides.flatMap((s) => s.body).filter((b) => /^Row \d+$/.test(b)));
  assert.equal(seen.size, 40, `expected all 40 rows across the slides, found ${seen.size}`);

  // And no single slide may be overfull, which is the thing being fixed.
  for (const s of deck.slides) {
    const n = s.body.filter((b) => /^Row \d+$/.test(b)).length;
    assert.ok(n <= 20, `slide ${s.slide} carries ${n} rows — that will run off the page`);
  }
});

test("the output is a structurally valid OOXML package", async () => {
  // Everything else here reads the deck with this package's own parser, which
  // proves the two agree — not that PowerPoint would open the file. This
  // checks the parts the OOXML spec requires, using the system unzip rather
  // than either of our readers, so a deck that only our code can open fails.
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const t = await createAdapterTestEnv(slides());
  await t.script(`
    import { create } from 'env:slides';
    export default async function main() { return create(${deckSpec}, '/out/q3.pptx'); }
  `);

  const file = join(mkdtempSync(join(tmpdir(), "glove-slides-")), "q3.pptx");
  writeFileSync(file, Buffer.from(await t.fs.readBytes("/out/q3.pptx")));

  // Non-zero exit means a corrupt archive; this is the CRC check, not a parse.
  execFileSync("unzip", ["-t", file], { stdio: "pipe" });

  const listing = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" });
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/slides/slide1.xml",
    "ppt/slides/_rels/slide1.xml.rels",
  ]) {
    assert.ok(listing.split("\n").includes(part), `missing required OOXML part ${part}:\n${listing}`);
  }
});

test("a malformed spec fails with a sentence, not a library stack trace", async () => {
  const t = await createAdapterTestEnv(slides());
  const cases: Array<[string, RegExp]> = [
    [`{ title: 'x', slides: [] }`, /non-empty `slides`/],
    [`{ slides: [{ title: 'a' }] }`, /non-empty `title`/],
    [`{ title: 'x', slides: [{ bullets: ['a'] }] }`, /slides\[0\] needs a non-empty `title`/],
    [`{ title: 'x', slides: [{ title: 'a', table: 'nope' }] }`, /table must be an array of rows/],
  ];
  for (const [spec, pattern] of cases) {
    const err = await t
      .script(`import { create } from 'env:slides';
               export default async function main() { return create(${spec}, '/out/bad.pptx'); }`)
      .then(() => "no error", (e: Error) => e.message);
    assert.match(err, pattern, `spec ${spec}`);
    assert.match(err, /env:slides\.create/, "the failing capability should be named");
  }
});

test("a non-deck file is refused by name, not by a parser crash", async () => {
  const t = await createAdapterTestEnv(slides());
  await t.fs.writeFile("/inbox/notes.txt", "this is plainly not a deck");
  const err = await t
    .script(`import { describe } from 'env:slides';
             export default async function main() { return describe('/inbox/notes.txt'); }`)
    .then(() => "no error", (e: Error) => e.message);
  assert.match(err, /not a PowerPoint deck/);
  assert.match(err, /ZIP/);
});

test("a ZIP that is not a deck says which kind of Office file it might be", async () => {
  // .docx and .xlsx are ZIPs too, and this is the mistake worth catching by
  // name — the extension claimed pptx and the container says otherwise.
  const t = await createAdapterTestEnv(slides());
  // Minimal empty ZIP: an end-of-central-directory record and nothing else.
  const empty = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0)]);
  const eocd = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
  const merged = new Uint8Array(empty.length + eocd.length);
  merged.set(empty);
  merged.set(eocd, empty.length);
  await t.fs.writeFile("/inbox/fake.pptx", merged);
  const err = await t
    .script(`import { describe } from 'env:slides';
             export default async function main() { return describe('/inbox/fake.pptx'); }`)
    .then(() => "no error", (e: Error) => e.message);
  assert.match(err, /not a PowerPoint deck|ppt\/slides/);
});
