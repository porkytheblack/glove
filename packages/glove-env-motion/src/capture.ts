/**
 * Bundle → PNG frames, in a headless browser we drive one frame at a time.
 *
 * The browser is a renderer here, not a runtime: it is opened, stepped through
 * a fixed number of frames, screenshotted, and closed. Nothing in the page
 * decides when a frame happens — see {@link ../clock!CLOCK_SHIM}.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { CLOCK_SHIM, FRAME_GLOBALS } from "./clock";

export class CaptureError extends Error {}

export interface CaptureOptions {
  /** Absolute path of the built bundle. */
  bundle: string;
  /** Directory to write `frame-0000.png` … into. */
  outDir: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** CSS background behind the scene. */
  background: string;
  /**
   * `clock` advances time by 1/fps per frame — for Reanimated and anything
   * else that animates against a clock. `frame` sets the frame number and
   * renders it directly — for scenes written with `useFrame()`.
   */
  mode: "clock" | "frame";
  /** Absolute path to a Chromium binary. Auto-detected when absent. */
  browserPath?: string;
  /** Per-frame screenshot budget. */
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CaptureResult {
  frames: string[];
  /** Errors the page raised while rendering — usually a bug in the scene. */
  pageErrors: string[];
  /** True when every frame is byte-identical: almost always a broken scene. */
  allIdentical: boolean;
}

/**
 * Where Chromium is.
 *
 * Playwright normally answers this from its own registry, but a container that
 * pre-installs browsers (as this one does, at `PLAYWRIGHT_BROWSERS_PATH`) may
 * have a layout playwright-core does not expect. Checking the explicit
 * overrides first means an operator can always name the binary and be obeyed.
 */
export async function resolveBrowser(explicit?: string): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  const ok = async (p: string) => {
    try {
      await access(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  const candidates = [
    explicit,
    process.env.GLOVE_CHROMIUM_PATH,
    process.env.CHROME_PATH,
  ].filter(Boolean) as string[];
  for (const c of candidates) if (await ok(c)) return c;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    const { readdir } = await import("node:fs/promises");
    try {
      const entries = await readdir(root);
      // Prefer full chromium over headless_shell: the shell cannot do some
      // compositing paths, and a wrong-looking frame is worse than a slow one.
      const dirs = entries
        .filter((e) => e.startsWith("chromium"))
        .sort((a, b) => Number(b.startsWith("chromium-")) - Number(a.startsWith("chromium-")));
      for (const d of dirs) {
        for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
          const p = join(root, d, rel);
          if (await ok(p)) return p;
        }
      }
    } catch {
      /* fall through */
    }
  }

  // playwright-core's own registry, when the install was conventional.
  try {
    const path = chromium.executablePath();
    if (path && (await ok(path))) return path;
  } catch {
    /* no registered browser */
  }
  return null;
}

/**
 * The page is written to disk and navigated to, rather than pushed in with
 * `setContent`.
 *
 * That is not a style preference. `addInitScript` installs on **navigation**,
 * and `setContent` does not count as one — measured: after `setContent` the
 * init globals are absent, after `goto` they are there. Get this wrong and the
 * synthetic clock never installs, the scene reads `window.__gloveFrame` as
 * undefined, and the render fails as "the scene never mounted" with no hint of
 * why.
 */
const PAGE_HTML = (background: string, bundleName: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;overflow:hidden;background:${background}}
  #root{width:100%;height:100%}
  /* A caret or selection highlight blinking mid-render would make two
     otherwise identical frames differ. */
  *{caret-color:transparent}
  ::selection{background:transparent}
</style></head>
<body><div id="root"></div><script src="./${bundleName}"></script></body></html>`;

export async function captureFrames(options: CaptureOptions): Promise<CaptureResult> {
  const executablePath = await resolveBrowser(options.browserPath);
  if (!executablePath) {
    throw new CaptureError(
      "no Chromium binary found. env:motion renders in a headless browser, so one has to exist. " +
        "Set GLOVE_CHROMIUM_PATH to a Chromium/Chrome executable, or install one with `npx playwright install chromium`.",
    );
  }

  await mkdir(options.outDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        // Subpixel antialiasing samples the background, so the same glyph
        // renders differently over different pixels. Off, text is stable and
        // frames stay comparable.
        "--disable-lcd-text",
        "--font-render-hinting=none",
        "--disable-skia-runtime-opts",
      ],
    });
    return await renderWith(browser, options, executablePath);
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function renderWith(browser: Browser, options: CaptureOptions, executablePath: string): Promise<CaptureResult> {
  const page: Page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
  });

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 400)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text().slice(0, 400));
  });

  // Order matters: the clock must be in place before the scene's module code
  // runs, or the scene captures the real `requestAnimationFrame` and escapes
  // our control entirely.
  await page.addInitScript(CLOCK_SHIM);
  await page.addInitScript(FRAME_GLOBALS);
  await page.addInitScript(
    ({ fps, durationInFrames, width, height }) => {
      const w = window as unknown as { __gloveFrame: Record<string, number> };
      Object.assign(w.__gloveFrame, { fps, durationInFrames, width, height, frame: 0 });
    },
    { fps: options.fps, durationInFrames: options.durationInFrames, width: options.width, height: options.height },
  );

  const bundleName = options.bundle.split("/").pop() ?? "bundle.js";
  const pageFile = join(dirname(options.bundle), "__page.html");
  await writeFile(pageFile, PAGE_HTML(options.background, bundleName));
  await page.goto(pathToFileURL(pageFile).href, { waitUntil: "load" });

  try {
    await page.waitForFunction("window.__gloveMounted === true", null, { timeout: options.timeoutMs });
  } catch {
    throw new CaptureError(
      `the scene never mounted within ${options.timeoutMs}ms.` +
        (pageErrors.length ? `\n${pageErrors.slice(0, 3).join("\n")}` : " The page reported no error, so check that the entry file default-exports a component."),
    );
  }

  const step = 1000 / options.fps;
  const frames: string[] = [];
  const digests = new Set<string>();
  const { createHash } = await import("node:crypto");

  for (let f = 0; f < options.durationInFrames; f++) {
    if (options.signal?.aborted) throw new CaptureError(`render cancelled after ${f} frames`);

    if (options.mode === "frame") {
      await page.evaluate((n) => (window as unknown as { __gloveSetFrame(n: number): void }).__gloveSetFrame(n), f);
    } else if (f > 0) {
      // Frame 0 is the scene at t=0 — advancing before capturing it would
      // silently drop the first 1/fps of every animation.
      await page.evaluate((s) => (window as unknown as { __gloveClock: { advance(ms: number): number } }).__gloveClock.advance(s), step);
    }
    await page.evaluate("window.__gloveClock.settle()");

    const buffer = await page.screenshot({ type: "png", timeout: options.timeoutMs });
    const file = join(options.outDir, `frame-${String(f).padStart(5, "0")}.png`);
    await writeFile(file, buffer);
    frames.push(file);
    digests.add(createHash("sha1").update(buffer).digest("hex"));
  }

  const scriptErrors = (await page.evaluate("window.__gloveErrors || []")) as string[];
  pageErrors.push(...scriptErrors.slice(0, 5));
  await page.close();

  void executablePath;
  return { frames, pageErrors, allIdentical: digests.size === 1 && frames.length > 1 };
}
