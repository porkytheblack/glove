/**
 * Whole-tree serialization, independent of which backend holds the tree.
 *
 * A backend that can serialize itself does (in-memory can, in one pass over a
 * map); everything else is walked. Both produce the same {@link VfsSnapshot},
 * which is what makes "develop against memory, deploy against object storage"
 * a configuration change rather than a migration.
 *
 * ## These operate on stored bytes, not on the visible view
 *
 * Every function here calls {@link unwrap} first, so a snapshot captures what
 * the backend actually holds — the metadata sidecar {@link withMeta} hides
 * from `files()`, and paths {@link withAccess} fences off — rather than what
 * the outermost layer chooses to show.
 *
 * That is deliberate and it is the only correct answer. A snapshot exists to
 * be restored, so anything it omits is data the restore destroys: take one
 * through a metadata layer without unwrapping and every summary, tag, link and
 * provenance entry is silently gone on the way back, with the file bytes
 * intact to make it look like it worked. These are host doors — the host holds
 * the handle and is serializing its own storage — not a surface an agent
 * reaches, which is where the narrowing belongs and stays.
 */
import { normalizePath } from "./paths";
import { base64ToBytes, bytesToBase64 } from "./backends/memory";
import { invalidateChain, isSnapshotable, unwrap, type Vfs, type VfsSnapshot } from "./types";

/** Serialize a whole tree. Prefer this over per-file persistence: one round trip, and atomic. */
export async function snapshot(vfs: Vfs): Promise<VfsSnapshot> {
  const base = unwrap(vfs);
  if (isSnapshotable(base)) return base.toSnapshot();

  const dirs: string[] = [];
  const files: VfsSnapshot["files"] = [];
  const walk = async (dir: string): Promise<void> => {
    dirs.push(dir);
    for (const entry of await base.list(dir)) {
      const p = normalizePath(dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`);
      if (entry.kind === "dir") {
        await walk(p);
      } else {
        const stat = await base.stat(p);
        files.push({ path: p, data: bytesToBase64(await base.read(p)), mtime: stat?.mtime ?? 0 });
      }
    }
  };
  await walk("/");
  return { version: 1, dirs: dirs.sort(), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

/**
 * Write a snapshot into an existing tree. Additive by default — pass
 * `{ clear: true }` to make the tree match the snapshot exactly, which is
 * what a restore usually means and what a merge never does.
 */
export async function restore(vfs: Vfs, snap: VfsSnapshot, opts?: { clear?: boolean }): Promise<void> {
  if (snap?.version !== 1) {
    throw new Error(`unsupported snapshot version: ${(snap as { version?: unknown })?.version}`);
  }
  const base = unwrap(vfs);
  if (opts?.clear) {
    const keep = new Set(snap.files.map((f) => normalizePath(f.path)));
    for (const existing of await base.files()) {
      if (!keep.has(existing)) await base.rm(existing);
    }
  }
  for (const dir of snap.dirs) await base.mkdir(dir);
  for (const file of snap.files) await base.write(file.path, base64ToBytes(file.data));
  // The bytes moved underneath every layer over this tree, sidecar included.
  invalidateChain(vfs);
}

/** Copy every file from one tree into another. Backend-agnostic migration. */
export async function copyTree(from: Vfs, to: Vfs): Promise<number> {
  const source = unwrap(from);
  const target = unwrap(to);
  let copied = 0;
  for (const path of await source.files()) {
    await target.write(path, await source.read(path));
    copied++;
  }
  invalidateChain(to);
  return copied;
}
