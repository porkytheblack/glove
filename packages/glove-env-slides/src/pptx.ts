/**
 * Reading a .pptx back out.
 *
 * A pptx is a ZIP of OOXML parts, so this is the same shape as the DOCX
 * reader in glove-env-documents: read the central directory, inflate the
 * parts we care about, pull text out of the XML.
 *
 * It is deliberately a *separate* implementation from the writer. pptxgenjs
 * produces the deck; nothing from pptxgenjs is used to verify it. A bug
 * symmetric in the writer — a title written into the wrong placeholder, a
 * bullet silently dropped — survives a round trip through its own library and
 * dies here.
 */
import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

/**
 * Parse the central directory.
 *
 * Reading the central directory rather than scanning for local headers is
 * what makes this correct on files with data descriptors, where the local
 * header's sizes are zero and the real ones live only here.
 */
function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record is last, but a trailing comment can
  // push it back by up to 64 KiB, so it has to be searched for.
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
  if (offset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported — re-save the deck without ZIP64");
  }

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
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

function readEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.localHeaderOffset;
  // The local header's name/extra lengths can differ from the central
  // directory's, so the data offset must come from the local header.
  const nameLen = view.getUint16(h + 26, true);
  const extraLen = view.getUint16(h + 28, true);
  const start = h + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) return raw;
  if (entry.compression === 8) return new Uint8Array(inflateRawSync(raw));
  throw new Error(`unsupported ZIP compression method ${entry.compression} for ${entry.name}`);
}

function readText(bytes: Uint8Array, name: string): string | null {
  const entries = readZip(bytes);
  const entry = entries.get(name);
  return entry ? new TextDecoder().decode(readEntry(bytes, entry)) : null;
}

/** `ppt/slides/slide12.xml` → 12. Used to order slides numerically, not lexically. */
function slideNumber(part: string): number {
  const m = /slide(\d+)\.xml$/.exec(part);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
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

/**
 * Text runs from one slide part, grouped into paragraphs.
 *
 * PowerPoint splits a single visual line into several `<a:t>` runs whenever
 * formatting changes mid-sentence, so runs are joined within their `<a:p>`
 * and only paragraph boundaries become lines. Without that, "Revenue **grew**
 * 12%" comes back as three separate bullets and every assertion about bullet
 * counts is wrong.
 */
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

export interface SlideText {
  /** 1-based, in presentation order. */
  slide: number;
  /** First paragraph on the slide — the title, by PowerPoint's own convention. */
  title: string;
  /** Every remaining paragraph, in order. */
  body: string[];
  /** Speaker notes, when the slide has any. */
  notes: string;
}

export interface DeckContent {
  slides: SlideText[];
  /** Every image/media part the deck embeds. */
  media: string[];
}

/** Read a deck's text, slide by slide, from the file itself. */
export function readDeck(bytes: Uint8Array): DeckContent {
  const entries = readZip(bytes);

  const slideParts = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slideParts.length === 0) {
    throw new Error(
      "this is a ZIP but not a PowerPoint deck (no ppt/slides/) — .docx and .xlsx are also ZIPs, check the file",
    );
  }

  const slides: SlideText[] = slideParts.map((part, i) => {
    const paragraphs = paragraphsOf(readText(bytes, part) ?? "");
    const notesPart = `ppt/notesSlides/notesSlide${slideNumber(part)}.xml`;
    const notes = entries.has(notesPart) ? paragraphsOf(readText(bytes, notesPart) ?? "").join("\n") : "";
    return {
      slide: i + 1,
      title: paragraphs[0] ?? "",
      body: paragraphs.slice(1),
      notes,
    };
  });

  // Trailing slash means a directory entry. `ppt/media/` exists even in a
  // deck with no images, so counting it as media reports one phantom asset in
  // every deck.
  const media = [...entries.keys()].filter((n) => n.startsWith("ppt/media/") && !n.endsWith("/")).sort();
  return { slides, media };
}

/** True when the bytes open with a ZIP local-file-header signature. */
export function looksZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
