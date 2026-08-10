/**
 * ZIP, read and write, with `node:zlib` and nothing else.
 *
 * A ZIP is a sequence of local-header + data blocks, then a central directory
 * that indexes them, then an end-of-central-directory record. Reading needs
 * the directory and `inflateRaw`; writing needs the same three structures and
 * `deflateRaw`. Both are a few hundred lines, which is a better trade than a
 * dependency for a format this stable.
 *
 * The read path is the security-sensitive one — see `extract` in index.ts for
 * escaping-name and runaway-expansion handling. This file's contribution is
 * refusing what it cannot honestly read (ZIP64, encryption, unknown
 * compression) rather than mishandling it quietly, and honouring the caller's
 * output cap when inflating.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** ZIP64 locator, present when a file has ≥65535 entries or is ≥4 GiB. */
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
/** General-purpose bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;

export interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  crc32: number;
  /** Directory entries are named with a trailing slash and carry no data. */
  directory: boolean;
}

function findEocd(buf: Buffer): number {
  // The EOCD sits at the end, after a comment of up to 64 KiB.
  const earliest = Math.max(0, buf.length - EOCD_MIN_SIZE - 0xffff);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/** Index a ZIP archive by entry name, in central-directory order. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("not a ZIP archive (no end-of-central-directory record)");
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new Error("ZIP64 archives are not supported (over 65535 entries, or over 4 GiB)");
  }

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt ZIP central directory at entry ${i + 1} of ${count}`);
    }
    const flags = buf.readUInt16LE(offset + 8);
    const compression = buf.readUInt16LE(offset + 10);
    const crc32 = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (flags & FLAG_ENCRYPTED) {
      throw new Error(`encrypted ZIP entries are not supported: ${name}`);
    }
    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      crc32,
      directory: name.endsWith("/"),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Decompress one entry, refusing to produce more than `maxBytes`.
 *
 * The cap is not belt-and-braces: the declared `uncompressedSize` is
 * attacker-controlled, so checking it before inflating catches only honest
 * archives. `maxOutputLength` is what actually stops a 42-byte file from
 * becoming a gigabyte.
 */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Buffer {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = entry.localHeaderOffset;
  if (head + 30 > buf.length || buf.readUInt32LE(head) !== LOCAL_SIGNATURE) {
    throw new Error(`corrupt ZIP: no local header for ${entry.name}`);
  }
  // The local header's own name/extra lengths are authoritative — the extra
  // field routinely differs in length from the central directory's copy.
  const nameLength = buf.readUInt16LE(head + 26);
  const extraLength = buf.readUInt16LE(head + 28);
  const start = head + 30 + nameLength + extraLength;
  const body = buf.subarray(start, start + entry.compressedSize);

  if (entry.compression === 0) {
    if (body.length > maxBytes) throw new Error(overExpandedMessage(entry.name, body.length, maxBytes));
    return body;
  }
  if (entry.compression !== 8) {
    throw new Error(
      `unsupported ZIP compression method ${entry.compression} for ${entry.name} — only store (0) and deflate (8) are supported`,
    );
  }
  try {
    return inflateRawSync(body, { maxOutputLength: maxBytes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/maxOutputLength|buffer|ERR_BUFFER_TOO_LARGE/i.test(msg)) {
      throw new Error(overExpandedMessage(entry.name, entry.uncompressedSize, maxBytes));
    }
    throw new Error(`could not inflate ${entry.name}: ${msg}`);
  }
}

function overExpandedMessage(name: string, size: number, maxBytes: number): string {
  return (
    `${name} expands past the ${maxBytes}-byte budget still available in this environment` +
    (size > 0 ? ` (it declares ${size} bytes)` : "") +
    `. Extract fewer entries with the include option, or raise limits.maxVfsBytes.`
  );
}

export interface ZipInput {
  name: string;
  data: Uint8Array;
}

/** CRC-32, table-driven. Required in both the local header and the directory. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a ZIP from entries already in memory. */
export function writeZip(files: ZipInput[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    const deflated = deflateRawSync(raw, { level: 6 });
    // Storing is smaller than deflating for already-compressed or tiny data,
    // and a ZIP that grows its input is a bad look for a "package this up".
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const sum = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date: 1980-01-01, deterministic output
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(EOCD_MIN_SIZE);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // directory start disk
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return new Uint8Array(Buffer.concat([...locals, directory, eocd]));
}
