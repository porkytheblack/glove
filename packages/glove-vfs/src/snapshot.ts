/**
 * Whole-tree serialization, independent of which backend holds the tree.
 *
 * A backend that can serialize itself does (in-memory can, in one pass over a
 * map); everything else is walked. Both produce the same {@link VfsSnapshot},
 * which is what makes "develop against memory, deploy against object storage"
 * a configuration change rather than a migration.
 */
import { normalizePath } from "./paths";
import { base64ToBytes, bytesToBase64 } from "./backends/memory";
import { isSnapshotable, type Vfs, type VfsSnapshot } from "./types";

/** Serialize a whole tree. Prefer this over per-file persistence: one round trip, and atomic. */
export async function snapshot(vfs: Vfs): Promise<VfsSnapshot> {
  if (isSnapshotable(vfs)) return vfs.toSnapshot();

  const dirs: string[] = [];
  const files: VfsSnapshot["files"] = [];
  const walk = async (dir: string): Promise<void> => {
    dirs.push(dir);
    for (const entry of await vfs.list(dir)) {
      const p = normalizePath(dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`);
      if (entry.kind === "dir") {
        await walk(p);
      } else {
        const stat = await vfs.stat(p);
        files.push({ path: p, data: bytesToBase64(await vfs.read(p)), mtime: stat?.mtime ?? 0 });
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
  if (opts?.clear) {
    const keep = new Set(snap.files.map((f) => normalizePath(f.path)));
    for (const existing of await vfs.files()) {
      if (!keep.has(existing)) await vfs.rm(existing);
    }
  }
  for (const dir of snap.dirs) await vfs.mkdir(dir);
  for (const file of snap.files) await vfs.write(file.path, base64ToBytes(file.data));
}

/** Copy every file from one tree into another. Backend-agnostic migration. */
export async function copyTree(from: Vfs, to: Vfs): Promise<number> {
  let copied = 0;
  for (const path of await from.files()) {
    await to.write(path, await from.read(path));
    copied++;
  }
  return copied;
}
