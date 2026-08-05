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
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { defineAdapter, type EnvFsHandle, type StdlibAdapter } from "glove-working-environment";
import { bundleScene } from "./bundle";
import { captureFrames, resolveBrowser } from "./capture";
import { encodeVideo } from "./encode";
import { RUNTIME_SOURCE, entrySource } from "./runtime";
import { MOTION_DOCS, MOTION_TYPES, MOTION_SKILL } from "./docs";

export { resolveBrowser } from "./capture";
export { BundleError } from "./bundle";
export { CaptureError } from "./capture";
export { EncodeError } from "./encode";

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
}

interface RenderArgs {
  fps?: number;
  durationInFrames?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  background?: string;
  mode?: "clock" | "frame";
  crf?: number;
  keepFrames?: string;
}

const DEFAULTS = { fps: 30, width: 1280, height: 720, background: "#ffffff", crf: 18 };

export function motion(options: MotionOptions = {}): StdlibAdapter {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxFrames = options.maxFrames ?? 1800;
  const resolveFrom = options.resolveFrom ?? process.cwd();

  return defineAdapter({
    name: "motion",
    description: "Render a React scene (Reanimated included) to video, animated GIF, PNG frames or a still image.",
    types: MOTION_TYPES,
    docs: MOTION_DOCS,
    skills: [MOTION_SKILL],
    create(vfs: EnvFsHandle) {
      /**
       * Stage the scene and everything it imports onto a real disk.
       *
       * esbuild resolves imports through the real filesystem, and the scene
       * lives in a virtual one — so the whole neighbourhood has to come along,
       * not just the entry file. Copying the entry's directory tree keeps
       * relative imports (`./title.jsx`, `../lib/theme.js`) working exactly as
       * the agent wrote them.
       */
      async function stage(scenePath: string): Promise<{ dir: string; entry: string; runtime: string; cleanup(): Promise<void> }> {
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

        const runtime = join(dir, "glove-motion-runtime.js");
        await writeFile(runtime, RUNTIME_SOURCE);
        const sceneRel = `./scene/${basename(scenePath)}`;
        const entry = join(dir, "__entry.jsx");
        await writeFile(entry, entrySource(sceneRel));

        return { dir, entry, runtime, cleanup: () => rm(dir, { recursive: true, force: true }) };
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
            // A still is one moment, so it is asked for by frame number even
            // when the scene animates against the clock.
            mode: args.mode ?? "clock",
            browserPath: options.browserPath,
            timeoutMs,
          });

          if (capture.pageErrors.length > 0 && capture.allIdentical) {
            throw new Error(
              `every frame came out identical and the scene raised errors:\n${capture.pageErrors.slice(0, 3).join("\n")}`,
            );
          }

          const ext = extname(outPath).toLowerCase();
          const warnings = [...bundle.warnings];
          if (capture.allIdentical && durationInFrames > 1) {
            warnings.push(
              "every frame is identical — the scene is not animating. " +
                "If it uses useAnimatedStyle/withTiming, the Reanimated worklet plugin may not be compiling; " +
                "if it uses useFrame(), pass mode: 'frame'.",
            );
          }

          if (stillFrame !== undefined || ext === ".png") {
            const wanted = capture.frames[stillFrame ?? capture.frames.length - 1];
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
          const frame = args.frame ?? 0;
          if (!Number.isInteger(frame) || frame < 0) {
            throw new Error(`still needs a frame index of 0 or more, got ${frame}`);
          }
          return renderTo(scenePath, outPath, { ...args, mode: args.mode ?? "frame" }, frame);
        },

        /**
         * What the renderer can actually do here, before spending a render
         * finding out. An agent that reads this can say "no browser" instead
         * of retrying a failing call three times.
         */
        async capabilities() {
          const browser = await resolveBrowser(options.browserPath);
          let reanimated = false;
          try {
            const { createRequire } = await import("node:module");
            const r = createRequire(join(resolveFrom, "noop.js"));
            r.resolve("react-native-reanimated");
            r.resolve("react-native-web");
            reanimated = true;
          } catch {
            reanimated = false;
          }
          return {
            browser: browser ?? null,
            canRender: browser !== null,
            reanimated,
            maxFrames,
            formats: [".mp4", ".webm", ".gif", ".png", "directory of frames"],
          };
        },
      };
    },
  });
}

export default motion;
