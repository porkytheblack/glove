# glove-env-documents

Document stdlib adapter for [`glove-working-environment`](../glove-working-environment). Registers `env:documents`, backed by [pdf-lib](https://pdf-lib.js.org) and [docx](https://docx.js.org).

```bash
pnpm add glove-env-documents
# optional: PDF text extraction
pnpm add pdfjs-dist
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";

const env = await createWorkingEnvironment({ stdlib: [documents()] });
await env.mount("./contract.pdf", "/inbox/contract.pdf");
```

## One spec, two formats

`pdf.create` and `docx.create` take the same document spec, so emitting both is a second call rather than a second implementation. Text wraps and paginates on its own — nothing is placed by coordinate.

```js
import { pdf, docx } from 'env:documents';

export default async function main() {
  const spec = {
    title: 'Q3 Revenue Review',
    content: [
      { heading: 'Summary' },
      { text: 'Revenue grew 11% quarter over quarter, driven by EMEA.' },
      { bullets: ['EMEA +18%', 'AMER +4%'] },
      { table: { headers: ['Region', 'Revenue'], rows: [['EMEA', 91000], ['AMER', 51000]] } },
      { pageBreak: true },
      { image: '/tmp/chart.png', width: 420 },
    ],
  };
  await pdf.create('/out/review.pdf', spec);
  await docx.create('/out/review.docx', spec);
  return { pdf: '/out/review.pdf', docx: '/out/review.docx' };
}
```

## What it gives the model

`describe(path)` sniffs the format from the file's bytes — a PDF named `.docx` is still a PDF — and dispatches.

| | |
|---|---|
| `pdf.describe` | Pages, page sizes, metadata, encryption flag |
| `pdf.create` | Render a document spec |
| `pdf.merge` / `split` / `extractPages` | Concatenate, explode, select (`'1-3,7'` or `[1,3,7]`, 1-based) |
| `pdf.setMetadata` / `stamp` | Rewrite metadata; draw a watermark on chosen pages |
| `pdf.extractText` | Page-by-page text — **needs the optional `pdfjs-dist` peer** |
| `pdf.readForm` / `fillForm` | List an AcroForm's fields; fill them by name, optionally flattened |
| `docx.describe` | Heading outline, counts, embedded image count, short preview |
| `docx.create` | Render the same spec |
| `docx.extractText` | Full text, paragraph by paragraph — plus `kind`, so a scan is not mistaken for a blank file |
| `docx.extractImages` | Write every embedded image into a directory, bytes unchanged |
| `docx.replaceText` | **Edit** an existing .docx in place, preserving everything unmatched |

## A document that has no text to give you

Both extractors report `kind`, because a document that yields nothing is
usually not broken — it is a picture of words.

```js
const { kind, text, note } = await pdf.extractText('/inbox/contract.pdf');
if (kind !== 'text') return { blocked: note };   // note names the pages and the way forward
```

`kind` is `'text'`, `'scanned'` or `'empty'`; PDFs add `'mixed'` and report it
per page as well. `'empty'` means the pages really are blank, which is a
different problem and OCR will not help.

**A `.docx` is the one that hides it.** Word keeps no text beside a pasted
picture, so a scanned contract someone dropped into Word extracts as `''` —
byte for byte what an empty document returns. Read bare, that is
indistinguishable from a blank file, and the honest conclusion is the wrong
one:

```js
const { kind, note } = await docx.extractText('/inbox/contract.docx');
// kind: 'scanned', note: 'This document has no text to read — its 1 image is the content…'
```

`describe` counts them too — `images` is content the word count cannot see —
and a `note` appears on a document that *does* have text but carries images
beside it, because a chart pasted into a report keeps its figures in pixels.
A plain text document with no images gets no note at all.

### Getting the pixels

`docx.extractImages` writes them out, including images in headers and footers:

```js
import { docx } from 'env:documents';
import { recognize } from 'env:ocr';

const { images, note } = await docx.extractImages('/inbox/contract.docx', '/tmp/media');
for (const image of images) {
  if (image.vector) continue;                 // see below
  const { text, confidence } = await recognize(image.path);
}
```

The package's own bytes are copied rather than re-encoded — a re-encode would
cost accuracy on exactly the scans this exists to reach.

**Check `vector` before handing a path on.** Word stores a chart pasted from
Excel as EMF, so the figure you most want is the one that arrives in a format
neither `env:images` nor `env:ocr` can decode. EMF, WMF and SVG are marked,
`note` says so when it happens, and `env:render` is the way to see them.
Embedded audio and video live under `word/media/` too; those are skipped and
named in `note` rather than written out under a function called
`extractImages`.

## Editing, not regenerating

`docx.create` writes a new file. `docx.replaceText` changes one that already
exists, and the difference matters more than it sounds:

```js
await docx.replaceText('/inbox/contract.docx', { 'Northwind Traders': 'Contoso Ltd' });
// → { path, replacements: 2, parts: [{ part: 'word/document.xml', replacements: 1 },
//     { part: 'word/footer1.xml', replacements: 1 }], unmatched: [] }
```

Only the parts holding the matched text are rewritten; every other entry in the
package is copied across **still compressed**, so it cannot be changed by code
that never decoded it. Measured on a contract with a header, a bold red client
name and a logo: the edit rewrote two of 28 parts and left the other 26
byte-identical, where extracting the text and re-rendering it dropped the
header, its relationships and the image, and returned the client name as plain
text.

Text split across formatting runs is still found — runs are joined per
paragraph before matching, which is what makes a bold name inside a plain
sentence reachable — and the replacement lands in the run the match started in,
so it keeps that run's formatting. A search that matches nothing throws rather
than writing an identical file.

## Non-Latin text

`pdf.create`, `pdf.stamp` and `pdf.fillForm` take a `font` — a VFS path to a
TTF/OTF — and embed it with fontkit, subsetted to the glyphs used. Without one,
text is drawn in Helvetica and anything past Latin-1 becomes `?`.

```js
await pdf.create('/out/keiyaku.pdf', {
  font: '/fonts/NotoSansJP-Regular.ttf',
  content: [{ heading: '契約書' }, { text: '本契約は…' }],
});
```

A font with no glyph for a character in the document is **refused by name**
rather than drawing glyph 0, which every viewer shows as a blank box — a
failure that looks like success to whoever produced the file. Metadata needs no
font at all: PDF text strings are UTF-16.

## When the spec is not enough

`docx.create(path, spec)` understands six block kinds. A coloured run inside a
sentence, a table with borders and column widths, a page-numbered footer, a
landscape section, paragraph spacing — none of them are expressible in it, and
anything the spec does not name is simply not rendered.

So the `docx` library is exported too, unchanged:

```js
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'env:documents';
import { writeFile } from 'env:fs';

const doc = new Document({
  sections: [{ children: [
    new Paragraph({ text: 'Q3 Review', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [
      new TextRun({ text: 'Revenue rose ' }),
      new TextRun({ text: '18%', bold: true, color: 'C00000' }),
    ] }),
  ] }],
});
await writeFile('/out/review.docx', await Packer.toBuffer(doc));
```

`Packer.toBuffer` is the only await and the only thing that produces anything;
it hands the bytes back rather than writing them, so the write goes through
`env:fs` like any other — which is also what a coding agent does in a real
sandbox.

`docx` is unusual among the libraries wrapped here in having no root object to
call methods on: a document is *assembled* out of constructed values. That is
what a builder family is for — every constructor here records into one op
list, so a `Paragraph` can be named inside a `Document`'s arguments.

## Design notes

**PDF text extraction is delegated, not faked.** Recovering characters from glyphs is a font and CMap problem that pdf-lib does not solve, and a naive content-stream scan returns *plausible nonsense* on any subsetted font — strictly worse than refusing, because a model cannot tell the difference. So `extractText` requires `pdfjs-dist` as an optional peer and says so plainly when it is absent; everything else works without it. DOCX extraction has no such requirement: a `.docx` is a ZIP of XML, and this package reads it with `node:zlib` rather than adding a dependency to read files it just wrote.

**Unicode degrades only when no font was supplied.** pdf-lib's standard fonts are WinAnsi-encoded and throw on anything outside Latin-1 — an em dash in agent-written prose would fail an entire render — so without a `font` curly quotes, dashes and ellipses are transliterated and anything else becomes `?`. With a `font`, nothing is transliterated and a character the font cannot draw is a refusal instead: the two behaviours are opposite on purpose. A substitution is right when the alternative is failing a whole document over punctuation, and wrong when the alternative is a page of blank boxes nobody notices. DOCX keeps full Unicode either way — it names fonts rather than carrying them.

**Editing goes through the package, not through a library.** `docx` cannot read a .docx and pdf-lib cannot re-typeset a page, so "edit this file" has no library answer. `docx.replaceText` inflates only the parts it changes and copies the rest as stored bytes; the same guarded VFS handle and the same inflation cap apply, because an edit path that skipped them would be a bomb reopened in a verb nobody thinks of as a reader.

**Malformed specs fail loudly.** An unrecognised block would otherwise vanish silently, and a report missing a section costs far more to notice than a failed call. `content[3] is not a recognised block` names the index and lists the block kinds.

**Errors name the file and the capability.** `env:documents.pdf.extractPages: page 4 is out of range — the document has 1 page (pages are 1-based)`.

## License

MIT
