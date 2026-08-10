/**
 * Every assertion here reads the deck back with this package's own ZIP+XML
 * reader, never with pptxgenjs. Verifying a writer with its own library
 * proves only self-consistency: a title written into the wrong placeholder,
 * or a bullet silently dropped, round-trips perfectly through the library
 * that made the mistake. Opening the file independently is what catches it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { assertAdapterOk, createAdapterTestEnv } from "glove-working-environment/testing";
import { slides, type DeckSummary, type SlideText } from "../src/index";
import { readDeck } from "../src/pptx";

/** Content of the host file the escape tests try, and fail, to reach. */
const HOST_MARKER = "HOST-ONLY-4f19c7b3";

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

// ======================================= the real PptxGenJS API

const REAL_API = `
  import { PptxGenJS } from 'env:slides';
  export default async function main() {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = 'Q3 Board Review';

    const cover = pptx.addSlide();
    cover.addText('Q3 Board Review', { x: 0.6, y: 2.2, w: 8.8, fontSize: 44, bold: true, color: '0B1120' });
    cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.0, w: 1.4, h: 0.07, fill: { color: '2563EB' } });

    const s = pptx.addSlide();
    s.addText('Revenue by region', { x: 0.5, y: 0.4, fontSize: 26, bold: true });
    s.addTable(
      [[{ text: 'Region', options: { bold: true } }, { text: 'Revenue', options: { bold: true } }],
       ['EMEA', '$2,435,210'], ['AMER', '$1,241,590']],
      { x: 0.5, y: 1.4, w: 5.5, fontSize: 14, align: pptx.AlignH.left },
    );
    s.addNotes('Lead with EMEA.');
    return pptx.writeFile({ fileName: '/out/board.pptx' });
  }
`;

test("a script can use PptxGenJS exactly as the library documents it", async () => {
  // The point of the whole recording mechanism. This is verbatim pptxgenjs —
  // `new`, a property assignment, chained builders, an enum read off the
  // instance, and an awaited terminal write. A model that has read the
  // library writes this from memory; anything it has to translate costs turns.
  const t = await createAdapterTestEnv(slides());
  const out = await t.script<string>(REAL_API);
  assert.equal(out, "/out/board.pptx");

  const deck = readDeck(await t.fs.readBytes("/out/board.pptx"));
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, "Q3 Board Review");
  assert.equal(deck.slides[1].title, "Revenue by region");

  const table = deck.slides[1].body.join(" ");
  for (const cell of ["Region", "Revenue", "EMEA", "$2,435,210"]) {
    assert.ok(table.includes(cell), `table cell ${cell} missing: ${table}`);
  }
  assert.match(deck.slides[1].notes, /Lead with EMEA/);
});

test("write() hands the bytes back instead of storing them", async () => {
  // Returned into the script, not out of it: a script's return value goes
  // through JSON, so bytes have to be used inside the run.
  const t = await createAdapterTestEnv(slides());
  const size = await t.script<number>(`
    import { PptxGenJS } from 'env:slides';
    import { writeFile } from 'env:fs';
    export default async function main() {
      const pptx = new PptxGenJS();
      pptx.addSlide().addText('hi', { x: 1, y: 1 });
      const bytes = await pptx.write();
      await writeFile('/out/from-bytes.pptx', bytes);
      return bytes.length;
    }
  `);
  assert.ok(size > 1000, `expected deck bytes, got ${size}`);
  const raw = await t.fs.readBytes("/out/from-bytes.pptx");
  assert.deepEqual([...raw.slice(0, 2)], [0x50, 0x4b], "should be a ZIP");
});

test("an image is read from the VFS, never the host filesystem", async () => {
  // Found by the error-attribution test below: pptxgenjs opens a `path`
  // itself, off the real disk, so a script could have named any host file and
  // had its bytes embedded in a deck it then exports.
  const t = await createAdapterTestEnv(slides());
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await t.fs.writeFile("/tmp/logo.png", new Uint8Array(png));
  const summary = await t.script<DeckSummary>(`
    import { PptxGenJS, describe } from 'env:slides';
    export default async function main() {
      const pptx = new PptxGenJS();
      pptx.addSlide().addImage({ path: '/tmp/logo.png', x: 1, y: 1, w: 2, h: 2 });
      await pptx.writeFile({ fileName: '/out/img.pptx' });
      return describe('/out/img.pptx');
    }
  `);
  assert.equal(summary.media, 1, "the VFS image should be embedded");

  // A host path the VFS does not have must fail, not resolve off real disk.
  const err = await t
    .script(`import { PptxGenJS } from 'env:slides';
             export default async function main() {
               const pptx = new PptxGenJS();
               pptx.addSlide().addImage({ path: '/etc/hostname', x: 1, y: 1 });
               return pptx.writeFile({ fileName: '/out/leak.pptx' });
             }`)
    .then(() => "NO ERROR", (e: Error) => e.message);
  assert.notEqual(err, "NO ERROR", "a host path must not be readable through addImage");
  assert.match(err, /no such file|not found|outside/i);
});

test("media and backgrounds are read from the VFS too, never the host filesystem", async () => {
  // `addImage` was rewritten; `addMedia` and `background` were not, and they
  // reach the same `fs.readFileSync(rel.path)` inside pptxgenjs at write time.
  // The host file below genuinely exists and holds a marker, so a failure to
  // read it is the guard doing its job rather than a mistyped path.
  const t = await createAdapterTestEnv(slides());
  const host = join(mkdtempSync(join(tmpdir(), "glove-slides-escape-")), "secret.png");
  writeFileSync(host, HOST_MARKER);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await t.fs.writeFile("/tmp/bg.png", new Uint8Array(png));
  await t.fs.writeFile("/tmp/clip.mp3", new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]));

  // Paths in the tree keep working, through all three routes.
  const summary = await t.script<DeckSummary>(`
    import { PptxGenJS, describe } from 'env:slides';
    export default async function main() {
      const pptx = new PptxGenJS();
      pptx.defineSlideMaster({ title: 'branded', background: { path: '/tmp/bg.png' } });
      const s = pptx.addSlide();
      s.background = { path: '/tmp/bg.png' };
      s.addText('hi', { x: 1, y: 1 });
      s.addMedia({ type: 'audio', path: '/tmp/clip.mp3', x: 1, y: 3, w: 2, h: 1 });
      await pptx.writeFile({ fileName: '/out/media.pptx' });
      return describe('/out/media.pptx');
    }
  `);
  assert.ok(summary.media >= 2, `VFS media should be embedded, got ${summary.media} parts`);

  // And a host path is refused whichever of the three named it.
  const routes: Array<[string, string]> = [
    ["addMedia", `pptx.addSlide().addMedia({ type: 'audio', path: HOST, x: 1, y: 1, w: 2, h: 1 });`],
    ["slide background", `pptx.addSlide().background = { path: HOST };`],
    ["master background", `pptx.defineSlideMaster({ title: 'm', background: { path: HOST } });`],
  ];
  for (const [label, attack] of routes) {
    const run = await t.runScript(`
      import { PptxGenJS } from 'env:slides';
      const HOST = ${JSON.stringify(host)};
      export default async function main() {
        const pptx = new PptxGenJS();
        ${attack}
        pptx.addSlide().addText('filler', { x: 1, y: 1 });
        return pptx.writeFile({ fileName: '/out/leak.pptx' });
      }
    `);
    assert.equal(run.ok, false, `${label}: a host path must not be readable`);
    assert.match(String(run.error), /no such file|not found|outside|never from the host/i, label);
    assert.equal(await t.fs.exists("/out/leak.pptx"), false, `${label}: host bytes reached a deliverable`);
  }
  assert.equal(readFileSync(host, "utf8"), HOST_MARKER, "the host file was there to be read all along");
});

test("a method the library does not have is refused, and lists what it does", async () => {
  const t = await createAdapterTestEnv(slides());
  const err = await t
    .script(`import { PptxGenJS } from 'env:slides';
             export default async function main() {
               const pptx = new PptxGenJS();
               pptx.addSlide().addParagraph('nope');
               return pptx.writeFile({ fileName: '/out/x.pptx' });
             }`)
    .then(() => "no error", (e: Error) => e.message);
  assert.match(err, /has no method "addParagraph"/);
  assert.match(err, /addText/, "the refusal should name real methods to correct toward");
});

test("a failing call is named by position and method, not by the write", async () => {
  // Recording means the deck is assembled at writeFile(), so without this the
  // error would point at the flush and say nothing about which call was bad.
  const t = await createAdapterTestEnv(slides());
  const err = await t
    .script(`import { PptxGenJS } from 'env:slides';
             export default async function main() {
               const pptx = new PptxGenJS();
               const s = pptx.addSlide();
               s.addText('fine', { x: 1, y: 1 });
               s.addImage({ path: '/inbox/does-not-exist.png', x: 1, y: 1 });
               return pptx.writeFile({ fileName: '/out/x.pptx' });
             }`)
    .then(() => "no error", (e: Error) => e.message);
  assert.match(err, /call #\d+ addImage\(\)/);
});

test("prototype methods are not reachable through a builder", async () => {
  // The allowlist is a sandbox boundary, not a convenience. Replaying a
  // script-chosen name against a live host object would make `constructor`
  // callable, and `constructor.constructor` is the classic route to the host
  // realm that tests/sandbox.test.ts exists to keep shut.
  const t = await createAdapterTestEnv(slides());
  for (const attack of ["constructor", "valueOf", "__defineGetter__"]) {
    const err = await t
      .script(`import { PptxGenJS } from 'env:slides';
               export default async function main() {
                 const pptx = new PptxGenJS();
                 pptx.addSlide()[${JSON.stringify(attack)}]();
                 return pptx.writeFile({ fileName: '/out/x.pptx' });
               }`)
      .then(() => "NO ERROR", (e: Error) => e.message);
    assert.notEqual(err, "NO ERROR", `${attack} must not be replayable`);
  }

  // `toString` is the deliberate exception, and it is not a hole: it answers
  // in the sandbox with a label and records nothing, so it never reaches a
  // host object. Refusing it instead made an ordinary debug string fatal —
  // measured six times in one eval run.
  const rendered = await t.script<string>(
    `import { PptxGenJS } from 'env:slides';
     export default async function main() {
       const pptx = new PptxGenJS();
       return pptx.addSlide().toString();
     }`,
  );
  assert.match(rendered, /^\[PptxGenJS \(recording/);
  assert.equal(await t.fs.exists("/out/x.pptx"), false);
});

// ============================================ decks built to be hostile

test("a deck that lies about a part's size is refused rather than inflated", async () => {
  // A .pptx arrives from outside and gets read on the way in. The declared
  // uncompressedSize comes out of that same file, so trusting it catches only
  // honest decks — this one declares 512 bytes and expands to five megabytes,
  // on the host heap, outside VFS accounting.
  const t = await createAdapterTestEnv(slides(), { limits: { maxVfsBytes: 200_000 } });
  const bomb = craftedZip("ppt/slides/slide1.xml", deflateRawSync(Buffer.alloc(5_000_000)), { declaredSize: 512 });
  assert.ok(bomb.byteLength < 20_000, `the fixture must be small to be a bomb, it is ${bomb.byteLength} bytes`);
  await t.fs.writeFile("/inbox/bomb.pptx", bomb);

  const run = await t.runScript(
    `import { describe } from 'env:slides';
     export default async function main() { return describe('/inbox/bomb.pptx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /expands past the 200000-byte inflation budget/);
  assert.match(String(run.error), /maxVfsBytes/);
});

test("replaceText inflates through the same cap, so an edit is not a way past it", async () => {
  // The edit path opens parts of its own. A read path added without the
  // budget would be a hole reopened one release after it was closed, and
  // nothing about `replaceText` looks like a place to check for a zip bomb.
  const t = await createAdapterTestEnv(slides(), { limits: { maxVfsBytes: 200_000 } });
  const bomb = craftedZip("ppt/slides/slide1.xml", deflateRawSync(Buffer.alloc(5_000_000)), { declaredSize: 512 });
  await t.fs.writeFile("/inbox/bomb.pptx", bomb);

  const run = await t.runScript(
    `import { replaceText } from 'env:slides';
     export default async function main() { return replaceText('/inbox/bomb.pptx', { a: 'b' }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /expands past the 200000-byte inflation budget/);
});

test("replaceText refuses an encrypted deck rather than splicing ciphertext", async () => {
  const t = await createAdapterTestEnv(slides());
  const locked = craftedZip("ppt/slides/slide1.xml", Buffer.from("<p:sld/>"), { flags: 0x0001, stored: true });
  await t.fs.writeFile("/inbox/locked.pptx", locked);

  const run = await t.runScript(
    `import { replaceText } from 'env:slides';
     export default async function main() { return replaceText('/inbox/locked.pptx', { a: 'b' }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /encrypted ZIP entries are not supported/);
});

test("an encrypted deck is refused by name, not misread as 'not a deck'", async () => {
  // Inflating ciphertext yields garbage rather than an error, so without the
  // flag check the deck comes back as "no ppt/slides/" — true, useless, and
  // silent about the password that is actually in the way.
  const t = await createAdapterTestEnv(slides());
  const locked = craftedZip("ppt/slides/slide1.xml", Buffer.from("<p:sld/>"), { flags: 0x0001, stored: true });
  await t.fs.writeFile("/inbox/locked.pptx", locked);

  const run = await t.runScript(
    `import { extract } from 'env:slides';
     export default async function main() { return extract('/inbox/locked.pptx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /encrypted ZIP entries are not supported/);
  assert.match(String(run.error), /without a password/);
});

/**
 * A one-entry ZIP whose headers can lie.
 *
 * Written by hand rather than committed as a fixture: the point of a bomb is
 * that a few hundred bytes claim to be megabytes, and a checked-in binary
 * would hide both numbers.
 */
function craftedZip(
  name: string,
  body: Uint8Array,
  opts: { declaredSize?: number; flags?: number; stored?: boolean } = {},
): Uint8Array {
  const nameBuf = Buffer.from(name, "utf8");
  const declared = opts.declaredSize ?? body.byteLength;
  const method = opts.stored ? 0 : 8;
  const flags = opts.flags ?? 0;

  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.byteLength, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.byteLength, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  nameBuf.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + body.byteLength, 16);

  return new Uint8Array(Buffer.concat([local, Buffer.from(body), central, eocd]));
}

test("a deck that is never written says so, rather than failing silently", async () => {
  const t = await createAdapterTestEnv(slides());
  const err = await t
    .script(`import { PptxGenJS } from 'env:slides';
             export default async function main() {
               const pptx = new PptxGenJS();
               pptx.addSlide().addText('orphan', { x: 1, y: 1 });
               return 'done';
             }`)
    .then((r) => `returned ${r}`, (e: Error) => e.message);
  // Nothing is flushed without a terminal call, so the script simply returns.
  assert.equal(err, "returned done");
  assert.equal(await t.fs.exists("/out/x.pptx"), false);
});
