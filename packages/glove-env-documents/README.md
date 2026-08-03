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
| `docx.describe` | Heading outline, counts, short preview |
| `docx.create` | Render the same spec |
| `docx.extractText` | Full text, paragraph by paragraph |

## Design notes

**PDF text extraction is delegated, not faked.** Recovering characters from glyphs is a font and CMap problem that pdf-lib does not solve, and a naive content-stream scan returns *plausible nonsense* on any subsetted font — strictly worse than refusing, because a model cannot tell the difference. So `extractText` requires `pdfjs-dist` as an optional peer and says so plainly when it is absent; everything else works without it. DOCX extraction has no such requirement: a `.docx` is a ZIP of XML, and this package reads it with `node:zlib` rather than adding a dependency to read files it just wrote.

**Unicode degrades where it must, and only there.** pdf-lib's standard fonts are WinAnsi-encoded and throw on anything outside Latin-1 — an em dash in agent-written prose would fail an entire render. Curly quotes, dashes and ellipses are transliterated to their ASCII equivalents and anything else becomes `?`. DOCX keeps full Unicode; the docs tell the model to pick that format when it matters.

**Malformed specs fail loudly.** An unrecognised block would otherwise vanish silently, and a report missing a section costs far more to notice than a failed call. `content[3] is not a recognised block` names the index and lists the block kinds.

**Errors name the file and the capability.** `env:documents.pdf.extractPages: page 4 is out of range — the document has 1 page (pages are 1-based)`.

## License

MIT
