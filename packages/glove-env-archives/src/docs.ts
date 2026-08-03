/** Materialized at `/std/archives/index.d.ts` and `/std/archives/README.md`. */

export const ARCHIVES_TYPES = `/** env:archives — zip, tar and tar.gz, read and written inside the VFS. */

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
  /** Total size once extracted, as the archive declares it. */
  uncompressedBytes: number;
  /** The first entries, for orientation — list() gives all of them. */
  sample: ArchiveEntry[];
}

/**
 * What is in here, without extracting anything. The format is detected from
 * the bytes, not the file name.
 */
export function describe(path: string): Promise<ArchiveSummary>;

/** Every entry, still without extracting. */
export function list(path: string): Promise<ArchiveEntry[]>;

/**
 * Extract into a directory; returns the paths written.
 *
 * Use \`include\` to take only what you need — it is also how you stay inside
 * the environment's size budget on a large archive:
 *
 *   await extract('/inbox/records.zip', '/inbox/records', { include: '**\\/*.csv' });
 *
 * Entries that would escape the destination are refused, and an archive that
 * expands past the environment's cap fails rather than filling the tree.
 * Nested archives are not extracted recursively — an extracted .zip is just a
 * file, and extracting it is a second call.
 */
export function extract(path: string, dir: string, opts?: { include?: string }): Promise<string[]>;

/**
 * Package a directory into one archive. The format follows the output
 * extension (.zip / .tar / .tgz) unless you override it.
 *
 *   await create('/out', '/tmp/deliverable.zip');
 *   await create('/out', '/tmp/reports.tgz', { glob: '/out/**\\/*.pdf' });
 *
 * Names are stored relative to \`dir\`, so extracting elsewhere does not
 * recreate the absolute path.
 */
export function create(
  dir: string,
  output: string,
  opts?: { glob?: string; format?: ArchiveFormat },
): Promise<ArchiveSummary>;
`;

export const ARCHIVES_DOCS = `# env:archives

Zip, tar and tar.gz, both directions. No dependencies — \`node:zlib\` and the
container formats themselves.

## Opening something that arrived

\`\`\`js
import { describe, list, extract } from 'env:archives';
import { readFile } from 'env:fs';
import { csv } from 'env:std';

/** Totals every CSV in a mounted archive. */
export default async function main() {
  const summary = await describe('/inbox/records.zip');
  if (summary.uncompressedBytes > 50_000_000) return { skipped: 'too large', summary };

  const written = await extract('/inbox/records.zip', '/inbox/records', { include: '**/*.csv' });
  let total = 0;
  for (const path of written) {
    for (const row of csv.parse(await readFile(path))) total += Number(row.amount ?? 0);
  }
  return { files: written.length, total };
}
\`\`\`

\`describe()\` before \`extract()\` is the habit worth having: it tells you the
entry count and the extracted size without spending either.

## Handing a deliverable back

\`\`\`js
import { create } from 'env:archives';

/** Bundles everything in /out as one file. */
export default async function main() {
  return create('/out', '/out/deliverable.zip');
}
\`\`\`

The host's \`env.export('/out/**')\` returns an array of files; packaging them
first makes it one.

## What is refused, and why

- **Entries that escape the destination.** \`../../etc/passwd\`, an absolute
  path, or backslash separators — all refused by name. The check is on the
  resolved path, not the spelling.
- **Decompression bombs.** A small archive that expands enormously fails at
  the environment's size cap. The declared size is checked *and* the
  decompression itself is capped, because declared sizes lie.
- **Encrypted and ZIP64 archives**, and tar entries that are symlinks,
  devices or hard links. These are refused explicitly rather than half-read:
  an extraction that silently drops or mangles entries is worse than one that
  fails.

## Formats

| Format | Read | Write | Notes |
|---|---|---|---|
| \`.zip\` | ✅ | ✅ | store + deflate; ZIP64 and encryption refused |
| \`.tar\` | ✅ | ✅ | regular files and directories; GNU/PAX long names |
| \`.tar.gz\` / \`.tgz\` | ✅ | ✅ | the above, through gzip |
`;
