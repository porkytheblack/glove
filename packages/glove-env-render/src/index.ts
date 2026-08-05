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
import { LibreOfficeError, ProfilePool, officeToPdf, rasterizeImage, rasterizePdf } from "./raster";
import { readLayout } from "./pptx-layout";
import { drawSlide } from "./schematic";
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
  /**
   * True when the pages are a **layout schematic**, not a real render.
   *
   * Set when a `.pptx` was drawn from its own OOXML geometry because no
   * LibreOffice was available. Positions and text are real; fonts, colours,
   * charts and master-slide inheritance are not. Good enough to catch things
   * running off the slide, overlapping or coming out empty — not good enough
   * to judge how it looks.
   */
  approximate?: boolean;
  /** Present when something was degraded, explaining what and why. */
  note?: string;
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
  /**
   * How many LibreOffice user profiles to keep warm. Default 2.
   *
   * Concurrent conversions cannot share a profile, and a fresh one is
   * expensive because LibreOffice runs first-run initialization into it. So
   * profiles are leased exclusively and reused — worth about 30% per
   * conversion. Raise it if you convert Office documents in parallel.
   */
  profilePoolSize?: number;
  /**
   * Convert an Office document to PDF yourself, instead of spawning
   * LibreOffice.
   *
   * **This is the escape hatch for scale.** Spawning `soffice` per file costs
   * roughly 1.5s of process start; every platform that renders Office
   * documents in volume keeps LibreOffice *warm* behind a queue instead —
   * Gotenberg, unoserver, JODConverter and Collabora are all that shape. Point
   * this at one of them and the ceiling is theirs, not ours:
   *
   * ```ts
   * render({
   *   async convertOffice(bytes, filename) {
   *     const form = new FormData();
   *     form.set("files", new Blob([bytes]), filename);
   *     const res = await fetch("http://gotenberg:3000/forms/libreoffice/convert", {
   *       method: "POST", body: form,
   *     });
   *     if (!res.ok) throw new Error(`gotenberg ${res.status}`);
   *     return new Uint8Array(await res.arrayBuffer());
   *   },
   * })
   * ```
   *
   * When set, `soffice` is never invoked and no profile pool is created.
   * PDFs and images are unaffected — they never needed LibreOffice.
   */
  convertOffice?: (bytes: Uint8Array, filename: string) => Promise<Uint8Array>;
  /**
   * Fall back to a layout **schematic** for `.pptx` when no real renderer is
   * available. Default true.
   *
   * A deck is drawn from its own OOXML geometry — real frames, real text, no
   * theme, no fonts, no charts. It exists because the alternative on a host
   * without LibreOffice is no visual check at all, and the defects that
   * matter most are positional: off the slide, overlapping, or empty.
   *
   * The result carries `approximate: true` and the image says so in a caption,
   * so nothing downstream can mistake it for a render. Set false to get the
   * LibreOffice error instead.
   */
  schematicFallback?: boolean;
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
  const pool = new ProfilePool(Math.max(1, options.profilePoolSize ?? 2));

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

          let pdfBytes: Uint8Array;
          if (kind === "pdf") {
            pdfBytes = data;
          } else if (options.convertOffice) {
            pdfBytes = await options.convertOffice(data, baseName(input));
          } else {
            try {
              pdfBytes = await officeToPdf(data, baseName(input), { sofficePath, timeoutMs: officeTimeoutMs, pool });
            } catch (e) {
              // No real renderer. For a deck we can still draw the layout from
              // its own geometry, which catches the positional defects; for
              // anything else the honest answer is the error.
              const canSchematic = (options.schematicFallback ?? true) && /\.pptx$/i.test(input);
              if (!canSchematic) throw e;
              return await schematic(vfs, data, input, dir, stem, wanted, maxWidth, maxPages, e);
            }
          }

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

/**
 * Draw a deck's layout when nothing can render it properly.
 *
 * The original failure is carried into `note` rather than swallowed — a host
 * that meant to have LibreOffice needs to find out, and "why is this a
 * diagram" should be answerable from the result alone.
 */
async function schematic(
  vfs: EnvFsHandle,
  data: Uint8Array,
  input: string,
  dir: string,
  stem: string,
  wanted: number[] | "all",
  maxWidth: number,
  maxPages: number,
  cause: unknown,
): Promise<RenderResult> {
  const layout = readLayout(data);
  const indices = (wanted === "all" ? layout.slides.map((s) => s.index) : wanted)
    .filter((n) => n >= 1 && n <= layout.slides.length)
    .slice(0, maxPages);
  if (indices.length === 0) {
    throw new Error(
      `render: no slide ${wanted === "all" ? "" : String(wanted)} in ${input} — it has ${layout.slides.length} slide(s)`,
    );
  }

  const pages: RenderedPage[] = [];
  for (const n of indices) {
    const drawn = await drawSlide(layout, n, { maxWidth });
    const path = `${dir}/${stem}-p${n}.png`;
    await vfs.writeFile(path, drawn.png);
    pages.push({ path, page: n, width: drawn.width, height: drawn.height, bytes: drawn.png.byteLength });
  }

  return {
    pages,
    format: "office",
    totalPages: layout.slides.length,
    approximate: true,
    note:
      `LibreOffice could not render this deck, so these are LAYOUT SCHEMATICS drawn from the file's own geometry: ` +
      `real positions and text, but not real fonts, colours or charts. Use them to check what is off the slide, ` +
      `overlapping, or empty — not to judge how it looks. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

export { LibreOfficeError };
