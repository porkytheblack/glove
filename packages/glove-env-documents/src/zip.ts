/**
 * A read-only ZIP reader, just enough for OOXML.
 *
 * `docx` writes .docx files but cannot read them, and pulling in a full zip
 * library to recover the text of a document we just produced is a poor
 * trade. A .docx is a ZIP of XML parts; reading one needs the central
 * directory and `inflateRaw`, both of which are a hundred lines and a Node
 * builtin.
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** ZIP64 locator, present when a file has ≥65535 entries or is ≥4 GiB. */
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;

export interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
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
    const compression = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { name, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Decompress one entry. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Buffer {
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

  if (entry.compression === 0) return body;
  if (entry.compression === 8) return inflateRawSync(body);
  throw new Error(`unsupported ZIP compression method ${entry.compression} for ${entry.name}`);
}

/** Read one named entry as UTF-8 text, or null when it is absent. */
export function readZipText(bytes: Uint8Array, name: string): string | null {
  const entry = readZip(bytes).get(name);
  return entry ? readZipEntry(bytes, entry).toString("utf8") : null;
}
