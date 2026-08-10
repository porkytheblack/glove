/**
 * `env:archives` — zip, tar and tar.gz inside the agent's virtual filesystem.
 *
 * Archives are how batches of files actually arrive: an export from another
 * system, a bundle of scans, a customer's data dump. An agent handed
 * `/inbox/records.zip` was simply stuck — nothing could open it. They are
 * also the natural way to hand a multi-file deliverable back, as one file
 * instead of an array the host has to write out itself.
 *
 * Dependency-free: ZIP and tar are stable, well-documented container formats,
 * and `node:zlib` supplies the only hard part.
 *
 * **Extraction is the security-sensitive operation** and gets the attention:
 *
 * - *Escaping names.* An entry that climbs out of the target directory, names
 *   an absolute path, or uses backslashes, is refused. Every name is resolved
 *   against the target directory and checked to still be under it — the check
 *   is on the resolved path, not the spelling, because the spellings are
 *   endless.
 * - *Runaway expansion.* The declared uncompressed size is supplied by the
 *   file, so it is checked AND the inflate itself is capped at the room
 *   actually left in the environment. A tiny archive that claims to be small
 *   and expands to a gigabyte fails at the cap, not at the claim.
 * - *Entry counts.* Bounded, so an archive of a million empty files cannot
 *   spend the environment's whole budget on directory overhead.
 *
 * Nested archives are not extracted recursively. An extracted `.zip` is just
 * a file; extracting it is a second, separately budgeted call.
 */
import { defineAdapter, globToRegExp, type EnvFsHandle } from "glove-working-environment";
import { readZip, readZipEntry, writeZip, type ZipInput } from "./zip";
import { gzip, isGzip, readTar, readTarEntry, ungzip, writeTar, type TarInput } from "./tar";
import { ARCHIVES_DOCS, ARCHIVES_TYPES } from "./docs";

export type ArchiveFormat = "zip" | "tar" | "tgz";

export interface ArchiveEntry {
  /** Path inside the archive, as stored. */
  name: string;
  bytes: number;
  directory: boolean;
}

export interface ArchiveSummary {
  path: string;
  format: ArchiveFormat;
  /** Size of the archive file itself. */
  bytes: number;
  entries: number;
  files: number;
  directories: number;
  /** Total size of the contents once extracted, as the archive declares it. */
  uncompressedBytes: number;
  /** The first entries, as orientation — the full list is `list()`. */
  sample: ArchiveEntry[];
}

/** Above this, an archive is refused before anything is read out of it. */
const MAX_ENTRIES = 20_000;
const SAMPLE = 12;

function detect(bytes: Uint8Array, path: string): ArchiveFormat {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (isGzip(bytes)) return "tgz";
  // A tar has "ustar" at offset 257 in its first header block.
  if (bytes.length > 262) {
    const magic = Buffer.from(bytes.subarray(257, 262)).toString("ascii");
    if (magic === "ustar") return "tar";
  }
  // Older tars have no magic at all; fall back to the name rather than
  // guessing wrong on a file the caller clearly believes is an archive.
  const lower = path.toLowerCase();
  if (lower.endsWith(".tar")) return "tar";
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) return "tgz";
  throw new Error(
    `${path} is not a zip, tar or tar.gz — it starts with neither PK, a gzip header, nor a ustar magic. ` +
      `Supported: .zip, .tar, .tar.gz/.tgz`,
  );
}

/**
 * Resolve an archive entry name against the destination, refusing anything
 * that escapes it.
 *
 * Returns null for entries that should be skipped rather than refused (the
 * `./` prefix real tars emit, and bare directory entries, which the VFS
 * creates implicitly on write).
 */
function safeJoin(dir: string, rawName: string): string | null {
  // Windows-style separators are legal inside an archive and are a traversal
  // vector the moment they are treated as literal name characters.
  const name = rawName.replace(/\\/g, "/");
  if (name === "" || name === "." || name === "./") return null;
  if (name.startsWith("/")) {
    throw new Error(`refusing entry "${rawName}": absolute paths inside an archive would escape ${dir}`);
  }
  const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  const parts: string[] = [];
  for (const segment of `${base}/${name}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) throw new Error(`refusing entry "${rawName}": it escapes the destination directory`);
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const resolved = `/${parts.join("/")}`;
  // The check is on the RESOLVED path. A name with climbing segments
  // normalises away before it is ever compared, so comparing spellings
  // would miss it.
  if (resolved !== base && !resolved.startsWith(`${base}/`)) {
    throw new Error(`refusing entry "${rawName}": it resolves to ${resolved}, outside ${base}`);
  }
  return resolved;
}

/**
 * Match entry names against the `include` glob.
 *
 * Borrowed from the core rather than re-derived. `globToRegExp` already gets
 * the case that matters right — a leading `**` matches a file at the root as
 * well as one three directories down — and the hand-rolled version here had
 * exactly that bug. Two sets of glob semantics in one package is two places
 * for them to disagree.
 */
function matcher(pattern: string | undefined): (name: string) => boolean {
  if (!pattern) return () => true;
  // It normalises against absolute paths; entry names are relative.
  const re = globToRegExp(pattern.startsWith("/") ? pattern : `/${pattern}`);
  return (name) => re.test(`/${name}`);
}

export const archives = () =>
  defineAdapter({
    name: "archives",
    description: "Read and write zip/tar/tar.gz: list, describe, extract selectively, package a directory back up.",
    types: ARCHIVES_TYPES,
    docs: ARCHIVES_DOCS,
    handles: {
      extensions: [".zip", ".tar", ".tgz", ".gz"],
      magic: [
        { bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK\3\4
        { bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
        { bytes: [0x1f, 0x8b] }, // gzip
        { bytes: [0x75, 0x73, 0x74, 0x61, 0x72], offset: 257 }, // ustar
      ],
    },
    create: (vfs: EnvFsHandle) => {
      /**
       * The ceiling on bytes any single decompression may produce.
       *
       * Taken from the environment's own cap rather than a constant of our
       * own — a budget this adapter invented would either be uselessly small
       * or exactly the hole that lets it push the tree past `maxVfsBytes`.
       * It is a memory bound, not an accounting one: the gateway still
       * enforces the real remaining space on every write, and this only stops
       * a gigabyte being materialised in order to be refused.
       */
      const budget = (): number => Math.max(1, vfs.limits.maxVfsBytes);

      const load = async (path: string): Promise<{ format: ArchiveFormat; raw: Uint8Array; body: Uint8Array }> => {
        const raw = await vfs.readBytes(path);
        const format = detect(raw, path);
        const body = format === "tgz" ? ungzip(raw, budget()) : raw;
        return { format, raw, body };
      };

      const index = (format: ArchiveFormat, body: Uint8Array): ArchiveEntry[] => {
        const entries =
          format === "zip"
            ? readZip(body).map((e) => ({ name: e.name, bytes: e.uncompressedSize, directory: e.directory }))
            : readTar(body).map((e) => ({ name: e.name, bytes: e.size, directory: e.directory }));
        if (entries.length > MAX_ENTRIES) {
          throw new Error(
            `this archive declares ${entries.length} entries, over the ${MAX_ENTRIES} cap — refusing to read it. ` +
              `Even empty entries cost bytes in the tree.`,
          );
        }
        return entries;
      };

      return {
        /** Structure of an archive: how many entries, how big once extracted. */
        async describe(path: string): Promise<ArchiveSummary> {
          const { format, raw, body } = await load(path);
          const entries = index(format, body);
          const files = entries.filter((e) => !e.directory);
          return {
            path,
            format,
            bytes: (await vfs.stat(path))?.size ?? raw.byteLength,
            entries: entries.length,
            files: files.length,
            directories: entries.length - files.length,
            uncompressedBytes: files.reduce((n, e) => n + e.bytes, 0),
            sample: entries.slice(0, SAMPLE),
          };
        },

        /** Every entry, without extracting anything. */
        async list(path: string): Promise<ArchiveEntry[]> {
          const { format, body } = await load(path);
          return index(format, body);
        },

        /**
         * Extract into `dir`. Returns the paths written.
         *
         * `include` filters by entry name (`"**\/*.csv"`), which is also the
         * way to stay inside the size budget on a large archive.
         */
        async extract(path: string, dir: string, opts: { include?: string } = {}): Promise<string[]> {
          const { format, body } = await load(path);
          index(format, body); // entry-count bound, before anything is inflated
          const wanted = matcher(opts.include);
          const written: string[] = [];
          let remaining = budget();

          if (format === "zip") {
            const zipEntries = readZip(body);
            for (const entry of zipEntries) {
              if (entry.directory || !wanted(entry.name)) continue;
              const dest = safeJoin(dir, entry.name);
              if (dest === null) continue;
              const data = readZipEntry(body, entry, remaining);
              remaining -= data.byteLength;
              await vfs.writeFile(dest, new Uint8Array(data));
              written.push(dest);
            }
          } else {
            const tarEntries = readTar(body);
            for (const entry of tarEntries) {
              if (entry.directory || !wanted(entry.name)) continue;
              const dest = safeJoin(dir, entry.name);
              if (dest === null) continue;
              const data = readTarEntry(body, entry);
              if (data.byteLength > remaining) {
                throw new Error(
                  `${entry.name} does not fit in the ${remaining} bytes still available — ` +
                    `extract fewer entries with the include option, or raise limits.maxVfsBytes.`,
                );
              }
              remaining -= data.byteLength;
              await vfs.writeFile(dest, data);
              written.push(dest);
            }
          }

          if (written.length === 0) {
            throw new Error(
              opts.include
                ? `no entries in ${path} match ${JSON.stringify(opts.include)} — list(path) shows what is in there`
                : `${path} contains no extractable files`,
            );
          }
          return written;
        },

        /**
         * Package a directory into a single archive. The format follows the
         * output extension unless `format` says otherwise.
         */
        async create(
          dir: string,
          output: string,
          opts: { glob?: string; format?: ArchiveFormat } = {},
        ): Promise<ArchiveSummary> {
          const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
          const paths = (await vfs.glob(opts.glob ?? `${base}/**`)).sort();
          if (paths.length === 0) {
            throw new Error(`nothing to archive: ${opts.glob ?? `${base}/**`} matched no files`);
          }
          const lower = output.toLowerCase();
          const format: ArchiveFormat =
            opts.format ?? (lower.endsWith(".zip") ? "zip" : lower.endsWith(".tar") ? "tar" : "tgz");

          const inputs: Array<ZipInput & TarInput> = [];
          for (const p of paths) {
            // Names are stored relative to `dir`, so extracting elsewhere does
            // not recreate the whole absolute path.
            const name = p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p.replace(/^\//, "");
            inputs.push({ name, data: await vfs.readBytes(p) });
          }

          const packed =
            format === "zip" ? writeZip(inputs) : format === "tar" ? writeTar(inputs) : gzip(writeTar(inputs));
          await vfs.writeFile(output, packed);

          return {
            path: output,
            format,
            bytes: packed.byteLength,
            entries: inputs.length,
            files: inputs.length,
            directories: 0,
            uncompressedBytes: inputs.reduce((n, f) => n + f.data.byteLength, 0),
            sample: inputs.slice(0, SAMPLE).map((f) => ({ name: f.name, bytes: f.data.byteLength, directory: false })),
          };
        },
      };
    },
  });

export default archives;
