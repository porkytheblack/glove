/**
 * The mount table — several backends composed into one tree.
 *
 * This is the piece that makes "one filesystem for the whole agent" a real
 * thing rather than a slogan. A session can put its scratch tree in memory,
 * its corpus on a read-only host directory, its long-lived notes in object
 * storage, and still hand every consumer ONE {@link Vfs}:
 *
 * ```ts
 * const fs = mountFs([
 *   { at: "/",       fs: inMemoryFs() },
 *   { at: "/corpus", fs: hostDirectory("./docs", { mode: "readonly" }), access: "read" },
 *   { at: "/memory", fs: await cachedRemote(store, { prefix: "sessions/abc/" }) },
 * ]);
 * ```
 *
 * ## Rules that are load-bearing
 *
 * - **Longest prefix wins.** `/memory/notes/x.md` goes to the `/memory`
 *   mount even though `/` also matches. Order in the array is irrelevant;
 *   only specificity routes.
 * - **The path down to a mount stays listable.** Mounting at `/a/b/c`
 *   synthesizes `/a` and `/a/b` as directories, even when no backend holds
 *   them — otherwise the mount is unreachable by `ls` and the agent cannot
 *   discover its own filesystem. Those synthetic directories are not
 *   writable: a write there is refused with the list of real mounts, because
 *   "it silently went somewhere" is the worst outcome available.
 * - **A mount point cannot be removed.** `rm('/memory')` would mean
 *   "unmount and delete a store the host attached", which is a host
 *   decision. It is refused; `rm('/memory/notes')` is fine.
 * - **`rooted` decides whether paths are translated.** By default a backend
 *   mounted at `/memory` is called with `/notes/x.md` — that is what lets an
 *   existing tree be grafted anywhere. Pass `rooted: false` when the
 *   backend's stored paths must stay absolute and stable, which is the case
 *   whenever something outside the tree references them by path (memory
 *   resource links are stored, unvalidated, as absolute paths — translating
 *   would invalidate every one of them silently).
 */
import { PathError, ancestors, isUnder, normalizePath } from "./paths";
import type { Vfs, VfsEntry, VfsStat } from "./types";

export interface Mount {
  /** Absolute directory to graft this backend at. `"/"` mounts it as the root. */
  at: string;
  fs: Vfs;
  /** `"write"` (default) or `"read"`, which refuses every mutation below this point. */
  access?: "write" | "read";
  /**
   * Translate paths into the backend so it sees them relative to `at`.
   * Default true. See the note above before turning it off.
   */
  rooted?: boolean;
}

interface ResolvedMount {
  at: string;
  fs: Vfs;
  readOnly: boolean;
  rooted: boolean;
}

class MountedFs implements Vfs {
  private readonly mounts: ResolvedMount[];
  /** Every directory on the way down to a mount point, `/` included. */
  private readonly synthetic: Set<string>;

  constructor(mounts: Mount[]) {
    if (mounts.length === 0) throw new PathError("mountFs needs at least one mount");
    const seen = new Set<string>();
    this.mounts = mounts
      .map((m) => {
        const at = normalizePath(m.at);
        if (seen.has(at)) throw new PathError(`duplicate mount point: ${at}`);
        seen.add(at);
        return { at, fs: m.fs, readOnly: m.access === "read", rooted: m.rooted !== false };
      })
      // Longest first, so the first match is the most specific one.
      .sort((a, b) => b.at.length - a.at.length);

    this.synthetic = new Set<string>(["/"]);
    for (const m of this.mounts) {
      for (const a of ancestors(m.at)) this.synthetic.add(a);
      this.synthetic.add(m.at);
    }
  }

  /** The mount owning a path, or null when the path is only a synthetic directory. */
  private route(path: string): { mount: ResolvedMount; inner: string } | null {
    const p = normalizePath(path);
    for (const m of this.mounts) {
      if (!isUnder(p, m.at)) continue;
      if (!m.rooted) return { mount: m, inner: p };
      const rest = m.at === "/" ? p : p.slice(m.at.length);
      return { mount: m, inner: rest === "" ? "/" : rest };
    }
    return null;
  }

  private need(path: string): { mount: ResolvedMount; inner: string } {
    const hit = this.route(path);
    if (hit) return hit;
    const p = normalizePath(path);
    if (this.synthetic.has(p)) {
      throw new PathError(
        `cannot write ${p}: it is above every mount point. Mounted trees: ${this.mounts.map((m) => m.at).join(", ")}`,
      );
    }
    throw new PathError(
      `no such path: ${p} — it is under no mounted tree. Mounted trees: ${this.mounts.map((m) => m.at).join(", ")}`,
    );
  }

  private refuseIfReadOnly(mount: ResolvedMount, op: string, path: string): void {
    if (mount.readOnly) {
      throw new PathError(`cannot ${op} ${normalizePath(path)}: the tree mounted at ${mount.at} is read-only`);
    }
  }

  /** Map a backend-relative path back into the composed tree. */
  private outward(mount: ResolvedMount, inner: string): string {
    if (!mount.rooted || mount.at === "/") return normalizePath(inner);
    return normalizePath(inner === "/" ? mount.at : `${mount.at}${inner}`);
  }

  async read(path: string): Promise<Uint8Array> {
    const { mount, inner } = this.need(path);
    return mount.fs.read(inner);
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const { mount, inner } = this.need(path);
    this.refuseIfReadOnly(mount, "write", path);
    return mount.fs.write(inner, data);
  }

  async rm(path: string): Promise<void> {
    const p = normalizePath(path);
    const owner = this.mounts.find((m) => m.at === p);
    if (owner) {
      throw new PathError(
        `cannot remove ${p}: it is a mount point. Remove what is inside it, or unmount it host-side.`,
      );
    }
    const { mount, inner } = this.need(p);
    this.refuseIfReadOnly(mount, "remove", p);
    return mount.fs.rm(inner);
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path);
    // Synthetic ancestors and mount points already exist as directories.
    if (this.synthetic.has(p) && !this.mounts.some((m) => m.at === p)) return;
    const { mount, inner } = this.need(p);
    this.refuseIfReadOnly(mount, "mkdir", p);
    return mount.fs.mkdir(inner);
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    if (this.synthetic.has(p)) return true;
    const hit = this.route(p);
    return hit ? hit.mount.fs.exists(hit.inner) : false;
  }

  async stat(path: string): Promise<VfsStat | null> {
    const p = normalizePath(path);
    const hit = this.route(p);
    if (hit) {
      const stat = await hit.mount.fs.stat(hit.inner);
      if (stat) return stat;
    }
    // A mount point with an empty backend, or a directory on the way to one,
    // is still a directory as far as the composed tree is concerned.
    return this.synthetic.has(p) ? { kind: "dir", size: 0, mtime: 0 } : null;
  }

  async list(path: string): Promise<VfsEntry[]> {
    const p = normalizePath(path);
    const hit = this.route(p);
    const entries = new Map<string, VfsEntry>();

    if (hit) {
      const stat = await hit.mount.fs.stat(hit.inner);
      if (stat?.kind === "file") throw new PathError(`not a directory: ${p}`);
      if (stat) for (const e of await hit.mount.fs.list(hit.inner)) entries.set(e.name, e);
    } else if (!this.synthetic.has(p)) {
      throw new PathError(`no such directory: ${p}`);
    }

    // Mount points nested below this directory show up as directories even
    // when the covering backend has never heard of them.
    const prefix = p === "/" ? "/" : p + "/";
    for (const m of this.mounts) {
      if (m.at === p || !m.at.startsWith(prefix)) continue;
      const name = m.at.slice(prefix.length).split("/")[0];
      if (name && !entries.has(name)) entries.set(name, { name, kind: "dir", size: 0 });
    }

    return [...entries.values()].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
  }

  async files(): Promise<string[]> {
    const out: string[] = [];
    for (const m of this.mounts) {
      for (const f of await m.fs.files()) {
        const outward = this.outward(m, f);
        // A backend mounted at "/" also covers the paths of deeper mounts;
        // the deeper mount is authoritative there, so drop the shadowed copy.
        if (this.mounts.some((other) => other !== m && other.at !== "/" && isUnder(outward, other.at))) continue;
        out.push(outward);
      }
    }
    return [...new Set(out)].sort();
  }

  async totalSize(): Promise<number> {
    let total = 0;
    for (const m of this.mounts) total += await m.fs.totalSize();
    return total;
  }
}

/**
 * Compose several backends into one tree. See the module note for routing,
 * listability and `rooted` semantics.
 */
export function mountFs(mounts: Mount[]): Vfs {
  return new MountedFs(mounts);
}
