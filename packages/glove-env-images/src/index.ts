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

/**
 * Controls shared by everything that reads a file. Vector input has no pixels
 * until something picks a resolution, and animated input has frames that only
 * some encoders can write back.
 */
export interface SourceOptions {
  /**
   * Rasterization multiplier for vector input (SVG). 2 renders a 100×50 SVG at
   * 200×100. Ignored for raster input.
   */
  scale?: number;
  /** Rasterization DPI for vector input; 72 is natural size. Overrides `scale`. */
  density?: number;
  /**
   * Keep every frame of an animated GIF/WebP. On by default whenever the
   * output format can hold frames; `false` writes the first frame only.
   */
  animated?: boolean;
}

export interface ResizeOptions extends SourceOptions {
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

export interface ConvertOptions extends SourceOptions {
  format?: Format;
  quality?: number;
}

export interface CropOptions {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RotateOptions extends SourceOptions {
  /** Degrees clockwise. Omit to auto-orient from EXIF instead. */
  angle?: number;
  background?: string;
}

export interface TextOptions {
  /** The words to draw. Newlines start a new line; XML is escaped, not parsed. */
  text: string;
  /** Point size in pixels. Default: 6% of the frame height, never below 12. */
  size?: number;
  /** Fill colour, as #rrggbb or a CSS name. Default white. */
  colour?: string;
  /** Halo drawn behind the fill so light text survives a light image. Null removes it. Default black. */
  outline?: string | null;
  /** Font family. Default "sans-serif" — whatever fontconfig resolves that to. */
  font?: string;
  /** "normal" or "bold". Default "bold": a watermark is read at a glance or not at all. */
  weight?: "normal" | "bold";
  /** Where to put it when left/top are omitted, e.g. "southeast", "centre". */
  gravity?: string;
  /** Exact placement of the text block's own box, in pixels from the top-left. */
  left?: number;
  top?: number;
  /** Gap from the edge when positioned by gravity. Default 16. */
  padding?: number;
  /** 0–1. Default 1. */
  opacity?: number;
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
 * Encoders that can write more than one frame.
 *
 * libvips holds an animated image as a single tall strip of frames, so handing
 * that strip to the PNG encoder does not flatten it — it writes an image thirty
 * times too tall, which is worse than the flattening it was meant to avoid. So
 * whether to decode every frame is decided against the OUTPUT format, never the
 * input's.
 */
const ANIMATED_FORMATS = new Set<Format>(["gif", "webp"]);

/**
 * Formats sharp reads but cannot write. Deliberately absent from
 * FORMAT_BY_EXT: mapping `.svg` to an encoder that does not exist would turn a
 * refusal the caller can act on into a file full of PNG bytes named `.svg`.
 */
const READ_ONLY_EXT = new Set(["svg", "svgz"]);

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
  if (READ_ONLY_EXT.has(ext)) {
    throw new Error(
      `cannot write ${output}: SVG is read-only here — sharp rasterizes it but has no SVG encoder. ` +
        `Write .png or .webp instead, and use { scale } or { density } to choose the resolution.`,
    );
  }
  return FORMAT_BY_EXT[ext] ?? null;
}

function encode(pipeline: Sharp, format: Format | null, quality?: number): Sharp {
  if (!format) return pipeline;
  return pipeline.toFormat(format, quality === undefined ? undefined : { quality });
}

/** A decoded source, plus the facts the callers need to decide what to do. */
interface Opened {
  pipeline: Sharp;
  /** Frames in the SOURCE, whether or not they were all decoded. */
  pages: number;
  /** True when every frame was decoded AND the encoder can write them back. */
  animated: boolean;
  width: number;
  /** Height of ONE frame — what `crop` coordinates are measured against. */
  pageHeight: number;
  format: string;
}

interface OpenOptions extends SourceOptions {
  /**
   * The format this pipeline will encode to. `null` means "whatever the source
   * was", which is what the bindings that keep the input format end up with.
   */
  target?: Format | null;
}

/**
 * Read a file and decide how much of it to decode.
 *
 * Two decisions live here because both depend on facts the caller does not
 * have: how many frames the source has, and what the output can hold. Reading
 * the header first costs one metadata parse and no pixels.
 */
async function open(vfs: EnvFsHandle, path: string, opts: OpenOptions = {}): Promise<Opened> {
  const buffer = Buffer.from(await vfs.readBytes(path));
  const density = densityFor(opts);
  const vector = density === undefined ? {} : { density };
  // Probed at the density the pipeline will use, so the reported size is the
  // size a crop box or a text layout is measured against — but never as
  // animated, because the frame's height is what those want, not the strip's.
  const probe = await sharp(buffer, { failOn: "error", ...vector }).metadata();
  const pages = probe.pages ?? 1;
  // No explicit target means the source format is kept, so that is what has to
  // be able to hold the frames.
  const target = opts.target ?? (probe.format as Format | undefined);
  const animated = opts.animated !== false && pages > 1 && target !== undefined && ANIMATED_FORMATS.has(target);
  return {
    pipeline: sharp(buffer, { failOn: "error", animated, ...vector }),
    pages,
    animated,
    width: probe.width ?? 0,
    // A flat read of an animated file reports one frame's height and no
    // pageHeight at all; an animated read reports the strip and the frame.
    pageHeight: probe.pageHeight ?? probe.height ?? 0,
    format: probe.format ?? "unknown",
  };
}

/**
 * DPI to rasterize vector input at. 72 is natural size, so `scale` is just a
 * multiplier on it — which is how the request actually arrives ("this logo at
 * 2x"), and nobody should have to know that 144 means twice.
 */
function densityFor(opts: SourceOptions): number | undefined {
  if (opts.density !== undefined) {
    if (typeof opts.density !== "number" || !Number.isFinite(opts.density) || opts.density <= 0 || opts.density > 7200) {
      throw new Error(`density must be a DPI between 1 and 7200 (72 is natural size), got ${JSON.stringify(opts.density)}`);
    }
    return opts.density;
  }
  if (opts.scale !== undefined) {
    if (typeof opts.scale !== "number" || !Number.isFinite(opts.scale) || opts.scale <= 0 || opts.scale > 100) {
      throw new Error(`scale must be a positive multiplier up to 100 (1 is natural size), got ${JSON.stringify(opts.scale)}`);
    }
    return 72 * opts.scale;
  }
  return undefined;
}

/**
 * Repeat a frame-sized overlay all the way down an animated image.
 *
 * The frames are one tall strip, so an overlay placed at `top: 0` marks frame
 * one and nothing else. Compositing the layers onto a single transparent frame
 * first — which is also where `gravity` resolves against a frame rather than
 * against the whole strip — and then repeating those bytes puts the same mark
 * on every frame. Layers only ever blend `over`, so flattening them first is
 * the same picture.
 */
async function perFrame(overlays: OverlayOptions[], base: Opened): Promise<OverlayOptions> {
  const frame = await sharp({
    create: { width: base.width, height: base.pageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(overlays)
    .raw()
    .toBuffer();
  return {
    input: Buffer.concat(Array.from({ length: base.pages }, () => frame)),
    raw: { width: base.width, height: base.pageHeight * base.pages, channels: 4 },
    left: 0,
    top: 0,
  };
}

/** Lay overlays over a base, once per frame when the base kept its frames. */
async function layerOnto(base: Opened, overlays: OverlayOptions[]): Promise<Sharp> {
  return base.pipeline.composite(base.animated ? [await perFrame(overlays, base)] : overlays);
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

const GRAVITIES = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "centre"];

/** Caller text goes into SVG attributes and elements, so it is data, not markup. */
function escapeXml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "apos" }[c]};`);
}

/**
 * Draw text as an SVG the size of one frame.
 *
 * sharp has no text primitive, so the standard idiom is to render an SVG and
 * composite it — which is fine, except that SVG cannot measure a string, so
 * nothing here can centre text by width. The anchor does that work instead:
 * `end` against the right edge, `middle` against the centre line. Vertical
 * placement is a baseline rather than a box, because librsvg's
 * `dominant-baseline` is not something to lean on, so the top row is pushed
 * down by one line.
 */
function textSvg(width: number, height: number, opts: TextOptions): string {
  const text = typeof opts.text === "string" ? opts.text : "";
  if (text.trim() === "") throw new Error("text needs a { text } string to draw");
  const size = opts.size ?? Math.max(12, Math.round(height * 0.06));
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    throw new Error(`size must be a positive number of pixels, got ${JSON.stringify(opts.size)}`);
  }
  const padding = opts.padding ?? 16;
  const opacity = Math.max(0, Math.min(1, opts.opacity ?? 1));
  const gravity = (opts.gravity ?? "southeast").toLowerCase().replace("center", "centre");
  if (!GRAVITIES.includes(gravity)) {
    throw new Error(`gravity ${JSON.stringify(opts.gravity)} is not one of ${GRAVITIES.join(", ")}`);
  }

  const lines = text.split("\n");
  const leading = size * 1.2;
  const block = leading * (lines.length - 1);

  const placed = opts.left !== undefined || opts.top !== undefined;
  const anchor = placed ? "start" : gravity.includes("west") ? "start" : gravity.includes("east") ? "end" : "middle";
  const x = placed
    ? Math.round(opts.left ?? padding)
    : anchor === "start"
      ? padding
      : anchor === "end"
        ? width - padding
        : width / 2;
  const y = placed
    ? Math.round(opts.top ?? padding) + size
    : gravity.includes("north")
      ? padding + size
      : gravity.includes("south")
        ? height - padding - block
        : height / 2 - block / 2 + size * 0.35;

  const spans = lines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : leading}">${escapeXml(line)}</tspan>`)
    .join("");
  const attrs =
    `x="${x}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(opts.font ?? "sans-serif")}" ` +
    `font-size="${size}" font-weight="${opts.weight === "normal" ? "normal" : "bold"}"`;
  // paint-order puts the halo behind the glyph instead of through the middle
  // of it; without it a stroke this thick eats the letterforms entirely.
  const halo =
    opts.outline === null
      ? ""
      : ` stroke="${escapeXml(opts.outline ?? "#000000")}" stroke-width="${Math.max(1, size / 10)}" paint-order="stroke fill"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g opacity="${opacity}"><text ${attrs} fill="${escapeXml(opts.colour ?? "#ffffff")}"${halo}>${spans}</text></g></svg>`
  );
}

export const images = () =>
  defineAdapter({
    name: "images",
    description: "Inspect and transform images: describe, resize, convert, crop, rotate, composite, draw text. Animated GIF/WebP and SVG included.",
    types: IMAGES_TYPES,
    docs: IMAGES_DOCS,
    handles: {
      extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff", ".avif", ".heic", ".heif", ".svg", ".svgz"],
      magic: [
        { bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
        { bytes: [0xff, 0xd8, 0xff] }, // JPEG
        { bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
        { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // WEBP, inside the RIFF container
        { bytes: [0x49, 0x49, 0x2a, 0x00] }, // TIFF, little-endian
        { bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // TIFF, big-endian
        { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ISO-BMFF: avif/heic
        // SVG is text, so sniffing it is a guess: a document may open with an
        // XML declaration, a doctype, or a comment. The extension is the
        // reliable signal; this only catches the plainest case.
        { bytes: [0x3c, 0x73, 0x76, 0x67] }, // "<svg"
      ],
    },
    create: (vfs: EnvFsHandle) => ({
      /** What is this image? Dimensions, format, colour space — no pixels. */
      async describe(path: string): Promise<ImageSummary> {
        return withPath(path, async () => {
          // Deliberately a flat read: width/height should be one frame's, and
          // `pages` reports the frame count either way.
          const meta = await (await open(vfs, path, { animated: false })).pipeline.metadata();
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
          // First frame only: "is this page blank?" is a question about one
          // picture, and decoding ninety frames to answer it is waste.
          const s = await (await open(vfs, path, { animated: false })).pipeline.stats();
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
          const format = formatFor(output, opts.format);
          const src = await open(vfs, input, { ...opts, target: format });
          let pipeline = src.pipeline.resize({
            width: opts.width,
            height: opts.height,
            fit: opts.fit ?? "cover",
            background: opts.background ?? "#000000",
            withoutEnlargement: opts.withoutEnlargement ?? false,
          });
          pipeline = encode(pipeline, format, opts.quality);
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
          const src = await open(vfs, input, { ...opts, target: format });
          return save(vfs, encode(src.pipeline, format, opts.quality), output);
        });
      },

      /** Cut a rectangle out. Returns the output path. */
      async crop(input: string, output: string, box: CropOptions): Promise<string> {
        return withPath(input, async () => {
          for (const key of ["left", "top", "width", "height"] as const) {
            if (typeof box?.[key] !== "number") throw new Error(`crop needs a numeric ${key}`);
          }
          if (box.width <= 0 || box.height <= 0) throw new Error("crop width and height must be positive");
          const src = await open(vfs, input, { target: formatFor(output, undefined) });
          const left = Math.round(box.left);
          const top = Math.round(box.top);
          const width = Math.round(box.width);
          const height = Math.round(box.height);
          // libvips answers an out-of-bounds box with "bad extract area", which
          // says nothing about which edge or how far over. It matters more here
          // than it looks: on an animated image the box is measured against ONE
          // frame, not against the whole strip of them.
          if (left < 0 || top < 0 || left + width > src.width || top + height > src.pageHeight) {
            throw new Error(
              `crop box ${width}×${height} at (${left}, ${top}) falls outside ` +
                `${src.width}×${src.pageHeight}${src.pages > 1 ? ` (one of ${src.pages} frames)` : ""}`,
            );
          }
          const pipeline = src.pipeline.extract({ left, top, width, height });
          return save(vfs, encode(pipeline, formatFor(output, undefined)), output);
        });
      },

      /** Rotate by an angle, or auto-orient from EXIF when no angle is given. */
      async rotate(input: string, output: string, opts: RotateOptions = {}): Promise<string> {
        return withPath(input, async () => {
          const format = formatFor(output, undefined);
          const src = await open(vfs, input, { ...opts, target: format });
          // The one operation animation cannot survive. libvips refuses a
          // quarter turn on a multi-page image outright, and a half turn
          // "succeeds" by flipping the whole strip — which reverses the frame
          // order. Neither is something to do quietly behind a caller's back.
          if (src.animated) {
            throw new Error(
              `${input} has ${src.pages} frames and libvips cannot rotate a multi-page image: the frames are stored ` +
                `as one tall strip, so a quarter turn is refused and a half turn silently reverses their order. ` +
                `Pass { animated: false } to rotate the first frame only, or write a still format.`,
            );
          }
          const pipeline =
            opts.angle === undefined
              ? src.pipeline.rotate()
              : src.pipeline.rotate(opts.angle, { background: opts.background ?? "#000000" });
          return save(vfs, encode(pipeline, format), output);
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
          const format = formatFor(output, undefined);
          const src = await open(vfs, input, { target: format });
          return save(vfs, encode(await layerOnto(src, overlays), format), output);
        });
      },

      /**
       * Draw text onto an image — a watermark, a date, a caption.
       *
       * sharp has no text primitive. The idiom everyone reaches for is to
       * render an SVG and composite it, which is enough moving parts (escaping,
       * anchoring, a halo that does not eat the glyphs) that leaving it to the
       * caller means it gets written badly, once per caller.
       */
      async text(input: string, output: string, opts: TextOptions): Promise<string> {
        return withPath(input, async () => {
          if (!opts || typeof opts !== "object") throw new Error("text needs a { text } option saying what to draw");
          const format = formatFor(output, undefined);
          const src = await open(vfs, input, { target: format });
          const svg = Buffer.from(textSvg(src.width, src.pageHeight, opts));
          const drawn = await sharp(svg).png().toBuffer();
          return save(vfs, encode(await layerOnto(src, [{ input: drawn, left: 0, top: 0 }]), format), output);
        });
      },

      /** Square thumbnail, cropped to fill. Returns the output path. */
      async thumbnail(input: string, output: string, size = 256): Promise<string> {
        return withPath(input, async () => {
          const format = formatFor(output, undefined);
          const src = await open(vfs, input, { target: format });
          const pipeline = src.pipeline.resize({ width: size, height: size, fit: "cover" });
          return save(vfs, encode(pipeline, format), output);
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
            // A cell is one picture: an animated source contributes its first
            // frame, or the sheet would be a column of strips.
            (await open(vfs, path, { animated: false })).pipeline
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
