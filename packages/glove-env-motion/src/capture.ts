/**
 * Bundle → PNG frames, in a headless browser we drive one frame at a time.
 *
 * The browser is a renderer here, not a runtime: it is opened, stepped through
 * a fixed number of frames, screenshotted, and closed. Nothing in the page
 * decides when a frame happens — see {@link ./clock!CLOCK_SHIM}.
 */
import { accessSync, constants as fsConstants, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
  /**
   * `src` of every image the browser could not draw.
   *
   * A missing picture is the one defect that survives every other check: the
   * render succeeds, the file is valid, and the hole is visible only by
   * looking at it. Asking the page directly is the only way to know.
   */
  brokenImages: string[];
}

/**
 * Playwright's per-platform browser layouts under `PLAYWRIGHT_BROWSERS_PATH`.
 *
 * Full chromium is listed before headless_shell on each platform: the shell
 * cannot do some compositing paths, and a wrong-looking frame is worse than a
 * slow one.
 */
export const PW_BROWSER_SUBPATHS = [
  "chrome-linux/chrome",
  "chrome-linux/headless_shell",
  "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  "chrome-mac/headless_shell",
  "chrome-win/chrome.exe",
  "chrome-win/headless_shell.exe",
];

/**
 * Where a browser that is ALREADY INSTALLED lives, per platform.
 *
 * This is the difference between "works on a laptop out of the box" and
 * "every macOS or Windows developer must run a browser install for a browser
 * they already have". Chrome, Edge and Chromium are all Chromium engines and
 * all screenshot identically for our purposes. Takes the platform as an
 * argument so the list for every OS is testable from any OS.
 */
export function systemBrowserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (platform === "win32") {
    const pf = env.PROGRAMFILES ?? "C:\\Program Files";
    const pf86 = env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA;
    return [
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(local ? [join(local, "Google", "Chrome", "Application", "chrome.exe")] : []),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
}

/**
 * Where Chromium is, on any platform.
 *
 * The order encodes a policy: an explicit answer is always obeyed
 * (option, then GLOVE_CHROMIUM_PATH / CHROME_PATH); then playwright's
 * browsers — a pre-provisioned `PLAYWRIGHT_BROWSERS_PATH` layout, then the
 * conventional registry — because a pinned build beats whatever the system
 * browser auto-updated to this week; then the system Chrome/Edge/Chromium,
 * so a laptop with a browser needs no install at all.
 *
 * Synchronous so it can also run inside `motion()` itself, where the result
 * is written into the docs the agent reads — the agent learns "no browser
 * here" from `/std/motion/README.md` instead of from a failed render.
 */
export function resolveBrowserSync(explicit?: string): string | null {
  const ok = (p: string) => {
    try {
      // On Windows X_OK degrades to an existence check, which is the right
      // question there anyway.
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  const named = [explicit, process.env.GLOVE_CHROMIUM_PATH, process.env.CHROME_PATH].filter(Boolean) as string[];
  for (const c of named) if (ok(c)) return c;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    try {
      const dirs = readdirSync(root)
        .filter((e) => e.startsWith("chromium"))
        .sort((a, b) => Number(b.startsWith("chromium-")) - Number(a.startsWith("chromium-")));
      for (const d of dirs) {
        for (const rel of PW_BROWSER_SUBPATHS) {
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

  for (const c of systemBrowserCandidates()) if (ok(c)) return c;
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
  /**
   * A scene that throws is dead immediately, and waiting out the mount timeout
   * only converts a one-second answer into a three-minute one — which an agent
   * then retries. `crashed` rejects the moment an uncaught error arrives so the
   * render fails at the speed the cause was actually known.
   *
   * Only `pageerror` counts as fatal. A `console.error` is often React
   * narrating a problem it went on to survive, and aborting on those would
   * fail renders that were about to succeed.
   */
  let fatal: string | null = null;
  let onFatal: ((message: string) => void) | null = null;
  page.on("pageerror", (e) => {
    const text = String(e).slice(0, 400);
    pageErrors.push(text);
    // Recorded as well as signalled: most scene errors throw during `goto`,
    // before anything is waiting to hear about them. Only signalling would
    // drop exactly the common case on the floor.
    fatal ??= text;
    onFatal?.(text);
  });
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

  const bundleName = basename(options.bundle);
  const pageFile = join(dirname(options.bundle), "__page.html");
  await writeFile(pageFile, PAGE_HTML(options.background, bundleName));
  await page.goto(pathToFileURL(pageFile).href, { waitUntil: "load" });

  const crashed = new Promise<never>((_, reject) => {
    const fail = (message: string) =>
      reject(
        new CaptureError(
          `the scene threw while rendering, so it never mounted.\n${message}\n` +
            "Fix the scene and render again — this is the scene's own error, not a renderer failure.",
        ),
      );
    if (fatal) fail(fatal);
    else onFatal = fail;
  });
  // The loser of the race stays pending forever; without this an error arriving
  // after a successful mount would surface as an unhandled rejection.
  crashed.catch(() => {});

  try {
    await Promise.race([
      page.waitForFunction("window.__gloveMounted === true", null, { timeout: options.timeoutMs }),
      crashed,
    ]);
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError(
      `the scene never mounted within ${options.timeoutMs}ms.` +
        (pageErrors.length
          ? `\n${pageErrors.slice(0, 3).join("\n")}`
          : " The page reported no error, so check that the entry file default-exports a component."),
    );
  } finally {
    // Past this point a page error is context for a later frame, not a reason
    // to reject a promise nobody is waiting on.
    onFatal = null;
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

  /**
   * Ask the page which pictures it could not draw.
   *
   * A broken `<img>` raises no page error and fails no request the renderer
   * watches — it just paints nothing, and the render reports success. The
   * browser knows: a decoded image has a non-zero `naturalWidth`.
   */
  const findBrokenImages = async (): Promise<string[]> =>
    (await page.evaluate(`
      Array.from(document.images)
        .filter((i) => !i.complete || i.naturalWidth === 0)
        .map((i) => i.getAttribute('src') || '(no src)')
        .slice(0, 5)
    `)) as string[];

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
    const brokenImages = await findBrokenImages();
    await page.close();
    return { frames: [file], pageErrors, allIdentical: false, brokenImages };
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
  const brokenImages = await findBrokenImages();
  await page.close();

  return { frames, pageErrors, allIdentical: digests.size === 1 && frames.length > 1, brokenImages };
}
