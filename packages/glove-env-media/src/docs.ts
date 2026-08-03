/** Materialized at `/std/media/index.d.ts` and `/std/media/README.md`. */

export const MEDIA_TYPES = `/** env:media — video and audio, by path. Nothing here returns pixel data. */

export interface StreamSummary {
  kind: "video" | "audio" | "subtitle" | "other";
  codec: string;
  width?: number;
  height?: number;
  fps?: number;
  channels?: number;
  sampleRate?: number;
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

/** Strip the audio track into its own file (format follows the output extension). */
export function extractAudio(input: string, output: string): Promise<string>;

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

## Two things worth knowing

**Media work is slow.** ffmpeg gets its own budget (two minutes per call by
default) rather than sharing the script timeout, but a long transcode can
still exceed it. Work on a clip, or ask the host to raise it.

**ffmpeg runs on the host, not in the sandbox.** Your script passes two VFS
paths; it cannot name a program or pass a flag, and nothing is spawned from
inside the sandbox. The environment still has no process spawning.
`;
