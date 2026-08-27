/**
 * A filesystem backed by an object store, with the tree index held in memory.
 *
 * ## Why the index matters more than the transport
 *
 * The `Vfs` contract has three whole-tree operations, and they are not cold
 * paths: `totalSize()` runs on every write (the byte-budget check), and
 * `files()` backs glob, grep, recursive rm, directory mv/cp and checkpoint
 * fork. Implemented naively against S3 those become a full bucket LIST per
 * write, which is not a slow filesystem — it is an unusable one.
 *
 * So this keeps every *answer about structure* in memory — paths, sizes,
 * mtimes, which directories exist — and goes to the network only for file
 * **content**. `files()`, `list()`, `stat()`, `exists()` and `totalSize()`
 * cost zero round trips; `read`, `write` and `rm` cost one.
 *
 * The index is built once, from a single LIST at construction, and
 * maintained on every mutation. It is only ever updated *after* the store
 * confirms the write, so a failed put leaves the index honest rather than
 * claiming a file that is not there.
 *
 * ## Directories
 *
 * Object stores have no directories. A non-empty one needs no representation
 * — it is implied by the keys beneath it, and the index derives it on load.
 * An **empty** directory has nothing to imply it, so `mkdir` writes a
 * zero-byte marker at `<key>/` (the convention every S3 console uses). A
 * marker implies its ancestors too, so one key is enough.
 *
 * ## What this does not do
 *
 * There is no distributed locking. The environment serializes its own
 * mutations within a process; two hosts pointed at the same prefix will race
 * on version rings and run history, and nothing here prevents that. Give
 * each session its own prefix.
 */
import type { Vfs, VfsEntry, VfsStat } from "../types";
import { PathError, ancestors, normalizePath } from "../paths";

/**
 * The storage backend you supply.
 *
 * S3, GCS, R2, Azure Blob and a plain directory all reduce to these four
 * operations, which is why this package depends on none of them.
 */
export interface ObjectStore {
  /** Reject if the key does not exist. */
  get(key: string): Promise<Uint8Array>;
  put(key: string, data: Uint8Array): Promise<void>;
  /** Deleting a key that does not exist must succeed, not throw. */
  delete(key: string): Promise<void>;
  /**
   * Every key under a prefix. Implementations MUST paginate internally and
   * return the complete set — a truncated listing silently becomes a
   * truncated filesystem.
   */
  list(prefix: string): Promise<RemoteObject[]>;
}

export interface RemoteObject {
  key: string;
  size: number;
  /** ms since epoch. Falls back to construction time when the store omits it. */
  mtime?: number;
}

export interface CachedRemoteOptions {
  /**
   * Key prefix for this environment, e.g. `"sessions/abc123/"`.
   *
   * Give every session its own — the tree is not safe to share (see above),
   * and a prefix is also what makes cleanup a single delete-by-prefix.
   */
  prefix?: string;
  /**
   * Keep file content in memory after a read or write. Default true.
   *
   * A working environment re-reads the same handful of files constantly —
   * scripts, their `.d.ts` siblings, the run log — so this removes most of
   * the round trips that remain after the index.
   */
  cacheContent?: boolean;
  /** Ceiling for the content cache. Default 32 MiB. */
  maxCacheBytes?: number;
  /**
   * How many deletes to have in flight at once when removing a directory.
   * Default 16.
   *
   * `rm /tmp` after a busy session is one call that fans out to every file
   * beneath it. Unbounded, that is a few hundred simultaneous requests and a
   * rate-limit response from the store.
   */
  deleteConcurrency?: number;
}

interface IndexEntry {
  size: number;
  mtime: number;
}

const DEFAULT_MAX_CACHE = 32 * 1024 * 1024;

export class CachedRemoteFs implements Vfs {
  private readonly store: ObjectStore;
  private readonly prefix: string;
  private readonly cacheContent: boolean;
  private readonly maxCacheBytes: number;
  private readonly deleteConcurrency: number;

  /** VFS path → size + mtime. The whole structural truth. */
  private index = new Map<string, IndexEntry>();
  /** Directories known to exist, derived from keys plus explicit markers. */
  private dirs = new Set<string>(["/"]);
  private totalBytes = 0;

  /** Insertion-ordered, so the oldest entry is the first key. */
  private cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;

  private constructor(store: ObjectStore, options: CachedRemoteOptions) {
    this.store = store;
    this.prefix = options.prefix ?? "";
    this.cacheContent = options.cacheContent ?? true;
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE;
    this.deleteConcurrency = Math.max(1, options.deleteConcurrency ?? 16);
  }

  /** Run `task` over every key, at most `deleteConcurrency` at a time. */
  private async fanOut(keys: string[], task: (key: string) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < keys.length) await task(keys[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(this.deleteConcurrency, keys.length) }, worker));
  }

  /**
   * Build the index from one LIST, then hand back a ready filesystem.
   *
   * Async because there is no honest way to serve `stat()` or `totalSize()`
   * before the listing lands, and a filesystem that lies until it warms up is
   * worse than one that takes a moment to open.
   */
  static async open(store: ObjectStore, options: CachedRemoteOptions = {}): Promise<CachedRemoteFs> {
    const fs = new CachedRemoteFs(store, options);
    const now = Date.now();
    for (const object of await store.list(fs.prefix)) {
      if (!object.key.startsWith(fs.prefix)) continue;
      const rest = object.key.slice(fs.prefix.length);
      if (rest === "") continue;

      if (rest.endsWith("/")) {
        // An explicit empty-directory marker.
        const dir = normalizePath("/" + rest.slice(0, -1));
        for (const a of ancestors(dir)) fs.dirs.add(a);
        fs.dirs.add(dir);
        continue;
      }

      const path = normalizePath("/" + rest);
      fs.index.set(path, { size: object.size, mtime: object.mtime ?? now });
      fs.totalBytes += object.size;
      for (const a of ancestors(path)) fs.dirs.add(a);
    }
    return fs;
  }

  // ── key mapping ───────────────────────────────────────────────────────

  private key(path: string): string {
    return this.prefix + path.slice(1); // paths are absolute and normalized
  }

  private marker(path: string): string {
    return this.key(path) + "/";
  }

  // ── content cache ─────────────────────────────────────────────────────

  private cacheGet(path: string): Uint8Array | undefined {
    const hit = this.cache.get(path);
    if (hit === undefined) return undefined;
    // Re-insert so the eviction order is least-recently-used, not oldest.
    this.cache.delete(path);
    this.cache.set(path, hit);
    return hit;
  }

  private cachePut(path: string, data: Uint8Array): void {
    if (!this.cacheContent) return;
    this.cacheEvict(path);
    // A single file larger than the whole budget would evict everything and
    // still not fit, so it is simply not cached.
    if (data.byteLength > this.maxCacheBytes) return;
    this.cache.set(path, data);
    this.cacheBytes += data.byteLength;
    while (this.cacheBytes > this.maxCacheBytes) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cacheEvict(oldest.value);
    }
  }

  private cacheEvict(path: string): void {
    const existing = this.cache.get(path);
    if (existing === undefined) return;
    this.cacheBytes -= existing.byteLength;
    this.cache.delete(path);
  }

  // ── Vfs ───────────────────────────────────────────────────────────────

  async read(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    if (!this.index.has(p)) {
      throw new PathError(`no such file: ${p}${this.dirs.has(p) ? " (it is a directory)" : ""}`);
    }
    const cached = this.cacheGet(p);
    if (cached) return cached;
    const data = await this.store.get(this.key(p));
    this.cachePut(p, data);
    return data;
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    if (this.dirs.has(p)) throw new PathError(`cannot write ${p}: it is a directory`);
    for (const a of ancestors(p)) {
      if (this.index.has(a)) throw new PathError(`cannot write ${p}: ${a} is a file`);
    }

    // The store first: the index must never claim a file the store rejected.
    await this.store.put(this.key(p), data);

    const prev = this.index.get(p);
    if (prev) this.totalBytes -= prev.size;
    this.index.set(p, { size: data.byteLength, mtime: Date.now() });
    this.totalBytes += data.byteLength;
    for (const a of ancestors(p)) this.dirs.add(a);
    this.cachePut(p, data);
  }

  async rm(path: string): Promise<void> {
    const p = normalizePath(path);

    if (this.index.has(p)) {
      await this.store.delete(this.key(p));
      this.totalBytes -= this.index.get(p)!.size;
      this.index.delete(p);
      this.cacheEvict(p);
      return;
    }

    if (this.dirs.has(p)) {
      if (p === "/") throw new PathError(`cannot remove the root directory`);
      const prefix = p + "/";
      const doomed = [...this.index.keys()].filter((f) => f.startsWith(prefix));
      const doomedDirs = [...this.dirs].filter((d) => d === p || d.startsWith(prefix));

      // Markers as well as content — a surviving marker would resurrect an
      // empty directory the next time this prefix is opened.
      await this.fanOut(
        [...doomed.map((f) => this.key(f)), ...doomedDirs.map((d) => this.marker(d))],
        (key) => this.store.delete(key),
      );

      for (const f of doomed) {
        this.totalBytes -= this.index.get(f)!.size;
        this.index.delete(f);
        this.cacheEvict(f);
      }
      for (const d of doomedDirs) this.dirs.delete(d);
      return;
    }

    throw new PathError(`no such file or directory: ${p}`);
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path);
    if (this.index.has(p)) throw new PathError(`cannot mkdir ${p}: it is a file`);
    for (const a of ancestors(p)) {
      if (this.index.has(a)) throw new PathError(`cannot mkdir ${p}: ${a} is a file`);
    }
    if (p === "/") return;

    // One marker is enough: it implies every ancestor on the way back in.
    if (!this.dirs.has(p)) await this.store.put(this.marker(p), new Uint8Array(0));

    for (const a of ancestors(p)) this.dirs.add(a);
    this.dirs.add(p);
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return this.index.has(p) || this.dirs.has(p);
  }

  async stat(path: string): Promise<VfsStat | null> {
    const p = normalizePath(path);
    const entry = this.index.get(p);
    if (entry) return { kind: "file", size: entry.size, mtime: entry.mtime };
    if (this.dirs.has(p)) return { kind: "dir", size: 0, mtime: 0 };
    return null;
  }

  async list(path: string): Promise<VfsEntry[]> {
    const p = normalizePath(path);
    if (this.index.has(p)) throw new PathError(`not a directory: ${p}`);
    if (!this.dirs.has(p)) throw new PathError(`no such directory: ${p}`);
    const prefix = p === "/" ? "/" : p + "/";
    const seen = new Map<string, VfsEntry>();

    for (const [f, entry] of this.index) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (!rest.includes("/")) seen.set(rest, { name: rest, kind: "file", size: entry.size });
    }
    for (const d of this.dirs) {
      if (d === p || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!seen.has(name)) seen.set(name, { name, kind: "dir", size: 0 });
    }

    return [...seen.values()].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
  }

  async files(): Promise<string[]> {
    return [...this.index.keys()].sort();
  }

  async totalSize(): Promise<number> {
    return this.totalBytes;
  }

  /** Drop cached content, keeping the index. For tests and memory pressure. */
  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }
}

/**
 * Open an object-store-backed filesystem for a working environment.
 *
 * ```ts
 * const env = await createWorkingEnvironment({
 *   filesystem: await cachedRemote(myS3Store, { prefix: `sessions/${id}/` }),
 *   stdlib: [documents()],
 * });
 * ```
 *
 * Reach for this when the tree genuinely outgrows the heap, or when other
 * systems need to read the files directly. If you only want the tree to
 * survive a restart, `env.snapshot()` to one object is cheaper on every axis
 * — one round trip per session instead of one per file, and atomic.
 */
export function cachedRemote(store: ObjectStore, options?: CachedRemoteOptions): Promise<CachedRemoteFs> {
  return CachedRemoteFs.open(store, options);
}
