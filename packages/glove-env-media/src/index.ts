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
import { Workspace, extensionOf, ffmpeg, ffmpegReport, ffprobe, safeName, type BinaryOverrides } from "./ffmpeg";
import { MEDIA_DOCS, MEDIA_TYPES } from "./docs";

export interface StreamSummary {
  kind: "video" | "audio" | "subtitle" | "other";
  codec: string;
  /**
   * Position among streams of the same kind, counting from 0 — which is what
   * `track` means everywhere else here. Not the file-wide stream index: a model
   * asking for "the second subtitle" should not have to subtract the video and
   * audio streams first.
   */
  track: number;
  /** ISO 639 code the file records, e.g. "eng". Mostly on audio and subtitles. */
  language?: string;
  /** The label the file carries, e.g. "Forced English". */
  title?: string;
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

/** Encoders, by the name a caller thinks in rather than ffmpeg's. */
export type AudioCodec = "mp3" | "aac" | "flac" | "opus" | "vorbis" | "pcm" | "copy";

export interface AudioOptions {
  /**
   * Encoder to use. Omitted, ffmpeg picks one from the output extension.
   * `"copy"` re-muxes the existing stream untouched — instant, and lossless
   * where the container will take it.
   */
  codec?: AudioCodec;
  /** kbps, e.g. 192. Lossy codecs only. */
  bitrate?: number;
  /** Hz, e.g. 44100. */
  sampleRate?: number;
  /** 1 for mono, 2 for stereo. */
  channels?: number;
}

export interface NormalizeOptions extends AudioOptions {
  /** Integrated target, LUFS. Default -14 — what streaming platforms normalise to. */
  lufs?: number;
  /** True-peak ceiling, dBTP. Default -1.5. */
  truePeak?: number;
  /** Loudness range target, LU. Default 11. */
  range?: number;
}

export interface LoudnessSummary {
  path: string;
  /** Integrated loudness, LUFS. Streaming targets -14; EBU R128 broadcast, -23. */
  lufs: number;
  /** True peak, dBTP. Above 0 and it will clip on somebody's playback chain. */
  truePeak: number;
  /** Loudness range, LU — how far the level travels across the file. */
  range: number;
  /** The gate the integrated measurement used, LUFS. */
  threshold: number;
}

export interface SubtitleOptions {
  /** Which subtitle stream, counting from 0. Matches `track` in describe(). */
  track?: number;
}

export interface BurnOptions extends SubtitleOptions {
  /**
   * A subtitle file in the tree (.srt/.vtt/.ass) to burn instead of one of the
   * video's own streams.
   */
  subtitles?: string;
}

export interface WaveformOptions {
  /** Pixels. Default [1000, 200]. */
  size?: [number, number];
  /** Trace colour as #rrggbb. Default "#3366cc". */
  colour?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

const AUDIO_ENCODER: Record<AudioCodec, string> = {
  mp3: "libmp3lame",
  aac: "aac",
  flac: "flac",
  opus: "libopus",
  vorbis: "libvorbis",
  pcm: "pcm_s16le",
  copy: "copy",
};

/**
 * Subtitle containers this ffmpeg build will actually write from a
 * `-map 0:s:N`. `.sub` is deliberately absent: the MicroDVD encoder is not
 * compiled in, and it would fail as "Automatic encoder selection failed",
 * which reads like a bug in the caller's file rather than a format we cannot
 * produce.
 */
const SUBTITLE_EXT = ["srt", "vtt", "ass", "ssa"];

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

function inRange(name: string, value: unknown, low: number, high: number, unit: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) {
    throw new Error(`${name} must be ${unit} between ${low} and ${high}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function track(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`track must be a whole number from 0, counting subtitle streams only, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

/**
 * Encoder flags for an audio stream.
 *
 * `-vn` with no other flag hands the whole decision to ffmpeg's container
 * defaults, which is how you end up with a 64 kbps mono AAC when you asked for
 * an MP3 — so every part of that decision is expressible here.
 */
function audioArgs(opts: AudioOptions = {}): string[] {
  const args: string[] = [];
  if (opts.codec !== undefined) {
    const encoder = AUDIO_ENCODER[opts.codec];
    if (!encoder) {
      throw new Error(`codec must be one of ${Object.keys(AUDIO_ENCODER).join(", ")}, got ${JSON.stringify(opts.codec)}`);
    }
    args.push("-c:a", encoder);
  }
  if (opts.codec === "copy") {
    // Copying moves the encoded bytes across unchanged, so a bitrate or a
    // sample rate cannot mean anything — ffmpeg accepts them and ignores them,
    // which reads as the request having worked.
    const asked = (["bitrate", "sampleRate", "channels"] as const).filter((k) => opts[k] !== undefined);
    if (asked.length) {
      throw new Error(
        `codec "copy" re-muxes the existing stream untouched, so ${asked.join(" and ")} cannot apply — ` +
          `name a real codec to re-encode`,
      );
    }
  }
  if (opts.bitrate !== undefined) {
    args.push("-b:a", `${Math.round(inRange("bitrate", opts.bitrate, 8, 3000, "kbps"))}k`);
  }
  if (opts.sampleRate !== undefined) {
    args.push("-ar", String(Math.round(inRange("sampleRate", opts.sampleRate, 8000, 384000, "a sample rate in Hz"))));
  }
  if (opts.channels !== undefined) {
    args.push("-ac", String(Math.round(inRange("channels", opts.channels, 1, 8, "a channel count"))));
  }
  return args;
}

/**
 * Pull loudnorm's report out of a run's stderr.
 *
 * It is printed as a JSON object after everything else ffmpeg has to say, so
 * the last brace-delimited block is it. A run that produced none means the
 * filter never saw audio — which is worth saying plainly, because ffmpeg exits
 * 0 in that case and the absence is the only evidence.
 */
function loudnormReport(stderr: string, path: string): Record<string, string> {
  const open = stderr.lastIndexOf("{");
  const close = stderr.indexOf("}", open);
  if (open < 0 || close < 0) {
    throw new Error(`${path} has no audio to measure — describe(path) lists the streams it does have`);
  }
  let report: Record<string, string>;
  try {
    report = JSON.parse(stderr.slice(open, close + 1)) as Record<string, string>;
  } catch {
    throw new Error(`could not read ffmpeg's loudness report for ${path}`);
  }
  // Digital silence measures as "-inf", which is not a number anything can
  // normalise towards — and reporting it as 0 LUFS would be a lie about the
  // loudest possible signal.
  if (!Number.isFinite(Number(report.input_i))) {
    throw new Error(`${path} measures as silence (${report.input_i ?? "no reading"} LUFS) — there is no loudness to work with`);
  }
  return report;
}

function number(report: Record<string, string>, key: string): number {
  const value = Number(report[key]);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export const media = (options: MediaOptions = {}) =>
  defineAdapter({
    name: "media",
    description: "Inspect and transform video and audio: describe, thumbnail, frames, clip, concat, transcode, subtitles, loudness, slideshow.",
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

      /**
       * A file with no audio fails in ffmpeg's terms — "Output file #0 does not
       * contain any stream", "matches no streams" — which is true and says
       * nothing about the file the caller passed. Name what is missing instead.
       */
      const withMissingStream = async <T>(kind: string, path: string, work: Promise<T>): Promise<T> =>
        work.catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          if (/matches no streams|Unable to locate subtitle stream|does not contain any stream/i.test(message)) {
            throw new Error(`${path} has no ${kind} — describe(path) lists the streams it does have`);
          }
          throw e;
        });

      /**
       * Check the track exists before asking ffmpeg to use it.
       *
       * Both failures otherwise arrive as filter-graph noise — "Stream map
       * '0:s:0' matches no streams", or an `Error initializing filter` whose
       * one useful line has already been trimmed off the end of stderr. Neither
       * mentions subtitles being absent, which is the whole of what happened.
       */
      const requireSubtitle = async (src: string, path: string, wanted: number): Promise<void> => {
        const probed = (await ffprobe(
          ["-print_format", "json", "-select_streams", "s", "-show_entries", "stream=index", src],
          run,
        )) as { streams?: unknown[] };
        const count = probed.streams?.length ?? 0;
        if (wanted < count) return;
        throw new Error(
          `${path} has no subtitle track ${wanted}: it has ` +
            `${count === 0 ? "none" : count === 1 ? "one (track 0)" : `${count} (tracks 0–${count - 1})`} — ` +
            `describe(path) lists them with their languages`,
        );
      };

      /**
       * loudnorm in analysis mode: the same targets as the real pass, writing
       * nothing. Its report is what makes the second pass land ON the target —
       * single-pass loudnorm is a dynamic compressor that only gets near it.
       */
      const measure = async (
        src: string,
        path: string,
        targets: { lufs: number; truePeak: number; range: number },
      ): Promise<Record<string, string>> => {
        const stderr = await ffmpegReport(
          [
            "-i", src,
            "-af", `loudnorm=I=${targets.lufs}:TP=${targets.truePeak}:LRA=${targets.range}:print_format=json`,
            "-f", "null", "-",
          ],
          run,
        );
        return loudnormReport(stderr, path);
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

          // Counted per kind, because that is how ffmpeg's own -map addresses
          // them and how every `track` option here is written.
          const seen: Record<string, number> = {};
          const streams: StreamSummary[] = (probed.streams ?? []).map((s) => {
            const type = String(s.codec_type ?? "other");
            const kind: StreamSummary["kind"] =
              type === "video" || type === "audio" || type === "subtitle" ? type : "other";
            const tags = (s.tags ?? {}) as Record<string, string>;
            seen[kind] = (seen[kind] ?? -1) + 1;
            return {
              kind,
              codec: String(s.codec_name ?? "unknown"),
              track: seen[kind],
              ...(tags.language ? { language: String(tags.language) } : {}),
              ...(tags.title ? { title: String(tags.title) } : {}),
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

        /**
         * Strip the audio track out into its own file.
         *
         * Without options the container's defaults decide the codec and the
         * bitrate, which is how "extract the audio" quietly produces a 64 kbps
         * mono file. `{ codec: 'copy' }` avoids the question entirely by moving
         * the encoded stream across untouched.
         */
        async extractAudio(input: string, output: string, opts: AudioOptions = {}): Promise<string> {
          const encoder = audioArgs(opts);
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const dst = ws.hostPath(output.split("/").pop() ?? "audio.m4a");
            await withMissingStream("audio stream", input, ffmpeg(["-i", src, "-vn", ...encoder, dst], run));
            return produce(ws, dst, output);
          });
        },

        /** How loud is this, in the units platforms actually specify? */
        async loudness(input: string): Promise<LoudnessSummary> {
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            // The input_* figures are properties of the file, not of the target,
            // so measuring against the default target reports the same numbers.
            const report = await measure(src, input, { lufs: -14, truePeak: -1.5, range: 11 });
            return {
              path: input,
              lufs: number(report, "input_i"),
              truePeak: number(report, "input_tp"),
              range: number(report, "input_lra"),
              threshold: number(report, "input_thresh"),
            };
          });
        },

        /**
         * Normalise loudness to a target, in two passes.
         *
         * Always two: loudnorm run blind is a dynamic compressor that lands
         * somewhere near the target, and the difference between "near -14 LUFS"
         * and "-14 LUFS" is the entire reason anyone asks for this. The first
         * pass measures, the second applies the measurement as a fixed gain.
         */
        async normalize(input: string, output: string, opts: NormalizeOptions = {}): Promise<string> {
          const targets = {
            lufs: opts.lufs === undefined ? -14 : inRange("lufs", opts.lufs, -70, -5, "an integrated target in LUFS"),
            truePeak: opts.truePeak === undefined ? -1.5 : inRange("truePeak", opts.truePeak, -9, 0, "a ceiling in dBTP"),
            range: opts.range === undefined ? 11 : inRange("range", opts.range, 1, 50, "a loudness range in LU"),
          };
          if (opts.codec === "copy") {
            throw new Error(`normalize re-encodes the audio by definition, so codec "copy" cannot apply`);
          }
          const encoder = audioArgs(opts);
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const m = await measure(src, input, targets);
            const dst = ws.hostPath(output.split("/").pop() ?? "normalized.m4a");
            const filter = [
              `loudnorm=I=${targets.lufs}`,
              `TP=${targets.truePeak}`,
              `LRA=${targets.range}`,
              `measured_I=${number(m, "input_i")}`,
              `measured_TP=${number(m, "input_tp")}`,
              `measured_LRA=${number(m, "input_lra")}`,
              `measured_thresh=${number(m, "input_thresh")}`,
              `offset=${number(m, "target_offset")}`,
              // Linear gain where the numbers allow it: nothing about the
              // dynamics was asked to change, only the level.
              "linear=true",
            ].join(":");
            // Any video in the file is not what we came for, and re-encoding it
            // would cost minutes and a generation of quality for nothing.
            await ffmpeg(["-i", src, "-c:v", "copy", "-af", filter, ...encoder, dst], run);
            return produce(ws, dst, output);
          });
        },

        /**
         * Draw the audio as a picture. A model cannot listen any more than it
         * can look, so this is to audio what `thumbnail` is to video: where the
         * silence is, where it clips, whether anything is there at all.
         */
        async waveform(input: string, output: string, opts: WaveformOptions = {}): Promise<string> {
          const [width, height] = opts.size ?? [1000, 200];
          if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
            throw new Error(`size must be [width, height] in whole pixels, got ${JSON.stringify(opts.size)}`);
          }
          const colour = opts.colour ?? "#3366cc";
          if (!/^#[0-9a-fA-F]{6}$/.test(colour)) {
            throw new Error(`colour must be #rrggbb, got ${JSON.stringify(opts.colour)}`);
          }
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            const dst = ws.hostPath(output.split("/").pop() ?? "waveform.png");
            await withMissingStream(
              "audio stream to draw",
              input,
              ffmpeg(
                ["-i", src, "-filter_complex", `[0:a]showwavespic=s=${width}x${height}:colors=${colour}`, "-frames:v", "1", dst],
                run,
              ),
            );
            return produce(ws, dst, output);
          });
        },

        /**
         * Pull a subtitle stream out as a file. The format follows the output
         * extension, so `.srt` in and `.vtt` out is also a conversion.
         */
        async extractSubtitles(input: string, output: string, opts: SubtitleOptions = {}): Promise<string> {
          const wanted = track(opts.track);
          const ext = extensionOf(output);
          if (!SUBTITLE_EXT.includes(ext)) {
            throw new Error(
              `cannot tell what subtitle format to write for ${output} — give it one of ` +
                `${SUBTITLE_EXT.map((e) => `.${e}`).join(", ")}`,
            );
          }
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            await requireSubtitle(src, input, wanted);
            const dst = ws.hostPath(output.split("/").pop() ?? "subtitles.srt");
            await ffmpeg(["-i", src, "-map", `0:s:${wanted}`, dst], run);
            return produce(ws, dst, output);
          });
        },

        /**
         * Burn subtitles into the picture, from a file in the tree or from one
         * of the video's own streams. Unlike a muxed subtitle track this cannot
         * be turned off again — which is the point, for anywhere that will not
         * render one.
         */
        async burnSubtitles(input: string, output: string, opts: BurnOptions = {}): Promise<string> {
          const wanted = track(opts.track);
          if (opts.subtitles !== undefined && typeof opts.subtitles !== "string") {
            throw new Error(`subtitles must be a path to a subtitle file, got ${JSON.stringify(opts.subtitles)}`);
          }
          if (opts.subtitles && !SUBTITLE_EXT.includes(extensionOf(opts.subtitles))) {
            throw new Error(
              `${opts.subtitles} is not a subtitle file — expected one of ${SUBTITLE_EXT.map((e) => `.${e}`).join(", ")}`,
            );
          }
          return withWorkspace(async (ws) => {
            const src = await stageInput(ws, input);
            let filter: string;
            if (opts.subtitles) {
              const name = `subs.${extensionOf(opts.subtitles)}`;
              await ws.stage(name, await vfs.readBytes(opts.subtitles));
              filter = `subtitles=${name}`;
            } else {
              await requireSubtitle(src, input, wanted);
              filter = `subtitles=${safeName(input.split("/").pop() ?? "input")}:si=${wanted}`;
            }
            const dst = ws.hostPath(output.split("/").pop() ?? "burned.mp4");
            // The filter graph names a bare file and ffmpeg runs in the
            // workspace. A filename inside a graph is parsed rather than passed
            // through — `:` starts the next option, `\` escapes — so the only
            // reliably safe form is one we sanitised, with no directory in it.
            await ffmpeg(["-i", src, "-vf", filter, "-c:a", "copy", dst], { ...run, cwd: ws.dir });
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
