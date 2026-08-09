/**
 * `glove-env-motion` — React scenes to frames, stills and video.
 *
 * The environment could already produce a PDF, a deck, a workbook and an
 * image. What it could not produce was anything that *moves*, and the reason
 * was never the encoder — ffmpeg has been there since `glove-env-media`. It
 * was that nothing could draw a frame.
 *
 * This draws frames by running React in a headless browser, one frame at a
 * time, against a clock it controls. Two consequences follow, and both matter
 * more than the feature itself:
 *
 * - **Renders are deterministic.** Same scene, same bytes — measured across
 *   independent runs. A re-render after an edit is a real diff.
 * - **Stills come free.** A one-frame render is a PNG, so the same component
 *   that makes a video makes a chart, a title card or a social image. That is
 *   why this is not called `env:video`.
 *
 * Reanimated works here, unchanged — the scene the agent writes can be the
 * same React Native motion code a phone runs. See {@link ./bundle!bundleScene}
 * for the four things that have to be true for that, each of which fails
 * silently when it is not.
 */
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { defineAdapter, type EnvFsHandle, type StdlibAdapter } from "glove-working-environment";
import { browserFleetCap, limitBrowserFleet } from "./browser-pool";
import { bundleScene } from "./bundle";
import { captureFrames, resolveBrowser, resolveBrowserSync } from "./capture";
import { encodeVideo } from "./encode";
import { RUNTIME_SOURCE, entrySource } from "./runtime";
import { MOTION_DOCS, MOTION_TYPES, MOTION_SKILL, hostNotes } from "./docs";

export { resolveBrowser } from "./capture";
export { BundleError } from "./bundle";
export {
  browserFleetCap,
  browserFleetStats,
  closeMotionBrowsers,
  limitBrowserFleet,
  BrowserFleetError,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_BROWSERS,
} from "./browser-pool";
export { CaptureError, systemBrowserCandidates, PW_BROWSER_SUBPATHS } from "./capture";
export { EncodeError, ffmpegInstallHint, resolveFfmpegSync, type FfmpegResolution } from "./encode";
export { doctor, type DoctorCheck, type DoctorOptions, type DoctorReport } from "./doctor";

export interface MotionOptions {
  /**
   * Directory whose `node_modules` supplies react, react-dom and (optionally)
   * react-native-web + react-native-reanimated.
   *
   * Defaults to the host process's cwd, which is right when the app that
   * mounts this adapter depends on them itself. Point it elsewhere to keep a
   * dedicated scene toolchain out of the app's own tree.
   */
  resolveFrom?: string;
  /** Explicit Chromium binary. Auto-detected from PLAYWRIGHT_BROWSERS_PATH etc. */
  browserPath?: string;
  ffmpegPath?: string;
  /** Wall-clock budget for one render. Default 180_000. */
  timeoutMs?: number;
  /**
   * Hard ceiling on frames per render. Default 1800 (a minute at 30fps).
   *
   * A frame is a screenshot, and an agent that asks for ten minutes of video
   * will sit there for an hour and fill the tree. Refusing early with the
   * number in the message is kinder than a timeout at frame 4000.
   */
  maxFrames?: number;
  /**
   * Chromium processes allowed across **every** environment in this process,
   * not just this one. `maxFrames` bounds a single render; this bounds the
   * fleet, which is the number that decides whether a multi-tenant host stays
   * up. Default {@link DEFAULT_MAX_BROWSERS}, or `GLOVE_MOTION_MAX_BROWSERS`.
   *
   * Because the fleet is process-wide, so is this setting: when two adapters
   * name different values the smallest wins. See {@link limitBrowserFleet}.
   */
  maxBrowsers?: number;
  /**
   * How long this environment's browser is kept alive between renders.
   * Default {@link DEFAULT_IDLE_MS}. Longer keeps more renders warm; shorter
   * gives the memory back sooner.
   */
  browserIdleMs?: number;
}

/** Distinguishes one adapter instance's browser from another's. */
let instances = 0;

interface RenderArgs {
  fps?: number;
  durationInFrames?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  background?: string;
  mode?: "auto" | "clock" | "frame";
  crf?: number;
  keepFrames?: string;
}

const DEFAULTS = { fps: 30, width: 1280, height: 720, background: "#ffffff", crf: 18 };

/**
 * Environment limits that fit a render.
 *
 * A render is a browser launch plus a screenshot per frame, and the
 * environment's default 30s ceiling is nowhere near that. `runTimeoutMs` is
 * the **most** any one run may be granted, not what every run gets: a script
 * asks for the time it needs with `run_script`'s `timeout_ms`, and that is
 * clamped to this. So raising it here does not hand four minutes to an
 * accidental `for(;;)` — it only makes four minutes askable for.
 *
 * Mount it beside the adapter — `createWorkingEnvironment({ stdlib: [motion()],
 * limits: MOTION_LIMITS })` — or forget to, and a render that cannot fit
 * refuses up front, naming both the `timeout_ms` to ask for and this ceiling.
 */
export const MOTION_LIMITS = { runTimeoutMs: 240_000 } as const;

export function motion(options: MotionOptions = {}): StdlibAdapter {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxFrames = options.maxFrames ?? 1800;
  const resolveFrom = options.resolveFrom ?? process.cwd();
  if (options.maxBrowsers !== undefined) limitBrowserFleet(options.maxBrowsers);

  // Resolution the way the bundler does it: the host's tree first, then this
  // package's own dependencies. Used for the docs below and by capabilities().
  const localRequire = createRequire(join(resolveFrom, "noop.js"));
  const selfRequire = createRequire(import.meta.url);
  const seen = (name: string): boolean => {
    try {
      localRequire.resolve(name);
      return true;
    } catch {
      /* fall through to our own dependencies */
    }
    try {
      selfRequire.resolve(name);
      return true;
    } catch {
      return false;
    }
  };

  return defineAdapter({
    name: "motion",
    description: "Render a React scene (Reanimated included) to video, animated GIF, PNG frames or a still image.",
    types: MOTION_TYPES,
    // The generated /std/motion/README.md tells the agent what THIS host can
    // actually do, so "no browser here" is learned from the docs instead of
    // from a failed render.
    docs:
      MOTION_DOCS +
      hostNotes({
        browser: resolveBrowserSync(options.browserPath) !== null,
        reanimated: seen("react-native-reanimated") && seen("react-native-web"),
      }),
    skills: [MOTION_SKILL],
    create(vfs: EnvFsHandle) {
      // One key per adapter instance, so one environment gets one browser and
      // no two environments ever share a Chromium process.
      const browserKey = `motion-${++instances}`;

      /**
       * Stage the scene and everything it imports onto a real disk.
       *
       * esbuild resolves imports through the real filesystem, and the scene
       * lives in a virtual one — so the whole neighbourhood has to come along,
       * not just the entry file. Copying the entry's directory tree keeps
       * relative imports (`./title.jsx`, `../lib/theme.js`) working exactly as
       * the agent wrote them.
       */
      async function stage(scenePath: string): Promise<{
        dir: string;
        entry: string;
        runtime: string;
        /** Absolute VFS paths the scene names as assets that are not in the tree. */
        missing: string[];
        cleanup(): Promise<void>;
      }> {
        const dir = await mkdtemp(join(tmpdir(), "glove-motion-"));
        const sceneDir = dirname(scenePath);
        const files = await vfs.glob(`${sceneDir}/**`);

        for (const p of files) {
          if (!/\.(jsx?|tsx?|json|css|svg)$/i.test(p)) continue;
          const rel = relative(sceneDir, p);
          const dest = join(dir, "scene", rel);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, await vfs.readBytes(p));
        }

        // Images the scene references have to be real files too, or the page
        // renders empty boxes where the pictures should be.
        for (const p of await vfs.glob(`${sceneDir}/**`)) {
          if (!/\.(png|jpe?g|gif|webp|avif|woff2?|ttf|otf|mp4|webm)$/i.test(p)) continue;
          const dest = join(dir, "scene", relative(sceneDir, p));
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, await vfs.readBytes(p));
        }

        /**
         * Assets the scene names by absolute VFS path — `/inbox/bag.webp`.
         *
         * The page is a `file://` URL, so an absolute src resolves against the
         * real filesystem root and quietly finds nothing. Uploaded photos live
         * in `/inbox`, which is the single most obvious thing to put in a
         * video, and it produced a broken-image box with no warning and no
         * error. Each referenced file is staged next to the page and the
         * literal is rewritten to point at the copy.
         */
        const ASSET = /(["'`])(\/[^"'`\s]+\.(?:png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|mp4|webm|mp3|wav))\1/gi;
        const staged = new Map<string, string>();
        const missing: string[] = [];

        for (const p of files) {
          if (!/\.(jsx?|tsx?|css)$/i.test(p)) continue;
          const source = new TextDecoder().decode(await vfs.readBytes(p));
          let rewritten = source;
          for (const [, , vfsPath] of source.matchAll(ASSET)) {
            if (staged.has(vfsPath) || missing.includes(vfsPath)) {
              // already resolved on an earlier file
            } else if (await vfs.exists(vfsPath)) {
              const dest = join(dir, "assets", vfsPath);
              await mkdir(dirname(dest), { recursive: true });
              await writeFile(dest, await vfs.readBytes(vfsPath));
              staged.set(vfsPath, `./assets${vfsPath}`);
            } else {
              missing.push(vfsPath);
            }
            const local = staged.get(vfsPath);
            if (local) rewritten = rewritten.split(vfsPath).join(local);
          }
          if (rewritten !== source) {
            await writeFile(join(dir, "scene", relative(sceneDir, p)), rewritten);
          }
        }

        const runtime = join(dir, "glove-motion-runtime.js");
        await writeFile(runtime, RUNTIME_SOURCE);
        const sceneRel = `./scene/${basename(scenePath)}`;
        const entry = join(dir, "__entry.jsx");
        await writeFile(entry, entrySource(sceneRel));

        return { dir, entry, runtime, missing, cleanup: () => rm(dir, { recursive: true, force: true }) };
      }

      async function renderTo(scenePath: string, outPath: string, args: RenderArgs, stillFrame?: number) {
        if (typeof scenePath !== "string" || !scenePath.startsWith("/")) {
          throw new Error(`render needs an absolute VFS path to the scene, got ${JSON.stringify(scenePath)}`);
        }
        if (!(await vfs.exists(scenePath))) throw new Error(`no such scene: ${scenePath}`);
        if (typeof outPath !== "string" || !outPath.startsWith("/")) {
          throw new Error(`render needs an absolute VFS output path, got ${JSON.stringify(outPath)}`);
        }

        const fps = args.fps ?? DEFAULTS.fps;
        const width = args.width ?? DEFAULTS.width;
        const height = args.height ?? DEFAULTS.height;
        const durationInFrames =
          stillFrame !== undefined
            ? stillFrame + 1
            : (args.durationInFrames ?? Math.round((args.durationSeconds ?? 3) * fps));

        if (!Number.isFinite(durationInFrames) || durationInFrames < 1) {
          throw new Error(`durationInFrames must be at least 1, got ${durationInFrames}`);
        }
        if (durationInFrames > maxFrames) {
          throw new Error(
            `${durationInFrames} frames exceeds the ${maxFrames}-frame limit (${(maxFrames / fps).toFixed(0)}s at ${fps}fps). ` +
              `Render a shorter scene, or lower fps — each frame is a full browser screenshot.`,
          );
        }

        // Refuse work that cannot fit the time this run can be granted, up
        // front and with the fix, instead of letting the wall-clock kill it
        // mid-render with a generic timeout.
        //
        // The 20s head is deliberately kept, even though a browser launch is
        // no longer paid per render (see ./browser-pool). The FIRST render in
        // an environment still pays a cold launch, and that is the one this
        // has to be safe for; the later ones only ever come in under it. Being
        // wrong high refuses a render that would have fit, which the agent can
        // see and answer. Being wrong low kills a render at frame 400, which
        // is the whole thing this check exists to prevent — so lowering it
        // wants a measurement of a full-size multi-frame render, not a guess
        // from the stills measured here.
        // ~330ms per screenshot, ~30ms per walked-but-not-captured frame.
        const ceilingMs = vfs.limits.runTimeoutMs;
        const screenshots = stillFrame !== undefined ? 1 : durationInFrames;
        const walked = stillFrame !== undefined ? stillFrame : 0;
        const estimateMs = 20_000 + screenshots * 330 + walked * 30;
        if (estimateMs > ceilingMs) {
          const suggest = Math.max(120_000, Math.ceil((estimateMs * 1.5) / 60_000) * 60_000);
          throw new Error(
            `a ${durationInFrames}-frame render needs roughly ${Math.ceil(estimateMs / 1000)}s — bundling, then a screenshot per frame. ` +
              `Ask for that time on the call: run_script with timeout_ms: ${estimateMs}. ` +
              `This environment allows at most ${ceilingMs}ms per run (limits.runTimeoutMs) and timeout_ms is clamped to it, ` +
              `so the ceiling has to come up too: create the environment with limits: { runTimeoutMs: ${suggest} } ` +
              `(this package exports MOTION_LIMITS as a good default), or render fewer frames.`,
          );
        }

        const staged = await stage(scenePath);
        try {
          const bundle = await bundleScene({
            entry: staged.entry,
            outfile: join(staged.dir, "bundle.js"),
            resolveFrom,
            runtime: staged.runtime,
          });

          const frameDir = join(staged.dir, "frames");
          const capture = await captureFrames({
            bundle: bundle.outfile,
            outDir: frameDir,
            width,
            height,
            fps,
            durationInFrames,
            background: args.background ?? DEFAULTS.background,
            // "auto" drives both the frame number and the clock, so a scene
            // animates without the caller knowing which kind it is.
            mode: args.mode ?? "auto",
            ...(stillFrame !== undefined ? { still: stillFrame } : {}),
            browserPath: options.browserPath,
            browserKey,
            browserIdleMs: options.browserIdleMs,
            // Never wait longer for a permit than the render itself may take.
            browserWaitMs: timeoutMs,
            timeoutMs,
          });

          if (capture.pageErrors.length > 0 && capture.allIdentical) {
            throw new Error(
              `every frame came out identical and the scene raised errors:\n${capture.pageErrors.slice(0, 3).join("\n")}`,
            );
          }

          const ext = extname(outPath).toLowerCase();
          const warnings = [...bundle.warnings];
          // A picture that did not load is the failure most likely to ship: the
          // render succeeds, the file is valid, and the hole where the product
          // should be is only visible by looking. Both halves are reported —
          // paths that are not in the tree at all, and anything the browser
          // could not draw for any other reason.
          for (const p of staged.missing) {
            warnings.push(
              `the scene references ${p}, which is not in this environment — that image will render as an empty box. ` +
                `Check the path with ls, or mount the file first.`,
            );
          }
          for (const src of capture.brokenImages) {
            warnings.push(`an image failed to load and rendered as an empty box: ${src}`);
          }
          if (capture.allIdentical && durationInFrames > 1) {
            warnings.push(
              "every frame is identical — the scene is not animating. " +
                "Check that the animation actually starts (an effect that never fires, a zero duration), " +
                "and that the scene moves with useFrame() or an animation library rather than real wall-clock time.",
            );
          }

          if (stillFrame !== undefined || ext === ".png") {
            const wanted = stillFrame !== undefined ? capture.frames[0] : capture.frames[capture.frames.length - 1];
            await vfs.writeFile(outPath, await readFile(wanted));
            return { path: outPath, width, height, frames: 1, warnings };
          }

          if (ext === "" || ext === "/") {
            // A directory target means the agent wants the frames themselves,
            // to composite or contact-sheet with env:images.
            await vfs.mkdir(outPath);
            const written: string[] = [];
            for (const f of await readdir(frameDir)) {
              const dest = `${outPath.replace(/\/$/, "")}/${f}`;
              await vfs.writeFile(dest, await readFile(join(frameDir, f)));
              written.push(dest);
            }
            return { path: outPath, width, height, fps, frames: written.length, files: written, warnings };
          }

          const video = join(staged.dir, `out${ext || ".mp4"}`);
          const encoded = await encodeVideo({
            frameDir,
            outFile: video,
            fps,
            crf: args.crf ?? DEFAULTS.crf,
            ffmpegPath: options.ffmpegPath,
            timeoutMs,
          });
          await vfs.writeFile(outPath, await readFile(video));

          if (args.keepFrames) {
            await vfs.mkdir(args.keepFrames);
            for (const f of await readdir(frameDir)) {
              await vfs.writeFile(`${args.keepFrames.replace(/\/$/, "")}/${f}`, await readFile(join(frameDir, f)));
            }
          }

          return {
            path: outPath,
            width,
            height,
            fps,
            frames: durationInFrames,
            durationSeconds: Number((durationInFrames / fps).toFixed(3)),
            bytes: encoded.bytes,
            warnings,
          };
        } finally {
          await staged.cleanup();
        }
      }

      return {
        /** Render a scene to `.mp4`, `.webm`, `.gif`, a `.png`, or a directory of frames. */
        async render(scenePath: string, outPath: string, args: RenderArgs = {}) {
          return renderTo(scenePath, outPath, args);
        },

        /** One frame as a PNG — a chart, a title card, a social image. */
        async still(scenePath: string, outPath: string, args: RenderArgs & { frame?: number } = {}) {
          const raw: unknown = args.frame ?? 0;
          // Script arguments arrive as JSON a model wrote, where "78" and 78
          // are the same intent. Rejecting the string was defensible; printing
          // it as `got 78` was not — the message then states a rule the
          // printed value satisfies, which reads as a broken validator and
          // sends the reader hunting in the wrong place.
          const frame: number = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : (raw as number);
          if (!Number.isInteger(frame) || frame < 0) {
            throw new Error(
              `still needs a frame index of 0 or more, got ${JSON.stringify(raw)} (${typeof raw}). ` +
                `Pass a whole number, e.g. { frame: 78 }.`,
            );
          }
          return renderTo(scenePath, outPath, args, frame);
        },

        /**
         * What the renderer can actually do here, before spending a render
         * finding out. An agent that reads this can say "no browser" instead
         * of retrying a failing call three times.
         */
        async capabilities() {
          const browser = await resolveBrowser(options.browserPath);
          return {
            browser: browser ?? null,
            canRender: browser !== null,
            reanimated: seen("react-native-reanimated") && seen("react-native-web"),
            maxFrames,
            /** Concurrent renders allowed across every environment in this process. */
            maxBrowsers: browserFleetCap(),
            formats: [".mp4", ".webm", ".gif", ".png", "directory of frames"],
          };
        },
      };
    },
  });
}

export default motion;
