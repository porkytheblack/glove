/**
 * env:render — turn a document into pictures of itself.
 *
 * Every other verification route in this environment reads text back. That
 * finds a wrong number and misses everything about how the thing LOOKS: a
 * table running off the page, a chart with no bars, a title overlapping its
 * subtitle, a deck whose last slide is blank. Those are the defects a person
 * catches in the first second and an extraction never sees.
 *
 * So this rasterizes to PNG inside the VFS, and `view_image` (in
 * glove-working-environment, enabled when the host wires a vision model)
 * hands the result to a model that can look at it.
 *
 * Paths in, paths out — the bytes never enter the context window.
 */
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";
import { LibreOfficeError, officeToPdf, rasterizeImage, rasterizePdf } from "./raster";
import { RENDER_DOCS, RENDER_TYPES, VERIFY_SKILL } from "./docs";

export interface RenderOptions {
  /** Which pages, 1-based. `"all"` for every page. Default `[1]`. */
  pages?: number[] | "all";
  /** Render scale before the width cap. Default 1.5. */
  scale?: number;
  /** Long-edge cap in pixels. Default 1600. */
  maxWidth?: number;
}

export interface RenderedPage {
  path: string;
  page: number;
  width: number;
  height: number;
  bytes: number;
}

export interface RenderResult {
  pages: RenderedPage[];
  /** What the input turned out to be, decided by magic bytes then extension. */
  format: "pdf" | "office" | "image";
  /** Pages in the source document (1 for an image). */
  totalPages: number;
}

export interface RenderAdapterOptions {
  /** Path to the LibreOffice binary. Default `"soffice"` (found on PATH). */
  sofficePath?: string;
  /** Budget for one Office conversion. Default 120_000. */
  officeTimeoutMs?: number;
  /** Default long-edge cap. Default 1600. */
  maxWidth?: number;
  /** How many pages one call may render. Default 20. */
  maxPages?: number;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK.. — every OOXML/ODF container
const OFFICE_EXT = /\.(pptx|docx|xlsx|odp|odt|ods|ppt|doc|xls|rtf)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/** Magic first, extension second — a `.pptx` that is really a PDF is a PDF. */
function classify(path: string, head: Uint8Array): "pdf" | "office" | "image" | null {
  if (startsWith(head, PDF_MAGIC)) return "pdf";
  if (startsWith(head, ZIP_MAGIC) && OFFICE_EXT.test(path)) return "office";
  if (IMAGE_EXT.test(path)) return "image";
  if (OFFICE_EXT.test(path)) return "office";
  return null;
}

export function render(options: RenderAdapterOptions = {}) {
  const sofficePath = options.sofficePath ?? "soffice";
  const officeTimeoutMs = options.officeTimeoutMs ?? 120_000;
  const defaultMaxWidth = options.maxWidth ?? 1600;
  const maxPages = options.maxPages ?? 20;

  return defineAdapter({
    name: "render",
    description:
      "Rasterize a PDF, deck, Word file or image to page PNGs in the filesystem — so you can LOOK at what you produced, not just read its text.",
    types: RENDER_TYPES,
    docs: RENDER_DOCS,
    skills: [
      {
        name: "verifying-output",
        summary: "Check what you produced by LOOKING at it, not just reading its text back.",
        body: VERIFY_SKILL,
      },
    ],
    // Deliberately NOT `handles`: the module that best describes a PDF is
    // env:documents, and claiming the same files for `describe` would steal
    // that dispatch. Renderers live in their own registry.
    renders: {
      extensions: [
        ".pdf", ".pptx", ".docx", ".xlsx", ".odp", ".odt", ".ods",
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif",
      ],
      magic: [{ bytes: PDF_MAGIC }],
    },
    create(vfs: EnvFsHandle) {
      return {
        async render(input: string, outDir: string, opts: RenderOptions = {}): Promise<RenderResult> {
          if (typeof input !== "string" || typeof outDir !== "string") {
            throw new Error("render(input, outDir, opts?) needs two paths");
          }
          const stat = await vfs.stat(input);
          if (!stat) throw new Error(`no such file: ${input}`);
          if (stat.kind !== "file") throw new Error(`${input} is a directory`);

          const data = await vfs.readBytes(input);
          const kind = classify(input, data.subarray(0, 8));
          if (!kind) {
            throw new Error(
              `cannot render ${input}: not a PDF, an Office document or an image. ` +
                `Supported: .pdf, .pptx, .docx, .xlsx, .odp, .odt, and common image formats.`,
            );
          }

          const maxWidth = opts.maxWidth ?? defaultMaxWidth;
          const scale = opts.scale ?? 1.5;
          const wanted = opts.pages ?? [1];

          if (Array.isArray(wanted) && wanted.length > maxPages) {
            throw new Error(`render: ${wanted.length} pages requested, limit is ${maxPages} per call`);
          }

          const stem = baseName(input).replace(/\.[^.]+$/, "");
          const dir = outDir.replace(/\/+$/, "");
          await vfs.mkdir(dir);

          if (kind === "image") {
            const page = await rasterizeImage(data, maxWidth);
            const path = `${dir}/${stem}.png`;
            await vfs.writeFile(path, page.png);
            return {
              pages: [{ path, page: 1, width: page.width, height: page.height, bytes: page.png.byteLength }],
              format: "image",
              totalPages: 1,
            };
          }

          const pdfBytes =
            kind === "pdf" ? data : await officeToPdf(data, baseName(input), { sofficePath, timeoutMs: officeTimeoutMs });

          const capped = wanted === "all" ? "all" : wanted;
          const { rendered, totalPages } = await rasterizePdf(pdfBytes, capped as number[] | "all", { scale, maxWidth });
          if (rendered.length === 0) {
            throw new Error(
              `render: no pages produced from ${input} — it has ${totalPages} page(s), and none of the requested pages exist`,
            );
          }

          const limited = rendered.slice(0, maxPages);
          const pages: RenderedPage[] = [];
          for (const page of limited) {
            const path = `${dir}/${stem}-p${page.page}.png`;
            await vfs.writeFile(path, page.png);
            pages.push({ path, page: page.page, width: page.width, height: page.height, bytes: page.png.byteLength });
          }
          return { pages, format: kind, totalPages };
        },
      };
    },
  });
}

function baseName(path: string): string {
  return path.split("/").pop() || path;
}

export { LibreOfficeError };
