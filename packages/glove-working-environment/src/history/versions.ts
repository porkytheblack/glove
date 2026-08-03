/**
 * Per-file linear undo/redo. On every guarded mutation the prior state
 * (content, or "absent") is pushed onto that file's undo ring; `undo` walks
 * back, `redo` walks forward, and a fresh mutation truncates the redo
 * branch. Version blobs live in the tree under `/.env/versions/` so they
 * are snapshotted with everything else and count against the size cap.
 */
import type { EnvLimits, FileVersionInfo, Vfs } from "../types";
import { normalizePath } from "../paths";

const INDEX_PATH = "/.env/versions/index.json";
const BLOB_DIR = "/.env/versions/blobs";

interface VersionEntry {
  /** Blob id, or null when the file did not exist in this version. */
  blob: string | null;
  ts: number;
  op: string;
  size: number;
}

interface PathVersions {
  undo: VersionEntry[];
  redo: VersionEntry[];
}

interface IndexFile {
  counter: number;
  paths: Record<string, PathVersions>;
}

export interface RestoredVersion {
  /** null → the file should be removed (restored state is "absent"). */
  content: Uint8Array | null;
  ts: number;
  op: string;
}

export class VersionStore {
  private index = new Map<string, PathVersions>();
  private counter = 0;
  private loaded = false;

  constructor(
    private vfs: Vfs,
    private limits: EnvLimits,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (await this.vfs.exists(INDEX_PATH)) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(await this.vfs.read(INDEX_PATH))) as IndexFile;
        this.counter = parsed.counter ?? 0;
        for (const [p, v] of Object.entries(parsed.paths ?? {})) this.index.set(p, v);
      } catch {
        // A corrupt index means version history is lost, not the environment.
      }
    }
  }

  private async persist(): Promise<void> {
    const file: IndexFile = { counter: this.counter, paths: Object.fromEntries(this.index.entries()) };
    await this.vfs.write(INDEX_PATH, new TextEncoder().encode(JSON.stringify(file)));
  }

  private async saveBlob(content: Uint8Array): Promise<string> {
    const id = `v${++this.counter}`;
    await this.vfs.write(`${BLOB_DIR}/${id}`, content);
    return id;
  }

  private async dropBlob(entry: VersionEntry): Promise<void> {
    if (entry.blob === null) return;
    const p = `${BLOB_DIR}/${entry.blob}`;
    if (await this.vfs.exists(p)) await this.vfs.rm(p);
  }

  private slot(path: string): PathVersions {
    const p = normalizePath(path);
    let s = this.index.get(p);
    if (!s) {
      s = { undo: [], redo: [] };
      this.index.set(p, s);
    }
    return s;
  }

  /** Bytes a mutation will add to version storage (for the size-cap precheck). */
  versionOverhead(prior: Uint8Array | null): number {
    return prior?.byteLength ?? 0;
  }

  /** Record the prior state of `path` before a mutation. Truncates the redo branch. */
  async recordMutation(path: string, prior: Uint8Array | null, op: string): Promise<void> {
    await this.load();
    const s = this.slot(path);
    for (const r of s.redo) await this.dropBlob(r);
    s.redo = [];
    const entry: VersionEntry = {
      blob: prior === null ? null : await this.saveBlob(prior),
      ts: Date.now(),
      op,
      size: prior?.byteLength ?? 0,
    };
    s.undo.push(entry);
    while (s.undo.length > this.limits.maxVersionsPerFile) {
      await this.dropBlob(s.undo.shift()!);
    }
    await this.persist();
  }

  async canUndo(path: string): Promise<boolean> {
    await this.load();
    return (this.index.get(normalizePath(path))?.undo.length ?? 0) > 0;
  }

  async canRedo(path: string): Promise<boolean> {
    await this.load();
    return (this.index.get(normalizePath(path))?.redo.length ?? 0) > 0;
  }

  /** Read the state `undo` would restore, without touching the stacks. */
  async peekUndo(path: string): Promise<RestoredVersion | null> {
    await this.load();
    const s = this.index.get(normalizePath(path));
    const entry = s?.undo[s.undo.length - 1];
    if (!entry) return null;
    const content = entry.blob === null ? null : await this.vfs.read(`${BLOB_DIR}/${entry.blob}`);
    return { content, ts: entry.ts, op: entry.op };
  }

  /** Read the state `redo` would restore, without touching the stacks. */
  async peekRedo(path: string): Promise<RestoredVersion | null> {
    await this.load();
    const s = this.index.get(normalizePath(path));
    const entry = s?.redo[s.redo.length - 1];
    if (!entry) return null;
    const content = entry.blob === null ? null : await this.vfs.read(`${BLOB_DIR}/${entry.blob}`);
    return { content, ts: entry.ts, op: entry.op };
  }

  /**
   * Pop the most recent prior version. `current` is the file's present state
   * (null = absent), stored so `redo` can come back.
   */
  async undo(path: string, current: Uint8Array | null): Promise<RestoredVersion | null> {
    await this.load();
    const s = this.slot(path);
    const entry = s.undo.pop();
    if (!entry) return null;
    s.redo.push({
      blob: current === null ? null : await this.saveBlob(current),
      ts: Date.now(),
      op: "undo",
      size: current?.byteLength ?? 0,
    });
    const content = entry.blob === null ? null : await this.vfs.read(`${BLOB_DIR}/${entry.blob}`);
    await this.dropBlob(entry);
    await this.persist();
    return { content, ts: entry.ts, op: entry.op };
  }

  async redo(path: string, current: Uint8Array | null): Promise<RestoredVersion | null> {
    await this.load();
    const s = this.slot(path);
    const entry = s.redo.pop();
    if (!entry) return null;
    s.undo.push({
      blob: current === null ? null : await this.saveBlob(current),
      ts: Date.now(),
      op: "redo",
      size: current?.byteLength ?? 0,
    });
    while (s.undo.length > this.limits.maxVersionsPerFile) {
      await this.dropBlob(s.undo.shift()!);
    }
    const content = entry.blob === null ? null : await this.vfs.read(`${BLOB_DIR}/${entry.blob}`);
    await this.dropBlob(entry);
    await this.persist();
    return { content, ts: entry.ts, op: entry.op };
  }

  async history(path: string): Promise<{ undo: FileVersionInfo[]; redo: FileVersionInfo[] }> {
    await this.load();
    const s = this.index.get(normalizePath(path));
    const map = (e: VersionEntry): FileVersionInfo => ({ ts: e.ts, op: e.op, present: e.blob !== null, size: e.size });
    return { undo: (s?.undo ?? []).map(map), redo: (s?.redo ?? []).map(map) };
  }
}
