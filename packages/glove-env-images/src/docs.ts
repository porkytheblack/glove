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

export interface ResizeOptions {
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

export interface ConvertOptions { format?: Format; quality?: number }
export interface CropOptions { left: number; top: number; width: number; height: number }
export interface RotateOptions {
  /** Degrees clockwise. Omit to auto-orient from EXIF instead. */
  angle?: number;
  background?: string;
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

/** Dimensions, format and colour space without decoding pixels. Start here. */
export function describe(path: string): Promise<ImageSummary>;

/** Channel statistics: means, spread, dominant colour, opacity. */
export function stats(path: string): Promise<ImageStats>;

/** Resize into a box. Returns the output path. */
export function resize(input: string, output: string, opts?: ResizeOptions): Promise<string>;

/** Re-encode to another format. Returns the output path. */
export function convert(input: string, output: string, opts?: ConvertOptions): Promise<string>;

/** Cut out a rectangle. Returns the output path. */
export function crop(input: string, output: string, box: CropOptions): Promise<string>;

/** Rotate by an angle, or auto-orient from EXIF when no angle is given. */
export function rotate(input: string, output: string, opts?: RotateOptions): Promise<string>;

/** Lay images over a base image. Returns the output path. */
export function composite(input: string, output: string, layers: CompositeLayer[]): Promise<string>;

/** Square thumbnail, cropped to fill. Returns the output path. */
export function thumbnail(input: string, output: string, size?: number): Promise<string>;

/** Tile many images into one grid, so a set can be inspected at a glance. */
export function contactSheet(inputs: string[], output: string, opts?: ContactSheetOptions): Promise<string>;
`;

export const IMAGES_DOCS = `# env:images

Inspect and transform raster images in the tree. Paths in, paths out —
image bytes never travel through your script, and never through the context
window.

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

## Composing and reviewing

\`\`\`js
import { composite, contactSheet } from 'env:images';

await composite('/inbox/photo.jpg', '/out/branded.jpg', [
  { input: '/inbox/logo.png', gravity: 'southeast', opacity: 0.6 },
]);

// One artifact that shows all of them at once
await contactSheet(await glob('/out/*.webp'), '/out/review.png', { cell: 160, columns: 5 });
\`\`\`

## Notes

- \`fit\`: \`cover\` crops to fill (default), \`inside\` shrinks to fit without
  cropping, \`contain\` pads with \`background\`.
- \`withoutEnlargement: true\` stops a small image being blown up.
- Coordinates for \`crop\` are pixels from the top-left of the *stored* image.
- Failures name the file that caused them.
`;
