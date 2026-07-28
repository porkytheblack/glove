/**
 * PDF: compose, inspect, and rearrange.
 *
 * pdf-lib handles structure and drawing but has no text layout, so the
 * renderer below does its own wrapping and pagination. Text *extraction* is a
 * different problem — decoding glyphs back to characters needs font and CMap
 * handling — and is delegated to pdfjs-dist, an optional peer.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
} from "./model";

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
}

export interface ExtractTextOptions {
  /** 1-based page numbers, or a range like "1-3,7". Default: every page. */
  pages?: string | number[];
}

export interface ExtractedText {
  path: string;
  pages: Array<{ page: number; text: string }>;
  /** All pages joined with form feeds — convenient for grep and for writing out. */
  text: string;
  characters: number;
}

const HEADING_SIZES: Record<number, number> = { 1: 20, 2: 15, 3: 12.5 };
const BODY_SIZE = 11;
const LINE_RATIO = 1.35;

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

async function loadPdf(vfs: EnvFsHandle, path: string): Promise<PDFDocument> {
  const bytes = await vfs.readBytes(path);
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

interface Cursor {
  page: PDFPage;
  y: number;
}

export function createPdfBindings(vfs: EnvFsHandle) {
  return {
    /** Structure and metadata of a PDF, without extracting any text. */
    async describe(path: string): Promise<PdfSummary> {
      const bytes = await vfs.readBytes(path);
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

      const body = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);

      if (spec.title) doc.setTitle(toWinAnsi(spec.title));
      if (spec.author) doc.setAuthor(toWinAnsi(spec.author));
      if (spec.subject) doc.setSubject(toWinAnsi(spec.subject));

      const cursor: Cursor = { page: doc.addPage([pageWidth, pageHeight]), y: pageHeight - margin };
      const newPage = () => {
        cursor.page = doc.addPage([pageWidth, pageHeight]);
        cursor.y = pageHeight - margin;
      };
      const need = (height: number) => {
        if (cursor.y - height < margin) newPage();
      };
      const draw = (text: string, font: PDFFont, size: number, indent = 0) => {
        const lines = wrap(toWinAnsi(text), font, size, contentWidth - indent);
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
            cursor.page.drawText("-", { x: margin, y: cursor.y - BODY_SIZE, size: BODY_SIZE, font: body });
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
              wrap(toWinAnsi(cellText(cells[c])), font, size, colWidth - 6),
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
      if (meta?.title !== undefined) doc.setTitle(toWinAnsi(meta.title));
      if (meta?.author !== undefined) doc.setAuthor(toWinAnsi(meta.author));
      if (meta?.subject !== undefined) doc.setSubject(toWinAnsi(meta.subject));
      if (meta?.creator !== undefined) doc.setCreator(toWinAnsi(meta.creator));
      if (meta?.producer !== undefined) doc.setProducer(toWinAnsi(meta.producer));
      if (meta?.keywords !== undefined) doc.setKeywords(meta.keywords.map(toWinAnsi));
      return savePdf(vfs, doc, output ?? input);
    },

    /** Draw a text stamp (watermark, "DRAFT", a case number) on pages. */
    async stamp(input: string, output: string, opts: StampOptions): Promise<string> {
      if (!opts || typeof opts.text !== "string" || opts.text === "") throw new Error("stamp needs { text }");
      const doc = await loadPdf(vfs, input);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const size = opts.size ?? 24;
      const position = opts.position ?? "bottom-right";
      const rotation = opts.rotate ?? (position === "center" ? 45 : 0);
      const text = toWinAnsi(opts.text);
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
     * Extract text, page by page. Needs the optional peer `pdfjs-dist`:
     * recovering characters from glyphs is a font/CMap problem that pdf-lib
     * does not solve, and a naive content-stream scan returns plausible
     * nonsense on any subsetted font — worse than refusing.
     */
    async extractText(path: string, opts: ExtractTextOptions = {}): Promise<ExtractedText> {
      const pdfjs = await loadPdfjs();
      const bytes = await vfs.readBytes(path);
      const task = pdfjs.getDocument({
        // pdfjs mutates the buffer it is given; hand it a copy.
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: false,
      });
      const doc = await task.promise;
      try {
        const indices = parsePages(opts.pages, doc.numPages);
        const pages: Array<{ page: number; text: string }> = [];
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
          pages.push({ page: index + 1, text: text.trim() });
        }
        const joined = pages.map((p) => p.text).join("\n\f\n");
        return { path, pages, text: joined, characters: joined.length };
      } finally {
        await doc.destroy();
      }
    },
  };
}

// -------------------------------------------------------- optional pdfjs

interface PdfjsTextItem {
  str?: string;
  hasEOL?: boolean;
}
interface PdfjsPage {
  getTextContent(): Promise<{ items: PdfjsTextItem[] }>;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfjsDocument> };
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
