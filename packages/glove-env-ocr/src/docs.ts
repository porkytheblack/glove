/** Materialized at `/std/ocr/index.d.ts` and `/std/ocr/README.md`. */

export const OCR_TYPES = `/** env:ocr — text off a scanned PDF or a photo of a document. Offline. */

export interface OcrPage {
  /** 1-based page in the source document. Always 1 for an image. */
  page: number;
  text: string;
  /** Tesseract's mean word confidence for this page, 0-100. 0 when it read nothing. */
  confidence: number;
  words: number;
  /**
   * Set when this PDF page already had a real text layer, so OCR was the wrong
   * tool for it — documents.extractText will do better on that page.
   */
  textLayer?: boolean;
}

export interface OcrResult {
  path: string;
  source: "pdf" | "image";
  /** The tessdata language actually used. */
  language: string;
  /** Every page joined by \\n\\f\\n — the same convention documents.extractText uses. */
  text: string;
  characters: number;
  pages: OcrPage[];
  /** Pages in the source document, even if fewer were read. */
  totalPages: number;
  /** Mean confidence across the pages that produced text, 0-100. */
  confidence: number;
  /**
   * Present when the result needs reading with suspicion, saying why: low
   * confidence, a blank page, a page that did not need OCR at all. Surface it;
   * OCR text looks exactly like real text and nothing else warns you.
   */
  note?: string;
}

export interface OcrSummary {
  path: string;
  format: "pdf" | "image";
  bytes: number;
  totalPages: number;
  /** 1-based PDF pages that already carry a text layer — OCR is wrong for these. */
  textLayerPages: number[];
  /** True when at least one page actually needs OCR. */
  needsOcr: boolean;
  /** Languages this host can run right now. */
  languages: string[];
}

export interface RecognizeOptions {
  /** Which pages of a PDF, 1-based. "all" for the whole document. Default "all". */
  pages?: number[] | "all";
  /** tessdata language code. Default "eng", the only one bundled. */
  lang?: string;
  /** Rasterisation scale for PDF pages. Default 3 (~216 dpi). Ignored for images. */
  scale?: number;
}

/**
 * Should this be OCR'd, and can it be? Runs no recognition, so it is the cheap
 * call to make first — on a PDF it reports which pages already have text.
 */
export function describe(path: string): Promise<OcrSummary>;

/**
 * Read the text off a scan.
 *
 *   const out = await recognize('/inbox/contract.pdf');
 *   if (out.note) console.log(out.note);
 *   const total = /Total:\\s*([\\d,.]+)/.exec(out.text)?.[1];
 *
 * PDF pages are rasterised first (through the same renderer env:render uses)
 * and read one at a time; images go straight in. Every page carries its own
 * confidence, so you can tell a clean scan from a photograph taken at an angle.
 *
 * Costs roughly a second a page. Pass \`pages\` when you only need some:
 *
 *   await recognize('/inbox/contract.pdf', { pages: [1, 2] });
 */
export function recognize(path: string, opts?: RecognizeOptions): Promise<OcrResult>;

/**
 * The tessdata languages this host can actually run. English is bundled and
 * always present; anything else is here only if the host installed its data.
 */
export function languages(): Promise<string[]>;
`;

export const OCR_DOCS = `# env:ocr

Text off a **scanned** PDF or a **photo** of a document. Tesseract, compiled to
WASM, bundled — no network call, no host wiring, no system package.

Reach for it exactly when there is no text layer to read. \`documents.extractText\`
is better in every case where it works.

## The whole flow

\`\`\`js
import { describe, recognize } from 'env:ocr';
import { pdf } from 'env:documents';

/** Pulls the total off a scanned invoice. */
export default async function main() {
  // Cheap: no recognition runs, and it tells you whether you need any.
  const summary = await describe('/inbox/invoice.pdf');
  if (!summary.needsOcr) {
    const real = await pdf.extractText('/inbox/invoice.pdf');
    return { via: 'text layer', text: real.text };
  }

  const out = await recognize('/inbox/invoice.pdf', { pages: [1] });
  const total = /total[^\\d]{0,12}([\\d.,]+)/i.exec(out.text)?.[1];
  return { via: 'ocr', total, confidence: out.confidence, note: out.note };
}
\`\`\`

## Read the confidence, always

OCR output is indistinguishable from real text right up until a digit is wrong.
\`confidence\` is Tesseract's own mean word score for the page, 0–100:

| confidence | what it means |
|---|---|
| 90+ | a clean scan; trust the words, still re-read the digits |
| 70–90 | usable prose, individual characters unreliable |
| under 65 | \`note\` is set. Do not quote numbers from this without looking at the page |
| 0 | nothing was read at all — see \`note\` for why |

\`view_image\` on the rendered page is the check that settles it. \`env:render\`
gives you the PNG:

\`\`\`js
import { render } from 'env:render';
export default async function main() {
  const shot = await render('/inbox/invoice.pdf', '/tmp/look', { pages: [1] });
  return shot.pages[0].path;  // then: view_image
}
\`\`\`

## A photo rather than a scan

\`\`\`js
import { recognize } from 'env:ocr';

export default async function main() {
  const out = await recognize('/inbox/receipt.jpg');
  return { text: out.text, confidence: out.confidence, note: out.note };
}
\`\`\`

Resolution is what decides the result. Tesseract wants roughly 300 dpi —
about 2500 pixels across an A4 page. A 600-pixel-wide screenshot of a table
will read badly and the \`note\` will say so.

## Languages

English is bundled. Others are here only if the host installed the matching
data package, and asking is one call:

\`\`\`js
import { languages, recognize } from 'env:ocr';

export default async function main() {
  const have = await languages();          // e.g. ['eng']
  if (!have.includes('deu')) return { skipped: 'no German data on this host', have };
  return recognize('/inbox/rechnung.pdf', { lang: 'deu' });
}
\`\`\`

Asking for a language that is not installed fails with the package name to
install. Nothing is ever downloaded at run time — that is the point of the
adapter, not an oversight.

## What it refuses

- **Anything that is not a PDF or an image.** A \`.docx\` or a \`.pptx\` already
  has real text in it; read it with \`env:documents\` or \`env:slides\`.
- **A language with no data on this host**, by name, rather than reaching for
  a CDN that is not reachable.
- More than 20 pages in one call — OCR costs about a second a page, so this is
  a budget. Ask again for the rest.

And one thing it does *not* refuse but does flag: OCR of a page that already
has a text layer. It runs, and \`note\` tells you it was a downgrade.
`;

export const SCAN_SKILL = `# Reading a scan

A scanned document is the one artifact where the obvious tool gives you nothing
and says so. This is the order that works.

## 1. Ask what you actually have

\`\`\`js
import { pdf } from 'env:documents';
const out = await pdf.extractText('/inbox/doc.pdf');
out.kind    // 'text' | 'scanned' | 'empty' | 'mixed'
\`\`\`

\`text\` — you are done, the text is real and exact. Stop here.
\`empty\` — the pages are blank. OCR will not change that.
\`scanned\` or \`mixed\` — there is no text layer. Continue.

If \`env:documents\` is not registered, \`ocr.describe(path)\` answers the same
question: \`needsOcr\` and \`textLayerPages\`.

## 2. OCR only the pages that need it

\`\`\`js
import { describe, recognize } from 'env:ocr';

const summary = await describe('/inbox/doc.pdf');
const scanned = [];
for (let p = 1; p <= summary.totalPages; p++) {
  if (!summary.textLayerPages.includes(p)) scanned.push(p);
}
const out = await recognize('/inbox/doc.pdf', { pages: scanned.slice(0, 20) });
\`\`\`

A page with a text layer should be read with \`documents.extractText\`, not
OCR'd. Mixing the two — extracted text for the born-digital pages, OCR for the
scans — gives a better document than OCR'ing all of it.

## 3. Do not trust it until you have looked

\`\`\`js
import { render } from 'env:render';
const shot = await render('/inbox/doc.pdf', '/tmp/look', { pages: [1] });
// then view_image on shot.pages[0].path
\`\`\`

Every number you intend to report should be read off the picture as well as
out of the text. \`confidence\` under 65, or a set \`note\`, means the text is
wrong somewhere and you do not know where.

## 4. Say which is which

When you answer, distinguish "the document says" from "OCR read". A quote from
a text layer is exact. A quote from OCR is a transcription, and a reader who
does not know that will treat a misread digit as a fact.
`;
