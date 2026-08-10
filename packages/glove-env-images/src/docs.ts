/**
 * Materialized at `/std/images/index.d.ts` and `/std/images/README.md`.
 * These are the whole API documentation the model gets; the adapter audit
 * checks that every declaration here matches a real binding and vice versa.
 */

export const IMAGES_TYPES = `/** env:images — raster images in the virtual filesystem. */

export type Fit = "cover" | "contain" | "fill" | "inside" | "outside";
export type Format = "jpeg" | "png" | "webp" | "avif" | "tiff" | "gif";

export interface ImageSummary {
  path: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  /** "srgb", "cmyk", "b-w", … */
  space: string;
  channels: number;
  hasAlpha: boolean;
  /** Pixels per inch, when recorded. */
  density: number | null;
  /** Frame count for animated GIF/WebP; 1 for stills. */
  pages: number;
  /** EXIF orientation 1–8, when present. rotate() with no angle normalises it. */
  orientation: number | null;
}

export interface ChannelStats { min: number; max: number; mean: number; stdev: number }

export interface ImageStats {
  path: string;
  channels: ChannelStats[];
  /** Most common colour as #rrggbb. */
  dominant: string;
  isOpaque: boolean;
  /** Mean luminance 0–255 over colour channels — a cheap blank/dark check. */
  meanBrightness: number;
}

/** Shared by everything that reads a file. */
export interface SourceOptions {
  /** Rasterization multiplier for SVG input: 2 renders a 100×50 SVG at 200×100. Ignored for raster input. */
  scale?: number;
  /** Rasterization DPI for SVG input; 72 is natural size. Overrides scale. */
  density?: number;
  /** Keep every frame of an animated GIF/WebP. On by default when the output can hold frames; false writes frame 1. */
  animated?: boolean;
}

export interface ResizeOptions extends SourceOptions {
  width?: number;
  height?: number;
  /** Default "cover". */
  fit?: Fit;
  /** Padding colour for "contain". Default black. */
  background?: string;
  withoutEnlargement?: boolean;
  /** Inferred from the output extension when omitted. */
  format?: Format;
  /** 1–100, lossy formats only. */
  quality?: number;
}

export interface ConvertOptions extends SourceOptions { format?: Format; quality?: number }
export interface CropOptions { left: number; top: number; width: number; height: number }
export interface RotateOptions extends SourceOptions {
  /** Degrees clockwise. Omit to auto-orient from EXIF instead. */
  angle?: number;
  background?: string;
}
export interface TextOptions {
  /** The words to draw. Newlines start a new line; XML is escaped, not parsed. */
  text: string;
  /** Pixels. Default: 6% of the frame height, never below 12. */
  size?: number;
  /** Fill colour. Default white. */
  colour?: string;
  /** Halo behind the fill, so light text survives a light image. null removes it. Default black. */
  outline?: string | null;
  /** Font family. Default "sans-serif". */
  font?: string;
  /** Default "bold". */
  weight?: "normal" | "bold";
  /** Used when left/top are omitted: "southeast" (default), "centre", "north", … */
  gravity?: string;
  /** Top-left of the text block, in pixels. Overrides gravity. */
  left?: number;
  top?: number;
  /** Gap from the edge when positioned by gravity. Default 16. */
  padding?: number;
  /** 0–1. Default 1. */
  opacity?: number;
}
export interface CompositeLayer {
  input: string;
  left?: number;
  top?: number;
  /** Used when left/top are omitted: "centre", "northwest", "southeast", … */
  gravity?: string;
  /** 0–1. Default 1. */
  opacity?: number;
}
export interface ContactSheetOptions {
  /** Cell size in pixels. Default 200. */
  cell?: number;
  /** Default: ceil(sqrt(n)). */
  columns?: number;
  background?: string;
}

/**
 * Dimensions, format and colour space without decoding pixels. Start here.
 * \`pages > 1\` means an animation; width/height are ONE frame's.
 */
export function describe(path: string): Promise<ImageSummary>;

/** Channel statistics: means, spread, dominant colour, opacity. First frame only. */
export function stats(path: string): Promise<ImageStats>;

/** Resize into a box. Returns the output path. */
export function resize(input: string, output: string, opts?: ResizeOptions): Promise<string>;

/** Re-encode to another format — including rasterizing an .svg. Returns the output path. */
export function convert(input: string, output: string, opts?: ConvertOptions): Promise<string>;

/** Cut out a rectangle. On an animation the box is measured against ONE frame. */
export function crop(input: string, output: string, box: CropOptions): Promise<string>;

/**
 * Rotate by an angle, or auto-orient from EXIF when no angle is given.
 * The one verb an animation cannot survive: it refuses a multi-frame source
 * unless you pass \`{ animated: false }\` to rotate frame 1 on its own.
 */
export function rotate(input: string, output: string, opts?: RotateOptions): Promise<string>;

/** Lay images over a base image. Returns the output path. */
export function composite(input: string, output: string, layers: CompositeLayer[]): Promise<string>;

/** Draw text onto an image — watermark, date, caption. Returns the output path. */
export function text(input: string, output: string, opts: TextOptions): Promise<string>;

/** Square thumbnail, cropped to fill. Returns the output path. */
export function thumbnail(input: string, output: string, size?: number): Promise<string>;

/** Tile many images into one grid, so a set can be inspected at a glance. */
export function contactSheet(inputs: string[], output: string, opts?: ContactSheetOptions): Promise<string>;
`;

export const IMAGES_DOCS = `# env:images

Inspect and transform images in the tree — raster, animated and SVG. Paths in,
paths out: image bytes never travel through your script, and never through the
context window.

## describe first, always

You cannot read an image. \`describe\` is how you find out what you are
holding, and it costs the same handful of tokens for a 4 KB icon and a 40 MB
scan.

\`\`\`js
import { describe } from 'env:images';

export default async function main() {
  return describe('/inbox/scan.jpg');
  // → { path, format: 'jpeg', bytes: 2418112, width: 4032, height: 3024,
  //     space: 'srgb', channels: 3, hasAlpha: false, density: 72,
  //     pages: 1, orientation: 6 }
}
\`\`\`

\`orientation: 6\` means the file is stored rotated — the pixels are sideways
and a viewer fixes it using EXIF. Normalise it before cropping, or your
coordinates refer to the wrong axis:

\`\`\`js
import { rotate } from 'env:images';
await rotate('/inbox/scan.jpg', '/tmp/upright.jpg');   // no angle = auto-orient
\`\`\`

## Batch work belongs in one script

This is the whole reason the adapter exists: one \`run_script\` over fifty
files instead of fifty tool calls.

\`\`\`js
import { glob } from 'env:fs';
import { describe, resize } from 'env:images';

export default async function main(args) {
  const paths = await glob('/inbox/**/*.{jpg,png}');
  const done = [];
  for (const path of paths) {
    const meta = await describe(path);
    if (meta.width <= args.maxWidth) continue;
    const out = '/out/' + path.split('/').pop().replace(/\\.\\w+$/, '.webp');
    await resize(path, out, { width: args.maxWidth, fit: 'inside', quality: 82 });
    done.push({ from: path, to: out, was: meta.width });
  }
  return { resized: done.length, skipped: paths.length - done.length };
}
\`\`\`

Return counts and paths, not the list of every file — the tree is the record.

## Output format follows the extension

\`resize('/a.png', '/out/b.webp')\` writes WebP. Pass \`{ format }\` only when
the extension cannot say so. Writing PNG bytes into a \`.jpg\` file is the
kind of mistake that surfaces three steps later, so the extension wins by
default.

## Checking whether an image is worth keeping

\`stats\` decodes pixels, so it is slower than \`describe\` — but it answers
"is this page blank?" without a human looking:

\`\`\`js
import { stats } from 'env:images';

export default async function main() {
  const s = await stats('/inbox/page-7.png');
  return { blank: s.meanBrightness > 250 && s.channels.every(c => c.stdev < 2), dominant: s.dominant };
}
\`\`\`

## Composing, captioning and reviewing

\`\`\`js
import { composite, text, contactSheet } from 'env:images';

await composite('/inbox/photo.jpg', '/out/branded.jpg', [
  { input: '/inbox/logo.png', gravity: 'southeast', opacity: 0.6 },
]);

// A watermark, without a logo file to composite
await text('/inbox/photo.jpg', '/out/dated.jpg', {
  text: 'DRAFT\\n2026-03-04', gravity: 'southeast', opacity: 0.8,
});

// One artifact that shows all of them at once
await contactSheet(await glob('/out/*.webp'), '/out/review.png', { cell: 160, columns: 5 });
\`\`\`

\`text\` draws with a dark halo behind a white fill by default, because a
watermark lands on images you have not looked at and plain white disappears
on a pale one. \`outline: null\` turns the halo off.

## Animations keep their frames

An animated GIF or WebP survives \`resize\`, \`convert\`, \`crop\`, \`thumbnail\`,
\`composite\` and \`text\` — as long as the output can hold frames, which means
\`.gif\` or \`.webp\`. Ask for \`.png\` and you get frame one, because that is
what a PNG is.

\`\`\`js
import { describe, resize } from 'env:images';

export default async function main() {
  const before = await describe('/inbox/loop.gif');   // { pages: 30, width: 480, ... }
  await resize('/inbox/loop.gif', '/out/small.gif', { width: 240 });
  return { was: before.pages, now: (await describe('/out/small.gif')).pages };  // 30 → 30
}
\`\`\`

Two exceptions worth knowing before you hit them:

- **\`rotate\` refuses an animation.** libvips stores the frames as one tall
  strip, so a quarter turn is not supported at all and a half turn reverses
  the frame order. Pass \`{ animated: false }\` to rotate frame one deliberately.
- **\`stats\` and \`contactSheet\` read frame one**, on purpose — one is a
  question about a picture, the other is a grid of pictures.

## SVG in, raster out

SVG is read-only: sharp rasterizes it and has no SVG encoder, so
\`convert('/a.png', '/out/b.svg')\` is refused rather than quietly writing PNG
bytes under an \`.svg\` name. Resolution is yours to pick:

\`\`\`js
import { convert, resize } from 'env:images';

await convert('/inbox/logo.svg', '/out/logo@2x.png', { scale: 2 });   // 2× natural size
await convert('/inbox/logo.svg', '/out/print.png', { density: 300 }); // or in DPI
await resize('/inbox/logo.svg', '/out/wide.png', { width: 1200 });    // renders AT 1200, not upscaled to it
\`\`\`

## Notes

- \`fit\`: \`cover\` crops to fill (default), \`inside\` shrinks to fit without
  cropping, \`contain\` pads with \`background\`.
- \`withoutEnlargement: true\` stops a small image being blown up.
- Coordinates for \`crop\` are pixels from the top-left of the *stored* image —
  of one frame, when it is animated.
- Failures name the file that caused them.
`;
