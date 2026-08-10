/**
 * TAR, read and write.
 *
 * Simpler than ZIP: a sequence of 512-byte headers, each followed by its
 * file's bytes padded to a 512-byte boundary, terminated by two zero blocks.
 * `.tar.gz` is that stream through gzip, which `node:zlib` provides.
 *
 * Only the entry kinds an agent will actually meet are handled — regular
 * files, directories, and the GNU/POSIX long-name extensions that every real
 * tar emits for paths over 100 characters. Anything else (symlinks, devices,
 * hard links) is refused by name rather than silently written as an empty
 * file, because a silently-wrong extraction is worse than a failed one.
 */
import { gunzipSync, gzipSync } from "node:zlib";

const BLOCK = 512;

export interface TarEntry {
  name: string;
  size: number;
  directory: boolean;
  /** Offset of the entry's data within the (already decompressed) stream. */
  offset: number;
}

/** Type flags we accept; everything else is refused with its name. */
const TYPE_NAMES: Record<string, string> = {
  "1": "hard link",
  "2": "symbolic link",
  "3": "character device",
  "4": "block device",
  "6": "FIFO",
};

function readString(buf: Buffer, at: number, length: number): string {
  const end = buf.indexOf(0, at) === -1 ? at + length : Math.min(buf.indexOf(0, at), at + length);
  return buf.toString("utf8", at, end).trim();
}

function readOctal(buf: Buffer, at: number, length: number): number {
  const text = readString(buf, at, length).replace(/[^0-7]/g, "");
  return text === "" ? 0 : parseInt(text, 8);
}

/** True when the bytes start with a gzip magic number. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Decompress if gzipped, refusing to produce more than `maxBytes`.
 *
 * The same reasoning as the ZIP inflate cap: a `.tar.gz` is exactly as good a
 * decompression bomb as a `.zip`, and there is no declared size to check
 * beforehand at all.
 */
export function ungzip(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (!isGzip(bytes)) return bytes;
  try {
    return new Uint8Array(gunzipSync(bytes, { maxOutputLength: maxBytes }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/maxOutputLength|buffer|ERR_BUFFER_TOO_LARGE/i.test(msg)) {
      throw new Error(
        `this archive expands past the ${maxBytes}-byte budget still available in this environment. ` +
          `Raise limits.maxVfsBytes, or work from a smaller archive.`,
      );
    }
    throw new Error(`could not decompress the archive: ${msg}`);
  }
}

export function gzip(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(bytes, { level: 6 }));
}

/** Index a (decompressed) tar stream. */
export function readTar(bytes: Uint8Array): TarEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: TarEntry[] = [];
  let at = 0;
  /** Set by an L/x long-name block, consumed by the entry that follows. */
  let pendingName: string | null = null;

  while (at + BLOCK <= buf.length) {
    const header = buf.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) break; // the terminating blocks

    const rawName = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 0x30);
    const prefix = readString(header, 345, 155);
    const dataAt = at + BLOCK;
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    if (typeFlag === "L" || typeFlag === "x" || typeFlag === "X") {
      // GNU long name, or a PAX header carrying `path=`.
      const payload = buf.toString("utf8", dataAt, dataAt + size);
      const pax = /(?:^|\n)\d+ path=([^\n]+)/.exec(payload);
      pendingName = (pax ? pax[1] : payload.replace(/\0+$/, "")).trim();
      at = dataAt + padded;
      continue;
    }

    if (TYPE_NAMES[typeFlag]) {
      throw new Error(
        `this tar contains a ${TYPE_NAMES[typeFlag]} (${pendingName ?? rawName}), which cannot be represented in the ` +
          `working environment's filesystem. Repack the archive with regular files only.`,
      );
    }

    const name = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    pendingName = null;
    if (name !== "") {
      entries.push({ name, size, directory: typeFlag === "5" || name.endsWith("/"), offset: dataAt });
    }
    at = dataAt + padded;
  }
  return entries;
}

export function readTarEntry(bytes: Uint8Array, entry: TarEntry): Uint8Array {
  return bytes.subarray(entry.offset, entry.offset + entry.size);
}

export interface TarInput {
  name: string;
  data: Uint8Array;
}

function writeOctal(buf: Buffer, value: number, at: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  buf.write(text, at, length - 1, "ascii");
  buf[at + length - 1] = 0;
}

/** Build a tar stream. Long names use the GNU `L` extension, as GNU tar does. */
export function writeTar(files: TarInput[]): Uint8Array {
  const blocks: Buffer[] = [];

  const pushHeader = (name: string, size: number, typeFlag: string): void => {
    const header = Buffer.alloc(BLOCK);
    header.write(name.slice(0, 100), 0, 100, "utf8");
    writeOctal(header, 0o644, 100, 8); // mode
    writeOctal(header, 0, 108, 8); // uid
    writeOctal(header, 0, 116, 8); // gid
    writeOctal(header, size, 124, 12);
    writeOctal(header, 0, 136, 12); // mtime: fixed, so output is deterministic
    header.write("        ", 148, 8, "ascii"); // checksum placeholder: spaces
    header.write(typeFlag, 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (const b of header) sum += b;
    writeOctal(header, sum, 148, 8);
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header);
  };

  const pushData = (data: Uint8Array): void => {
    const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    blocks.push(body);
    const remainder = body.length % BLOCK;
    if (remainder !== 0) blocks.push(Buffer.alloc(BLOCK - remainder));
  };

  for (const file of files) {
    if (Buffer.byteLength(file.name, "utf8") > 100) {
      const nameBytes = Buffer.from(`${file.name}\0`, "utf8");
      pushHeader("././@LongLink", nameBytes.length, "L");
      pushData(nameBytes);
    }
    pushHeader(file.name, file.data.byteLength, "0");
    pushData(file.data);
  }

  blocks.push(Buffer.alloc(BLOCK * 2)); // end-of-archive
  return new Uint8Array(Buffer.concat(blocks));
}
