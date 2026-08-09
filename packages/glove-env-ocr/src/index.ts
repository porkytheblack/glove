/**
 * `env:ocr` — the last step from a picture of words to words.
 *
 * Until this existed the environment could get *close* to a scanned document
 * and no further. `documents.extractText` reports `kind: "scanned"` and stops,
 * correctly: there is no text layer to read. `render` turns the pages into
 * PNGs, correctly: that is what it is for. A vision model can then *look* at
 * the page — but the agent still cannot grep it, quote it, diff it against a
 * spreadsheet, or put a number from it in a report. A scanned contract was
 * effectively opaque.
 *
 * So: Tesseract, in WASM, bundled.
 *
 * Two decisions carry this adapter, and both are about not lying:
 *
 * **It never touches the network.** The usual `tesseract.js` setup downloads
 * `eng.traineddata` from a CDN the first time it runs. In a sandboxed runtime
 * with no egress that is not a slow path, it is a broken one — and the failure
 * arrives at recognise time, on a real document, not at setup. Here the WASM
 * core and the English training data are both ordinary bundled dependencies
 * read off disk. English works on a bare host with no host wiring at all.
 * Another language works if its data package is installed, and says exactly
 * that if it is not.
 *
 * **It rasterises through `env:render`, not through its own copy.** PDF pages
 * come from `glove-env-render/raster` — the same pdfjs + canvas path that
 * produces the images a vision model looks at. The first thing anyone asks
 * about an OCR result is whether it matches what they saw; two rasterizers
 * makes that unanswerable.
 *
 * And one thing it refuses to do quietly: OCR a page that already has a text
 * layer. That is strictly worse than extracting it — the same words if you are
 * lucky, a mangled number if you are not — so the result says which pages
 * those were and points at `documents.extractText`.
 */
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";
import { rasterizeImage, rasterizePdf } from "glove-env-render/raster";
import { Engine, OcrLanguageError, availableLanguages, round } from "./engine";
import { probePdf, range, summarizePages } from "./pdf";
import { OCR_DOCS, OCR_TYPES, SCAN_SKILL } from "./docs";

export interface OcrPage {
  /** 1-based page in the source document. Always 1 for an image. */
  page: number;
  text: string;
  /** Tesseract's mean word confidence for this page, 0–100. 0 when it read nothing. */
  confidence: number;
  /** Words read on this page. */
  words: number;
  /**
   * True when this PDF page already had a real text layer, so OCR was the
   * wrong tool for it — `documents.extractText` will do better.
   */
  textLayer?: boolean;
}

export interface OcrResult {
  path: string;
  /** What the input turned out to be, decided by magic bytes then extension. */
  source: "pdf" | "image";
  /** The tessdata language actually used. */
  language: string;
  /** Every recognised page joined by `\n\f\n`, the same convention `documents.extractText` uses. */
  text: string;
  characters: number;
  pages: OcrPage[];
  /** Pages in the source document (1 for an image), even if fewer were read. */
  totalPages: number;
  /** Mean confidence across the pages that produced text, 0–100. */
  confidence: number;
  /** Present when the result needs reading with suspicion, saying why. */
  note?: string;
}

export interface OcrSummary {
  path: string;
  format: "pdf" | "image";
  bytes: number;
  totalPages: number;
  /** 1-based PDF pages that already carry a text layer — OCR is wrong for these. */
  textLayerPages: number[];
  /** True when at least one page needs OCR. */
  needsOcr: boolean;
  /** Languages this host can actually run right now. */
  languages: string[];
}

export interface RecognizeOptions {
  /** Which pages of a PDF, 1-based. `"all"` for the whole document. Default `"all"`. */
  pages?: number[] | "all";
  /** tessdata language code. Default `"eng"`, the only one bundled. */
  lang?: string;
  /** Rasterisation scale for PDF pages. Default 3 (~216 dpi). Ignored for images. */
  scale?: number;
}

export interface OcrAdapterOptions {
  /**
   * A directory of `<lang>.traineddata(.gz)` files, or a URL, to use instead
   * of the bundled data.
   *
   * The escape hatch for a host with its own models — a custom-trained one, or
   * the full `4.0.0` tessdata set. Leave it unset and English comes from the
   * bundled `@tesseract.js-data/eng`, which is the point of this adapter.
   */
  langPath?: string;
  /** How many pages one `recognize` call may read. Default 20. */
  maxPages?: number;
  /** Default rasterisation scale for PDF pages. Default 3. */
  scale?: number;
  /**
   * Long-edge cap in pixels for a rasterised page. Default 3000.
   *
   * Higher than `env:render`'s 1600 on purpose: that cap exists because a
   * vision model charges by pixel, and this one exists because Tesseract wants
   * roughly 300 dpi. They are different jobs with different right answers.
   */
  maxWidth?: number;
  /** Languages `describe()` reports on. Default `["eng"]` plus anything installed. */
  languages?: string[];
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;
const IMAGE_MAGIC: Array<{ bytes: number[]; offset?: number }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
  { bytes: [0xff, 0xd8, 0xff] }, // JPEG
  { bytes: [0x42, 0x4d] }, // BMP
  { bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { bytes: [0x49, 0x49, 0x2a, 0x00] }, // TIFF LE
  { bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // TIFF BE
  { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // RIFF....WEBP
];

/** Below this, the text is more likely wrong than right and the caller must know. */
const SHAKY_CONFIDENCE = 65;

/** Long edge under which Tesseract is working well below the resolution it wants. */
const THIN_PIXELS = 1000;

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/** Magic first, extension second — a `.png` that is really a PDF is a PDF. */
function classify(path: string, head: Uint8Array): "pdf" | "image" | null {
  if (startsWith(head, PDF_MAGIC)) return "pdf";
  if (IMAGE_MAGIC.some((m) => startsWith(head, m.bytes, m.offset))) return "image";
  if (IMAGE_EXT.test(path)) return "image";
  return null;
}

export function ocr(options: OcrAdapterOptions = {}) {
  const maxPages = Math.max(1, options.maxPages ?? 20);
  const defaultScale = options.scale ?? 3;
  const maxWidth = options.maxWidth ?? 3000;
  const knownLanguages = options.languages ?? ["eng", "deu", "fra", "spa", "ita", "por", "nld", "rus"];

  // One engine per adapter instance. `create` runs twice per environment (once
  // read-only, for write-time script validation) and this must not spawn a
  // worker in either — hence lazily, inside recognize().
  const engine = new Engine(options.langPath);

  return defineAdapter({
    name: "ocr",
    description:
      "Read text off a scanned PDF or a photo of a document with bundled Tesseract — offline, per-page confidence, no host wiring.",
    types: OCR_TYPES,
    docs: OCR_DOCS,
    skills: [
      {
        name: "reading-a-scan",
        summary: "Get text out of a scanned PDF or a photo — and know when not to.",
        body: SCAN_SKILL,
      },
    ],
    // Deliberately NOT `handles`: `env:documents` describes a PDF better than
    // this adapter can and `env:images` owns PNGs. Claiming those extensions
    // would steal `describe` dispatch from the modules that understand the
    // formats, to say something narrower. Same reasoning as `env:render`.
    create(vfs: EnvFsHandle) {
      const load = async (path: string): Promise<{ kind: "pdf" | "image"; data: Uint8Array; bytes: number }> => {
        if (typeof path !== "string") throw new Error("ocr takes a path");
        const stat = await vfs.stat(path);
        if (!stat) throw new Error(`no such file: ${path}`);
        if (stat.kind !== "file") throw new Error(`${path} is a directory`);
        const data = await vfs.readBytes(path);
        const kind = classify(path, data.subarray(0, 16));
        if (!kind) {
          throw new Error(
            `cannot OCR ${path}: it is neither a PDF nor an image. ` +
              `Supported: .pdf and .png/.jpg/.webp/.gif/.bmp/.tiff. ` +
              `An Office document or a deck has real text already — read it with env:documents or env:slides, ` +
              `or render it to PDF with env:render first.`,
          );
        }
        return { kind, data, bytes: stat.size };
      };

      return {
        /**
         * Should this be OCR'd at all, and can it be? Cheap: no recognition
         * runs, so this is the call to make before spending pages.
         */
        async describe(path: string): Promise<OcrSummary> {
          const { kind, data, bytes } = await load(path);
          const languages = await availableLanguages(knownLanguages, options.langPath);
          if (kind === "image") {
            return { path, format: "image", bytes, totalPages: 1, textLayerPages: [], needsOcr: true, languages };
          }
          const probe = await probePdf(data, "all");
          return {
            path,
            format: "pdf",
            bytes,
            totalPages: probe.totalPages,
            textLayerPages: probe.textLayerPages,
            needsOcr: probe.textLayerPages.length < probe.totalPages,
            languages,
          };
        },

        /** Which tessdata languages this host can run right now. */
        async languages(): Promise<string[]> {
          return availableLanguages(knownLanguages, options.langPath);
        },

        /**
         * Read the text off a scan. PDF pages are rasterised through
         * `env:render`'s rasterizer first; images go straight in.
         */
        async recognize(path: string, opts: RecognizeOptions = {}): Promise<OcrResult> {
          const { kind, data } = await load(path);
          const lang = opts.lang ?? "eng";
          const scale = opts.scale ?? defaultScale;

          if (kind === "image") {
            const page = await rasterizeImage(data, maxWidth);
            const read = await engine.recognize(page.png, lang);
            const thin = Math.max(page.width, page.height) < THIN_PIXELS;
            const pages: OcrPage[] = [{ page: 1, text: read.text, confidence: read.confidence, words: read.words }];
            return finish(path, "image", lang, pages, 1, [], thin ? `${page.width}x${page.height}` : undefined);
          }

          const wanted = opts.pages ?? "all";
          if (Array.isArray(wanted)) {
            if (wanted.length === 0) throw new Error("recognize: pages was an empty array — omit it to read them all");
            if (wanted.length > maxPages) {
              throw new Error(
                `recognize: ${wanted.length} pages requested, limit is ${maxPages} per call — ` +
                  `OCR costs roughly a second a page, so this is a budget, not a capability. Call it again for the rest.`,
              );
            }
          }

          // The guard runs before any pixels are produced: if every page the
          // caller asked for already has text, the cheapest useful answer is
          // "you do not want this call".
          const probe = await probePdf(data, wanted);
          const requested = wanted === "all" ? range(1, probe.totalPages) : wanted.filter((p) => p >= 1 && p <= probe.totalPages);
          if (requested.length === 0) {
            throw new Error(
              `recognize: no page ${wanted === "all" ? "" : JSON.stringify(wanted)} in ${path} — it has ${probe.totalPages} page(s)`,
            );
          }
          const capped = requested.slice(0, maxPages);

          const { rendered } = await rasterizePdf(data, capped, { scale, maxWidth });
          const withText = new Set(probe.textLayerPages);
          const pages: OcrPage[] = [];
          for (const image of rendered) {
            const read = await engine.recognize(image.png, lang);
            pages.push({
              page: image.page,
              text: read.text,
              confidence: read.confidence,
              words: read.words,
              ...(withText.has(image.page) ? { textLayer: true } : {}),
            });
          }
          const truncated = capped.length < requested.length ? requested.length : 0;
          return finish(path, "pdf", lang, pages, probe.totalPages, probe.textLayerPages, undefined, truncated, maxPages);
        },
      };
    },
  });
}

/**
 * Assemble the result and, more importantly, decide what to warn about.
 *
 * An OCR result that reads like extracted text is dangerous: nothing about
 * `text: "Total: 4B23.19"` announces that the 8 was a guess. So every way this
 * result can be misleading gets said out loud, in one place.
 */
function finish(
  path: string,
  source: "pdf" | "image",
  language: string,
  pages: OcrPage[],
  totalPages: number,
  textLayerPages: number[],
  smallImage?: string,
  truncated = 0,
  maxPages = 0,
): OcrResult {
  const text = pages.map((p) => p.text).join("\n\f\n");
  const scored = pages.filter((p) => p.words > 0);
  const confidence = scored.length === 0 ? 0 : round(scored.reduce((n, p) => n + p.confidence, 0) / scored.length);

  const notes: string[] = [];
  const readTextLayer = pages.filter((p) => p.textLayer).map((p) => p.page);
  if (readTextLayer.length > 0) {
    notes.push(
      `page(s) ${summarizePages(readTextLayer)} already have a real text layer — this OCR of them is a downgrade. ` +
        `Read those with documents.extractText and keep OCR for the rest.`,
    );
  }
  if (scored.length === 0) {
    notes.push(
      smallImage
        ? `nothing readable was found, and the image is only ${smallImage} — Tesseract wants roughly 300 dpi, ` +
          `so a larger scan of the same page is the fix.`
        : `nothing readable was found. If you can see text when you view this with view_image, it is probably ` +
          `too small, too skewed or in a language other than ${language} — try ocr.languages() for what this host can run.`,
    );
  } else if (confidence < SHAKY_CONFIDENCE) {
    notes.push(
      `mean confidence is ${confidence}/100, low enough that the text is likely wrong in places — ` +
        `treat individual characters, and especially digits, as unverified.` +
        (smallImage ? ` The image is only ${smallImage}; Tesseract wants roughly 300 dpi.` : ""),
    );
  }
  const blank = pages.filter((p) => p.words === 0).map((p) => p.page);
  if (scored.length > 0 && blank.length > 0) {
    notes.push(`page(s) ${summarizePages(blank)} produced no text at all.`);
  }
  if (truncated > 0) {
    notes.push(`only the first ${maxPages} of ${truncated} requested pages were read — ask for the rest by page number.`);
  }
  if (textLayerPages.length === totalPages && totalPages > 0 && source === "pdf") {
    notes.push(`every page of this PDF has a text layer; documents.extractText reads it without OCR at all.`);
  }

  return {
    path,
    source,
    language,
    text,
    characters: text.length,
    pages,
    totalPages,
    confidence,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

export { OcrLanguageError };
export default ocr;
