/**
 * Reading a .pptx back out, and writing one back with a part changed.
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
 *
 * The same independence is what makes editing possible at all. pptxgenjs
 * cannot open a deck, so the only way to change one slide of an inbound file
 * is to go at the package directly: {@link rewriteZip} re-emits every entry
 * it was not asked to change with its original compressed bytes, so a typo fix
 * on slide 4 cannot cost the deck its master, its theme or its images.
 */
import { deflateRawSync, inflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { DEFAULT_LIMITS } from "glove-working-environment";

export interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** General-purpose bit flags, as the central directory recorded them. */
  flags: number;
  /** CRC-32 of the uncompressed data. Needed to re-emit the entry unchanged. */
  crc: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** General-purpose bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;
/** General-purpose bit 3: sizes and CRC follow the data, not the header. */
const FLAG_DATA_DESCRIPTOR = 0x0008;

/**
 * Ceiling on what one part may inflate to when the caller does not say.
 *
 * The adapter passes the environment's real `maxVfsBytes`; this stands in for
 * a host calling `readDeck` on bytes of its own, which has no limits to
 * consult. The default limit is the honest stand-in — the figure the
 * environment uses unless a host raised it — and erring low is the safe
 * direction: too low is a named error, too high is an OOM.
 */
const DEFAULT_MAX_INFLATED = DEFAULT_LIMITS.maxVfsBytes;

/**
 * Parse the central directory.
 *
 * Reading the central directory rather than scanning for local headers is
 * what makes this correct on files with data descriptors, where the local
 * header's sizes are zero and the real ones live only here.
 */
export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
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
    if (view.getUint16(offset + 8, true) & FLAG_ENCRYPTED) {
      // Inflating ciphertext produces garbage rather than an error, so the
      // deck would come back as "not a PowerPoint deck" — a refusal that
      // names the password is the one a person can act on.
      throw new Error(`encrypted ZIP entries are not supported: ${name} — save the deck without a password`);
    }
    entries.set(name, {
      name,
      compression: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
      flags: view.getUint16(offset + 8, true),
      crc: view.getUint32(offset + 16, true),
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
 * becoming gigabytes of host heap — a .pptx is bounded on the way in by
 * `maxFileBytes`, which a deflate stream expands many-fold.
 */
function readEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.localHeaderOffset;
  // The local header's name/extra lengths can differ from the central
  // directory's, so the data offset must come from the local header.
  const nameLen = view.getUint16(h + 26, true);
  const extraLen = view.getUint16(h + 28, true);
  const start = h + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) {
    if (raw.byteLength > maxBytes) throw new Error(bombMessage(entry, maxBytes));
    return raw;
  }
  if (entry.compression !== 8) {
    throw new Error(`unsupported ZIP compression method ${entry.compression} for ${entry.name}`);
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

function readText(bytes: Uint8Array, name: string, maxBytes: number): string | null {
  const entries = readZip(bytes);
  const entry = entries.get(name);
  return entry ? new TextDecoder().decode(readEntry(bytes, entry, maxBytes)) : null;
}

/** One part's bytes, from an index already built. Bounded by `maxBytes`. */
export function readPartBytes(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  return readEntry(bytes, entry, maxBytes);
}

/**
 * One part as UTF-8 text, byte-faithful enough to write back.
 *
 * `ignoreBOM` keeps a leading U+FEFF in the string instead of silently
 * dropping it, which is what a default TextDecoder does. That is fine when the
 * text is only being read, and wrong when it is going to be re-encoded and put
 * back in the package: an edit would quietly strip a byte order mark the
 * producer put there.
 */
export function readPart(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(readEntry(bytes, entry, maxBytes));
}

// ------------------------------------------------------------------ writing

/**
 * CRC-32, from `node:zlib` where the runtime has it.
 *
 * `zlib.crc32` arrived in Node 20.15 / 22.2, and this package does not pin a
 * floor that high. The table fallback is the same polynomial, and a slide part
 * is tens of kilobytes — not a trade worth an engines constraint on every
 * consumer.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  if (typeof nodeCrc32 === "function") return nodeCrc32(bytes) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Rebuild a deck with some parts replaced and every other one copied.
 *
 * "Copied" is literal: an untouched part's *compressed* bytes move across with
 * its recorded CRC, method and sizes, so a part this code never decoded cannot
 * be changed by it. That is what makes a single-slide edit safe — the master,
 * the theme, the layouts, the notes masters and `ppt/media/*` are carried, not
 * regenerated. Measured on a deck this package wrote, rebuilding it from
 * `extract()` instead lost the chart image and the footer layout.
 *
 * Part order is preserved from the source central directory rather than
 * normalised. Producers disagree about it — pptxgenjs emits directory entries
 * first and `[Content_Types].xml` nineteenth, and PowerPoint opens those decks
 * — so the safe move is to keep whatever order already worked instead of
 * inventing one. Extra fields are dropped and the data-descriptor flag is
 * cleared, because the sizes are written into the local header here rather
 * than trailing the data.
 */
export function rewriteZip(bytes: Uint8Array, replacements: Map<string, Uint8Array>): Uint8Array {
  const entries = readZip(bytes);
  for (const name of replacements.keys()) {
    if (!entries.has(name)) throw new Error(`cannot replace ${name}: no such part in the deck`);
  }

  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries.values()) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const replacement = replacements.get(entry.name);

    const body = replacement ? deflateRawSync(replacement) : rawEntryBytes(source, entry);
    const method = replacement ? 8 : entry.compression;
    const crc = replacement ? crc32(replacement) : entry.crc;
    const uncompressedSize = replacement ? replacement.byteLength : entry.uncompressedSize;
    // Keep the UTF-8-name flag and anything else the producer set; drop only
    // the data-descriptor bit, whose promise this writer does not keep.
    const flags = entry.flags & ~FLAG_DATA_DESCRIPTOR;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0, deflate
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.byteLength + body.byteLength;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(directory.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, directory, eocd]));
}

/** A part's stored bytes, still compressed — never inflated, so never a bomb. */
function rawEntryBytes(source: Buffer, entry: ZipEntry): Buffer {
  const head = entry.localHeaderOffset;
  if (head + 30 > source.length || source.readUInt32LE(head) !== SIG_LOCAL) {
    throw new Error(`corrupt ZIP: no local header for ${entry.name}`);
  }
  const nameLen = source.readUInt16LE(head + 26);
  const extraLen = source.readUInt16LE(head + 28);
  const start = head + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > source.length) {
    throw new Error(`corrupt ZIP: ${entry.name} claims ${entry.compressedSize} bytes that run past the end of the deck`);
  }
  return source.subarray(start, end);
}

/** `ppt/slides/slide12.xml` → 12. Used to order slides numerically, not lexically. */
function slideNumber(part: string): number {
  const m = /slide(\d+)\.xml$/.exec(part);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Slide parts in presentation order — index 0 is "slide 1".
 *
 * One function, used by every verb that has to turn a slide number into a
 * part. Reading and editing must agree about which slide is slide 4, or an
 * edit lands on a slide the caller never looked at.
 */
export function slidePartsOf(entries: Map<string, ZipEntry>): string[] {
  return [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
}

/**
 * The notes part belonging to a slide, resolved through the slide's own
 * relationships.
 *
 * The numeric convention — `slide7.xml` ↔ `notesSlide7.xml` — holds for decks
 * this package writes and for very little else: PowerPoint numbers notes parts
 * in the order they were created, so a deck where slide 2 got notes first has
 * `notesSlide1.xml` hanging off slide 2. Reading the rels is the answer the
 * file itself gives; the convention stays only as the fallback for a deck with
 * no rels part at all.
 */
export function notesPartFor(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  slidePart: string,
  maxBytes: number,
): string | null {
  const relsPart = slidePart.replace(/^(.*\/)([^/]+)$/, "$1_rels/$2.rels");
  const rels = entries.get(relsPart);
  if (rels) {
    const xml = readPart(bytes, rels, maxBytes);
    for (const [, target] of xml.matchAll(
      /<Relationship\b[^>]*\bType="[^"]*\/notesSlide"[^>]*\bTarget="([^"]*)"/g,
    )) {
      const resolved = resolveRelative("ppt/slides/", target);
      if (entries.has(resolved)) return resolved;
    }
    // A rels part that exists and names no notes slide is the file saying
    // this slide has none. Believing it beats guessing by number.
    return null;
  }
  const guess = `ppt/notesSlides/notesSlide${slideNumber(slidePart)}.xml`;
  return entries.has(guess) ? guess : null;
}

/** `ppt/slides/` + `../notesSlides/notesSlide2.xml` → `ppt/notesSlides/notesSlide2.xml`. */
function resolveRelative(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = base.split("/").filter(Boolean);
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") segments.pop();
    else segments.push(piece);
  }
  return segments.join("/");
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

/**
 * Read a deck's text, slide by slide, from the file itself.
 *
 * `maxBytes` bounds what any one part may inflate to; the adapter passes the
 * environment's `maxVfsBytes`.
 */
export function readDeck(bytes: Uint8Array, maxBytes: number = DEFAULT_MAX_INFLATED): DeckContent {
  const entries = readZip(bytes);

  const slideParts = slidePartsOf(entries);

  if (slideParts.length === 0) {
    throw new Error(
      "this is a ZIP but not a PowerPoint deck (no ppt/slides/) — .docx and .xlsx are also ZIPs, check the file",
    );
  }

  const slides: SlideText[] = slideParts.map((part, i) => {
    const paragraphs = paragraphsOf(readText(bytes, part, maxBytes) ?? "");
    const notesPart = notesPartFor(bytes, entries, part, maxBytes);
    const notes = notesPart ? paragraphsOf(readText(bytes, notesPart, maxBytes) ?? "").join("\n") : "";
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
