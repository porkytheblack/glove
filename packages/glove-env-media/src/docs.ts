/** Materialized at `/std/media/index.d.ts` and `/std/media/README.md`. */

export const MEDIA_TYPES = `/** env:media — video and audio, by path. Nothing here returns pixel data. */

export interface StreamSummary {
  kind: "video" | "audio" | "subtitle" | "other";
  codec: string;
  /** Position among streams of the SAME kind, from 0 — what \`track\` means below. */
  track: number;
  /** ISO 639 code the file records, e.g. "eng". */
  language?: string;
  /** The label the file carries, e.g. "Forced English". */
  title?: string;
  width?: number;
  height?: number;
  fps?: number;
  channels?: number;
  sampleRate?: number;
}

/** Encoders, by the name you think in rather than ffmpeg's. */
export type AudioCodec = "mp3" | "aac" | "flac" | "opus" | "vorbis" | "pcm" | "copy";

export interface AudioOptions {
  /** Omitted, ffmpeg picks from the output extension. "copy" re-muxes untouched. */
  codec?: AudioCodec;
  /** kbps, e.g. 192. Lossy codecs only. */
  bitrate?: number;
  /** Hz, e.g. 44100. */
  sampleRate?: number;
  /** 1 mono, 2 stereo. */
  channels?: number;
}

export interface NormalizeOptions extends AudioOptions {
  /** Integrated target in LUFS. Default -14, what streaming platforms use. */
  lufs?: number;
  /** True-peak ceiling in dBTP. Default -1.5. */
  truePeak?: number;
  /** Loudness range target in LU. Default 11. */
  range?: number;
}

export interface LoudnessSummary {
  path: string;
  /** Integrated loudness, LUFS. */
  lufs: number;
  /** True peak, dBTP. Above 0 clips on playback. */
  truePeak: number;
  /** Loudness range, LU. */
  range: number;
  /** The gate the integrated reading used, LUFS. */
  threshold: number;
}

export interface SubtitleOptions {
  /** Which subtitle stream, from 0. Matches \`track\` in describe(). */
  track?: number;
}

export interface BurnOptions extends SubtitleOptions {
  /** A subtitle file in the tree to burn instead of one of the video's own streams. */
  subtitles?: string;
}

export interface WaveformOptions {
  /** Pixels. Default [1000, 200]. */
  size?: [number, number];
  /** Trace colour as #rrggbb. Default "#3366cc". */
  colour?: string;
}

export interface MediaSummary {
  path: string;
  /** Container format as ffprobe names it, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  format: string;
  bytes: number;
  /** Seconds. Null when the container does not record it. */
  duration: number | null;
  bitrate: number | null;
  streams: StreamSummary[];
  /** The first video stream's dimensions, when there is one. */
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * What is this file? Codecs, duration, dimensions, stream layout.
 *
 * Start here. A video is far too large to read, so this summary and a
 * thumbnail are the only way to know what you are working with.
 */
export function describe(path: string): Promise<MediaSummary>;

/** One frame, as an image you can then describe() with env:images. */
export function thumbnail(input: string, output: string, atSeconds?: number): Promise<string>;

/**
 * Frames into a directory as PNGs, returning the paths written.
 * \`fps\` is frames per second of SOURCE (default 1); \`limit\` caps the count
 * (default 200) so a long video cannot fill the tree.
 */
export function frames(input: string, dir: string, opts?: { fps?: number; limit?: number }): Promise<string[]>;

/** Cut start–end (seconds) into a new file. */
export function clip(input: string, output: string, opts: { start: number; end: number }): Promise<string>;

/** Join files end to end. They must share a codec and container — transcode first if not. */
export function concat(inputs: string[], output: string): Promise<string>;

/**
 * Re-encode: change container (by output extension), quality, size or rate.
 * \`crf\` runs 0 (lossless) to 51 (worst); 23 is the usual default.
 */
export function transcode(
  input: string,
  output: string,
  opts?: { crf?: number; scale?: [number, number]; fps?: number },
): Promise<string>;

/**
 * Strip the audio track into its own file (format follows the output extension).
 * Without options the container's defaults choose the codec and bitrate, which
 * is how "just extract the audio" ends up as 64 kbps mono.
 */
export function extractAudio(input: string, output: string, opts?: AudioOptions): Promise<string>;

/** How loud is this, in the units platforms specify? Reads the file, writes nothing. */
export function loudness(input: string): Promise<LoudnessSummary>;

/**
 * Normalise loudness to a target, in two passes — measure, then apply.
 * Video streams are copied, not re-encoded.
 */
export function normalize(input: string, output: string, opts?: NormalizeOptions): Promise<string>;

/** Draw the audio as an image: where the silence is, where it clips. */
export function waveform(input: string, output: string, opts?: WaveformOptions): Promise<string>;

/** Pull a subtitle stream out as a file; the format follows the output extension. */
export function extractSubtitles(input: string, output: string, opts?: SubtitleOptions): Promise<string>;

/** Burn subtitles into the picture, from a file in the tree or from an embedded track. */
export function burnSubtitles(input: string, output: string, opts?: BurnOptions): Promise<string>;

/** Turn an ordered list of images into a video. \`frameMs\` is how long each is held. */
export function slideshow(
  images: string[],
  output: string,
  opts?: { frameMs?: number; size?: [number, number] },
): Promise<string>;
`;

export const MEDIA_DOCS = `# env:media

Video and audio. Paths in, paths out — a video is far too large to put in
context, so every operation is a path transformation plus a cheap summary.

## Look before you work

\`\`\`js
import { describe, thumbnail } from 'env:media';

/** What are we holding? */
export default async function main() {
  const info = await describe('/inbox/recording.mp4');
  await thumbnail('/inbox/recording.mp4', '/tmp/cover.png', info.duration ? info.duration / 2 : 1);
  return info;   // { duration: 184.5, width: 1920, height: 1080, fps: 29.97, streams: [...] }
}
\`\`\`

\`describe()\` is the first call on any media file. You cannot read a video, so
the summary and a frame or two are all you have to reason with.

## Frames out, video in

\`\`\`js
import { frames, slideshow } from 'env:media';
import { contactSheet } from 'env:images';

/** A contact sheet of one frame every ten seconds. */
export default async function main() {
  const shots = await frames('/inbox/recording.mp4', '/tmp/shots', { fps: 0.1, limit: 24 });
  return contactSheet(shots, '/out/overview.png', { cell: 240, columns: 6 });
}
\`\`\`

\`\`\`js
import { slideshow } from 'env:media';
import { glob } from 'env:fs';

/** A video from a folder of stills. */
export default async function main() {
  const stills = (await glob('/inbox/frames/*.png')).sort();
  return slideshow(stills, '/out/animation.mp4', { frameMs: 400, size: [1280, 720] });
}
\`\`\`

Stills are padded rather than stretched when \`size\` is given, so images of
different shapes are not distorted to match each other.

## Cutting and joining

\`\`\`js
import { clip, concat, transcode } from 'env:media';

/** The two interesting minutes, at a smaller size. */
export default async function main() {
  await clip('/inbox/long.mp4', '/tmp/a.mp4', { start: 30, end: 90 });
  await clip('/inbox/long.mp4', '/tmp/b.mp4', { start: 300, end: 360 });
  await concat(['/tmp/a.mp4', '/tmp/b.mp4'], '/tmp/joined.mp4');
  return transcode('/tmp/joined.mp4', '/out/highlights.mp4', { crf: 28, scale: [1280, 720] });
}
\`\`\`

\`concat\` copies streams without re-encoding, which is fast but requires the
inputs to match. If it complains, \`transcode\` them to a common format first.

## Audio you asked for, not audio you were given

\`extractAudio\` with no options leaves the codec and the bitrate to the
container's defaults. Say what you want instead:

\`\`\`js
import { extractAudio } from 'env:media';

await extractAudio('/inbox/talk.mp4', '/out/talk.mp3',
                   { codec: 'mp3', bitrate: 192, sampleRate: 44100, channels: 2 });

// Or skip the question entirely — 'copy' moves the encoded stream across
// untouched, which is instant and lossless where the container will take it.
await extractAudio('/inbox/talk.mp4', '/out/talk.m4a', { codec: 'copy' });
\`\`\`

## Loudness

\`\`\`js
import { loudness, normalize, waveform } from 'env:media';

export default async function main() {
  const before = await loudness('/inbox/episode.wav');   // { lufs: -27.4, truePeak: -6.1, ... }
  await normalize('/inbox/episode.wav', '/out/episode.mp3', { lufs: -16, codec: 'mp3', bitrate: 192 });
  await waveform('/out/episode.mp3', '/out/episode.png');
  return { before: before.lufs, after: (await loudness('/out/episode.mp3')).lufs };
}
\`\`\`

\`normalize\` measures first and then applies that measurement, because loudnorm
run blind only lands *near* a target — and near -14 LUFS is not what anyone
means by "normalise to -14 LUFS". Video streams are copied through untouched.

\`waveform\` is to audio what \`thumbnail\` is to video: you cannot listen to a
file any more than you can look at one, and a picture shows dead air, clipping
and "is there anything in here at all" in one glance.

## Subtitles

\`describe\` reports subtitle streams with a \`track\` number and a language, and
both subtitle verbs take that same number:

\`\`\`js
import { describe, extractSubtitles, burnSubtitles } from 'env:media';

export default async function main() {
  const info = await describe('/inbox/film.mkv');
  const subs = info.streams.filter(s => s.kind === 'subtitle');   // [{ track: 0, language: 'eng' }, …]

  await extractSubtitles('/inbox/film.mkv', '/out/film.srt', { track: 0 });
  await extractSubtitles('/inbox/film.mkv', '/out/film.vtt', { track: 0 });   // and converts

  // Burned in: pixels, not a track a player can switch off.
  await burnSubtitles('/inbox/film.mkv', '/out/hardsubbed.mp4', { track: 0 });
  await burnSubtitles('/inbox/clip.mp4', '/out/captioned.mp4', { subtitles: '/inbox/captions.srt' });
}
\`\`\`

## Two things worth knowing

**Media work is slow.** ffmpeg gets its own budget (two minutes per call by
default) rather than sharing the script timeout, but a long transcode can
still exceed it. Work on a clip, or ask the host to raise it.

**ffmpeg runs on the host, not in the sandbox.** Your script passes two VFS
paths; it cannot name a program or pass a flag, and nothing is spawned from
inside the sandbox. The environment still has no process spawning.
`;
