/**
 * PNG frames → a video file.
 *
 * Thin on purpose. `glove-env-media` already owns ffmpeg for the agent, and
 * everything past "turn these frames into an mp4" — trimming, concatenating,
 * adding audio — belongs there. This exists so a render produces a playable
 * file in one call instead of leaving a directory of PNGs the agent has to
 * know what to do with.
 */
import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

export class EncodeError extends Error {}

export interface FfmpegResolution {
  path: string;
  /** Where it came from — the doctor shows this to the host. */
  source: "option" | "env" | "bundled" | "PATH";
}

/**
 * Find an ffmpeg, on any platform.
 *
 * The bundled `@ffmpeg-installer/ffmpeg` covers the common platform/arch
 * pairs, but not all of them — and a host that installed ffmpeg themselves
 * (brew, winget, apt) should not need to configure anything. So: an explicit
 * answer first (option, then GLOVE_FFMPEG_PATH / FFMPEG_PATH), the bundled
 * binary second, and a `ffmpeg` on PATH as the fallback for the platforms the
 * installer does not ship.
 */
export function resolveFfmpegSync(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): FfmpegResolution | null {
  const usable = (p: string) => {
    try {
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  if (explicit) return { path: explicit, source: "option" };
  for (const name of ["GLOVE_FFMPEG_PATH", "FFMPEG_PATH"] as const) {
    const p = env[name];
    if (p && usable(p)) return { path: p, source: "env" };
  }

  try {
    const mod = require_("@ffmpeg-installer/ffmpeg") as { path: string };
    if (mod.path) return { path: mod.path, source: "bundled" };
  } catch {
    /* no build for this platform/arch — fall through to PATH */
  }

  const exe = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, exe);
    if (usable(p)) return { path: p, source: "PATH" };
  }
  return null;
}

/** The install command for THIS platform, for error messages and the doctor. */
export function ffmpegInstallHint(platform: NodeJS.Platform = process.platform): string {
  const cmd =
    platform === "darwin" ? "brew install ffmpeg" : platform === "win32" ? "winget install Gyan.FFmpeg" : "apt install ffmpeg";
  return `install it (${cmd}) so it is on PATH, or pass ffmpegPath to motion()`;
}

async function ffmpegPath(override?: string): Promise<string> {
  const found = resolveFfmpegSync(override);
  if (!found) {
    throw new EncodeError(
      `ffmpeg is not available: the bundled @ffmpeg-installer has no build for ${process.platform}-${process.arch} and none was found on PATH. ` +
        `Video and GIF outputs need it (stills and PNG frames do not) — ${ffmpegInstallHint()}.`,
    );
  }
  if (found.source === "bundled" && process.platform !== "win32") {
    // The installed binary is not reliably executable after some package
    // managers unpack it; the same fix glove-env-media makes.
    await chmod(found.path, 0o755).catch(() => {});
  }
  return found.path;
}

export interface EncodeOptions {
  frameDir: string;
  outFile: string;
  fps: number;
  /** 0–51; lower is better and bigger. 18 is visually lossless. */
  crf: number;
  ffmpegPath?: string;
  timeoutMs: number;
}

export async function encodeVideo(options: EncodeOptions): Promise<{ bytes: number }> {
  const bin = await ffmpegPath(options.ffmpegPath);
  const isWebm = options.outFile.toLowerCase().endsWith(".webm");
  const isGif = options.outFile.toLowerCase().endsWith(".gif");

  const args = [
    "-y",
    "-loglevel", "error",
    "-framerate", String(options.fps),
    "-i", join(options.frameDir, "frame-%05d.png"),
  ];

  if (isGif) {
    // One pass would quantise each frame against its own palette and the
    // result shimmers. Building a palette from the whole sequence first is
    // the standard fix and costs one extra filter, not an extra pass.
    args.push("-vf", `split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`);
  } else if (isWebm) {
    args.push("-c:v", "libvpx-vp9", "-crf", String(options.crf), "-b:v", "0", "-pix_fmt", "yuv420p");
  } else {
    args.push(
      "-c:v", "libx264",
      "-crf", String(options.crf),
      "-preset", "medium",
      // Without yuv420p the file plays in ffplay and in nothing else —
      // QuickTime and most browsers refuse yuv444.
      "-pix_fmt", "yuv420p",
      // H.264 needs even dimensions; a 1281px-wide scene would otherwise fail
      // deep inside the encoder with a message about no such filter.
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-movflags", "+faststart",
    );
  }
  args.push(options.outFile);

  await new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: options.timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        const detail = String(stderr ?? "").trim().split("\n").slice(-3).join("\n");
        reject(new EncodeError(`ffmpeg failed: ${detail || err.message}`));
        return;
      }
      resolve();
    });
  });

  const info = await stat(options.outFile).catch(() => null);
  if (!info || info.size === 0) {
    throw new EncodeError(`ffmpeg reported success but wrote no data to ${options.outFile}`);
  }
  return { bytes: info.size };
}
