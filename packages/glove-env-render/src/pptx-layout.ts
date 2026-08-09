/**
 * Reading a deck's *layout* — where things are, not just what they say.
 *
 * `glove-env-slides` already reads a deck's text. This reads geometry as
 * well, because the defects worth catching are positional: a text box wider
 * than the slide, two shapes on top of each other, a slide with nothing on
 * it. Text extraction is blind to every one of those.
 *
 * A ZIP of OOXML parts, same shape as the readers in `glove-env-slides` and
 * `glove-env-documents`. Kept separate from theirs on purpose — a renderer
 * that shared the writer's code would inherit the writer's bugs and agree
 * with itself about a broken deck.
 */
import { inflateRawSync } from "node:zlib";
import { DEFAULT_LIMITS } from "glove-working-environment";

/** English Metric Units per inch — OOXML's internal unit. */
const EMU_PER_INCH = 914_400;
/** Default deck size when the presentation part omits it: 13.333in x 7.5in. */
const DEFAULT_SLIDE = { w: 12_192_000, h: 6_858_000 };

export interface LaidOutShape {
  /** Position and size in EMU, relative to the slide origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Paragraphs of text inside the shape, in order. */
  text: string[];
  /** Point size of the shape's first run, when it declares one. */
  fontSize?: number;
  bold: boolean;
  /** True for a picture rather than a text/auto shape. */
  picture: boolean;
}

export interface LaidOutSlide {
  index: number;
  shapes: LaidOutShape[];
}

export interface DeckLayout {
  /** Slide dimensions in EMU. */
  width: number;
  height: number;
  slides: LaidOutSlide[];
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
/** General-purpose bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;

/**
 * Ceiling on what one part may inflate to when the caller does not say.
 *
 * The live `maxVfsBytes` is the number that belongs here and a caller holding
 * a VFS handle should pass it; the environment's default stands in when this
 * reader is handed bytes alone. Erring low is the safe direction, because too
 * low is a named error naming the limit to raise, while too high is an OOM
 * that takes the whole process with it.
 */
const DEFAULT_MAX_INFLATED = DEFAULT_LIMITS.maxVfsBytes;

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file: no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new Error("ZIP64 archives are not supported");

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (view.getUint16(offset + 8, true) & FLAG_ENCRYPTED) {
      // Inflating ciphertext yields garbage, not an error, so the deck would
      // come back as "not a PowerPoint deck" and the schematic would be drawn
      // from nothing. Refusing by name says what to do about it.
      throw new Error(`encrypted ZIP entries are not supported: ${name} — save the deck without a password`);
    }
    entries.set(name, {
      name,
      compression: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Inflate one part, refusing to produce more than `maxBytes`.
 *
 * The cap is the whole defence, not belt-and-braces: `uncompressedSize` comes
 * from the file being inspected, so trusting it catches only honest decks.
 * `maxOutputLength` is what stops a few kilobytes of deflate stream from
 * becoming gigabytes of host heap — and this reader runs on decks LibreOffice
 * has already refused, which is exactly the population a crafted file is in.
 */
function readEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.localHeaderOffset;
  const nameLen = view.getUint16(h + 26, true);
  const extraLen = view.getUint16(h + 28, true);
  const start = h + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) {
    if (raw.byteLength > maxBytes) throw new Error(bombMessage(entry, maxBytes));
    return raw;
  }
  if (entry.compression !== 8) {
    throw new Error(`unsupported ZIP compression method ${entry.compression}`);
  }
  try {
    return new Uint8Array(inflateRawSync(raw, { maxOutputLength: maxBytes }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/maxOutputLength|buffer|ERR_BUFFER_TOO_LARGE/i.test(msg)) throw new Error(bombMessage(entry, maxBytes));
    throw new Error(`could not inflate ${entry.name}: ${msg}`);
  }
}

function bombMessage(entry: ZipEntry, maxBytes: number): string {
  return (
    `${entry.name} expands past the ${maxBytes}-byte inflation budget for this environment` +
    (entry.uncompressedSize > 0 ? ` (it declares ${entry.uncompressedSize} bytes)` : "") +
    `. This deck is either corrupt or crafted to exhaust memory; raise limits.maxVfsBytes if it is genuinely this large.`
  );
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Paragraphs inside one shape, runs joined the way PowerPoint splits them. */
function paragraphsOf(xml: string): string[] {
  const out: string[] = [];
  for (const [, body] of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    let line = "";
    for (const [, run] of body.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) line += decodeXmlText(run);
    const trimmed = line.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function slideNumber(part: string): number {
  const m = /slide(\d+)\.xml$/.exec(part);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Shapes on one slide, with their frames.
 *
 * `<p:sp>` is a shape and `<p:pic>` a picture; both carry an `<a:off>` /
 * `<a:ext>` pair inside `<a:xfrm>`. A shape with no `xfrm` inherits its frame
 * from the layout, which is not read here — those are reported at the origin
 * with zero size and drawn as "position unknown" rather than silently placed
 * somewhere plausible.
 */
function shapesOf(xml: string): LaidOutShape[] {
  const shapes: LaidOutShape[] = [];
  for (const [, tag, body] of xml.matchAll(/<p:(sp|pic)\b[^>]*>([\s\S]*?)<\/p:\1>/g)) {
    const off = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/.exec(body);
    const ext = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/.exec(body);
    const size = /<a:rPr\b[^>]*\bsz="(\d+)"/.exec(body);
    shapes.push({
      x: off ? Number(off[1]) : 0,
      y: off ? Number(off[2]) : 0,
      w: ext ? Number(ext[1]) : 0,
      h: ext ? Number(ext[2]) : 0,
      text: paragraphsOf(body),
      // OOXML stores font size in hundredths of a point.
      ...(size ? { fontSize: Number(size[1]) / 100 } : {}),
      bold: /<a:rPr\b[^>]*\bb="1"/.test(body),
      picture: tag === "pic",
    });
  }
  return shapes;
}

/**
 * Read every slide's shapes and the deck's dimensions.
 *
 * `maxBytes` bounds what any one part may inflate to; pass the environment's
 * `maxVfsBytes` when there is a VFS handle to read it from.
 */
export function readLayout(bytes: Uint8Array, maxBytes: number = DEFAULT_MAX_INFLATED): DeckLayout {
  const entries = readZip(bytes);

  const presentation = entries.get("ppt/presentation.xml");
  let width = DEFAULT_SLIDE.w;
  let height = DEFAULT_SLIDE.h;
  if (presentation) {
    const xml = new TextDecoder().decode(readEntry(bytes, presentation, maxBytes));
    const m = /<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/.exec(xml);
    if (m) {
      width = Number(m[1]);
      height = Number(m[2]);
    }
  }

  const parts = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (parts.length === 0) {
    throw new Error("this is a ZIP but not a PowerPoint deck (no ppt/slides/) — .docx and .xlsx are also ZIPs");
  }

  const slides = parts.map((part, i) => ({
    index: i + 1,
    shapes: shapesOf(new TextDecoder().decode(readEntry(bytes, entries.get(part)!, maxBytes))),
  }));

  return { width, height, slides };
}

export const EMU = { PER_INCH: EMU_PER_INCH };
