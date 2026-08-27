/**
 * The default in-memory filesystem backend. The whole environment is a data
 * structure, so snapshot / restore are near-free.
 */
import type { SnapshotableVfs, Vfs, VfsEntry, VfsSnapshot, VfsStat } from "../types";
import { PathError, ancestors, normalizePath } from "../paths";

interface FileNode {
  data: Uint8Array;
  mtime: number;
}

export class InMemoryFs implements SnapshotableVfs {
  private filesMap = new Map<string, FileNode>();
  private dirs = new Set<string>(["/"]);
  private totalBytes = 0;

  async read(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    const node = this.filesMap.get(p);
    if (!node) throw new PathError(`no such file: ${p}${this.dirs.has(p) ? " (it is a directory)" : ""}`);
    return node.data;
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    if (this.dirs.has(p)) throw new PathError(`cannot write ${p}: it is a directory`);
    for (const a of ancestors(p)) {
      if (this.filesMap.has(a)) throw new PathError(`cannot write ${p}: ${a} is a file`);
      this.dirs.add(a);
    }
    const prev = this.filesMap.get(p);
    if (prev) this.totalBytes -= prev.data.byteLength;
    this.filesMap.set(p, { data, mtime: Date.now() });
    this.totalBytes += data.byteLength;
  }

  async rm(path: string): Promise<void> {
    const p = normalizePath(path);
    const node = this.filesMap.get(p);
    if (node) {
      this.totalBytes -= node.data.byteLength;
      this.filesMap.delete(p);
      return;
    }
    if (this.dirs.has(p)) {
      if (p === "/") throw new PathError(`cannot remove the root directory`);
      const prefix = p + "/";
      for (const f of [...this.filesMap.keys()]) {
        if (f.startsWith(prefix)) {
          this.totalBytes -= this.filesMap.get(f)!.data.byteLength;
          this.filesMap.delete(f);
        }
      }
      for (const d of [...this.dirs]) {
        if (d === p || d.startsWith(prefix)) this.dirs.delete(d);
      }
      return;
    }
    throw new PathError(`no such file or directory: ${p}`);
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path);
    if (this.filesMap.has(p)) throw new PathError(`cannot mkdir ${p}: it is a file`);
    for (const a of ancestors(p)) {
      if (this.filesMap.has(a)) throw new PathError(`cannot mkdir ${p}: ${a} is a file`);
      this.dirs.add(a);
    }
    this.dirs.add(p);
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return this.filesMap.has(p) || this.dirs.has(p);
  }

  async stat(path: string): Promise<VfsStat | null> {
    const p = normalizePath(path);
    const node = this.filesMap.get(p);
    if (node) return { kind: "file", size: node.data.byteLength, mtime: node.mtime };
    if (this.dirs.has(p)) return { kind: "dir", size: 0, mtime: 0 };
    return null;
  }

  async list(path: string): Promise<VfsEntry[]> {
    const p = normalizePath(path);
    if (this.filesMap.has(p)) throw new PathError(`not a directory: ${p}`);
    if (!this.dirs.has(p)) throw new PathError(`no such directory: ${p}`);
    const prefix = p === "/" ? "/" : p + "/";
    const seen = new Map<string, VfsEntry>();
    for (const [f, node] of this.filesMap) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) seen.set(rest, { name: rest, kind: "file", size: node.data.byteLength });
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
    return [...this.filesMap.keys()].sort();
  }

  async totalSize(): Promise<number> {
    return this.totalBytes;
  }

  /** Serialize the whole tree (used by the environment's snapshot door). */
  toSnapshot(): VfsSnapshot {
    const files = [...this.filesMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, node]) => ({
        path,
        data: bytesToBase64(node.data),
        mtime: node.mtime,
      }));
    return { version: 1, dirs: [...this.dirs].sort(), files };
  }

  static fromSnapshot(snap: VfsSnapshot): InMemoryFs {
    if (!snap || snap.version !== 1) throw new PathError(`unsupported snapshot version: ${(snap as { version?: unknown })?.version}`);
    const fs = new InMemoryFs();
    for (const d of snap.dirs) fs.dirs.add(normalizePath(d));
    for (const f of snap.files) {
      const data = base64ToBytes(f.data);
      fs.filesMap.set(normalizePath(f.path), { data, mtime: f.mtime });
      fs.totalBytes += data.byteLength;
      for (const a of ancestors(f.path)) fs.dirs.add(a);
    }
    return fs;
  }
}

/** Create the default in-memory filesystem, optionally preloaded from a snapshot. */
export function inMemoryFs(options?: { snapshot?: VfsSnapshot }): Vfs {
  return options?.snapshot ? InMemoryFs.fromSnapshot(options.snapshot) : new InMemoryFs();
}

/** Rehydrate a filesystem from a snapshot produced by `env.snapshot()`. */
export function fromSnapshot(snap: VfsSnapshot): Vfs {
  return InMemoryFs.fromSnapshot(snap);
}

export function bytesToBase64(data: Uint8Array): string {
  // Node-only package (the executor needs node:vm), so Buffer is available.
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

export function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
