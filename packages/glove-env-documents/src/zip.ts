/**
 * A ZIP reader, and a writer that rebuilds an archive around it.
 *
 * `docx` writes .docx files but cannot read them, and pulling in a full zip
 * library to recover the text of a document we just produced is a poor
 * trade. A .docx is a ZIP of XML parts; reading one needs the central
 * directory and `inflateRaw`, both of which are a hundred lines and a Node
 * builtin.
 *
 * The writer exists for the same reason in reverse. Editing a .docx means
 * changing one part and leaving forty alone, and the only way to leave a part
 * *alone* is to copy its bytes — so {@link rewriteZip} re-emits every entry it
 * was not asked to change with its original compressed bytes, CRC and method,
 * untouched. Nothing is re-encoded on the way through, which is what makes
 * "the header survived the edit" a fact about the file rather than a hope
 * about a model of it.
 */
import { deflateRawSync, inflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { DEFAULT_LIMITS } from "glove-working-environment";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** General-purpose bit 3: sizes and CRC follow the data, not the header. */
const FLAG_DATA_DESCRIPTOR = 0x0008;
/** ZIP64 locator, present when a file has ≥65535 entries or is ≥4 GiB. */
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
/** General-purpose bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;

/**
 * Ceiling on what one part may inflate to when the caller does not say.
 *
 * The live `maxVfsBytes` is the right number and a caller holding a VFS
 * handle should pass it; this stands in for the entry points that take bytes
 * and nothing else. The environment's default is the closest honest stand-in
 * — the figure in force unless a host has raised it — and erring low is the
 * safe direction, because too low is a named error naming the limit to raise
 * while too high is an OOM that takes the whole process with it.
 */
const DEFAULT_MAX_INFLATED = DEFAULT_LIMITS.maxVfsBytes;

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

function findEocd(buf: Buffer): number {
  // The EOCD sits at the end, after a comment of up to 64 KiB.
  const earliest = Math.max(0, buf.length - EOCD_MIN_SIZE - 0xffff);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/** Index a ZIP archive by entry name. */
export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(buf);
  if (eocd < 0) {
    throw new Error("not a ZIP archive (no end-of-central-directory record) — .doc and .rtf are not supported, only .docx");
  }
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new Error("ZIP64 archives are not supported");
  }

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt ZIP central directory at entry ${i + 1} of ${count}`);
    }
    const flags = buf.readUInt16LE(offset + 8);
    const compression = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (flags & FLAG_ENCRYPTED) {
      // Nothing downstream can read this, and inflating the ciphertext yields
      // garbage rather than an error — so it is refused by name here instead
      // of surfacing later as "not a Word document".
      throw new Error(`encrypted ZIP entries are not supported: ${name} — save the .docx without a password`);
    }
    entries.set(name, { name, compression, compressedSize, uncompressedSize, localHeaderOffset, flags, crc });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Decompress one entry, refusing to produce more than `maxBytes`.
 *
 * The cap is the whole defence, not belt-and-braces: the declared
 * `uncompressedSize` is attacker-controlled, so checking it before inflating
 * catches only honest files. `maxOutputLength` is what stops a few kilobytes
 * of deflate stream from becoming gigabytes of host heap — a .docx is bounded
 * on the way in by `maxFileBytes`, which a deflate stream expands many-fold.
 */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number = DEFAULT_MAX_INFLATED): Buffer {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = entry.localHeaderOffset;
  if (buf.readUInt32LE(head) !== LOCAL_SIGNATURE) {
    throw new Error(`corrupt ZIP: no local header for ${entry.name}`);
  }
  // The local header's own name/extra lengths are authoritative — the extra
  // field routinely differs in length from the central directory's copy.
  const nameLength = buf.readUInt16LE(head + 26);
  const extraLength = buf.readUInt16LE(head + 28);
  const start = head + 30 + nameLength + extraLength;
  const body = buf.subarray(start, start + entry.compressedSize);

  if (entry.compression === 0) {
    if (body.length > maxBytes) throw new Error(bombMessage(entry.name, body.length, maxBytes));
    return body;
  }
  if (entry.compression !== 8) {
    throw new Error(`unsupported ZIP compression method ${entry.compression} for ${entry.name}`);
  }
  try {
    return inflateRawSync(body, { maxOutputLength: maxBytes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/maxOutputLength|buffer|ERR_BUFFER_TOO_LARGE/i.test(msg)) {
      throw new Error(bombMessage(entry.name, entry.uncompressedSize, maxBytes));
    }
    throw new Error(`could not inflate ${entry.name}: ${msg}`);
  }
}

function bombMessage(name: string, size: number, maxBytes: number): string {
  return (
    `${name} expands past the ${maxBytes}-byte inflation budget for this environment` +
    (size > 0 ? ` (it declares ${size} bytes)` : "") +
    `. This document is either corrupt or crafted to exhaust memory; raise limits.maxVfsBytes if it is genuinely this large.`
  );
}

/** Read one named entry as UTF-8 text, or null when it is absent. */
export function readZipText(bytes: Uint8Array, name: string, maxBytes?: number): string | null {
  const entry = readZip(bytes).get(name);
  return entry ? readZipEntry(bytes, entry, maxBytes).toString("utf8") : null;
}

// ------------------------------------------------------------------ writing

/**
 * CRC-32, from `node:zlib` where the runtime has it.
 *
 * `zlib.crc32` arrived in Node 20.15 / 22.2, and this package does not pin a
 * floor that high. The table fallback is the same polynomial and a few
 * microseconds slower on parts that are tens of kilobytes — not a trade worth
 * an engines constraint on every consumer.
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
 * Rebuild an archive with some entries replaced and every other one copied.
 *
 * "Copied" is literal: an untouched entry's *compressed* bytes are moved
 * across with its recorded CRC, method and sizes, so a part this code never
 * looked at cannot be changed by it. That is the whole point — an edit to
 * `word/document.xml` must not be able to disturb `word/media/image1.png`,
 * `word/styles.xml` or a header, and the cheapest way to guarantee that is to
 * never decode them.
 *
 * Entry order is preserved from the source central directory rather than
 * normalised. Producers disagree about it — `docx` emits directory entries
 * first and `[Content_Types].xml` well down the list, and Word opens those
 * files — so the safe move is to keep whatever order already worked instead of
 * inventing one.
 *
 * Two header fields are deliberately not carried over. Extra fields are
 * dropped (they are optional metadata, and a stale one is worse than none),
 * and the data-descriptor flag is cleared because the sizes are written into
 * the local header here rather than trailing the data.
 */
export function rewriteZip(bytes: Uint8Array, replacements: Map<string, Uint8Array>): Uint8Array {
  const entries = readZip(bytes);
  for (const name of replacements.keys()) {
    if (!entries.has(name)) throw new Error(`cannot replace ${name}: no such entry in the archive`);
  }

  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries.values()) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const replacement = replacements.get(entry.name);

    let body: Buffer;
    let method: number;
    let crc: number;
    let uncompressedSize: number;
    if (replacement) {
      body = deflateRawSync(replacement);
      method = 8;
      crc = crc32(replacement);
      uncompressedSize = replacement.byteLength;
    } else {
      body = rawEntryBytes(source, entry);
      method = entry.compression;
      crc = entry.crc;
      uncompressedSize = entry.uncompressedSize;
    }
    // Keep the UTF-8-name flag and anything else the producer set; drop only
    // the data-descriptor bit, whose promise this writer does not keep.
    const flags = entry.flags & ~FLAG_DATA_DESCRIPTOR;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0, deflate
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
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
  const eocd = Buffer.alloc(EOCD_MIN_SIZE);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(directory.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, directory, eocd]));
}

/** An entry's stored bytes, still compressed — never inflated, so never a bomb. */
function rawEntryBytes(source: Buffer, entry: ZipEntry): Buffer {
  const head = entry.localHeaderOffset;
  if (head + 30 > source.length || source.readUInt32LE(head) !== LOCAL_SIGNATURE) {
    throw new Error(`corrupt ZIP: no local header for ${entry.name}`);
  }
  const nameLength = source.readUInt16LE(head + 26);
  const extraLength = source.readUInt16LE(head + 28);
  const start = head + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > source.length) {
    throw new Error(`corrupt ZIP: ${entry.name} claims ${entry.compressedSize} bytes that run past the end of the file`);
  }
  return source.subarray(start, end);
}
