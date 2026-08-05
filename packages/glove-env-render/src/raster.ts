/**
 * The two rasterizers: pdfjs for PDFs, LibreOffice for everything Office.
 *
 * Both stay host-side. Nothing here is reachable from inside the sandbox —
 * scripts call `render()`, which is an adapter binding, and the adapter runs
 * in the host realm exactly like `env:media`'s ffmpeg does.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

export interface RasterPage {
  page: number;
  width: number;
  height: number;
  png: Uint8Array;
}

/**
 * pdfjs ships its own font data, and without being pointed at it every
 * standard-font document renders through a fallback — same layout, different
 * glyphs. For a tool whose entire job is "show me what this really looks
 * like", quietly substituting the typeface is the one thing it must not do.
 */
function standardFontDataUrl(): string {
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  return join(root, "standard_fonts") + "/";
}

let pdfjsModule: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
function pdfjs() {
  // The legacy build is the one that runs on Node without a DOM.
  pdfjsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}

/** Rasterize selected pages of a PDF. `pages` is 1-based. */
export async function rasterizePdf(
  data: Uint8Array,
  pages: number[] | "all",
  opts: { scale: number; maxWidth: number },
): Promise<{ rendered: RasterPage[]; totalPages: number }> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const lib = await pdfjs();
  // `data` is transferred and detached by pdfjs, so hand it a copy — the
  // caller may still want its bytes (we do, for the image branch).
  const task = lib.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: standardFontDataUrl(),
  });
  const doc = await task.promise;

  const total = doc.numPages;
  const wanted = pages === "all" ? range(1, total) : pages.filter((p) => p >= 1 && p <= total);
  const rendered: RasterPage[] = [];

  for (const n of wanted) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Cap the long edge: a vision model charges by pixels, and an A4 page at
    // scale 3 buys nothing a person could not read at 1.5.
    const scale = Math.min(opts.scale, opts.maxWidth / base.width);
    const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // PDF pages are transparent where nothing is drawn. Flattened onto black
    // by a viewer, dark text on a transparent background becomes invisible —
    // so paint the page white first, which is what the page IS.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvasContext: ctx as never, viewport, canvas: canvas as never }).promise;
    rendered.push({ page: n, width, height, png: canvas.toBuffer("image/png") });
    page.cleanup();
  }

  await task.destroy();
  return { rendered, totalPages: total };
}

/** Re-encode an image to PNG, downscaling to `maxWidth`. */
export async function rasterizeImage(data: Uint8Array, maxWidth: number): Promise<RasterPage> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(Buffer.from(data));
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { page: 1, width, height, png: canvas.toBuffer("image/png") };
}

export class LibreOfficeError extends Error {}

/**
 * A lease pool of LibreOffice user profiles.
 *
 * Two facts pull in opposite directions. Concurrent conversions **cannot**
 * share a profile: LibreOffice locks it and the loser exits without writing
 * anything (measured: four concurrent on one profile produced two PDFs). But
 * a *fresh* profile is expensive, because LibreOffice runs its first-run
 * initialization into it every time.
 *
 * So: keep a small set of profiles, hand each conversion an *exclusive* lease
 * on one, and put it back afterwards. Exclusivity buys the safety, reuse buys
 * the initialization back.
 *
 * Measured at 8 conversions per arm, alternating so drift hits both equally,
 * comparing medians because the distribution is skewed:
 *
 * | strategy | median | spread |
 * |---|---|---|
 * | a fresh profile each | 1297ms | 1089–2016 |
 * | a leased profile reused | 1019ms | 986–1183 |
 *
 * ~21%, and the tighter spread matters as much as the median — reusing a
 * profile makes the cost predictable, not just lower. Naive sequential
 * benchmarks of this are worthless: run-to-run variance exceeded the effect
 * three times over until the arms were interleaved.
 *
 * None of which touches the real ceiling. Process start is ~1s and no amount
 * of profile management removes it; `convertOffice` does, by handing the work
 * to something that keeps LibreOffice warm.
 *
 * Profiles live under one temp root and are the OS's to reap; there is no
 * adapter teardown hook to delete them in, and a stale profile directory is
 * harmless.
 */
export class ProfilePool {
  private root: string | null = null;
  private readonly idle: string[] = [];
  private created = 0;
  private readonly waiting: Array<(profile: string) => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<string> {
    const ready = this.idle.pop();
    if (ready) return ready;
    if (this.created < this.max) {
      this.root ??= await mkdtemp(join(tmpdir(), "glove-render-profiles-"));
      const profile = join(this.root, `p${this.created++}`);
      return profile; // LibreOffice creates it on first use
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(profile: string): void {
    const next = this.waiting.shift();
    if (next) next(profile);
    else this.idle.push(profile);
  }
}

/**
 * Convert an Office document to PDF with headless LibreOffice.
 *
 * There is no npm package that renders .pptx faithfully; LibreOffice is the
 * one that does, and it is a system dependency rather than a bundled binary.
 * That makes its absence a first-class outcome rather than a crash, so every
 * failure here names the package to install.
 *
 * Each conversion gets a private user profile, and that is load-bearing.
 *
 * LibreOffice locks its user-installation directory on startup and opens an
 * IPC socket named after it — the machinery that makes a second document open
 * in the LibreOffice you already have running. Headless, a second
 * `--convert-to` sees the lock, tries to delegate to the running instance
 * instead of converting, and exits without writing anything. Measured here:
 * four concurrent conversions sharing a profile produced two PDFs; the same
 * four with a profile each produced four.
 *
 * The losers do not fail consistently — some exit 1, some exit 0 having done
 * nothing — which is why the check below is "did a PDF appear", never the
 * exit code.
 */
export async function officeToPdf(
  data: Uint8Array,
  filename: string,
  opts: { sofficePath: string; timeoutMs: number; pool: ProfilePool },
): Promise<Uint8Array> {
  const work = await mkdtemp(join(tmpdir(), "glove-render-"));
  const outDir = join(work, "out");
  const input = join(work, basename(filename));
  // Held exclusively for the duration of this conversion — that exclusivity
  // is precisely what makes reusing a profile safe.
  const profile = await opts.pool.acquire();
  try {
    await writeFile(input, data);
    let stderr = "";
    try {
      const result = await run(
        opts.sofficePath,
        [
          `-env:UserInstallation=file://${profile}`,
          "--headless",
          "--norestore",
          "--invisible",
          "--nolockcheck",
          "--convert-to",
          "pdf",
          "--outdir",
          outDir,
          input,
        ],
        { timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      );
      stderr = result.stderr ?? "";
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (/ENOENT/.test(detail)) {
        throw new LibreOfficeError(
          `LibreOffice not found (looked for "${opts.sofficePath}"). Office formats are rendered through it: ` +
            `install libreoffice-impress (decks) / libreoffice-writer (Word), or pass sofficePath. ` +
            `PDFs and images do not need it.`,
        );
      }
      throw new LibreOfficeError(`LibreOffice failed converting ${basename(filename)}: ${detail}`);
    }

    const produced = (await readdir(outDir).catch(() => [])).filter((f) => f.endsWith(".pdf"));
    if (produced.length === 0) {
      // The failure mode that cost the most to diagnose: soffice exits 0 with
      // "source file could not be loaded" when the application module for the
      // format is missing — core alone has no import filters at all.
      const missingFilter = /source file could not be loaded/i.test(stderr);
      throw new LibreOfficeError(
        missingFilter
          ? `LibreOffice could not load ${basename(filename)} — it exited successfully but produced nothing, which means ` +
            `the import filter for this format is not installed. Install libreoffice-impress (for .pptx) or ` +
            `libreoffice-writer (for .docx); libreoffice-core on its own cannot open either.`
          : `LibreOffice produced no PDF from ${basename(filename)}${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    }
    return new Uint8Array(await readFile(join(outDir, produced[0])));
  } finally {
    opts.pool.release(profile);
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
