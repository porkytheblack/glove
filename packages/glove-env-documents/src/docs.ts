/**
 * Materialized at `/std/documents/index.d.ts` and `/std/documents/README.md`.
 * The adapter audit checks these against the real bindings in both
 * directions, so a declaration here is a promise the code has to keep.
 */

export const DOCUMENTS_TYPES = `/** env:documents — PDF and DOCX in the virtual filesystem. */

// ---------------------------------------------------------- document model
// One spec, two renderers: pdf.create and docx.create take the same shape.

export type PageSize = "a4" | "letter" | [number, number];

export type Block =
  | { heading: string; level?: 1 | 2 | 3 }
  | { text: string }
  | { bullets: string[] }
  | { table: { headers?: string[]; rows: Array<Array<string | number | boolean | null>> } }
  | { image: string; width?: number; height?: number }   // image is a VFS path to a PNG or JPEG
  | { pageBreak: true };

export interface DocumentSpec {
  title?: string;
  author?: string;
  subject?: string;
  /** Default "a4". PDF only. */
  pageSize?: PageSize;
  /** Points of margin on every side. Default 56 (about 2cm). PDF only. */
  margin?: number;
  content: Block[];
}

// ------------------------------------------------------------- summaries

export interface PdfSummary {
  path: string;
  format: "pdf";
  bytes: number;
  pages: number;
  pageSizes: Array<{ width: number; height: number }>;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  encrypted: boolean;
}

export interface DocxSummary {
  path: string;
  format: "docx";
  bytes: number;
  paragraphs: number;
  words: number;
  characters: number;
  /** Headings in document order — an outline to navigate by. */
  headings: Array<{ level: number; text: string }>;
  tables: number;
  /** First few paragraphs, so the shape is visible without extracting. */
  preview: string[];
}

/** "text" = a real text layer; "scanned" = images of words; "empty" = nothing drawn. */
export type PageKind = "text" | "scanned" | "empty";

export interface ExtractedText {
  path: string;
  pages: Array<{ page: number; text: string; kind: PageKind }>;
  /** Pages joined with form feeds. */
  text: string;
  characters: number;
  /** The document as a whole; "mixed" when pages disagree. Check this before blaming your code. */
  kind: PageKind | "mixed";
  /** Present when kind is not "text": what to do about it. */
  note?: string;
}

export interface DocxText {
  path: string;
  paragraphs: string[];
  text: string;
  characters: number;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

export interface StampOptions {
  text: string;
  /** Default "bottom-right". */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  size?: number;
  /** 0–1. Default 0.35. */
  opacity?: number;
  /** Degrees counter-clockwise. Default 0, or 45 for "center". */
  rotate?: number;
  /** 1-based pages, or a range like "1-3,7". Default: all. */
  pages?: string | number[];
}

// ----------------------------------------------------------------- verbs

/** Summarise a PDF or DOCX — the format is detected from the bytes. Start here. */
export function describe(path: string): Promise<PdfSummary | DocxSummary>;

export const pdf: {
  /** Structure and metadata, no text. */
  describe(path: string): Promise<PdfSummary>;
  /** Render a document spec to a PDF. Returns the output path. */
  create(path: string, spec: DocumentSpec): Promise<string>;
  /** Concatenate PDFs in order. Returns the output path. */
  merge(inputs: string[], output: string): Promise<string>;
  /** One file per page, as <dir>/<stem>-<n>.pdf. Returns the paths. */
  split(input: string, dir: string): Promise<string[]>;
  /** Keep only the selected pages ("1-3,7" or [1,3,7]). Returns the output path. */
  extractPages(input: string, output: string, pages: string | number[]): Promise<string>;
  /** Rewrite metadata, in place or to a new path. Returns the path written. */
  setMetadata(input: string, meta: PdfMetadata, output?: string): Promise<string>;
  /** Draw a text stamp or watermark. Returns the output path. */
  stamp(input: string, output: string, opts: StampOptions): Promise<string>;
  /** Extract text page by page. Requires the optional pdfjs-dist peer. */
  extractText(path: string, opts?: { pages?: string | number[] }): Promise<ExtractedText>;
};

export const docx: {
  /** Outline, counts and a short preview. */
  describe(path: string): Promise<DocxSummary>;
  /** Render a document spec to a .docx. Returns the output path. */
  create(path: string, spec: DocumentSpec): Promise<string>;
  /** Full text, paragraph by paragraph. */
  extractText(path: string): Promise<DocxText>;
};
`;

export const DOCUMENTS_DOCS = `# env:documents

Compose, inspect and rearrange PDF and DOCX files that live in the tree.

## One spec, two formats

\`pdf.create\` and \`docx.create\` take the same document spec. Emitting both
is a second call, not a second implementation.

\`\`\`js
import { pdf, docx } from 'env:documents';

export default async function main(args) {
  const spec = {
    title: 'Q3 Revenue Review',
    author: 'analysis agent',
    content: [
      { heading: 'Summary' },
      { text: 'Revenue grew 11% quarter over quarter, driven by EMEA.' },
      { bullets: ['EMEA +18%', 'AMER +4%', 'APAC flat'] },
      { heading: 'By region', level: 2 },
      { table: { headers: ['Region', 'Revenue'], rows: [['EMEA', 91000], ['AMER', 51000]] } },
      { pageBreak: true },
      { heading: 'Appendix', level: 2 },
      { image: '/tmp/chart.png', width: 420 },
    ],
  };

  await pdf.create('/out/review.pdf', spec);
  await docx.create('/out/review.docx', spec);
  return { pdf: '/out/review.pdf', docx: '/out/review.docx' };
}
\`\`\`

Text wraps and paginates on its own — you do not place anything by
coordinate. Blocks flow in order.

## Look before you read

\`describe\` sniffs the format from the file's bytes and summarises it. It
costs the same whether the document has 2 pages or 900.

\`\`\`js
import { describe } from 'env:documents';

export default async function main() {
  return describe('/inbox/contract.pdf');
  // → { path, format: 'pdf', bytes: 184320, pages: 14,
  //     pageSizes: [{ width: 595.28, height: 841.89 }, …],
  //     title: 'Master Agreement', author: null, …, encrypted: false }
}
\`\`\`

For a .docx, \`describe\` returns the heading outline and a short preview —
usually enough to decide which section you actually need.

## Reading text

\`\`\`js
import { pdf, docx } from 'env:documents';
import { writeFile } from 'env:fs';

export default async function main() {
  const { pages, characters } = await pdf.extractText('/inbox/contract.pdf', { pages: '1-3' });
  // Big text belongs in a file, not in your return value.
  await writeFile('/tmp/contract-1-3.txt', pages.map(p => p.text).join('\\n\\n'));
  return { characters, wrote: '/tmp/contract-1-3.txt' };
}
\`\`\`

**PDF text extraction needs the optional peer \`pdfjs-dist\`.** If the host has
not installed it, \`pdf.extractText\` says so and \`pdf.describe\` still works.
DOCX extraction has no such requirement.

Extraction returns what the file actually contains, and tells you which it
was. A scanned PDF is images of text and yields little or nothing, so
\`kind\` says \`"scanned"\` (per page, and for the document) rather than leaving
you to guess from a character count that looks like a bug in your own code:

\`\`\`js
const { kind, characters, note } = await pdf.extractText('/inbox/contract.pdf');
if (kind !== 'text') return { blocked: note };   // note names the pages and the way forward
\`\`\`

A scan has no text layer, so no extractor will do better — the pages have to
be rasterised and read as images (a vision model, or OCR host-side). \`empty\`
means the pages really are blank, which is a different problem.

## Rearranging PDFs

\`\`\`js
import { pdf } from 'env:documents';

await pdf.merge(['/inbox/a.pdf', '/inbox/b.pdf'], '/out/combined.pdf');
await pdf.extractPages('/inbox/big.pdf', '/out/first-three.pdf', '1-3');
await pdf.split('/inbox/big.pdf', '/tmp/pages');        // → ['/tmp/pages/big-1.pdf', …]
await pdf.stamp('/out/combined.pdf', '/out/draft.pdf', { text: 'DRAFT', position: 'center' });
await pdf.setMetadata('/out/draft.pdf', { title: 'Draft bundle', author: 'agent' });
\`\`\`

Page selections are **1-based**, as a string range (\`'1-3,7'\`) or an array
(\`[1, 3, 7]\`). An out-of-range page says how many the document has.

## Notes

- Images in a spec are VFS paths to PNG or JPEG files. Convert other formats
  with \`env:images\` first.
- PDFs use the standard Helvetica family, which covers Latin-1. Characters
  outside it are transliterated where there is an obvious equivalent (curly
  quotes, dashes, ellipsis) and otherwise become \`?\`. For full Unicode, emit
  DOCX.
- \`setMetadata\` writes back to the same path unless you pass an output path.
- Only \`.docx\` is readable, not legacy \`.doc\` or \`.rtf\`.
`;
