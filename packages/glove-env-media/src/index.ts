/**
 * `env:media` — video and audio, through ffmpeg, inside the agent's virtual
 * filesystem.
 *
 * Video is the format where "paths in, paths out" pays most: a 200 MB file
 * cannot go anywhere near a context window, so every useful operation is
 * necessarily a path transformation plus a cheap summary. `describe()` and
 * `thumbnail()` are what let a model reason about a video it fundamentally
 * cannot look at.
 *
 * ffmpeg is a subprocess, and "no process spawning" is one of the
 * environment's stated non-goals. The resolution — spelled out in
 * `src/ffmpeg.ts` and in the README — is that the subprocess is started by
 * this host-side adapter and never by sandboxed code. A script passes two VFS
 * paths and cannot name a program, pass a flag, or see that a process was
 * involved.
 */
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";
import { Workspace, extensionOf, ffmpeg, ffprobe, type BinaryOverrides } from "./ffmpeg";
import { MEDIA_DOCS, MEDIA_TYPES } from "./docs";

export interface StreamSummary {
  kind: "video" | "audio" | "subtitle" | "other";
  codec: string;
  /** Video only. */
  width?: number;
  height?: number;
  fps?: number;
  /** Audio only. */
  channels?: number;
  sampleRate?: number;
}

export interface MediaSummary {
  path: string;
  /** Container format, e.g. "mov,mp4,m4a,3gp,3g2,mj2" as ffprobe names it. */
  format: string;
  bytes: number;
  /** Seconds, rounded to milliseconds. Null when the container does not say. */
  duration: number | null;
  bitrate: number | null;
  streams: StreamSummary[];
  /** Convenience: the first video stream's dimensions, when there is one. */
  width?: number;
  height?: number;
  fps?: number;
}

export interface MediaOptions extends BinaryOverrides {
  /**
   * Budget for a single ffmpeg invocation. Media work routinely outlasts the
   * environment's default script timeout, so this is separate and generous.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Parse "30000/1001" as ffprobe writes frame rates. */
function parseRate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined;
  const fps = num / den;
  return fps > 0 ? Math.round(fps * 1000) / 1000 : undefined;
}

function positive(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number of seconds, got ${JSON.stringify(value)}`);
  }
  return value;
}

export const media = (options: MediaOptions = {}) =>
  defineAdapter({
    name: "media",
    description: "Inspect and transform video and audio: describe, thumbnail, frames, clip, concat, transcode, slideshow.",
    types: MEDIA_TYPES,
    docs: MEDIA_DOCS,
    handles: {
      extensions: [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"],
      magic: [
        { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ISO-BMFF: mp4/mov/m4a
        { bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // Matroska / WebM
        { bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF: wav/avi
        { bytes: [0x49, 0x44, 0x33] }, // ID3, i.e. mp3
        { bytes: [0x66, 0x4c, 0x61, 0x43] }, // fLaC
        { bytes: [0x4f, 0x67, 0x67, 0x53] }, // OggS
      ],
    },
    create: (vfs: EnvFsHandle) => {
      const run = { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS };

      /**
       * Stage inputs, run, read outputs back. Every entry point goes through
       * this so the temp directory is disposed exactly once, on both paths.
       */
      const withWorkspace = async <T>(fn: (ws: Workspace) => Promise<T>): Promise<T> => {
        const ws = await Workspace.open();
        try {
          return await fn(ws);
        } finally {
          await ws.dispose();
        }
      };

      /** Stage one VFS file into the workspace. */
      const stageInput = async (ws: Workspace, path: string): Promise<string> => {
        const bytes = await vfs.readBytes(path);
        if (bytes.byteLength === 0) throw new Error(`${path} is empty — there is nothing to read`);
        return ws.stage(path.split("/").pop() ?? "input", bytes);
      };

      /** Run ffmpeg, then move one produced file into the VFS. */
      const produce = async (ws: Workspace, hostOut: string, vfsOut: string): Promise<string> => {
        await vfs.writeFile(vfsOut, await ws.collect(hostOut));
        return vfsOut;
      };

      const describe = async (path: string): Promise<MediaSummary> =>
        withWorkspace(async (ws) => {
          const input = await stageInput(ws, path);
          const probed = (await ffprobe(
            ["-print_format", "json", "-show_format", "-show_streams", input],
            run,
          )) as {
            format?: { format_name?: string; duration?: string; bit_rate?: string };
            streams?: Array<Record<string, unknown>>;
          };

          const streams: StreamSummary[] = (probed.streams ?? []).map((s) => {
            const type = String(s.codec_type ?? "other");
            const kind: StreamSummary["kind"] =
              type === "video" || type === "audio" || type === "subtitle" ? type : "other";
            return {
              kind,
              codec: String(s.codec_name ?? "unknown"),
              ...(kind === "video"
                ? {
                    width: Number(s.width) || undefined,
                    height: Number(s.height) || undefined,
                    fps: parseRate(s.avg_frame_rate) ?? parseRate(s.r_frame_rate),
                  }
                : {}),
              ...(kind === "audio"
                ? {
                    channels: Number(s.channels) || undefined,
                    sampleRate: Number(s.sample_rate) || undefined,
                  }
                : {}),
            };
          });

          const video = streams.find((s) => s.kind === "video");
          const duration = Number(probed.format?.duration);
          const bitrate = Number(probed.format?.bit_rate);
          return {
            path,
            format: String(probed.format?.format_name ?? "unknown"),
            bytes: (await vfs.stat(path))?.size ?? 0,
            duration: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
            bitrate: Number.isFinite(bitrate) ? bitrate : null,
            streams,
            ...(video?.width ? { width: video.width, height: video.height, fps: video.fps } : {}),
          };
        });

      return {
        /** What is this file? Codecs, duration, dimensions — no pixel data. */
        describe,

        /** A single frame as an image. `atSeconds` defaults to one second in. */
        async thumbnail(input: string, output: string, atSeconds = 1): Promise<string> {
          const at = positive("atSeconds", atSeconds);
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const dst = ws.hostPath(output.split("/").pop() ?? "thumb.png");
            // -ss before -i seeks by keyframe, which is much faster and is
            // what you want for a thumbnail. -frames:v 1 takes exactly one.
            await ffmpeg(["-ss", String(at), "-i", src, "-frames:v", "1", "-q:v", "2", dst], run);
            return produce(ws, dst, output);
          });
        },

        /**
         * Extract frames into a directory as PNGs. `fps` controls how many
         * per second of source (default 1); `limit` caps the total.
         */
        async frames(
          input: string,
          dir: string,
          opts: { fps?: number; limit?: number } = {},
        ): Promise<string[]> {
          const fps = opts.fps ?? 1;
          if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps must be a positive number, got ${JSON.stringify(opts.fps)}`);
          const limit = opts.limit ?? 200;
          if (!Number.isInteger(limit) || limit <= 0) throw new Error(`limit must be a positive whole number, got ${JSON.stringify(opts.limit)}`);

          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const outDir = await ws.outputDir("frames");
            await ffmpeg(
              ["-i", src, "-vf", `fps=${fps}`, "-frames:v", String(limit), `${outDir}/frame-%05d.png`],
              run,
            );
            const produced = await ws.collectDir("frames");
            if (produced.length === 0) {
              throw new Error(`no frames came out of ${input} — describe(path) will say whether it has a video stream`);
            }
            const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
            const written: string[] = [];
            for (const frame of produced) {
              const path = `${base}/${frame.name}`;
              await vfs.writeFile(path, frame.data);
              written.push(path);
            }
            return written;
          });
        },

        /** Cut `start`–`end` (seconds) into a new file, without re-encoding where possible. */
        async clip(input: string, output: string, opts: { start: number; end: number }): Promise<string> {
          const start = positive("start", opts?.start);
          const end = positive("end", opts?.end);
          if (end <= start) throw new Error(`end (${end}s) must be after start (${start}s)`);
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const dst = ws.hostPath(output.split("/").pop() ?? "clip.mp4");
            // -ss/-to AFTER -i is frame-accurate; before -i it is fast but
            // snaps to keyframes. For a cut the caller asked for by seconds,
            // accuracy is the right default.
            await ffmpeg(["-i", src, "-ss", String(start), "-to", String(end), dst], run);
            return produce(ws, dst, output);
          });
        },

        /** Join files end to end. They must share a codec and container. */
        async concat(inputs: string[], output: string): Promise<string> {
          if (!Array.isArray(inputs) || inputs.length < 2) {
            throw new Error(`concat needs at least two input paths, got ${JSON.stringify(inputs)}`);
          }
          return withWorkspace(async (ws) => {
            const staged: string[] = [];
            for (const [i, path] of inputs.entries()) {
              const bytes = await vfs.readBytes(path);
              staged.push(await ws.stage(`in-${i}.${extensionOf(path) || "mp4"}`, bytes));
            }
            // The concat demuxer takes a list file. Paths inside it are the
            // workspace's own, which we generated — no caller string reaches it.
            const listPath = await ws.stage("concat.txt", new TextEncoder().encode(staged.map((p) => `file '${p}'`).join("\n")));
            const dst = ws.hostPath(output.split("/").pop() ?? "joined.mp4");
            await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", dst], run);
            return produce(ws, dst, output);
          });
        },

        /** Re-encode: change container, quality, or size. */
        async transcode(
          input: string,
          output: string,
          opts: { crf?: number; scale?: [number, number]; fps?: number } = {},
        ): Promise<string> {
          const args: string[] = [];
          if (opts.crf !== undefined) {
            if (!Number.isInteger(opts.crf) || opts.crf < 0 || opts.crf > 51) {
              throw new Error(`crf must be a whole number from 0 (lossless) to 51 (worst), got ${JSON.stringify(opts.crf)}`);
            }
            args.push("-crf", String(opts.crf));
          }
          const filters: string[] = [];
          if (opts.scale) {
            const [w, h] = opts.scale;
            if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
              throw new Error(`scale must be [width, height] in whole pixels, got ${JSON.stringify(opts.scale)}`);
            }
            filters.push(`scale=${w}:${h}`);
          }
          if (opts.fps !== undefined) {
            if (!Number.isFinite(opts.fps) || opts.fps <= 0) throw new Error(`fps must be positive, got ${JSON.stringify(opts.fps)}`);
            filters.push(`fps=${opts.fps}`);
          }
          if (filters.length) args.push("-vf", filters.join(","));

          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const dst = ws.hostPath(output.split("/").pop() ?? "out.mp4");
            await ffmpeg(["-i", src, ...args, dst], run);
            return produce(ws, dst, output);
          });
        },

        /** Strip the audio track out into its own file. */
        async extractAudio(input: string, output: string): Promise<string> {
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const dst = ws.hostPath(output.split("/").pop() ?? "audio.m4a");
            await ffmpeg(["-i", src, "-vn", dst], run);
            return produce(ws, dst, output);
          });
        },

        /** Turn an ordered list of images into a video. */
        async slideshow(
          images: string[],
          output: string,
          opts: { frameMs?: number; size?: [number, number] } = {},
        ): Promise<string> {
          if (!Array.isArray(images) || images.length === 0) {
            throw new Error(`slideshow needs at least one image path, got ${JSON.stringify(images)}`);
          }
          const frameMs = opts.frameMs ?? 1000;
          if (!Number.isFinite(frameMs) || frameMs <= 0) throw new Error(`frameMs must be positive, got ${JSON.stringify(opts.frameMs)}`);

          return withWorkspace(async (ws) => {
            const inDir = await ws.outputDir("stills");
            const ext = extensionOf(images[0]) || "png";
            // Numbered sequentially, because ffmpeg's image demuxer reads a
            // %05d pattern — the caller's own filenames have no order.
            for (const [i, path] of images.entries()) {
              await ws.stageInto("stills", `still-${String(i).padStart(5, "0")}.${ext}`, await vfs.readBytes(path));
            }
            const filters = ["format=yuv420p"];
            if (opts.size) {
              const [w, h] = opts.size;
              if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
                throw new Error(`size must be [width, height] in whole pixels, got ${JSON.stringify(opts.size)}`);
              }
              // Pad rather than stretch: stills of different shapes should not
              // be distorted to match each other.
              filters.unshift(`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:-1:-1:color=black`);
            } else {
              // H.264 needs even dimensions; an odd-sized still fails otherwise.
              filters.unshift("scale=trunc(iw/2)*2:trunc(ih/2)*2");
            }
            const dst = ws.hostPath(output.split("/").pop() ?? "slideshow.mp4");
            await ffmpeg(
              [
                "-framerate", String(1000 / frameMs),
                "-i", `${inDir}/still-%05d.${ext}`,
                "-vf", filters.join(","),
                "-r", "25",
                dst,
              ],
              run,
            );
            return produce(ws, dst, output);
          });
        },
      };
    },
  });

export default media;
