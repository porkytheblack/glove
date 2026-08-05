/**
 * Bundle → PNG frames, in a headless browser we drive one frame at a time.
 *
 * The browser is a renderer here, not a runtime: it is opened, stepped through
 * a fixed number of frames, screenshotted, and closed. Nothing in the page
 * decides when a frame happens — see {@link ./clock!CLOCK_SHIM}.
 */
import { accessSync, constants as fsConstants, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { CLOCK_SHIM, FRAME_GLOBALS } from "./clock";

export class CaptureError extends Error {}

export interface CaptureOptions {
  /** Absolute path of the built bundle. */
  bundle: string;
  /** Directory to write `frame-00000.png` … into. */
  outDir: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** CSS background behind the scene. */
  background: string;
  /**
   * How frames are driven. `auto` (the default upstream) drives BOTH signals
   * every frame — the frame number for `useFrame()` scenes and the clock for
   * Reanimated — so any scene animates without the caller knowing which kind
   * it is. `clock` and `frame` isolate one signal, for the rare scene where
   * the other has side effects.
   */
  mode: "auto" | "clock" | "frame";
  /**
   * Capture exactly one frame — this one — instead of the whole run.
   *
   * A pure frame-driven scene is jumped to directly; a clock-driven scene is
   * walked there without intermediate screenshots, which is cheap because a
   * clock step is milliseconds and a screenshot is the expensive part.
   */
  still?: number;
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
 * pre-installs browsers (as some do, at `PLAYWRIGHT_BROWSERS_PATH`) may have a
 * layout playwright-core does not expect. Checking the explicit overrides
 * first means an operator can always name the binary and be obeyed.
 *
 * Synchronous so it can also run inside `motion()` itself, where the result
 * is written into the docs the agent reads — the agent learns "no browser
 * here" from `/std/motion/README.md` instead of from a failed render.
 */
export function resolveBrowserSync(explicit?: string): string | null {
  const ok = (p: string) => {
    try {
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  const candidates = [explicit, process.env.GLOVE_CHROMIUM_PATH, process.env.CHROME_PATH].filter(Boolean) as string[];
  for (const c of candidates) if (ok(c)) return c;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    try {
      // Prefer full chromium over headless_shell: the shell cannot do some
      // compositing paths, and a wrong-looking frame is worse than a slow one.
      const dirs = readdirSync(root)
        .filter((e) => e.startsWith("chromium"))
        .sort((a, b) => Number(b.startsWith("chromium-")) - Number(a.startsWith("chromium-")));
      for (const d of dirs) {
        for (const rel of [
          "chrome-linux/chrome",
          "chrome-linux/headless_shell",
          "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        ]) {
          const p = join(root, d, rel);
          if (ok(p)) return p;
        }
      }
    } catch {
      /* fall through */
    }
  }

  // playwright-core's own registry, when the install was conventional.
  try {
    const path = chromium.executablePath();
    if (path && ok(path)) return path;
  } catch {
    /* no registered browser */
  }
  return null;
}

export async function resolveBrowser(explicit?: string): Promise<string | null> {
  return resolveBrowserSync(explicit);
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
  const executablePath = resolveBrowserSync(options.browserPath);
  if (!executablePath) {
    throw new CaptureError(
      "no Chromium binary found. env:motion renders in a headless browser, so one has to exist. " +
        "Set GLOVE_CHROMIUM_PATH to a Chromium/Chrome executable, or install one with `npx playwright-core install chromium`.",
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
    return await renderWith(browser, options);
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function renderWith(browser: Browser, options: CaptureOptions): Promise<CaptureResult> {
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
        (pageErrors.length
          ? `\n${pageErrors.slice(0, 3).join("\n")}`
          : " The page reported no error, so check that the entry file default-exports a component."),
    );
  }

  const step = 1000 / options.fps;
  const setFrame = (f: number) =>
    page.evaluate((n) => (window as unknown as { __gloveSetFrame(n: number): void }).__gloveSetFrame(n), f);
  const advance = (ms: number) =>
    page.evaluate((s) => (window as unknown as { __gloveClock: { advance(ms: number): number } }).__gloveClock.advance(s), ms);
  const settle = () => page.evaluate("window.__gloveClock.settle()");

  /**
   * One frame, on both axes by default. A `useFrame()` scene answers the
   * frame number and ignores the clock; a Reanimated scene answers the clock
   * and ignores the frame number; each signal is inert for the other kind, so
   * driving both costs nothing and removes the caller's obligation to know
   * which scene they have. The two stay consistent by construction: frame f
   * is always t = f/fps.
   */
  const drive = async (f: number) => {
    if (options.mode !== "clock") await setFrame(f);
    if (options.mode !== "frame") await advance(f === 0 ? 0 : step);
    await settle();
  };

  const shot = async (name: string): Promise<{ file: string; buffer: Buffer }> => {
    const buffer = await page.screenshot({ type: "png", timeout: options.timeoutMs });
    const file = join(options.outDir, name);
    await writeFile(file, buffer);
    return { file, buffer };
  };

  const drainErrors = async () => {
    const scriptErrors = (await page.evaluate("window.__gloveErrors || []")) as string[];
    pageErrors.push(...scriptErrors.slice(0, 5));
  };

  // --- a single frame ------------------------------------------------------
  if (options.still !== undefined) {
    const target = options.still;
    // A scene that subscribes to the frame number and holds no clock
    // callbacks is a pure function of the frame — jump straight to it.
    // Anything else is walked there, cheaply: a clock step is milliseconds,
    // and the one screenshot at the end is the expensive part.
    const probe = (await page.evaluate(
      "({ listeners: window.__gloveFrameListenerCount ? window.__gloveFrameListenerCount() : 0, pending: window.__gloveClock.pending() })",
    )) as { listeners: number; pending: number };
    const jump = options.mode === "frame" || (options.mode === "auto" && probe.listeners > 0 && probe.pending === 0);

    if (jump) {
      await setFrame(target);
      await settle();
    } else {
      for (let f = 0; f <= target; f++) {
        if (options.signal?.aborted) throw new CaptureError(`render cancelled at frame ${f}`);
        await drive(f);
      }
    }
    const { file } = await shot(`frame-${String(target).padStart(5, "0")}.png`);
    await drainErrors();
    await page.close();
    return { frames: [file], pageErrors, allIdentical: false };
  }

  // --- the whole run -------------------------------------------------------
  const frames: string[] = [];
  const digests = new Set<string>();
  const { createHash } = await import("node:crypto");

  for (let f = 0; f < options.durationInFrames; f++) {
    if (options.signal?.aborted) throw new CaptureError(`render cancelled after ${f} frames`);
    await drive(f);
    const { file, buffer } = await shot(`frame-${String(f).padStart(5, "0")}.png`);
    frames.push(file);
    digests.add(createHash("sha1").update(buffer).digest("hex"));
  }

  await drainErrors();
  await page.close();

  return { frames, pageErrors, allIdentical: digests.size === 1 && frames.length > 1 };
}
