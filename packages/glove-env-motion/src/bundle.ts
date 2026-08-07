/**
 * Scene source → one browser bundle.
 *
 * Five things have to be true here, and each fails *silently* when it is not
 * — no error, no warning, just a scene that renders its first frame and never
 * moves. Each cost a diagnostic round to find, which is exactly why none of
 * them is the host's problem anymore:
 *
 * - **The worklets Babel transform runs on our own Babel.** Reanimated's
 *   model is worklets, lifted by a Babel plugin, and esbuild does not run
 *   Babel. `@babel/core@^7` + the presets are *dependencies* of this package
 *   — the host's Babel (any version, or none) never enters the picture, so
 *   the plugin's `assertVersion(7)` cannot fail on someone else's install.
 * - **React ships with the package.** The host's copy wins when present
 *   (`resolveFrom` first); ours is the fallback, so a bare server host with
 *   no React of its own still renders `useFrame()` scenes out of the box.
 * - **`.web.js` beats `.js`** so the native runtime never gets bundled.
 * - The clock and the page-load path live in {@link ../capture}, with the
 *   same rule: internal, checked, not configuration.
 *
 * What remains for the host is the actual opt-in — installing
 * `react-native-reanimated` + `react-native-web` if scenes use them — and a
 * missing install fails with the command to run, not with still frames.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const require_ = createRequire(import.meta.url);

/** This package's root, so its own node_modules can serve as a fallback. */
const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where imports resolve from, in order: the host's tree first (their React,
 * their Reanimated version), then this package's own dependencies. The staged
 * scene lives in a temp dir with no node_modules of its own, so *everything*
 * flows through this list — which is what makes the order dependable.
 */
const FALLBACK_NODE_PATHS = [join(PKG_ROOT, "node_modules"), dirname(PKG_ROOT)];

/**
 * The slice of Babel used here, declared structurally so the type does not
 * depend on @types packages.
 */
interface BabelCore {
  version?: string;
  transformAsync(
    code: string,
    options: Record<string, unknown>,
  ): Promise<{ code?: string | null } | null>;
}

export interface BundleOptions {
  /** Absolute host path of the scene entry (already staged out of the VFS). */
  entry: string;
  /** Where to write the bundle. */
  outfile: string;
  /** Directory whose node_modules supplies the host's react, reanimated, etc. */
  resolveFrom: string;
  /** Absolute path of the emitted runtime, bound to the `glove/motion` import. */
  runtime: string;
  /** Extra esbuild `define` entries. */
  define?: Record<string, string>;
}

export class BundleError extends Error {}

/** Resolve a specifier the same way the bundle will: host first, then us. */
function resolvable(name: string, resolveFrom: string): string | null {
  try {
    return createRequire(join(resolveFrom, "noop.js")).resolve(name);
  } catch {
    /* fall through to our own tree */
  }
  try {
    return require_.resolve(name);
  } catch {
    return null;
  }
}

/**
 * Reanimated's worklets, lifted with our own pinned Babel 7.
 *
 * Only the scene's sources are transformed — `node_modules` ships
 * pre-compiled. When Reanimated is not installed at all, the transform is
 * skipped silently on purpose: a `useFrame()` scene has no worklets to lift,
 * and a scene that *does* import Reanimated fails at resolution with the
 * install command (see {@link friendlyResolveError}), which is the loud path.
 * The one case that warns is Reanimated present but its plugin missing —
 * that is the configuration that would otherwise render still frames.
 */
function workletsPlugin(resolveFrom: string, warn: (message: string) => void): esbuild.Plugin {
  return {
    name: "glove-worklets",
    setup(build) {
      // Reanimated 4 ships the plugin in react-native-worklets; 3 carried its
      // own. Both are looked for wherever the bundle would find Reanimated.
      const plugin =
        resolvable("react-native-worklets/plugin", resolveFrom) ??
        resolvable("react-native-reanimated/plugin", resolveFrom);

      if (!plugin) {
        if (resolvable("react-native-reanimated", resolveFrom)) {
          warn(
            "react-native-reanimated is installed but its worklets Babel plugin could not be found — " +
              "scenes using useAnimatedStyle/withTiming will render a still first frame with no error. " +
              "Reinstall react-native-reanimated (v4 ships the plugin via react-native-worklets). " +
              "Frame-driven scenes (useFrame) are unaffected.",
          );
        }
        return;
      }

      const babel = require_("@babel/core") as BabelCore;
      const presetReact = require_.resolve("@babel/preset-react");
      const presetTs = require_.resolve("@babel/preset-typescript");

      build.onLoad({ filter: /\.(jsx?|tsx?)$/ }, async (args) => {
        if (args.path.includes("node_modules")) return null;
        const source = await readFile(args.path, "utf8");
        const out = await babel.transformAsync(source, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          presets: [
            [presetReact, { runtime: "automatic" }],
            ...(/\.tsx?$/.test(args.path) ? [[presetTs, { isTSX: true, allExtensions: true }] as const] : []),
          ],
          plugins: [plugin],
          sourceMaps: false,
        });
        return { contents: out?.code ?? source, loader: "js" };
      });
    },
  };
}

export interface BundleResult {
  outfile: string;
  bytes: number;
  /** Non-fatal problems worth surfacing to the agent. */
  warnings: string[];
}

/**
 * A missing package should read as the command that fixes it, not as a
 * bundler resolution trace four directories deep.
 */
function friendlyResolveError(text: string, resolveFrom: string): string | null {
  if (/Could not resolve "react-native-(reanimated|worklets)/.test(text)) {
    return (
      `the scene imports react-native-reanimated, which is not installed (looked in ${resolveFrom} and in this package's own dependencies). ` +
      `Either install it — pnpm add react-native-reanimated react-native-web — or write the scene against 'glove/motion' (useFrame, interpolate), which needs no extra packages.`
    );
  }
  if (/Could not resolve "react-native-web"/.test(text)) {
    return (
      `the scene imports react-native components, which render on the web through react-native-web. ` +
      `pnpm add react-native-web (and react-native-reanimated if the scene animates with it).`
    );
  }
  if (/Could not resolve "(react|react-dom)(\/|")/.test(text)) {
    return (
      `react could not be resolved from ${resolveFrom} or from glove-env-motion's own dependencies — ` +
      `the install looks broken; reinstall glove-env-motion.`
    );
  }
  return null;
}

export async function bundleScene(options: BundleOptions): Promise<BundleResult> {
  const warnings: string[] = [];
  const entryDir = dirname(options.entry);

  try {
    const result = await esbuild.build({
      entryPoints: [options.entry],
      bundle: true,
      outfile: options.outfile,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      target: "es2022",
      absWorkingDir: entryDir,
      nodePaths: [join(options.resolveFrom, "node_modules"), ...FALLBACK_NODE_PATHS],
      // `react-native` is what a Reanimated scene imports; on a browser it has
      // to become react-native-web. Aliasing rather than asking the author to
      // write the web import keeps copy-pasted React Native code working.
      alias: {
        "react-native": "react-native-web",
        // `glove/motion` is not a package — it is emitted beside the scene so
        // it compiles with the same React instance. Resolved separately the
        // page would get two Reacts and every hook would throw.
        "glove/motion": options.runtime,
      },
      // React Native ships platform-specific files. `.web.js` must win over
      // `.js`, or the NATIVE runtime gets bundled and silently does nothing in
      // a browser.
      resolveExtensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
      define: {
        "process.env.NODE_ENV": '"production"',
        __DEV__: "false",
        global: "window",
        ...options.define,
      },
      // Untranspiled JSX inside react-native-web's published source.
      loader: { ".js": "jsx" },
      plugins: [workletsPlugin(options.resolveFrom, (m) => warnings.push(m))],
      logLevel: "silent",
      metafile: false,
    });

    if (result.errors.length > 0) {
      throw new BundleError(formatEsbuild(result.errors, options.resolveFrom));
    }
    const bytes = (await readFile(options.outfile)).byteLength;
    return { outfile: options.outfile, bytes, warnings };
  } catch (e) {
    if (e instanceof BundleError) throw e;
    const errors = (e as { errors?: esbuild.Message[] }).errors;
    throw new BundleError(
      errors?.length ? formatEsbuild(errors, options.resolveFrom) : e instanceof Error ? e.message : String(e),
    );
  }
}

/** esbuild's own text, trimmed to what an agent can act on. */
function formatEsbuild(errors: esbuild.Message[], resolveFrom: string): string {
  const raw = errors
    .slice(0, 5)
    .map((e) => {
      const where = e.location ? ` (${e.location.file}:${e.location.line}:${e.location.column})` : "";
      return `${e.text}${where}`;
    })
    .join("\n");
  const friendly = friendlyResolveError(raw, resolveFrom);
  return friendly ? `${friendly}\n(bundler: ${raw.split("\n")[0]})` : raw;
}
