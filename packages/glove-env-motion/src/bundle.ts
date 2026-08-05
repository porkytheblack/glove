/**
 * Scene source → one browser bundle.
 *
 * Four things here exist because leaving any of them out fails *silently* —
 * no error, no warning, just a scene that renders its first frame and never
 * moves. Each cost a diagnostic round to find, so each is written down.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

const require_ = createRequire(import.meta.url);

/**
 * The slice of Babel used here, declared structurally.
 *
 * `@babel/core` is an OPTIONAL peer — a host that only renders `useFrame()`
 * scenes never installs it — so importing its types would make this package
 * fail to compile wherever it is genuinely absent.
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
  /** Directory whose node_modules supplies react, reanimated, etc. */
  resolveFrom: string;
  /** Absolute path of the emitted runtime, bound to the `glove/motion` import. */
  runtime: string;
  /** Extra esbuild `define` entries. */
  define?: Record<string, string>;
}

export class BundleError extends Error {}

/**
 * Reanimated's model is worklets: functions lifted out of the module and run
 * by its own runtime. That lifting is a **Babel** transform, and esbuild does
 * not run Babel.
 *
 * Without the plugin the bundle builds with zero errors and zero warnings, the
 * page loads with an empty console, the scene renders its initial values —
 * and `useAnimatedStyle(() => …)` stays an ordinary closure that nothing ever
 * calls. Every frame comes out identical. There is nothing to grep for.
 *
 * So the transform is applied to the scene's own sources (not to
 * `node_modules`, which ships pre-compiled), and its absence is a loud error
 * rather than a quiet no-op.
 */
function workletsPlugin(resolveFrom: string, warn: (message: string) => void): esbuild.Plugin {
  return {
    name: "glove-worklets",
    setup(build) {
      let babel: BabelCore | null = null;
      let plugin: string | null = null;
      let preset: string | null = null;

      try {
        const localRequire = createRequire(join(resolveFrom, "noop.js"));
        babel = localRequire("@babel/core") as BabelCore;
        preset = localRequire.resolve("@babel/preset-react");
        // Reanimated 4 moved the plugin into react-native-worklets. Try the
        // new home first, then the old one, so both majors work.
        for (const candidate of ["react-native-worklets/plugin", "react-native-reanimated/plugin"]) {
          try {
            plugin = localRequire.resolve(candidate);
            break;
          } catch {
            /* try the next */
          }
        }
      } catch {
        /* handled below */
      }

      if (!babel || !plugin || !preset) {
        warn(
          "Reanimated worklets are NOT being compiled: " +
            `${!babel ? "@babel/core" : !preset ? "@babel/preset-react" : "react-native-worklets/plugin"} could not be resolved from ${resolveFrom}. ` +
            "Scenes using useAnimatedStyle/withTiming will render a still first frame with no error. " +
            "Install @babel/core@^7, @babel/preset-react and react-native-reanimated to fix it. " +
            "Frame-driven scenes (useFrame) are unaffected.",
        );
        return;
      }

      // Babel 8 rejects the plugin ("Requires Babel ^7.0.0-0, but was loaded
      // with 8.x") from inside a preset it pulls in itself, so the version is
      // checked here where the message can say what to do.
      const version = babel.version ?? "";
      if (!version.startsWith("7.")) {
        throw new BundleError(
          `@babel/core ${version} is installed, but the Reanimated worklets plugin requires Babel 7. ` +
            `Pin "@babel/core": "^7.28.0" — Babel 8 fails inside the plugin's own preset with a confusing message.`,
        );
      }

      build.onLoad({ filter: /\.(jsx?|tsx?)$/ }, async (args) => {
        if (args.path.includes("node_modules")) return null;
        const source = await readFile(args.path, "utf8");
        const out = await babel!.transformAsync(source, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          presets: [
            [preset!, { runtime: "automatic" }],
            // TypeScript scenes go through Babel too, so a .tsx entry does not
            // reach esbuild still carrying types the worklet plugin choked on.
            ...(/\.tsx?$/.test(args.path) ? [[require_.resolve("@babel/preset-typescript"), { isTSX: true, allExtensions: true }] as const] : []),
          ],
          plugins: [plugin!],
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
  /** Non-fatal problems worth surfacing to the agent, e.g. worklets not compiled. */
  warnings: string[];
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
      nodePaths: [join(options.resolveFrom, "node_modules")],
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
      throw new BundleError(formatEsbuild(result.errors));
    }
    const bytes = (await readFile(options.outfile)).byteLength;
    return { outfile: options.outfile, bytes, warnings };
  } catch (e) {
    if (e instanceof BundleError) throw e;
    const errors = (e as { errors?: esbuild.Message[] }).errors;
    throw new BundleError(errors?.length ? formatEsbuild(errors) : e instanceof Error ? e.message : String(e));
  }
}

/** esbuild's own text, trimmed to what an agent can act on. */
function formatEsbuild(errors: esbuild.Message[]): string {
  return errors
    .slice(0, 5)
    .map((e) => {
      const where = e.location ? ` (${e.location.file}:${e.location.line}:${e.location.column})` : "";
      return `${e.text}${where}`;
    })
    .join("\n");
}
