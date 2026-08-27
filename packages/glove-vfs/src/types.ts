/**
 * The contract every part of an agent's storage agrees on.
 *
 * Glove grew three filesystems independently: the working environment's
 * script tree, the memory layer's resource store, and — implicitly — whatever
 * a REPL session held in scope. Each solved the same problem privately, so a
 * file the agent *made* could not be *filed*, a note it had *filed* could not
 * be *read by a script*, and an intermediate it computed in a REPL was
 * addressable from nowhere at all. The tree is the natural shared namespace
 * for all three, so this package makes it one.
 *
 * ## The base contract stays small on purpose
 *
 * {@link Vfs} is nine methods over bytes and paths. That is deliberately less
 * than any one consumer wants, because it is the most any backend can
 * promise: an in-memory map, a host directory and an S3 prefix all implement
 * it exactly. Everything richer — summaries, tags, cross-references,
 * provenance, embeddings — is an OPTIONAL capability a backend may also
 * implement, discovered by {@link hasMeta} / {@link hasSearch} rather than
 * declared in the base type.
 *
 * That split is what lets a plain bytes backend host a memory resource store
 * (wrap it in {@link withMeta}, which keeps the metadata in a sidecar) while
 * a purpose-built backend that stores metadata natively serves the exact same
 * consumer with no wrapper. The consumer asks the tree what it can do; it
 * does not ask which tree it is.
 */

export { PathError } from "./paths";

/** A single entry returned by {@link Vfs.list}. */
export interface VfsEntry {
  name: string;
  kind: "file" | "dir";
  /** Byte size for files, 0 for directories. */
  size: number;
}

export interface VfsStat {
  kind: "file" | "dir";
  size: number;
  /** ms since epoch of the last mutation. */
  mtime: number;
}

/**
 * A tree of bytes at absolute, `/`-separated, normalized paths.
 *
 * The raw Vfs knows nothing about scripts, zones, versions, limits, or
 * metadata — those live in the layers above (see {@link withAccess},
 * {@link withMeta}) or in the consumer that mounts it. Implementations must
 * normalize every incoming path (`normalizePath`) so `/a//b` and `/a/b` are
 * the same file and `..` cannot escape the root.
 */
export interface Vfs {
  read(path: string): Promise<Uint8Array>;
  /** Writes a file, creating parent directories as needed. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Removes a file, or a directory and everything under it. */
  rm(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<VfsStat | null>;
  /** Lists the immediate children of a directory. */
  list(path: string): Promise<VfsEntry[]>;
  /** Every file path in the tree (no directories), sorted. */
  files(): Promise<string[]>;
  /** Total bytes of file content currently stored. */
  totalSize(): Promise<number>;
}

/**
 * A serialized whole tree. One object, one round trip, atomic — which is why
 * it beats a per-file backend for plain "persist this session" persistence.
 */
export interface VfsSnapshot {
  version: 1;
  /** Directories that exist (including empty ones). */
  dirs: string[];
  /** File contents, base64-encoded. */
  files: Array<{ path: string; data: string; mtime: number }>;
}

/** Backends that can serialize themselves in one call. */
export interface SnapshotableVfs extends Vfs {
  toSnapshot(): VfsSnapshot;
}

export function isSnapshotable(vfs: Vfs): vfs is SnapshotableVfs {
  return typeof (vfs as Partial<SnapshotableVfs>).toSnapshot === "function";
}

/**
 * A layer wrapping another tree — {@link withAccess}, {@link withMeta}.
 *
 * The layers exist to narrow what a caller sees: a policy hides fenced paths,
 * the metadata layer hides its own sidecar. That is right for every read an
 * agent makes and wrong for exactly one operation — serializing the tree,
 * which must capture what is *stored*, not what is *visible*, or a restore
 * silently reconstructs a different tree. `inner` is the seam that lets
 * {@link snapshot} see past the narrowing.
 */
export interface WrappingVfs extends Vfs {
  readonly inner: Vfs;
  /**
   * Drop any cached derived state, because the bytes underneath changed by a
   * route this layer did not see. {@link restore} is that route: it writes to
   * the base, so a metadata layer that had already read the old sidecar would
   * otherwise keep serving it.
   */
  invalidate?(): void;
}

export function isWrapping(vfs: Vfs): vfs is WrappingVfs {
  const candidate = (vfs as Partial<WrappingVfs>).inner;
  return typeof candidate === "object" && candidate !== null && typeof candidate.read === "function";
}

/**
 * Strip every wrapping layer, returning the tree that actually holds the
 * bytes. Host-side serialization uses this; nothing on an agent's path should.
 */
export function unwrap(vfs: Vfs): Vfs {
  let current = vfs;
  // Bounded so a self-referential `inner` cannot hang the process.
  for (let i = 0; i < 32 && isWrapping(current); i++) current = current.inner;
  return current;
}

/** Tell every layer over a tree that its bytes changed out from under it. */
export function invalidateChain(vfs: Vfs): void {
  let current = vfs;
  for (let i = 0; i < 32 && isWrapping(current); i++) {
    current.invalidate?.();
    current = current.inner;
  }
}

// ---------------------------------------------------------------------------
// Metadata capability
// ---------------------------------------------------------------------------

/**
 * Who wrote this and why. Append-only per path.
 *
 * Structurally identical to `glove-memory`'s `Provenance` so a memory adapter
 * over a Vfs needs no translation — but declared here, because this package
 * does not depend on that one.
 */
export interface VfsProvenance {
  /** `"conversation:<id>/turn:<n>"`, `"manual"`, `"import:<kind>:<id>"`, … */
  source: string;
  actor: string;
  /** ISO 8601. */
  timestamp: string;
  note?: string;
}

/** A cross-reference from a file to something outside the tree. */
export interface VfsLink {
  kind: "entity" | "episode" | "resource";
  /** Entity / episode id, or a resource path. */
  id: string;
  relation?: string;
}

export interface VfsMetadata {
  /** Short description shown in listings, so a browse costs no reads. */
  summary?: string;
  tags: string[];
  links: VfsLink[];
  /** Free-form consumer fields. */
  [key: string]: unknown;
}

/** What a metadata-capable tree knows about one path beyond its bytes. */
export interface VfsRecord {
  path: string;
  metadata: VfsMetadata;
  /** Append-only. */
  provenance: VfsProvenance[];
  embeddingStatus: "missing" | "fresh" | "stale";
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/**
 * The optional metadata surface.
 *
 * A backend either stores this natively or gains it from {@link withMeta},
 * which keeps a sidecar index in the same tree. Consumers detect it with
 * {@link hasMeta} rather than requiring it, so a working environment over a
 * plain in-memory tree is unaffected by any of this.
 */
export interface VfsMeta {
  getMeta(path: string): Promise<VfsRecord | null>;
  /**
   * Merge a metadata patch. `undefined` values delete the key; `tags` and
   * `links` replace wholesale (they are sets, not accumulations). Provenance
   * is appended, never replaced.
   */
  setMeta(path: string, patch: Partial<VfsMetadata>, provenance?: VfsProvenance): Promise<void>;
  /** Every file whose metadata links to a target. */
  linksFor(kind: VfsLink["kind"], id: string): Promise<Array<{ path: string; relation?: string }>>;
  /** Repoint every link at `from` to `to` (entity merges, resource moves). */
  replaceLinkTarget(
    kind: VfsLink["kind"],
    from: string,
    to: string,
    provenance?: VfsProvenance,
  ): Promise<number>;
}

export type MetaVfs = Vfs & VfsMeta;

export function hasMeta(vfs: Vfs): vfs is MetaVfs {
  const v = vfs as Partial<VfsMeta>;
  return typeof v.getMeta === "function" && typeof v.setMeta === "function";
}

// ---------------------------------------------------------------------------
// Search capability
// ---------------------------------------------------------------------------

export interface GrepSpec {
  query: string;
  /** Treat `query` as a regex. Default false (literal substring). */
  regex?: boolean;
  caseSensitive?: boolean;
  /** Restrict to a subtree. Default `"/"`. */
  path?: string;
  /** Only paths matching this glob. */
  glob?: string;
  /** Lines of context either side of a match. Default 2. */
  contextLines?: number;
  limit?: number;
}

export interface GrepMatch {
  path: string;
  /** 1-based. */
  line: number;
  text: string;
  context?: { before: string[]; after: string[] };
}

export interface SemanticMatch {
  path: string;
  summary?: string;
  score: number;
  distance: number;
}

export interface SemanticSearchOpts {
  limit?: number;
  path?: string;
  /** 0 = pure similarity, 1 = pure recency. Default 0. */
  recencyWeight?: number;
}

/**
 * The optional semantic-search surface — an out-of-band index lifecycle, not
 * an embedding implementation. The artifact may be vectors, an FTS document,
 * BM25 postings: `setEmbedding` means "the index now covers this path", and
 * `vector` is only meaningful when the index is a vector one.
 */
export interface VfsSearch {
  searchSemantic(query: string, opts?: SemanticSearchOpts): Promise<SemanticMatch[]>;
  findNeedingEmbedding(opts?: { limit?: number }): Promise<string[]>;
  setEmbedding(path: string, vector: number[]): Promise<void>;
}

export type SearchVfs = Vfs & VfsSearch;

export function hasSearch(vfs: Vfs): vfs is SearchVfs {
  return typeof (vfs as Partial<VfsSearch>).searchSemantic === "function";
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function toText(data: Uint8Array): string {
  return decoder.decode(data);
}

/**
 * A cheap "is this text?" check, used to keep binary content out of places
 * that will render it — a NUL byte in the first 8 KiB is decisive enough and
 * costs nothing.
 */
export function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.byteLength, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}
