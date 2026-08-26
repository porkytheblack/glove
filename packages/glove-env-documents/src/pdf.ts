/**
 * PDF: compose, inspect, and rearrange.
 *
 * pdf-lib handles structure and drawing but has no text layout, so the
 * renderer below does its own wrapping and pagination. Text *extraction* is a
 * different problem — decoding glyphs back to characters needs font and CMap
 * handling — and is delegated to pdfjs-dist, an optional peer.
 */
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  type PDFField,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { EnvFsHandle } from "glove-working-environment";
import {
  cellText,
  isBullets,
  isHeading,
  isImage,
  isPageBreak,
  isTable,
  isText,
  resolvePageSize,
  validateSpec,
  type DocumentSpec,
  type FontSpec,
} from "./model";

export type { FontSpec };

export interface PdfSummary {
  path: string;
  format: "pdf";
  bytes: number;
  pages: number;
  /** Width/height in points, per page — deduplicated runs stay short. */
  pageSizes: Array<{ width: number; height: number }>;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  encrypted: boolean;
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
  /** 1-based page numbers, or a range like "1-3,7". Default: every page. */
  pages?: string | number[];
  /** A font to embed — needed for any stamp text outside Latin-1. */
  font?: string | FontSpec;
}

export interface ExtractTextOptions {
  /** 1-based page numbers, or a range like "1-3,7". Default: every page. */
  pages?: string | number[];
}

export interface PdfFormField {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown" | "optionlist" | "button" | "signature";
  /** Current value: a string, a list for multi-select, a boolean for a checkbox, null when unset. */
  value: string | string[] | boolean | null;
  /** The permitted values, for the field kinds that have a fixed set. */
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

export interface PdfFormContents {
  path: string;
  fields: PdfFormField[];
  /**
   * True for an XFA form, where the AcroForm fields this lists may be a stale
   * shadow of what a reader actually displays.
   */
  xfa: boolean;
  /** Present when something about the form needs saying before you trust it. */
  note?: string;
}

export interface FillFormOptions {
  /** Where to write. Default: back over the input path. */
  output?: string;
  /** A font to render the filled values with — required for non-Latin values. */
  font?: string | FontSpec;
  /** Bake the values into the page and remove the fields, so they cannot be edited. */
  flatten?: boolean;
  /** Fill an XFA form's AcroForm layer anyway. Off by default; see `fillForm`. */
  allowXfa?: boolean;
}

export interface FilledForm {
  path: string;
  /** Field names that were set, in the order given. */
  filled: string[];
  flattened: boolean;
}

/**
 * What a page turned out to be made of.
 *
 * - `text` — a real text layer was extracted.
 * - `scanned` — almost no text, but the page paints images: it is a picture
 *   of words, and no extractor will do better.
 * - `empty` — almost no text and nothing drawn.
 */
export type PageKind = "text" | "scanned" | "empty";

export interface ExtractedText {
  path: string;
  pages: Array<{ page: number; text: string; kind: PageKind }>;
  /** All pages joined with form feeds — convenient for grep and for writing out. */
  text: string;
  characters: number;
  /**
   * The document as a whole: `mixed` when pages disagree.
   *
   * `characters: 3` on a visibly 40-page contract is indistinguishable from a
   * bug in the caller's own code. This says which it is, structurally, so a
   * model does not have to infer it from a number that looks like a mistake.
   */
  kind: PageKind | "mixed";
  /** Present when `kind` is not "text": what to do about it. */
  note?: string;
}

/**
 * Characters below which a page is not carrying a text layer.
 *
 * A page of body text runs 1,500–3,000 characters. A scan yields zero, or a
 * few dozen from a stamped header. Anything under this is not text a reader
 * could use, whatever produced it.
 */
const TEXT_LAYER_FLOOR = 100;

const HEADING_SIZES: Record<number, number> = { 1: 20, 2: 15, 3: 12.5 };
const BODY_SIZE = 11;
const LINE_RATIO = 1.35;
/**
 * What a bullet is drawn with. A hyphen rather than "•", because the marker is
 * a glyph the embedded font has to carry too, and every font has a hyphen
 * while plenty of single-script faces have no bullet.
 */
const BULLET_MARKER = "-";

/** Parse `"1-3,7"` or `[1,3]` into 0-based indices, validated against a page count. */
export function parsePages(spec: string | number[] | undefined, pageCount: number, label = "pages"): number[] {
  if (spec === undefined) return Array.from({ length: pageCount }, (_, i) => i);
  const wanted: number[] = [];
  if (Array.isArray(spec)) {
    for (const n of spec) {
      if (!Number.isInteger(n)) throw new Error(`${label} must contain whole numbers, got ${JSON.stringify(n)}`);
      wanted.push(n);
    }
  } else if (typeof spec === "string") {
    for (const part of spec.split(",")) {
      const piece = part.trim();
      if (piece === "") continue;
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
      if (range) {
        const [from, to] = [Number(range[1]), Number(range[2])];
        if (from > to) throw new Error(`${label} range "${piece}" runs backwards`);
        for (let n = from; n <= to; n++) wanted.push(n);
      } else if (/^\d+$/.test(piece)) {
        wanted.push(Number(piece));
      } else {
        throw new Error(`cannot parse ${label} ${JSON.stringify(piece)} — use "1-3,7" or [1, 3, 7]`);
      }
    }
  } else {
    throw new Error(`${label} must be a string like "1-3,7" or an array of page numbers`);
  }
  if (wanted.length === 0) throw new Error(`${label} selected no pages`);
  for (const n of wanted) {
    if (n < 1 || n > pageCount) {
      throw new Error(`page ${n} is out of range — the document has ${pageCount} page${pageCount === 1 ? "" : "s"} (pages are 1-based)`);
    }
  }
  return wanted.map((n) => n - 1);
}

/**
 * Refuse a file that is not a PDF, and say what it looks like instead.
 *
 * Found by agent evaluation: pointing `extractText` at a text file returned
 * pdf-lib's own `Invalid PDF structure.`, which reads as "this PDF is
 * corrupt". A model that believes the document is damaged goes looking for a
 * different extractor; a model told it is holding a text file just reads it.
 * The distinction costs one header check and saves a run.
 *
 * Checked before handing anything to a parser, because every parser's message
 * for "this is not my format" is written for someone who already knows what
 * the bytes are.
 */
function assertPdf(path: string, bytes: Uint8Array): void {
  // "%PDF-" — the header every PDF opens with.
  const isPdf =
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
  if (isPdf) return;

  const zip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const hint = zip
    ? `It is a ZIP container — .docx, .xlsx and .pptx all are. If it is a Word file, use env:documents.docx; ` +
      `for a spreadsheet use env:spreadsheets, and for a deck use env:slides.`
    : looksTextual(bytes)
      ? `It looks like text — read it with env:fs.readFile instead.`
      : `Its first bytes are ${[...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}.`;

  throw new Error(`${path} is not a PDF: it does not start with the %PDF- header. ${hint}`);
}

/** No NUL in the first kilobyte, and mostly printable — good enough to say "text". */
function looksTextual(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  }
  return printable / n > 0.9;
}

async function loadPdf(vfs: EnvFsHandle, path: string): Promise<PDFDocument> {
  const bytes = await vfs.readBytes(path);
  assertPdf(path, bytes);
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${path} could not be read as a PDF: ${message}`);
  }
}

async function savePdf(vfs: EnvFsHandle, doc: PDFDocument, path: string): Promise<string> {
  await vfs.writeFile(path, await doc.save());
  return path;
}

/** Break `text` into lines that fit `width` at `size`, honouring existing newlines. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width || line === "") {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on anything outside
 * it — an em dash or a smart quote in agent-written prose would fail the whole
 * render. Substituting the nearest ASCII is better than refusing the document.
 */
const SUBSTITUTIONS: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ",
  "•": "-", "→": "->", "≤": "<=", "≥": ">=",
};

export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of String(text)) {
    if (ch in SUBSTITUTIONS) {
      out += SUBSTITUTIONS[ch];
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // Latin-1 plus tab/newline survive; everything else becomes "?" rather
    // than aborting the render.
    out += code === 9 || code === 10 || (code >= 32 && code <= 255) ? ch : "?";
  }
  return out;
}

// ------------------------------------------------------------ font embedding

/**
 * The pair of faces a render draws with, and the one function that decides
 * what a string becomes on the way to the page.
 *
 * `prepare` is where the two worlds differ and the only place they need to.
 * With a standard font it transliterates, because refusing a document over one
 * em dash would be worse than drawing a hyphen. With an embedded font it
 * refuses instead — a missing glyph in a real font is drawn as a blank box,
 * which looks like a rendering bug to whoever opens the file and like success
 * to whoever produced it.
 */
interface Faces {
  body: PDFFont;
  bold: PDFFont;
  prepare(text: string): string;
  /** True when a supplied font was embedded rather than a standard one used. */
  embedded: boolean;
}

function normalizeFontSpec(font: string | FontSpec | undefined): FontSpec | undefined {
  if (font === undefined) return undefined;
  // An empty string reads as "no font" but arrives as a request for one, so it
  // is refused rather than resolved to a path that cannot exist.
  if (typeof font === "string") {
    if (font === "") throw new TypeError("font is an empty string — give a path to a .ttf/.otf, or omit it");
    return { regular: font };
  }
  if (!font || typeof font !== "object" || typeof font.regular !== "string" || font.regular === "") {
    throw new TypeError(
      `font must be a path to a .ttf/.otf, or { regular, bold? } of such paths, got ${JSON.stringify(font)}`,
    );
  }
  if (font.bold !== undefined && typeof font.bold !== "string") {
    throw new TypeError(`font.bold must be a path to a .ttf/.otf, got ${JSON.stringify(font.bold)}`);
  }
  return font;
}

/**
 * Read a font file through the guarded handle and parse it once, so a bad
 * path, a non-font and a font collection each fail by their own name.
 *
 * The collection case is worth its own branch: a `.ttc` parses fine and then
 * has no `hasGlyphForCodePoint`, because it is several fonts in a trench coat.
 * pdf-lib cannot embed one either — its embedder calls `fontkit.create` with
 * no face to pick — so it is refused here, where the message can name the
 * faces inside rather than surfacing as a TypeError from library internals.
 */
async function loadFont(vfs: EnvFsHandle, path: string): Promise<{ bytes: Uint8Array; font: FontkitFont }> {
  let bytes: Uint8Array;
  try {
    bytes = await vfs.readBytes(path);
  } catch (e) {
    throw new Error(
      `could not read the font ${path} from this environment's filesystem: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = fontkit.create(bytes);
  } catch (e) {
    throw new Error(
      `${path} is not a font fontkit can read (.ttf, .otf and .woff are): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const font = parsed as FontkitFont & { fonts?: Array<{ postscriptName?: string | null }> };
  if (typeof font.hasGlyphForCodePoint !== "function") {
    const faces = (font.fonts ?? []).map((f) => f.postscriptName).filter(Boolean);
    throw new Error(
      `${path} is a font collection (.ttc/.otc), not a single font, and neither pdf-lib nor this adapter can embed one. ` +
        (faces.length > 0
          ? `It contains ${faces.length} face(s): ${faces.slice(0, 8).join(", ")}${faces.length > 8 ? ", …" : ""}. `
          : "") +
        `Supply one face as a .ttf or .otf instead.`,
    );
  }
  return { bytes, font };
}

/** The slice of fontkit's Font this file uses. */
interface FontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

/**
 * Refuse a document the font cannot actually draw.
 *
 * pdf-lib does not fail on an unmapped code point — it emits glyph 0, which
 * every viewer renders as an empty box or nothing at all. So the text is
 * checked against the font's own character set first, and the whole document
 * is checked at once rather than failing at the first bad character, because
 * "your font is missing these 4 characters" is one fix and four errors is
 * four runs.
 */
function assertCoverage(font: FontkitFont, path: string, texts: string[]): void {
  const missing = new Set<string>();
  for (const text of texts) {
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      // Line breaks and tabs are layout, not glyphs — they never reach a
      // showText operator.
      if (code === 9 || code === 10 || code === 13) continue;
      if (!font.hasGlyphForCodePoint(code)) missing.add(ch);
    }
  }
  if (missing.size === 0) return;
  const shown = [...missing]
    .slice(0, 12)
    .map((ch) => `${JSON.stringify(ch)} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`)
    .join(", ");
  throw new Error(
    `${path} has no glyph for ${missing.size} character${missing.size === 1 ? "" : "s"} in this document: ${shown}` +
      `${missing.size > 12 ? ", …" : ""}. ` +
      `They would be drawn as blank boxes, so the render is refused instead. ` +
      `Supply a font that covers this script — for CJK that means a CJK font, not a Latin one with a few extra glyphs.`,
  );
}

/**
 * Embed the supplied font, or fall back to the standard Helvetica pair.
 *
 * `subset: true` writes only the glyphs the document uses. A full CJK face is
 * megabytes and the environment has a per-file limit; subsetting is what keeps
 * a two-page Japanese memo the size of a two-page memo.
 */
async function embedFaces(
  vfs: EnvFsHandle,
  doc: PDFDocument,
  font: string | FontSpec | undefined,
  texts: string[],
  /**
   * `"bold"` for a caller that draws with one weight. pdf-lib writes every
   * font it was handed, referenced or not, so embedding the regular face for a
   * stamp would leave a dead font dictionary in each stamped file.
   */
  need: "both" | "bold" = "both",
): Promise<Faces> {
  const spec = normalizeFontSpec(font);
  if (!spec) {
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return {
      body: need === "bold" ? bold : await doc.embedFont(StandardFonts.Helvetica),
      bold,
      prepare: toWinAnsi,
      embedded: false,
    };
  }

  doc.registerFontkit(fontkit);
  const body = await embedOne(vfs, doc, spec.regular, texts);
  const bold = spec.bold ? await embedOne(vfs, doc, spec.bold, texts) : body;
  // No transliteration: coverage is already proven, so the text goes to the
  // page exactly as it was written.
  return { body, bold, prepare: (t) => String(t), embedded: true };
}

/**
 * Read, check and embed one face, translating an embedder failure into a
 * sentence about the font.
 *
 * Some fonts fontkit can *read* it cannot *embed* — the OTTO-flavoured Unifont
 * faces on a Debian box fail with "Not a CFF Font", which names an internal
 * table and not the file the caller chose. Measured: four of the 47 fonts on
 * this host parse, report full CJK coverage, and then fail inside the
 * embedder. Saying which font and suggesting another is the difference between
 * a fixable error and a mysterious one.
 */
async function embedOne(vfs: EnvFsHandle, doc: PDFDocument, path: string, texts: string[]): Promise<PDFFont> {
  const { bytes, font } = await loadFont(vfs, path);
  assertCoverage(font, path, texts);
  try {
    // Only the glyphs this document uses travel with it. A CJK face is
    // megabytes and the environment caps single files; measured, a 6.2 MB
    // Japanese font became a 4 KB PDF.
    return await doc.embedFont(bytes, { subset: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${path} could not be embedded: ${message}. The file parses as a font but pdf-lib's embedder will not take it ` +
        `— this happens with some OpenType/CFF variants. Try a TrueType (.ttf) build of the same face.`,
    );
  }
}

/** Every string a spec will draw, so coverage can be checked before anything is. */
function drawnText(spec: DocumentSpec): string[] {
  const out: string[] = [];
  if (spec.title) out.push(spec.title);
  for (const block of spec.content ?? []) {
    if (isHeading(block)) out.push(block.heading);
    else if (isText(block)) out.push(block.text);
    else if (isBullets(block)) {
      // The renderer draws its own marker, which is a glyph like any other.
      out.push(BULLET_MARKER, ...block.bullets.map(String));
    } else if (isTable(block)) {
      for (const cell of block.table.headers ?? []) out.push(cellText(cell));
      for (const row of block.table.rows) for (const cell of row) out.push(cellText(cell));
    }
  }
  return out;
}

interface Cursor {
  page: PDFPage;
  y: number;
}

export function createPdfBindings(vfs: EnvFsHandle) {
  return {
    /** Structure and metadata of a PDF, without extracting any text. */
    async describe(path: string): Promise<PdfSummary> {
      const bytes = await vfs.readBytes(path);
      assertPdf(path, bytes);
      let doc: PDFDocument;
      let encrypted = false;
      try {
        doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        encrypted = doc.isEncrypted;
      } catch (e) {
        throw new Error(`${path} could not be read as a PDF: ${e instanceof Error ? e.message : String(e)}`);
      }
      const pageSizes = doc.getPages().map((p) => ({
        width: Math.round(p.getWidth() * 100) / 100,
        height: Math.round(p.getHeight() * 100) / 100,
      }));
      const str = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
      return {
        path,
        format: "pdf",
        bytes: (await vfs.stat(path))?.size ?? 0,
        pages: doc.getPageCount(),
        pageSizes,
        title: str(doc.getTitle()),
        author: str(doc.getAuthor()),
        subject: str(doc.getSubject()),
        creator: str(doc.getCreator()),
        producer: str(doc.getProducer()),
        encrypted,
      };
    },

    /** Render a document spec to a PDF. Returns the output path. */
    async create(path: string, spec: DocumentSpec): Promise<string> {
      validateSpec(spec);
      const doc = await PDFDocument.create();
      const [pageWidth, pageHeight] = resolvePageSize(spec.pageSize);
      const margin = typeof spec.margin === "number" && spec.margin >= 0 ? spec.margin : 56;
      const contentWidth = pageWidth - margin * 2;
      if (contentWidth <= 0) throw new Error(`margin ${margin} leaves no room on a ${pageWidth}pt-wide page`);

      const { body, bold, prepare } = await embedFaces(vfs, doc, spec.font, drawnText(spec));

      // Metadata is not drawn, so it needs no font: pdf-lib writes these as
      // UTF-16 hex strings, which carry any script. Transliterating them was
      // costing a Japanese title its characters for nothing.
      if (spec.title) doc.setTitle(spec.title);
      if (spec.author) doc.setAuthor(spec.author);
      if (spec.subject) doc.setSubject(spec.subject);

      const cursor: Cursor = { page: doc.addPage([pageWidth, pageHeight]), y: pageHeight - margin };
      const newPage = () => {
        cursor.page = doc.addPage([pageWidth, pageHeight]);
        cursor.y = pageHeight - margin;
      };
      const need = (height: number) => {
        if (cursor.y - height < margin) newPage();
      };
      const draw = (text: string, font: PDFFont, size: number, indent = 0) => {
        const lines = wrap(prepare(text), font, size, contentWidth - indent);
        const lineHeight = size * LINE_RATIO;
        for (const line of lines) {
          need(lineHeight);
          cursor.page.drawText(line, { x: margin + indent, y: cursor.y - size, size, font });
          cursor.y -= lineHeight;
        }
      };

      if (spec.title) {
        draw(spec.title, bold, 24);
        cursor.y -= 10;
      }

      for (const block of spec.content) {
        if (isPageBreak(block)) {
          newPage();
          continue;
        }
        if (isHeading(block)) {
          const size = HEADING_SIZES[block.level ?? 1] ?? HEADING_SIZES[1];
          cursor.y -= size * 0.5;
          draw(block.heading, bold, size);
          cursor.y -= size * 0.25;
          continue;
        }
        if (isText(block)) {
          draw(block.text, body, BODY_SIZE);
          cursor.y -= BODY_SIZE * 0.5;
          continue;
        }
        if (isBullets(block)) {
          for (const item of block.bullets) {
            const lineHeight = BODY_SIZE * LINE_RATIO;
            need(lineHeight);
            cursor.page.drawText(BULLET_MARKER, { x: margin, y: cursor.y - BODY_SIZE, size: BODY_SIZE, font: body });
            draw(String(item), body, BODY_SIZE, 14);
          }
          cursor.y -= BODY_SIZE * 0.5;
          continue;
        }
        if (isTable(block)) {
          const { headers, rows } = block.table;
          const columns = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length), 1);
          const colWidth = contentWidth / columns;
          const size = 10;
          const lineHeight = size * LINE_RATIO;

          const drawRow = (cells: Array<string | number | boolean | null>, font: PDFFont) => {
            const wrapped = Array.from({ length: columns }, (_, c) =>
              wrap(prepare(cellText(cells[c])), font, size, colWidth - 6),
            );
            const height = Math.max(...wrapped.map((w) => w.length)) * lineHeight;
            need(height);
            const top = cursor.y;
            wrapped.forEach((lines, c) => {
              lines.forEach((line, li) => {
                cursor.page.drawText(line, {
                  x: margin + c * colWidth,
                  y: top - size - li * lineHeight,
                  size,
                  font,
                });
              });
            });
            cursor.y = top - height;
          };

          if (headers && headers.length > 0) {
            drawRow(headers, bold);
            need(4);
            cursor.page.drawLine({
              start: { x: margin, y: cursor.y - 2 },
              end: { x: margin + contentWidth, y: cursor.y - 2 },
              thickness: 0.5,
              color: rgb(0.6, 0.6, 0.6),
            });
            cursor.y -= 6;
          }
          for (const row of rows) drawRow(row, body);
          cursor.y -= BODY_SIZE * 0.5;
          continue;
        }
        if (isImage(block)) {
          const raw = await vfs.readBytes(block.image);
          const isPng = raw[0] === 0x89 && raw[1] === 0x50;
          const isJpeg = raw[0] === 0xff && raw[1] === 0xd8;
          if (!isPng && !isJpeg) {
            throw new Error(`${block.image} is neither PNG nor JPEG — convert it first (env:images can)`);
          }
          const embedded = isPng ? await doc.embedPng(raw) : await doc.embedJpg(raw);
          const natural = embedded.scale(1);
          let width = block.width ?? Math.min(natural.width, contentWidth);
          let height = block.height ?? (natural.height * width) / natural.width;
          if (width > contentWidth) {
            height = (height * contentWidth) / width;
            width = contentWidth;
          }
          need(height);
          cursor.page.drawImage(embedded, { x: margin, y: cursor.y - height, width, height });
          cursor.y -= height + BODY_SIZE * 0.5;
        }
      }

      return savePdf(vfs, doc, path);
    },

    /** Concatenate PDFs in order. Returns the output path. */
    async merge(inputs: string[], output: string): Promise<string> {
      if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("merge needs at least one input path");
      const out = await PDFDocument.create();
      for (const input of inputs) {
        const src = await loadPdf(vfs, input);
        const copied = await out.copyPages(src, src.getPageIndices());
        for (const page of copied) out.addPage(page);
      }
      return savePdf(vfs, out, output);
    },

    /**
     * One file per page, written as `<dir>/<stem>-<n>.pdf`. Returns the paths
     * in page order.
     */
    async split(input: string, dir: string): Promise<string[]> {
      const src = await loadPdf(vfs, input);
      const stem = (input.split("/").pop() ?? "page").replace(/\.pdf$/i, "");
      const base = dir.replace(/\/$/, "");
      const written: string[] = [];
      for (let i = 0; i < src.getPageCount(); i++) {
        const out = await PDFDocument.create();
        const [page] = await out.copyPages(src, [i]);
        out.addPage(page);
        written.push(await savePdf(vfs, out, `${base}/${stem}-${i + 1}.pdf`));
      }
      return written;
    },

    /** Keep only the selected pages. Returns the output path. */
    async extractPages(input: string, output: string, pages: string | number[]): Promise<string> {
      const src = await loadPdf(vfs, input);
      const indices = parsePages(pages, src.getPageCount());
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      for (const page of copied) out.addPage(page);
      return savePdf(vfs, out, output);
    },

    /** Rewrite document metadata in place (or to a new path). */
    async setMetadata(input: string, meta: PdfMetadata, output?: string): Promise<string> {
      const doc = await loadPdf(vfs, input);
      // Not drawn, so not font-bound: pdf-lib writes these as UTF-16 hex
      // strings, which carry any script without an embedded face.
      if (meta?.title !== undefined) doc.setTitle(meta.title);
      if (meta?.author !== undefined) doc.setAuthor(meta.author);
      if (meta?.subject !== undefined) doc.setSubject(meta.subject);
      if (meta?.creator !== undefined) doc.setCreator(meta.creator);
      if (meta?.producer !== undefined) doc.setProducer(meta.producer);
      if (meta?.keywords !== undefined) doc.setKeywords(meta.keywords);
      return savePdf(vfs, doc, output ?? input);
    },

    /** Draw a text stamp (watermark, "DRAFT", a case number) on pages. */
    async stamp(input: string, output: string, opts: StampOptions): Promise<string> {
      if (!opts || typeof opts.text !== "string" || opts.text === "") throw new Error("stamp needs { text }");
      const doc = await loadPdf(vfs, input);
      // A stamp is a few words, so the bold face carries it: with a supplied
      // font, `bold` is the bold file when there is one and the regular file
      // otherwise, which is the right answer for a font with no bold cut.
      const faces = await embedFaces(vfs, doc, opts.font, [opts.text], "bold");
      const font = faces.bold;
      const size = opts.size ?? 24;
      const position = opts.position ?? "bottom-right";
      const rotation = opts.rotate ?? (position === "center" ? 45 : 0);
      const text = faces.prepare(opts.text);
      const textWidth = font.widthOfTextAtSize(text, size);
      const pad = 24;

      for (const index of parsePages(opts.pages, doc.getPageCount())) {
        const page = doc.getPage(index);
        const { width, height } = page.getSize();
        const spots: Record<string, [number, number]> = {
          "top-left": [pad, height - pad - size],
          "top-right": [width - pad - textWidth, height - pad - size],
          "bottom-left": [pad, pad],
          "bottom-right": [width - pad - textWidth, pad],
          center: [(width - textWidth) / 2, (height - size) / 2],
        };
        const [x, y] = spots[position] ?? spots["bottom-right"];
        page.drawText(text, {
          x,
          y,
          size,
          font,
          opacity: opts.opacity ?? 0.35,
          rotate: degrees(rotation),
          color: rgb(0.5, 0.5, 0.5),
        });
      }
      return savePdf(vfs, doc, output);
    },

    /**
     * The fields of a fillable PDF: what they are called, what kind they are,
     * and what is in them.
     *
     * This is the call that has to come first. A form's field names are not
     * the labels printed next to the boxes — they are whatever the form's
     * author typed, often `topmostSubform[0].Page1[0].f1_04[0]` — so filling
     * one without reading it is guessing.
     */
    async readForm(path: string): Promise<PdfFormContents> {
      const doc = await loadPdf(vfs, path);
      const form = doc.getForm();
      const fields = form.getFields().map(describeField);
      const xfa = form.hasXFA();
      const note = xfa
        ? `This is an XFA form. The ${fields.length} field(s) above are its AcroForm layer, which Acrobat ignores in ` +
          `favour of the XFA definition — so what you read here may not be what a person sees, and filling it may ` +
          `not show up. fillForm refuses this by default; pass { allowXfa: true } if you know the form is a hybrid.`
        : fields.length === 0
          ? `This PDF has no form fields — it is a flat document, not a fillable form. If it looks like a form, the ` +
            `boxes are printed on the page rather than being fields, and there is nothing to fill.`
          : undefined;
      return { path, fields, xfa, ...(note ? { note } : {}) };
    },

    /**
     * Fill fields by name and save. Returns the path written.
     *
     * An unknown field name is an error, not a no-op: the whole failure mode
     * of form filling is a name that is nearly right, and a call that reports
     * success while setting nothing is indistinguishable from one that worked.
     * The message lists the names the form does have.
     */
    async fillForm(
      path: string,
      values: Record<string, string | number | boolean | string[]>,
      options: FillFormOptions = {},
    ): Promise<FilledForm> {
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new TypeError(`fillForm needs { fieldName: value }, got ${values === null ? "null" : typeof values}`);
      }
      const entries = Object.entries(values);
      if (entries.length === 0) throw new Error("fillForm was given no values — nothing to fill");

      const doc = await loadPdf(vfs, path);
      const form = doc.getForm();

      if (form.hasXFA() && options.allowXfa !== true) {
        throw new Error(
          `${path} is an XFA form. Setting its AcroForm fields produces a file that looks filled to this code and ` +
            `blank in Acrobat, which is worse than not filling it — so it is refused. Read it with pdf.readForm to ` +
            `see the fields, and pass { allowXfa: true } only if you know this is a hybrid form that renders them.`,
        );
      }

      const known = form.getFields().map((f) => f.getName());
      const filled: string[] = [];
      for (const [name, value] of entries) {
        const field = form.getFieldMaybe(name);
        if (!field) {
          throw new Error(
            `${path} has no form field named ${JSON.stringify(name)}. It has ${known.length}: ` +
              `${known.slice(0, 20).map((n) => JSON.stringify(n)).join(", ")}${known.length > 20 ? ", …" : ""}. ` +
              `Field names are the form author's, not the printed labels — read pdf.readForm('${path}') first.`,
          );
        }
        setField(field, value, name);
        filled.push(name);
      }

      // Appearance streams are what a viewer actually draws, and they are
      // regenerated from the value using a font. Without an embedded one that
      // font is Helvetica, so a Japanese answer would fail here rather than
      // reaching the page — which is the honest place for it to fail.
      const faces = options.font
        ? await embedFaces(vfs, doc, options.font, entries.map(([, v]) => textOf(v)))
        : undefined;
      form.updateFieldAppearances(faces?.body);

      if (options.flatten) form.flatten();
      const output = options.output ?? path;
      await savePdf(vfs, doc, output);
      return { path: output, filled, flattened: options.flatten === true };
    },

    /**
     * Extract text, page by page. Needs the optional peer `pdfjs-dist`:
     * recovering characters from glyphs is a font/CMap problem that pdf-lib
     * does not solve, and a naive content-stream scan returns plausible
     * nonsense on any subsetted font — worse than refusing.
     */
    async extractText(path: string, opts: ExtractTextOptions = {}): Promise<ExtractedText> {
      const pdfjs = await loadPdfjs();
      const bytes = await vfs.readBytes(path);
      assertPdf(path, bytes);
      const task = pdfjs.getDocument({
        // pdfjs mutates the buffer it is given; hand it a copy.
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: false,
        // 0 = errors only. pdfjs otherwise narrates font substitution to
        // stderr for practically every document ("Ensure that the
        // `standardFontDataUrl` API parameter is provided", then one line per
        // substituted face). None of it is actionable — pdfjs ships Foxit
        // faces rather than the Liberation ones it asks for — and real
        // failures still throw.
        verbosity: 0,
      });
      const doc = await task.promise;
      try {
        const indices = parsePages(opts.pages, doc.numPages);
        const pages: Array<{ page: number; text: string; kind: PageKind }> = [];
        for (const index of indices) {
          const page = await doc.getPage(index + 1);
          const content = await page.getTextContent();
          let text = "";
          for (const item of content.items) {
            const piece = item as { str?: string; hasEOL?: boolean };
            if (typeof piece.str !== "string") continue;
            text += piece.str;
            if (piece.hasEOL) text += "\n";
          }
          text = text.trim();
          // A page short on text is only a *scan* if something was drawn on
          // it. Without that check a genuinely blank page reads as a scan,
          // and the advice that follows would be wrong.
          const kind: PageKind =
            text.length >= TEXT_LAYER_FLOOR ? "text" : (await paintsImages(page)) ? "scanned" : "empty";
          pages.push({ page: index + 1, text, kind });
        }
        const joined = pages.map((p) => p.text).join("\n\f\n");
        const kinds = new Set(pages.map((p) => p.kind));
        const kind: PageKind | "mixed" =
          pages.length === 0 ? "empty" : kinds.size === 1 ? [...kinds][0] : "mixed";
        const scanned = pages.filter((p) => p.kind === "scanned").map((p) => p.page);
        const note =
          scanned.length > 0
            ? `${scanned.length} page(s) are images of text, not text: ${summarizePages(scanned)}. ` +
              `No extractor will get more out of them — the document has no text layer there. ` +
              `Read them with env:ocr: recognize(path, { pages: [...] }) rasterises those pages and OCRs them ` +
              `in-environment, reporting per-page confidence. A vision model through view_image also works for a page or two.`
            : kind === "empty"
              ? `This PDF draws no text and no images on the pages requested — it is blank, not unreadable.`
              : undefined;
        return { path, pages, text: joined, characters: joined.length, kind, ...(note ? { note } : {}) };
      } finally {
        await task.destroy();
      }
    },
  };
}

// -------------------------------------------------------------- form fields

/**
 * One field, flattened into something a script can read without knowing
 * pdf-lib's class hierarchy.
 *
 * The `type` is derived from the class rather than from the field's `/FT`
 * entry, because pdf-lib has already done the work of telling a radio group
 * from a checkbox and a dropdown from an option list — distinctions `/FT` runs
 * together under `/Btn` and `/Ch`.
 */
function describeField(field: PDFField): PdfFormField {
  const base = {
    name: field.getName(),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
  };
  if (field instanceof PDFTextField) return { ...base, type: "text", value: field.getText() ?? null };
  if (field instanceof PDFCheckBox) return { ...base, type: "checkbox", value: field.isChecked() };
  if (field instanceof PDFRadioGroup) {
    return { ...base, type: "radio", value: field.getSelected() ?? null, options: field.getOptions() };
  }
  if (field instanceof PDFDropdown) {
    return { ...base, type: "dropdown", value: field.getSelected()[0] ?? null, options: field.getOptions() };
  }
  if (field instanceof PDFOptionList) {
    return { ...base, type: "optionlist", value: field.getSelected(), options: field.getOptions() };
  }
  if (field instanceof PDFSignature) return { ...base, type: "signature", value: null };
  return { ...base, type: "button", value: null };
}

/** What a value looks like as text — used for font coverage, before anything is set. */
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" ");
  return typeof value === "boolean" ? "" : String(value);
}

/**
 * Set one field, refusing a value its kind cannot hold.
 *
 * Every refusal names the field, its kind and — for the fields with a fixed
 * set — the values it will accept. A dropdown quietly left unset because the
 * option string was off by a space is the failure this exists to make loud.
 */
function setField(field: PDFField, value: unknown, name: string): void {
  const kind = (what: string): string => `field ${JSON.stringify(name)} is a ${what}`;

  if (field instanceof PDFTextField) {
    if (Array.isArray(value) || value === null || typeof value === "object") {
      throw new TypeError(`${kind("text field")} — give it a string, got ${JSON.stringify(value)}`);
    }
    field.setText(String(value));
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (typeof value !== "boolean") {
      throw new TypeError(`${kind("checkbox")} — give it true or false, got ${JSON.stringify(value)}`);
    }
    if (value) field.check();
    else field.uncheck();
    return;
  }
  if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
    if (typeof value !== "string") {
      const what = field instanceof PDFRadioGroup ? "radio group" : "dropdown";
      throw new TypeError(
        `${kind(what)} — give it one of ${JSON.stringify(field.getOptions())}, got ${JSON.stringify(value)}`,
      );
    }
    const options = field.getOptions();
    if (!options.includes(value)) {
      throw new Error(
        `${JSON.stringify(value)} is not one of the choices for ${JSON.stringify(name)}: ${JSON.stringify(options)}`,
      );
    }
    field.select(value);
    return;
  }
  if (field instanceof PDFOptionList) {
    const wanted = Array.isArray(value) ? value : [value];
    const options = field.getOptions();
    for (const item of wanted) {
      if (typeof item !== "string" || !options.includes(item)) {
        throw new Error(
          `${JSON.stringify(item)} is not one of the choices for ${JSON.stringify(name)}: ${JSON.stringify(options)}`,
        );
      }
    }
    field.select(wanted as string[]);
    return;
  }
  throw new Error(
    `${kind(field instanceof PDFSignature ? "signature field" : "button")}, which cannot be filled with a value. ` +
      `Signatures need a signing tool, and a button is an action rather than an answer.`,
  );
}

// -------------------------------------------------------- optional pdfjs

/**
 * **The peer range must stay in step with `glove-env-render` and
 * `glove-env-ocr`.**
 *
 * pdfjs resolves its main-thread worker through `globalThis.pdfjsWorker`, a
 * process-global. Two copies of pdfjs in one host — this adapter on one major,
 * the rasterizer on another — therefore share whichever worker registered
 * first, and the loser fails every call with
 *
 *     The API version "6.2.108" does not match the Worker version "5.7.284"
 *
 * It is order-dependent, so it presents as "OCR broke" or "extractText broke"
 * depending on which ran first, and neither package's own tests can see it:
 * each one is the only pdfjs in its own test process. Scanned-document work
 * wires all three together, which is exactly when it bites.
 */

interface PdfjsTextItem {
  str?: string;
  hasEOL?: boolean;
}
interface PdfjsPage {
  getTextContent(): Promise<{ items: PdfjsTextItem[] }>;
  /** Drawing operators. Present in every pdfjs release we support. */
  getOperatorList?(): Promise<{ fnArray: number[] }>;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}
/** The loading task owns teardown in pdfjs 6; `doc.destroy` is gone. */
interface PdfjsLoadingTask {
  promise: Promise<PdfjsDocument>;
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(options: Record<string, unknown>): PdfjsLoadingTask;
  OPS?: Record<string, number>;
}

/**
 * The operator ids for the three image-painting ops, resolved by NAME from
 * the loaded pdfjs rather than hard-coded — the numbers are internal and have
 * moved between major versions.
 */
let imageOps: Set<number> | null = null;

async function paintsImages(page: PdfjsPage): Promise<boolean> {
  if (typeof page.getOperatorList !== "function") return false;
  if (imageOps === null) {
    const ops = pdfjsCache?.OPS ?? {};
    imageOps = new Set(
      ["paintImageXObject", "paintJpegXObject", "paintInlineImage", "paintImageMaskXObject"]
        .map((n) => ops[n])
        .filter((v): v is number => typeof v === "number"),
    );
  }
  if (imageOps.size === 0) return false;
  try {
    const list = await page.getOperatorList();
    return list.fnArray.some((fn) => imageOps!.has(fn));
  } catch {
    // A page whose operator list will not build tells us nothing either way;
    // reporting "empty" is the claim we can actually stand behind.
    return false;
  }
}

/** "1, 2, 3" for a few pages; "1–3, 7 (+12 more)" once there are many. */
function summarizePages(pages: number[]): string {
  const shown = pages.slice(0, 8).join(", ");
  return pages.length > 8 ? `${shown} (+${pages.length - 8} more)` : shown;
}

let pdfjsCache: PdfjsModule | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (pdfjsCache) return pdfjsCache;
  // A variable specifier keeps the optional peer out of the build graph: the
  // package must install and typecheck without pdfjs-dist present.
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  try {
    pdfjsCache = (await import(specifier)) as PdfjsModule;
  } catch (e) {
    throw new Error(
      "extractText needs the optional peer dependency pdfjs-dist — install it (`pnpm add pdfjs-dist`) to read text out of PDFs. " +
        `describe() works without it and reports structure and metadata. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  return pdfjsCache;
}
