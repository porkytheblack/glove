/**
 * A copy-on-write filesystem backed by a real host directory.
 *
 * Reads fall through to disk; writes and deletes land in an in-memory
 * overlay; nothing on the host changes until the host calls `commit()`.
 *
 * Two things this buys that `InMemoryFs` cannot:
 *
 * 1. **A real corpus without a thousand `mount()` calls.** Pointing the
 *    environment at a directory of a thousand documents currently means a
 *    thousand round-trips and a full second copy in memory, with every byte
 *    counted against `maxVfsBytes`. Here the base is read on demand.
 * 2. **The agent cannot damage the source.** Everything it writes is an
 *    overlay entry until a human commits it. That is the property that makes
 *    an agent safe to point at real data, and it is why `commit()` is
 *    explicit rather than a default.
 *
 * ## Containment is the whole risk surface
 *
 * The VFS path space must stay inside the root. `..` is already normalised
 * away by `normalizePath` before a path reaches here, but symlinks are not:
 * a link inside the root pointing at `/etc`, or a symlinked parent
 * directory, would read and eventually write outside it.
 *
 * So containment is verified **after** symlink resolution, on the real path,
 * for every access — and a link that escapes is refused rather than
 * followed. Refusing is the right default: an agent pointed at a directory
 * has been given that directory, and silently following a link out of it is
 * not something the person who granted it would expect.
 *
 * ## One environment per directory
 *
 * Two environments opened over the same host directory will corrupt each
 * other, quietly. Each keeps its own `VersionStore` in memory but writes it
 * to the same `/.env/versions/index.json`, and blob ids come from a
 * per-environment counter — so both allocate `v1`, `v2`, `v3`, and each one's
 * `undo` eventually restores the other's content. The tree looks fine
 * throughout; only the history is wrong.
 *
 * There is no locking here to prevent it, because the fix is structural: give
 * each environment its own directory (or its own subdirectory of a shared
 * root) and commit them separately. `cachedRemote` documents the same rule
 * for key prefixes and it holds for the same reason.
 */
import { readdir, readFile, realpath, stat as hostStat, mkdir as hostMkdir, writeFile, rm as hostRm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Vfs, VfsEntry, VfsStat } from "../types";
import { PathError, ancestors, normalizePath } from "../paths";

interface OverlayFile {
  data: Uint8Array;
  mtime: number;
}

export interface HostDirectoryOptions {
  /**
   * `"cow"` (default) keeps every write in memory until `commit()`.
   * `"readonly"` refuses writes outright — for pointing an agent at data it
   * should only ever read.
   */
  mode?: "cow" | "readonly";
}

export class HostDirectoryFs implements Vfs {
  /** VFS path → new content. */
  private overlay = new Map<string, OverlayFile>();
  /** VFS paths deleted in the overlay; reads must not fall through to them. */
  private tombstones = new Set<string>();
  /** Directories created in the overlay (the base's own are found on disk). */
  private overlayDirs = new Set<string>(["/"]);
  /** Invalidated by every mutation — see `totalSize`. */
  private sizeCache: number | null = null;
  private realRoot: string | null = null;

  constructor(
    private readonly root: string,
    private readonly options: HostDirectoryOptions = {},
  ) {}

  private get readOnly(): boolean {
    return this.options.mode === "readonly";
  }

  private refuseIfReadOnly(op: string, path: string): void {
    if (this.readOnly) {
      throw new PathError(`cannot ${op} ${path}: this environment is backed by a read-only host directory`);
    }
  }

  /** The root, with its own symlinks resolved, so comparisons are like-for-like. */
  private async rootPath(): Promise<string> {
    if (this.realRoot === null) {
      try {
        this.realRoot = await realpath(this.root);
      } catch (e) {
        throw new PathError(`host directory ${this.root} is not readable: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return this.realRoot;
  }

  /**
   * The host path for a VFS path, verified to be inside the root.
   *
   * Resolution walks as far as the path exists — a file being *created* has
   * no real path yet, so its nearest existing ancestor is what gets checked.
   * That is the ancestor a symlink would have to subvert.
   */
  private async hostPathFor(vfsPath: string): Promise<string> {
    const root = await this.rootPath();
    const relative = vfsPath === "/" ? "" : vfsPath.slice(1);
    const naive = relative === "" ? root : join(root, relative);

    let probe = naive;
    const unresolved: string[] = [];
    for (;;) {
      try {
        const real = await realpath(probe);
        const full = unresolved.length ? join(real, ...unresolved) : real;
        if (real !== root && !real.startsWith(root + sep)) {
          throw new PathError(
            `refusing ${vfsPath}: it resolves outside the host directory (${real}). ` +
              `Symlinks that leave the root are not followed.`,
          );
        }
        return full;
      } catch (e) {
        if (e instanceof PathError) throw e;
        const parent = resolve(probe, "..");
        if (parent === probe) {
          // Walked past the filesystem root without finding anything real.
          throw new PathError(`refusing ${vfsPath}: ${this.root} does not exist`);
        }
        unresolved.unshift(probe.slice(parent.length + 1));
        probe = parent;
      }
    }
  }

  /** Is this path shadowed by a delete in the overlay (directly or by a parent)? */
  private deleted(p: string): boolean {
    if (this.tombstones.has(p)) return true;
    for (const t of this.tombstones) {
      if (p.startsWith(t === "/" ? "/" : `${t}/`)) return true;
    }
    return false;
  }

  async read(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    const staged = this.overlay.get(p);
    if (staged) return staged.data;
    if (this.deleted(p)) throw new PathError(`no such file: ${p}`);
    const host = await this.hostPathFor(p);
    try {
      const s = await hostStat(host);
      if (s.isDirectory()) throw new PathError(`no such file: ${p} (it is a directory)`);
      return new Uint8Array(await readFile(host));
    } catch (e) {
      if (e instanceof PathError) throw e;
      throw new PathError(`no such file: ${p}`);
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    this.refuseIfReadOnly("write", p);
    if ((await this.stat(p))?.kind === "dir") throw new PathError(`cannot write ${p}: it is a directory`);
    for (const a of ancestors(p)) {
      if ((await this.stat(a))?.kind === "file") throw new PathError(`cannot write ${p}: ${a} is a file`);
      this.overlayDirs.add(a);
    }
    // Writing revives a path an earlier delete tombstoned.
    this.tombstones.delete(p);
    this.overlay.set(p, { data, mtime: Date.now() });
    this.sizeCache = null;
  }

  async rm(path: string): Promise<void> {
    const p = normalizePath(path);
    this.refuseIfReadOnly("remove", p);
    if (p === "/") throw new PathError(`cannot remove the root directory`);
    const current = await this.stat(p);
    if (!current) throw new PathError(`no such file or directory: ${p}`);

    if (current.kind === "dir") {
      const prefix = `${p}/`;
      for (const key of [...this.overlay.keys()]) if (key.startsWith(prefix)) this.overlay.delete(key);
      for (const d of [...this.overlayDirs]) if (d === p || d.startsWith(prefix)) this.overlayDirs.delete(d);
    } else {
      this.overlay.delete(p);
    }
    // The tombstone shadows whatever the base still has at that path.
    this.tombstones.add(p);
    this.sizeCache = null;
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path);
    this.refuseIfReadOnly("mkdir", p);
    if ((await this.stat(p))?.kind === "file") throw new PathError(`cannot mkdir ${p}: it is a file`);
    for (const a of ancestors(p)) {
      if ((await this.stat(a))?.kind === "file") throw new PathError(`cannot mkdir ${p}: ${a} is a file`);
      this.overlayDirs.add(a);
    }
    this.tombstones.delete(p);
    this.overlayDirs.add(p);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: string): Promise<VfsStat | null> {
    const p = normalizePath(path);
    const staged = this.overlay.get(p);
    if (staged) return { kind: "file", size: staged.data.byteLength, mtime: staged.mtime };
    if (this.overlayDirs.has(p)) return { kind: "dir", size: 0, mtime: 0 };
    if (this.deleted(p)) return null;
    try {
      const host = await this.hostPathFor(p);
      const s = await hostStat(host);
      if (s.isDirectory()) return { kind: "dir", size: 0, mtime: 0 };
      if (!s.isFile()) return null; // sockets, devices — not representable here
      return { kind: "file", size: s.size, mtime: s.mtimeMs };
    } catch {
      return null;
    }
  }

  async list(path: string): Promise<VfsEntry[]> {
    const p = normalizePath(path);
    const current = await this.stat(p);
    if (!current) throw new PathError(`no such directory: ${p}`);
    if (current.kind === "file") throw new PathError(`not a directory: ${p}`);

    const prefix = p === "/" ? "/" : `${p}/`;
    const seen = new Map<string, VfsEntry>();

    // The base, unless shadowed.
    try {
      const host = await this.hostPathFor(p);
      for (const entry of await readdir(host, { withFileTypes: true })) {
        const child = `${prefix}${entry.name}`;
        if (this.deleted(child) || this.overlay.has(child)) continue;
        if (entry.isDirectory()) {
          seen.set(entry.name, { name: entry.name, kind: "dir", size: 0 });
        } else if (entry.isFile()) {
          const s = await hostStat(join(host, entry.name)).catch(() => null);
          seen.set(entry.name, { name: entry.name, kind: "file", size: s?.size ?? 0 });
        } else if (entry.isSymbolicLink()) {
          // Include it only if it stays inside the root — hostPathFor is the
          // authority, and it refuses the ones that do not.
          const target = await this.stat(child).catch(() => null);
          if (target) seen.set(entry.name, { name: entry.name, kind: target.kind, size: target.size });
        }
      }
    } catch (e) {
      if (e instanceof PathError && /resolves outside/.test(e.message)) throw e;
      // A directory that exists only in the overlay has nothing on disk.
    }

    // The overlay wins.
    for (const [f, node] of this.overlay) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (!rest.includes("/")) seen.set(rest, { name: rest, kind: "file", size: node.data.byteLength });
    }
    for (const d of this.overlayDirs) {
      if (d === p || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const name = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
      if (!seen.has(name)) seen.set(name, { name, kind: "dir", size: 0 });
    }

    return [...seen.values()].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
  }

  async files(): Promise<string[]> {
    const out = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await this.list(dir)) {
        const child = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
        if (entry.kind === "dir") await walk(child);
        else out.add(child);
      }
    };
    await walk("/");
    return [...out].sort();
  }

  /**
   * Total bytes, cached.
   *
   * Every guarded write asks for this, and answering it means walking the
   * whole base tree — which on a directory of a thousand documents turns
   * every write into a full traversal. The cache is invalidated by any
   * mutation, which is exactly when the answer can change.
   */
  async totalSize(): Promise<number> {
    if (this.sizeCache !== null) return this.sizeCache;
    let total = 0;
    for (const f of await this.files()) total += (await this.stat(f))?.size ?? 0;
    this.sizeCache = total;
    return total;
  }

  // ------------------------------------------------------------ host doors

  /** What the overlay currently holds, without writing any of it. */
  pending(): { written: string[]; removed: string[] } {
    return { written: [...this.overlay.keys()].sort(), removed: [...this.tombstones].sort() };
  }

  /**
   * Apply the overlay to the host directory. Returns what changed.
   *
   * Deletes are applied before writes: a path that was removed and then
   * written again must end up present, and applying them the other way round
   * would leave it gone.
   *
   * ## Why this clears entry by entry rather than `overlay.clear()`
   *
   * A commit is a sequence of awaited disk operations, and the environment
   * keeps accepting writes throughout — a host calls `commit()` on a Save
   * button while a `run_script` is still writing `/out`. Clearing the whole
   * overlay at the end therefore discards every write that arrived *during*
   * the commit: writes the environment accepted, version-recorded, and
   * reported to the model as successful, gone from disk and from the VFS
   * view alike, with no error anywhere.
   *
   * So each entry is removed only if it is still the same object this commit
   * wrote. A write that landed mid-commit has replaced it, and survives to
   * the next one. Same for tombstones: only the ones this commit applied are
   * dropped.
   */
  async commit(): Promise<{ written: string[]; removed: string[] }> {
    if (this.readOnly) throw new PathError(`cannot commit: this environment is backed by a read-only host directory`);
    const removed: string[] = [];
    const appliedTombstones: string[] = [];
    for (const t of [...this.tombstones].sort()) {
      if (this.overlay.has(t)) continue; // rewritten since; the write covers it
      await hostRm(await this.hostPathFor(t), { recursive: true, force: true });
      appliedTombstones.push(t);
      removed.push(t);
    }
    const written: string[] = [];
    const applied: Array<[string, OverlayFile]> = [];
    for (const [p, node] of [...this.overlay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const host = await this.hostPathFor(p);
      await hostMkdir(resolve(host, ".."), { recursive: true });
      await writeFile(host, node.data);
      applied.push([p, node]);
      written.push(p);
    }
    for (const [p, node] of applied) {
      if (this.overlay.get(p) === node) this.overlay.delete(p);
    }
    for (const t of appliedTombstones) {
      // A path re-deleted during the commit wants the same outcome this
      // commit already produced, so dropping it is right either way. A path
      // deleted for the FIRST time during the commit was never in this list.
      this.tombstones.delete(t);
    }
    this.sizeCache = null;
    return { written, removed };
  }

  /** Throw the overlay away. The host directory was never touched. */
  discard(): void {
    this.overlay.clear();
    this.tombstones.clear();
    this.overlayDirs = new Set<string>(["/"]);
    this.sizeCache = null;
  }
}

/**
 * Back an environment with a real host directory, copy-on-write.
 *
 * ```ts
 * const disk = hostDirectory("./workspace");
 * const env = await createWorkingEnvironment({ filesystem: disk });
 * // … agent works; the directory on disk is untouched …
 * await disk.commit();   // or disk.discard()
 * ```
 */
export function hostDirectory(root: string, options?: HostDirectoryOptions): HostDirectoryFs {
  return new HostDirectoryFs(root, options);
}
