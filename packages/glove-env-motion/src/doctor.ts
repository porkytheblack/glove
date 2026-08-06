/**
 * `doctor()` — is this host ready to render, and if not, what is the one line
 * that fixes it?
 *
 * The renderer's requirements were learned the hard way (five silent failure
 * modes, each costing a diagnostic round), so the check exists in three
 * places with one source of truth: here for the developer configuring a host
 * (`pnpm exec glove-motion-doctor`), in `capabilities()` for the agent at
 * runtime, and in the `/std/motion` docs the agent reads before its first
 * call.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveBrowserSync } from "./capture";
import { ffmpegInstallHint, resolveFfmpegSync } from "./encode";

const require_ = createRequire(import.meta.url);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /** What was found, phrased for a human reading a terminal. */
  detail: string;
  /** The one line that fixes it. Present on every failing check. */
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  /** Same meaning as `motion()`'s: where the host's packages resolve from. */
  resolveFrom?: string;
  browserPath?: string;
  ffmpegPath?: string;
}

/** Resolve the way the bundler will: the host's tree first, then our own. */
function whoHas(name: string, resolveFrom: string): "host" | "bundled" | null {
  try {
    createRequire(join(resolveFrom, "noop.js")).resolve(name);
    return "host";
  } catch {
    /* try our own dependencies */
  }
  try {
    require_.resolve(name);
    return "bundled";
  } catch {
    return null;
  }
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const resolveFrom = options.resolveFrom ?? process.cwd();
  const checks: DoctorCheck[] = [];

  const browser = resolveBrowserSync(options.browserPath);
  checks.push(
    browser
      ? { name: "browser", ok: true, detail: browser }
      : {
          name: "browser",
          ok: false,
          detail: "no Chromium-family browser found — render and still cannot work without one",
          fix:
            "install Google Chrome / Edge / Chromium (found automatically), or run: npx playwright-core install chromium, " +
            "or set GLOVE_CHROMIUM_PATH to a browser binary",
        },
  );

  const ffmpeg = resolveFfmpegSync(options.ffmpegPath);
  checks.push(
    ffmpeg
      ? {
          name: "ffmpeg",
          ok: true,
          detail: ffmpeg.source === "bundled" ? `bundled with the package (${ffmpeg.path})` : `${ffmpeg.path} (from ${ffmpeg.source})`,
        }
      : {
          name: "ffmpeg",
          ok: false,
          detail: `the bundled @ffmpeg-installer has no build for ${process.platform}-${process.arch} and none was found on PATH — video and GIF outputs need it (stills and PNG frames do not)`,
          fix: ffmpegInstallHint(),
        },
  );

  const react = whoHas("react", resolveFrom);
  checks.push(
    react
      ? {
          name: "react",
          ok: true,
          detail: react === "host" ? `the host's copy (resolved from ${resolveFrom})` : "bundled with glove-env-motion — no install needed",
        }
      : {
          name: "react",
          ok: false,
          detail: "react could not be resolved from the host or from this package's own dependencies",
          fix: "reinstall glove-env-motion — react ships with it, so a missing react means a broken install",
        },
  );

  const reanimated = whoHas("react-native-reanimated", resolveFrom);
  if (!reanimated) {
    checks.push({
      name: "reanimated",
      ok: true,
      detail:
        "not installed — useFrame() scenes render with nothing extra; React Native motion code would need: pnpm add react-native-reanimated react-native-web",
    });
  } else {
    const web = whoHas("react-native-web", resolveFrom);
    const plugin =
      whoHas("react-native-worklets/plugin", resolveFrom) ?? whoHas("react-native-reanimated/plugin", resolveFrom);
    if (!web) {
      checks.push({
        name: "reanimated",
        ok: false,
        detail: "react-native-reanimated is installed but react-native-web is not — RN components cannot render on the web without it",
        fix: "pnpm add react-native-web",
      });
    } else if (!plugin) {
      checks.push({
        name: "reanimated",
        ok: false,
        detail:
          "installed, but the worklets Babel plugin is missing — withTiming/useAnimatedStyle would render still frames with no error",
        fix: "reinstall react-native-reanimated (v4 ships the plugin via react-native-worklets)",
      });
    } else {
      checks.push({
        name: "reanimated",
        ok: true,
        detail: "installed with react-native-web and the worklets plugin — React Native motion code renders here",
      });
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
