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
import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

export class EncodeError extends Error {}

let cached: string | null = null;

async function ffmpegPath(override?: string): Promise<string> {
  if (override) return override;
  if (cached) return cached;
  try {
    const mod = require_("@ffmpeg-installer/ffmpeg") as { path: string };
    // The installed binary is not reliably executable after some package
    // managers unpack it; the same fix glove-env-media makes.
    await chmod(mod.path, 0o755).catch(() => {});
    cached = mod.path;
    return cached;
  } catch {
    throw new EncodeError(
      "ffmpeg is not available. Install @ffmpeg-installer/ffmpeg, or pass ffmpegPath to motion().",
    );
  }
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
