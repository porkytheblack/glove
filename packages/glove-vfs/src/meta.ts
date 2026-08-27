/**
 * Metadata, provenance and content search for a filesystem that has none.
 *
 * A memory resource store wants summaries, tags, cross-references, an
 * append-only provenance trail and search. A working environment wants bytes
 * at paths. Those are not two filesystems — they are one filesystem and one
 * layer, and this is the layer: {@link withMeta} takes any {@link Vfs} and
 * returns a {@link MetaVfs} that keeps the extra fields in a sidecar index
 * inside the same tree.
 *
 * ## Why one index rather than a sidecar per file
 *
 * Metadata is small and read constantly (every listing wants summaries),
 * while content is large and read selectively. A file-per-file scheme doubles
 * the entry count of every tree and turns a directory listing into N reads —
 * on `cachedRemote` that is N network round trips to render one `ls`. One
 * JSON index is a single read, cached in memory, written back on change; the
 * cost is that a metadata write rewrites the index, which is the right trade
 * when the index is kilobytes and the content is megabytes. It is the same
 * call the version store already makes for the same reason.
 *
 * The index is hidden from `files()` and `list()`. It is bookkeeping, and a
 * memory adapter over this tree would otherwise surface it as a resource the
 * agent can read, edit and be confused by. `read`/`stat`/`exists` still see
 * it, so a host can inspect or back it up.
 *
 * ## Content lifecycle
 *
 * A write marks the path `missing` (new) or `stale` (content changed) and
 * returns — indexing never happens on the write path. A host drains the
 * queue out of band:
 *
 * ```ts
 * const pending = await fs.findNeedingEmbedding({ limit: 50 });
 * const vectors = await embedder.embed(await Promise.all(pending.map(readText)));
 * for (const [i, path] of pending.entries()) await fs.setEmbedding(path, vectors[i]);
 * ```
 */
import { basename, dirname, isUnder, normalizePath, PathError } from "./paths";
import { cosine, lexicalScore, recencyScore } from "./search";
import {
  looksBinary,
  toBytes,
  toText,
  type MetaVfs,
  type SemanticMatch,
  type SemanticSearchOpts,
  type Vfs,
  type VfsEntry,
  type VfsLink,
  type VfsMetadata,
  type VfsProvenance,
  type VfsRecord,
  type VfsSearch,
  type VfsStat,
} from "./types";

/** Where the sidecar lives by default. */
export const META_INDEX_PATH = "/.vfs/meta.json";

export interface Embedder {
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface WithMetaOptions {
  /** Override the sidecar location (one index per tree). */
  indexPath?: string;
  /**
   * Enables {@link VfsSearch}. With an embedder, `searchSemantic` compares
   * stored vectors; with `lexical: true` it scores token overlap in-process,
   * which needs no service at all. Without either, the tree advertises no
   * search capability rather than a bad one.
   */
  embedder?: Embedder;
  lexical?: boolean;
  /** Stamped on writes that supply no provenance of their own. */
  defaultProvenance?: () => VfsProvenance;
}

interface StoredRecord {
  metadata: VfsMetadata;
  provenance: VfsProvenance[];
  embeddingStatus: "missing" | "fresh" | "stale";
  createdAt: string;
  updatedAt: string;
  vector?: number[];
}

interface StoredIndex {
  version: 1;
  records: Record<string, StoredRecord>;
}

function emptyMetadata(): VfsMetadata {
  return { tags: [], links: [] };
}

class MetaFs implements MetaVfs, VfsSearch {
  private index: StoredIndex | null = null;
  private readonly indexPath: string;
  /** Serializes read-modify-write on the index; two writers would lose one. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly inner: Vfs,
    private readonly options: WithMetaOptions,
  ) {
    this.indexPath = normalizePath(options.indexPath ?? META_INDEX_PATH);
  }

  // -- index plumbing -------------------------------------------------------

  private async load(): Promise<StoredIndex> {
    if (this.index) return this.index;
    if (await this.inner.exists(this.indexPath)) {
      try {
        const parsed = JSON.parse(toText(await this.inner.read(this.indexPath))) as StoredIndex;
        if (parsed?.version === 1 && parsed.records) {
          this.index = parsed;
          return this.index;
        }
      } catch {
        // A corrupt sidecar must not take the tree's content with it: the
        // bytes are the truth, the metadata is derived and re-creatable.
      }
    }
    this.index = { version: 1, records: {} };
    return this.index;
  }

  private async flush(): Promise<void> {
    const index = await this.load();
    await this.inner.mkdir(dirname(this.indexPath));
    await this.inner.write(this.indexPath, toBytes(JSON.stringify(index)));
  }

  /** Run a read-modify-write against the index under the serialization lock. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private hidden(path: string): boolean {
    return normalizePath(path) === this.indexPath;
  }

  /**
   * Drop the cached index. Called when something writes the sidecar by a
   * route this layer did not see — a `restore`, which writes to the base.
   */
  invalidate(): void {
    this.index = null;
  }

  // -- Vfs ------------------------------------------------------------------

  read(path: string): Promise<Uint8Array> {
    return this.inner.read(path);
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    await this.inner.write(p, data);
    if (this.hidden(p)) return;
    await this.exclusive(async () => {
      const index = await this.load();
      const now = new Date().toISOString();
      const prev = index.records[p];
      if (prev) {
        prev.updatedAt = now;
        prev.embeddingStatus = "stale";
        delete prev.vector;
      } else {
        index.records[p] = {
          metadata: emptyMetadata(),
          provenance: this.options.defaultProvenance ? [this.options.defaultProvenance()] : [],
          embeddingStatus: "missing",
          createdAt: now,
          updatedAt: now,
        };
      }
      await this.flush();
    });
  }

  async rm(path: string): Promise<void> {
    const p = normalizePath(path);
    const stat = await this.inner.stat(p);
    const affected =
      stat?.kind === "dir" ? (await this.inner.files()).filter((f) => isUnder(f, p)) : [p];
    await this.inner.rm(p);
    if (this.hidden(p)) {
      this.index = null;
      return;
    }
    await this.exclusive(async () => {
      const index = await this.load();
      let changed = false;
      for (const f of affected) {
        if (index.records[f]) {
          delete index.records[f];
          changed = true;
        }
      }
      if (changed) await this.flush();
    });
  }

  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  stat(path: string): Promise<VfsStat | null> {
    return this.inner.stat(path);
  }

  async list(path: string): Promise<VfsEntry[]> {
    const p = normalizePath(path);
    const entries = await this.inner.list(p);
    if (p !== dirname(this.indexPath)) return entries;
    const hide = basename(this.indexPath);
    return entries.filter((e) => e.name !== hide);
  }

  async files(): Promise<string[]> {
    return (await this.inner.files()).filter((f) => f !== this.indexPath);
  }

  async totalSize(): Promise<number> {
    // The sidecar is hidden from `files()`, so it must be hidden from the
    // byte count too: a tree whose listing and whose size disagree about what
    // is in it will eventually be enforced against on one and reported on the
    // other. The budget is very slightly optimistic as a result — by the size
    // of one JSON index — which is the cheaper of the two inconsistencies.
    const total = await this.inner.totalSize();
    const sidecar = await this.inner.stat(this.indexPath);
    return total - (sidecar?.kind === "file" ? sidecar.size : 0);
  }

  // -- VfsMeta --------------------------------------------------------------

  async getMeta(path: string): Promise<VfsRecord | null> {
    const p = normalizePath(path);
    const index = await this.load();
    const rec = index.records[p];
    if (!rec) return null;
    return {
      path: p,
      metadata: structuredClone(rec.metadata),
      provenance: structuredClone(rec.provenance),
      embeddingStatus: rec.embeddingStatus,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    };
  }

  async setMeta(path: string, patch: Partial<VfsMetadata>, provenance?: VfsProvenance): Promise<void> {
    const p = normalizePath(path);
    if (!(await this.inner.exists(p))) throw new PathError(`no such file: ${p}`);
    await this.exclusive(async () => {
      const index = await this.load();
      const now = new Date().toISOString();
      const rec = (index.records[p] ??= {
        metadata: emptyMetadata(),
        provenance: [],
        embeddingStatus: "missing",
        createdAt: now,
        updatedAt: now,
      });
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete rec.metadata[key];
        else rec.metadata[key] = value as never;
      }
      rec.metadata.tags ??= [];
      rec.metadata.links ??= [];
      // Provenance is append-only. Losing why a thing was written is losing
      // the only account of it that exists.
      if (provenance) rec.provenance.push(provenance);
      rec.updatedAt = now;
      await this.flush();
    });
  }

  async linksFor(kind: VfsLink["kind"], id: string): Promise<Array<{ path: string; relation?: string }>> {
    const index = await this.load();
    const out: Array<{ path: string; relation?: string }> = [];
    for (const [path, rec] of Object.entries(index.records)) {
      for (const link of rec.metadata.links ?? []) {
        if (link.kind === kind && link.id === id) out.push({ path, relation: link.relation });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async replaceLinkTarget(
    kind: VfsLink["kind"],
    from: string,
    to: string,
    provenance?: VfsProvenance,
  ): Promise<number> {
    return this.exclusive(async () => {
      const index = await this.load();
      let changed = 0;
      for (const rec of Object.values(index.records)) {
        let touched = false;
        for (const link of rec.metadata.links ?? []) {
          if (link.kind === kind && link.id === from) {
            link.id = to;
            touched = true;
          }
        }
        if (touched) {
          changed++;
          if (provenance) rec.provenance.push(provenance);
        }
      }
      if (changed) await this.flush();
      return changed;
    });
  }

  // -- VfsSearch ------------------------------------------------------------

  async searchSemantic(query: string, opts?: SemanticSearchOpts): Promise<SemanticMatch[]> {
    const index = await this.load();
    const root = opts?.path ? normalizePath(opts.path) : "/";
    const limit = opts?.limit ?? 10;
    const recencyWeight = opts?.recencyWeight ?? 0;
    const now = Date.now();

    let queryVector: number[] | null = null;
    if (this.options.embedder) {
      const [vec] = await this.options.embedder.embed([query]);
      queryVector = vec ?? null;
    }

    const scored: SemanticMatch[] = [];
    for (const [path, rec] of Object.entries(index.records)) {
      if (!isUnder(path, root)) continue;
      if (!(await this.inner.exists(path))) continue;
      let relevance: number;
      if (queryVector && rec.vector) {
        relevance = cosine(queryVector, rec.vector);
      } else if (this.options.lexical) {
        const bytes = await this.inner.read(path);
        if (looksBinary(bytes)) continue;
        relevance = lexicalScore(query, `${rec.metadata.summary ?? ""}\n${toText(bytes)}`);
      } else {
        continue;
      }
      if (relevance <= 0) continue;
      const score = (1 - recencyWeight) * relevance + recencyWeight * recencyScore(rec.updatedAt, now);
      scored.push({ path, summary: rec.metadata.summary, score, distance: 1 - relevance });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async findNeedingEmbedding(opts?: { limit?: number }): Promise<string[]> {
    const index = await this.load();
    const out: string[] = [];
    for (const [path, rec] of Object.entries(index.records)) {
      if (rec.embeddingStatus !== "fresh") out.push(path);
    }
    out.sort();
    return opts?.limit ? out.slice(0, opts.limit) : out;
  }

  async setEmbedding(path: string, vector: number[]): Promise<void> {
    const p = normalizePath(path);
    await this.exclusive(async () => {
      const index = await this.load();
      const rec = index.records[p];
      if (!rec) throw new PathError(`no such file: ${p}`);
      // Meaningful only for a vector index; for a lexical or external one
      // this call still means "the index now covers this path".
      if (vector.length) rec.vector = vector;
      rec.embeddingStatus = "fresh";
      await this.flush();
    });
  }
}

/**
 * Give any filesystem summaries, tags, cross-references, provenance and —
 * when configured with an embedder or `lexical: true` — content search.
 *
 * The returned object is still a {@link Vfs}, so anything that took the base
 * contract keeps working and never learns that metadata exists.
 */
export function withMeta(vfs: Vfs, options: WithMetaOptions = {}): MetaVfs & Partial<VfsSearch> {
  const fs = new MetaFs(vfs, options);
  if (options.embedder || options.lexical) return fs;
  // No index and no scorer means no honest search: hide the methods so
  // `hasSearch()` reports the truth rather than advertising an empty one.
  const SEARCH_METHODS = new Set(["searchSemantic", "findNeedingEmbedding", "setEmbedding"]);
  return new Proxy(fs, {
    get(target, prop, receiver) {
      return SEARCH_METHODS.has(prop as string) ? undefined : Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return SEARCH_METHODS.has(prop as string) ? false : Reflect.has(target, prop);
    },
  }) as MetaVfs;
}
