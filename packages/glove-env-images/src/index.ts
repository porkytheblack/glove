/**
 * `env:images` — sharp bridged into the agent's virtual filesystem.
 *
 * Paths in, paths out. A model cannot read an image's bytes usefully, so
 * `describe()` is the primary verb: it answers "what am I holding?" in a few
 * dozen tokens. Everything else transforms one path into another.
 */
import sharp from "sharp";
import type { OverlayOptions, Sharp } from "sharp";
import { defineAdapter, type EnvFsHandle, type FileSummary } from "glove-working-environment";
import { IMAGES_DOCS, IMAGES_TYPES } from "./docs";

export interface ImageSummary extends FileSummary {
  width: number;
  height: number;
  /** Colour space, e.g. "srgb", "cmyk", "b-w". */
  space: string;
  channels: number;
  hasAlpha: boolean;
  /** Pixels per inch, when the file records it. */
  density: number | null;
  /** Frame count for animated GIF/WebP; 1 for stills. */
  pages: number;
  /** EXIF orientation (1–8), when present. `autoOrient` normalises it. */
  orientation: number | null;
}

export interface ChannelStats {
  min: number;
  max: number;
  mean: number;
  stdev: number;
}

export interface ImageStats {
  path: string;
  channels: ChannelStats[];
  /** Most common colour, as #rrggbb. */
  dominant: string;
  /** True when every pixel is fully opaque. */
  isOpaque: boolean;
  /** Mean luminance 0–255 across channels — a cheap "is this blank/dark" check. */
  meanBrightness: number;
}

export type Fit = "cover" | "contain" | "fill" | "inside" | "outside";
export type Format = "jpeg" | "png" | "webp" | "avif" | "tiff" | "gif";

export interface ResizeOptions {
  width?: number;
  height?: number;
  /** How to fit the box. Default "cover". */
  fit?: Fit;
  /** Padding colour for "contain", as #rrggbb or a CSS name. Default black. */
  background?: string;
  /** Never scale an image up past its natural size. Default false. */
  withoutEnlargement?: boolean;
  /** Output format; inferred from the output extension when omitted. */
  format?: Format;
  /** 1–100 for lossy formats. */
  quality?: number;
}

export interface ConvertOptions {
  format?: Format;
  quality?: number;
}

export interface CropOptions {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RotateOptions {
  /** Degrees clockwise. Omit to auto-orient from EXIF instead. */
  angle?: number;
  background?: string;
}

export interface CompositeLayer {
  /** Path of the image to lay on top. */
  input: string;
  left?: number;
  top?: number;
  /** Position when left/top are omitted, e.g. "centre", "southeast". */
  gravity?: string;
  /** 0–1. Default 1. */
  opacity?: number;
}

export interface ContactSheetOptions {
  /** Cell size in pixels. Default 200. */
  cell?: number;
  /** Images per row. Default: ceil(sqrt(n)). */
  columns?: number;
  background?: string;
}

const FORMAT_BY_EXT: Record<string, Format> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  avif: "avif",
  tif: "tiff",
  tiff: "tiff",
  gif: "gif",
};

/**
 * Pick the output encoder. An explicit `format` wins; otherwise the output
 * path's extension decides, because writing PNG bytes to `/out/x.jpg` is a
 * mistake nobody notices until something else refuses to open the file.
 */
function formatFor(output: string, explicit: Format | undefined): Format | null {
  if (explicit) {
    if (!(explicit in FORMAT_BY_EXT) && !Object.values(FORMAT_BY_EXT).includes(explicit)) {
      throw new Error(`unsupported format ${JSON.stringify(explicit)} — use one of ${[...new Set(Object.values(FORMAT_BY_EXT))].join(", ")}`);
    }
    return explicit;
  }
  const ext = output.slice(output.lastIndexOf(".") + 1).toLowerCase();
  return FORMAT_BY_EXT[ext] ?? null;
}

function encode(pipeline: Sharp, format: Format | null, quality?: number): Sharp {
  if (!format) return pipeline;
  return pipeline.toFormat(format, quality === undefined ? undefined : { quality });
}

async function load(vfs: EnvFsHandle, path: string): Promise<Sharp> {
  const bytes = await vfs.readBytes(path);
  return sharp(Buffer.from(bytes), { failOn: "error" });
}

async function save(vfs: EnvFsHandle, pipeline: Sharp, output: string): Promise<string> {
  const buffer = await pipeline.toBuffer();
  await vfs.writeFile(output, new Uint8Array(buffer));
  return output;
}

/** sharp reports a decode failure with no clue which file it was reading. */
function withPath<T>(path: string, work: () => Promise<T>): Promise<T> {
  return work().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes(path)) throw e;
    throw new Error(`${path}: ${message}`);
  });
}

function hex(channel: { r: number; g: number; b: number }): string {
  const part = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${part(channel.r)}${part(channel.g)}${part(channel.b)}`;
}

export const images = () =>
  defineAdapter({
    name: "images",
    description: "Inspect and transform raster images: describe, resize, convert, crop, rotate, composite.",
    types: IMAGES_TYPES,
    docs: IMAGES_DOCS,
    handles: {
      extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff", ".avif", ".heic", ".heif"],
      magic: [
        { bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
        { bytes: [0xff, 0xd8, 0xff] }, // JPEG
        { bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
        { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // WEBP, inside the RIFF container
        { bytes: [0x49, 0x49, 0x2a, 0x00] }, // TIFF, little-endian
        { bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // TIFF, big-endian
        { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ISO-BMFF: avif/heic
      ],
    },
    create: (vfs: EnvFsHandle) => ({
      /** What is this image? Dimensions, format, colour space — no pixels. */
      async describe(path: string): Promise<ImageSummary> {
        return withPath(path, async () => {
          const meta = await (await load(vfs, path)).metadata();
          if (!meta.format) throw new Error("not a recognised image format");
          return {
            path,
            format: meta.format,
            bytes: (await vfs.stat(path))?.size ?? 0,
            width: meta.width ?? 0,
            height: meta.height ?? 0,
            space: meta.space ?? "unknown",
            channels: meta.channels ?? 0,
            hasAlpha: meta.hasAlpha === true,
            density: meta.density ?? null,
            pages: meta.pages ?? 1,
            orientation: meta.orientation ?? null,
          };
        });
      },

      /** Channel statistics — enough to tell a blank scan from a real one. */
      async stats(path: string): Promise<ImageStats> {
        return withPath(path, async () => {
          const s = await (await load(vfs, path)).stats();
          const channels: ChannelStats[] = s.channels.map((c) => ({
            min: c.min,
            max: c.max,
            mean: Math.round(c.mean * 100) / 100,
            stdev: Math.round(c.stdev * 100) / 100,
          }));
          // Alpha is not luminance; averaging it in would make every
          // transparent PNG look dark.
          const colour = channels.slice(0, 3);
          const meanBrightness =
            colour.length === 0 ? 0 : Math.round((colour.reduce((a, c) => a + c.mean, 0) / colour.length) * 100) / 100;
          return { path, channels, dominant: hex(s.dominant), isOpaque: s.isOpaque, meanBrightness };
        });
      },

      /** Resize into a box. Returns the output path. */
      async resize(input: string, output: string, opts: ResizeOptions = {}): Promise<string> {
        return withPath(input, async () => {
          if (opts.width === undefined && opts.height === undefined) {
            throw new Error("resize needs a width, a height, or both");
          }
          let pipeline = (await load(vfs, input)).resize({
            width: opts.width,
            height: opts.height,
            fit: opts.fit ?? "cover",
            background: opts.background ?? "#000000",
            withoutEnlargement: opts.withoutEnlargement ?? false,
          });
          pipeline = encode(pipeline, formatFor(output, opts.format), opts.quality);
          return save(vfs, pipeline, output);
        });
      },

      /** Re-encode to another format. Returns the output path. */
      async convert(input: string, output: string, opts: ConvertOptions = {}): Promise<string> {
        return withPath(input, async () => {
          const format = formatFor(output, opts.format);
          if (!format) {
            throw new Error(
              `cannot tell what format to write for ${output} — give it a known extension (.png, .jpg, .webp, .avif, .tiff, .gif) or pass { format }`,
            );
          }
          return save(vfs, encode(await load(vfs, input), format, opts.quality), output);
        });
      },

      /** Cut a rectangle out. Returns the output path. */
      async crop(input: string, output: string, box: CropOptions): Promise<string> {
        return withPath(input, async () => {
          for (const key of ["left", "top", "width", "height"] as const) {
            if (typeof box?.[key] !== "number") throw new Error(`crop needs a numeric ${key}`);
          }
          if (box.width <= 0 || box.height <= 0) throw new Error("crop width and height must be positive");
          const pipeline = (await load(vfs, input)).extract({
            left: Math.round(box.left),
            top: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height),
          });
          return save(vfs, encode(pipeline, formatFor(output, undefined)), output);
        });
      },

      /** Rotate by an angle, or auto-orient from EXIF when no angle is given. */
      async rotate(input: string, output: string, opts: RotateOptions = {}): Promise<string> {
        return withPath(input, async () => {
          const loaded = await load(vfs, input);
          const pipeline =
            opts.angle === undefined
              ? loaded.rotate()
              : loaded.rotate(opts.angle, { background: opts.background ?? "#000000" });
          return save(vfs, encode(pipeline, formatFor(output, undefined)), output);
        });
      },

      /** Lay images on top of a base image. Returns the output path. */
      async composite(input: string, output: string, layers: CompositeLayer[]): Promise<string> {
        return withPath(input, async () => {
          if (!Array.isArray(layers) || layers.length === 0) throw new Error("composite needs at least one layer");
          const overlays: OverlayOptions[] = [];
          for (const layer of layers) {
            if (!layer?.input) throw new Error("each composite layer needs an { input } path");
            let overlay = sharp(Buffer.from(await vfs.readBytes(layer.input)));
            if (layer.opacity !== undefined && layer.opacity < 1) {
              // sharp has no opacity knob; scaling the alpha channel is the
              // supported way to fade a layer.
              const alpha = Math.round(Math.max(0, Math.min(1, layer.opacity)) * 255);
              overlay = overlay.ensureAlpha().composite([
                {
                  input: Buffer.from([255, 255, 255, alpha]),
                  raw: { width: 1, height: 1, channels: 4 },
                  tile: true,
                  blend: "dest-in",
                },
              ]);
            }
            overlays.push({
              input: await overlay.png().toBuffer(),
              ...(layer.left !== undefined ? { left: Math.round(layer.left) } : {}),
              ...(layer.top !== undefined ? { top: Math.round(layer.top) } : {}),
              ...(layer.gravity !== undefined ? { gravity: layer.gravity } : {}),
            });
          }
          const pipeline = (await load(vfs, input)).composite(overlays);
          return save(vfs, encode(pipeline, formatFor(output, undefined)), output);
        });
      },

      /** Square thumbnail, cropped to fill. Returns the output path. */
      async thumbnail(input: string, output: string, size = 256): Promise<string> {
        return withPath(input, async () => {
          const pipeline = (await load(vfs, input)).resize({ width: size, height: size, fit: "cover" });
          return save(vfs, encode(pipeline, formatFor(output, undefined)), output);
        });
      },

      /**
       * Tile many images into one grid. The point is to make a set of images
       * inspectable in a single artifact — one export, one glance — instead of
       * one file at a time.
       */
      async contactSheet(inputs: string[], output: string, opts: ContactSheetOptions = {}): Promise<string> {
        if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("contactSheet needs at least one input path");
        const cell = Math.max(16, Math.round(opts.cell ?? 200));
        const columns = Math.max(1, Math.round(opts.columns ?? Math.ceil(Math.sqrt(inputs.length))));
        const rows = Math.ceil(inputs.length / columns);
        const tiles: OverlayOptions[] = [];
        for (let i = 0; i < inputs.length; i++) {
          const path = inputs[i];
          const tile = await withPath(path, async () =>
            (await load(vfs, path))
              .resize({ width: cell, height: cell, fit: "contain", background: opts.background ?? "#ffffff" })
              .png()
              .toBuffer(),
          );
          tiles.push({ input: tile, left: (i % columns) * cell, top: Math.floor(i / columns) * cell });
        }
        const sheet = sharp({
          create: {
            width: columns * cell,
            height: rows * cell,
            channels: 4,
            background: opts.background ?? "#ffffff",
          },
        }).composite(tiles);
        return save(vfs, encode(sheet, formatFor(output, undefined) ?? "png"), output);
      },
    }),
  });

export default images;
