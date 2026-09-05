/**
 * A real-media reference adapter for the example. It renders actual MP4 bytes
 * with ffmpeg so every glove-video mode can be exercised without a hosted
 * video-generation account. It is intentionally an example, not an AI model.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ResolvedVideoReference,
  VideoCallContext,
  VideoExtendRequest,
  VideoGenerateRequest,
  VideoModelAdapter,
  VideoModelResult,
  VideoTransformRequest,
} from "glove-video";

const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

function dimensions(request: VideoGenerateRequest): { width: number; height: number } {
  if (request.params.aspectRatio === "9:16") return { width: 360, height: 640 };
  return { width: 640, height: 360 };
}

function extension(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "video/webm") return ".webm";
  if (mime.startsWith("image/")) return ".png";
  return ".mp4";
}

function imageReference(refs: ResolvedVideoReference[]): ResolvedVideoReference | undefined {
  return refs.find(
    (ref) =>
      ref.mime.startsWith("image/") &&
      (ref.role === "first-frame" || ref.role === "identity" || ref.role === "style"),
  );
}

async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  await execFileAsync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    signal,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function withWorkspace<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "glove-video-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function output(
  path: string,
  request: VideoGenerateRequest,
  job: string,
): Promise<VideoModelResult> {
  const bytes = new Uint8Array(await readFile(path));
  const { width, height } = dimensions(request);
  const duration = request.params.duration ?? 2;
  return {
    videos: [
      {
        bytes,
        mime: "video/mp4",
        width,
        height,
        duration,
        fps: 24,
        has_audio: false,
      },
    ],
    provider_job_ids: [job],
    usage: { requests: 1, seconds_generated: duration },
  };
}

async function notify(
  ctx: VideoCallContext | undefined,
  phase: "queued" | "generating" | "downloading",
  progress: number,
  job: string,
): Promise<void> {
  await ctx?.onProgress?.({ phase, progress, provider_job_id: job });
}

async function generate(
  request: VideoGenerateRequest,
  ctx?: VideoCallContext,
): Promise<VideoModelResult> {
  const job = `local-generate-${Date.now()}`;
  await notify(ctx, "queued", 0, job);
  return withWorkspace(async (directory) => {
    const resultPath = join(directory, "output.mp4");
    const duration = request.params.duration ?? 2;
    const { width, height } = dimensions(request);
    const frames = Math.max(1, Math.round(duration * 24));
    const ref = imageReference(request.refs);
    await notify(ctx, "generating", 0.2, job);
    if (ref) {
      const inputPath = join(directory, `reference${extension(ref.mime)}`);
      await writeFile(inputPath, ref.bytes);
      await runFfmpeg(
        [
          "-loop",
          "1",
          "-i",
          inputPath,
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0015,1.10)':d=${frames}:s=${width}x${height}:fps=24,format=yuv420p`,
          "-frames:v",
          String(frames),
          "-an",
          "-c:v",
          "libx264",
          "-movflags",
          "+faststart",
          resultPath,
        ],
        ctx?.signal,
      );
    } else {
      await runFfmpeg(
        [
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=${width}x${height}:rate=24:duration=${duration}`,
          "-vf",
          "format=yuv420p",
          "-an",
          "-c:v",
          "libx264",
          "-movflags",
          "+faststart",
          resultPath,
        ],
        ctx?.signal,
      );
    }
    await notify(ctx, "downloading", 1, job);
    return output(resultPath, request, job);
  });
}

async function renderFromSource(
  request: VideoExtendRequest | VideoTransformRequest,
  mode: "extend" | "transform",
  ctx?: VideoCallContext,
): Promise<VideoModelResult> {
  const job = `local-${mode}-${Date.now()}`;
  await notify(ctx, "queued", 0, job);
  return withWorkspace(async (directory) => {
    const inputPath = join(directory, `source${extension(request.source.mime)}`);
    const resultPath = join(directory, "output.mp4");
    await writeFile(inputPath, request.source.bytes);
    const duration = request.params.duration ?? 2;
    const { width, height } = dimensions(request);
    const videoFilter =
      mode === "extend"
        ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},hflip,format=yuv420p`
        : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},hue=h=35:s=1.25,format=yuv420p`;
    await notify(ctx, "generating", 0.25, job);
    await runFfmpeg(
      [
        "-stream_loop",
        "-1",
        "-i",
        inputPath,
        "-t",
        String(duration),
        "-vf",
        videoFilter,
        "-an",
        "-c:v",
        "libx264",
        "-movflags",
        "+faststart",
        resultPath,
      ],
      ctx?.signal,
    );
    await notify(ctx, "downloading", 1, job);
    return output(resultPath, request, job);
  });
}

export function localFfmpegVideo(): VideoModelAdapter {
  return {
    name: "local-ffmpeg:reference",
    capabilities: {
      modes: ["text-to-video", "image-to-video", "video-to-video", "extend"],
      maxRefs: 3,
      refRoles: ["first-frame", "identity", "style", "continuity", "source"],
      durations: [2, 3],
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["360p"],
      audio: false,
      negativePrompt: false,
      seed: false,
      maxCandidates: 1,
    },
    generate,
    extend: (request, ctx) => renderFromSource(request, "extend", ctx),
    transform: (request, ctx) => renderFromSource(request, "transform", ctx),
  };
}
