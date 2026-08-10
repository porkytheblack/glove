/**
 * The PDF side of `env:ocr` — page counting and the text-layer guard.
 *
 * **There is no rasterizer in this file, deliberately.** PDF pages are turned
 * into pixels by `glove-env-render/raster`, the same pdfjs + canvas path
 * `env:render` uses for `view_image`. A second one here would drift from it —
 * different fonts, different scale handling, different bugs — and the first
 * question anyone asks about an OCR result is "does this match what I saw".
 *
 * What *is* here is the guard: pdfjs is already in the tree behind the
 * rasterizer, and one cheap `getTextContent()` per page answers the question
 * that decides whether OCR should have been called at all.
 */

/**
 * Characters of extractable text that make a page "already text".
 *
 * The same floor `env:documents` uses to call a page scanned, and it should
 * stay the same: the two adapters are answering opposite halves of one
 * question and disagreeing about the boundary would be worse than either
 * answer.
 */
const TEXT_LAYER_FLOOR = 100;

interface PdfjsPage {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}
interface PdfjsLoadingTask {
  promise: Promise<PdfjsDocument>;
  /** The loading task owns teardown in pdfjs 6; `doc.destroy` is gone. */
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(options: Record<string, unknown>): PdfjsLoadingTask;
}

let cache: PdfjsModule | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (cache) return cache;
  // The legacy build is the one that runs on Node without a DOM.
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  cache = (await import(specifier)) as PdfjsModule;
  return cache;
}

export interface PdfProbe {
  totalPages: number;
  /** 1-based pages that already carry a usable text layer. */
  textLayerPages: number[];
}

/**
 * How many pages, and which of them do not need OCR at all.
 *
 * This is the difference between a useful answer and a silently worse one. OCR
 * of a born-digital page is strictly inferior to reading its text layer — same
 * words at best, mangled numbers at worst — and a model that reaches for
 * `env:ocr` first has no way to know. So we look, and say so.
 *
 * Advisory by construction: any failure inside pdfjs here returns "no pages
 * have text", because a broken guard must not stop the OCR the caller asked
 * for.
 */
export async function probePdf(data: Uint8Array, pages: number[] | "all"): Promise<PdfProbe> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    // pdfjs mutates (and detaches) the buffer it is handed; the caller still
    // needs these bytes for the rasterizer.
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: false,
    // 0 = errors only. pdfjs otherwise narrates font substitution to stderr
    // for practically every document, none of it actionable.
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const total = doc.numPages;
    const wanted = pages === "all" ? range(1, total) : pages.filter((p) => p >= 1 && p <= total);
    const withText: number[] = [];
    for (const n of wanted) {
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let chars = 0;
        for (const item of content.items) {
          if (typeof item.str === "string") chars += item.str.trim().length;
          if (chars >= TEXT_LAYER_FLOOR) break;
        }
        if (chars >= TEXT_LAYER_FLOOR) withText.push(n);
      } catch {
        /* advisory only — a page we cannot probe is simply not reported */
      }
    }
    return { totalPages: total, textLayerPages: withText };
  } finally {
    await task.destroy();
  }
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** `[1,2,3,7]` → `"1-3, 7"`, so a note about twelve pages stays one line. */
export function summarizePages(pages: number[]): string {
  if (pages.length === 0) return "none";
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}
