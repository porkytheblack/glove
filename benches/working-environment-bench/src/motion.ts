/**
 * `env:motion` — a bespoke stdlib adapter that lives only in this benchmark.
 *
 * Its purpose is to answer a question the shipped adapters cannot: can a host
 * bolt on a capability the environment has never heard of — a domain library,
 * a media pipeline, an internal service wrapper — and will a model discover
 * and use it purely from `/std`? Nothing here is exported by any package; it
 * is written the way a downstream user would write one.
 */
import sharp from "sharp";
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";

export interface ClipSummary {
  path: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  frames: number;
  /** Per-frame delays in milliseconds. */
  delays: number[];
  durationMs: number;
}

const MOTION_TYPES = `/** env:motion — assemble still images into animated clips. */

export interface ClipSummary {
  path: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  frames: number;
  /** Per-frame delays in milliseconds. */
  delays: number[];
  durationMs: number;
}

export interface ClipOptions {
  /** Milliseconds each frame is held. Default 400. */
  frameMs?: number;
  /** Frame width in pixels; every frame is fitted to it. Default 320. */
  width?: number;
  /** Frame height in pixels. Default 240. */
  height?: number;
  /** Padding colour when a frame does not fill the box. Default "#000000". */
  background?: string;
  /** 0 loops forever. Default 0. */
  loop?: number;
}

/** Summarise a clip: dimensions, frame count, timing. Works on any animated GIF. */
export function describe(path: string): Promise<ClipSummary>;

/** Assemble still images (PNG/JPEG paths, in order) into an animated GIF. Returns the output path. */
export function clip(inputs: string[], output: string, opts?: ClipOptions): Promise<string>;

/** Pull one frame out of a clip as a PNG. Frame numbers are 1-based. Returns the output path. */
export function frame(input: string, output: string, frameNumber: number): Promise<string>;
`;

const MOTION_DOCS = `# env:motion

Turn a sequence of stills into an animated clip. Paths in, paths out — the
frames stay in the tree, and nothing image-shaped travels through your
context.

\`\`\`js
import { glob } from 'env:fs';
import { clip, describe } from 'env:motion';

export default async function main() {
  const frames = (await glob('/inbox/frames/*.png')).sort();
  await clip(frames, '/out/animation.gif', { frameMs: 250, width: 480, height: 360 });
  return describe('/out/animation.gif');
  // → { path, format: 'gif', bytes, width: 480, height: 360, frames: 12,
  //     delays: [250, …], durationMs: 3000 }
}
\`\`\`

Frames are fitted into the box and padded with \`background\` rather than
cropped, so mixed aspect ratios stay intact. \`frame(input, output, n)\`
extracts a single still (1-based) when you want to inspect one.
`;

async function loadFrame(vfs: EnvFsHandle, path: string, w: number, h: number, bg: string): Promise<Buffer> {
  const bytes = await vfs.readBytes(path);
  try {
    return await sharp(Buffer.from(bytes))
      .resize({ width: w, height: h, fit: "contain", background: bg })
      .png()
      .toBuffer();
  } catch (e) {
    throw new Error(`${path} could not be read as an image: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const motion = () =>
  defineAdapter({
    name: "motion",
    description: "Assemble still images into animated clips; inspect and extract frames.",
    types: MOTION_TYPES,
    docs: MOTION_DOCS,
    create: (vfs: EnvFsHandle) => ({
      async describe(path: string): Promise<ClipSummary> {
        const bytes = await vfs.readBytes(path);
        let meta;
        try {
          meta = await sharp(Buffer.from(bytes), { animated: true }).metadata();
        } catch (e) {
          throw new Error(`${path} could not be read as a clip: ${e instanceof Error ? e.message : String(e)}`);
        }
        const frames = meta.pages ?? 1;
        const delays = Array.isArray(meta.delay) ? meta.delay.map(Number) : new Array(frames).fill(0);
        // With `animated: true` the reported height covers every page.
        const height = meta.pageHeight ?? meta.height ?? 0;
        return {
          path,
          format: meta.format ?? "unknown",
          bytes: (await vfs.stat(path))?.size ?? 0,
          width: meta.width ?? 0,
          height,
          frames,
          delays,
          durationMs: delays.reduce((a, b) => a + b, 0),
        };
      },

      async clip(inputs: string[], output: string, opts: Record<string, unknown> = {}): Promise<string> {
        if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("clip needs at least one input frame path");
        const frameMs = Math.max(10, Math.round(Number(opts.frameMs ?? 400)));
        const width = Math.max(1, Math.round(Number(opts.width ?? 320)));
        const height = Math.max(1, Math.round(Number(opts.height ?? 240)));
        const background = typeof opts.background === "string" ? opts.background : "#000000";
        const loop = Number(opts.loop ?? 0);

        const frames: Buffer[] = [];
        for (const path of inputs) frames.push(await loadFrame(vfs, path, width, height, background));

        // sharp applies `delay` per frame; a scalar only sets the first one.
        const buffer = await sharp(frames, { join: { animated: true } })
          .gif({ delay: new Array(frames.length).fill(frameMs), loop })
          .toBuffer();
        await vfs.writeFile(output, new Uint8Array(buffer));
        return output;
      },

      async frame(input: string, output: string, frameNumber: number): Promise<string> {
        const bytes = await vfs.readBytes(input);
        const meta = await sharp(Buffer.from(bytes), { animated: true }).metadata();
        const total = meta.pages ?? 1;
        const n = Math.round(Number(frameNumber));
        if (!Number.isFinite(n) || n < 1 || n > total) {
          throw new Error(`frame ${frameNumber} is out of range — the clip has ${total} frame${total === 1 ? "" : "s"} (frames are 1-based)`);
        }
        const pageHeight = meta.pageHeight ?? meta.height ?? 0;
        const buffer = await sharp(Buffer.from(bytes), { animated: true })
          .extract({ left: 0, top: (n - 1) * pageHeight, width: meta.width ?? 0, height: pageHeight })
          .png()
          .toBuffer();
        await vfs.writeFile(output, new Uint8Array(buffer));
        return output;
      },
    }),
  });
