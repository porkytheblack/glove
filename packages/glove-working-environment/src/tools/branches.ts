/**
 * Whole-tree checkpoints, addressable from inside the agent loop.
 *
 * `undo`/`redo` are per-file and linear. That covers a typo. It does not
 * cover "try this whole approach, and if it doesn't work, put everything
 * back" — which is what an agent does when it restructures a five-script
 * pipeline. Today the only way back is to undo each file in the right order,
 * from memory, and any mistake leaves the tree in a state that is neither
 * the old one nor the new one.
 *
 * `fork` saves the tree under a name; `restore` puts it back. Between them
 * an agent can make any mess it likes and unmake it in one call, which is
 * what makes exploratory work worth attempting at all.
 *
 * ## Two deliberate omissions
 *
 * **No merge.** Three-way merge is out of scope, and the alternative —
 * last-write-wins, refusing on conflict — is a lot of machinery for
 * something an agent can already express: restore the branch it wants, then
 * copy across the handful of files it wants from the other. Explicit beats a
 * policy nobody can predict.
 *
 * **`/.env` is not checkpointed.** Two reasons. A branch stored inside the
 * tree would otherwise contain the branches, recursively. And the run log is
 * a record of what actually happened: restoring files does not un-run a
 * script, so history stays continuous across a restore, which is also the
 * only reading that lets an agent see what it just undid.
 */
import type { EnvSnapshot, Vfs } from "../types";
import { base64ToBytes, bytesToBase64 } from "../vfs/memory";
import { isUnder, normalizePath } from "../paths";

export const BRANCH_DIR = "/.env/branches";
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export interface BranchInfo {
  name: string;
  files: number;
  bytes: number;
  /** ISO timestamp of the fork. */
  created: string;
}

interface StoredBranch {
  version: 1;
  created: string;
  snapshot: EnvSnapshot;
}

export function branchPath(name: string): string {
  return `${BRANCH_DIR}/${name}.json`;
}

export function validateBranchName(name: unknown): string {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(
      `invalid checkpoint name ${JSON.stringify(name)} — use letters, digits, "-" or "_", starting with a letter or digit (max 64)`,
    );
  }
  return name;
}

/**
 * Everything outside `/.env`, which is what a checkpoint covers.
 *
 * The walk awaits per entry, so it must run under the environment's exclusive
 * lock: interleaved with a mutation it captures a tree that never existed —
 * half of one write and half of the next.
 */
async function captureTree(vfs: Vfs): Promise<EnvSnapshot> {
  const files: EnvSnapshot["files"] = [];
  const dirs: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (isUnder(dir, "/.env")) return;
    dirs.push(dir);
    for (const entry of await vfs.list(dir)) {
      const p = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
      if (isUnder(p, "/.env")) continue;
      if (entry.kind === "dir") {
        await walk(p);
      } else {
        const stat = await vfs.stat(p);
        files.push({ path: p, data: bytesToBase64(await vfs.read(p)), mtime: stat?.mtime ?? 0 });
      }
    }
  };
  await walk("/");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { version: 1, dirs: dirs.sort(), files };
}

/** Save the tree under `name`. Returns what was captured. Hold the lock. */
export async function forkBranch(vfs: Vfs, name: string): Promise<BranchInfo> {
  validateBranchName(name);
  const snapshot = await captureTree(vfs);
  const stored: StoredBranch = { version: 1, created: new Date().toISOString(), snapshot };
  const payload = new TextEncoder().encode(JSON.stringify(stored));
  await vfs.write(branchPath(name), payload);
  return {
    name,
    files: snapshot.files.length,
    bytes: snapshot.files.reduce((n, f) => n + base64ToBytes(f.data).byteLength, 0),
    created: stored.created,
  };
}

async function readBranch(vfs: Vfs, name: string): Promise<StoredBranch> {
  validateBranchName(name);
  const path = branchPath(name);
  if (!(await vfs.exists(path))) {
    const existing = (await listBranches(vfs)).map((b) => b.name);
    throw new Error(
      existing.length
        ? `no checkpoint named "${name}". Existing: ${existing.join(", ")}.`
        : `no checkpoint named "${name}" — none have been created yet. Use fork first.`,
    );
  }
  const stored = JSON.parse(new TextDecoder().decode(await vfs.read(path))) as StoredBranch;
  if (stored?.version !== 1 || !stored.snapshot) throw new Error(`checkpoint "${name}" is corrupt and cannot be restored`);
  return stored;
}

/**
 * Put the tree back to a saved state.
 *
 * Everything outside `/.env` is replaced: files the checkpoint does not have
 * are removed, which is the whole point — "put it back" has to mean the file
 * you created is gone, not merely that the ones you edited are reverted.
 *
 * **All or nothing.** A restore is a long sequence of removes and writes, and
 * a failure part-way through leaves the tree in a state that is neither the
 * old one nor the new one — the exact outcome checkpoints exist to prevent.
 * So the current tree is captured first and reinstated if any step throws,
 * and the caller reports the original failure. The capture is the same walk
 * `fork` does; on the in-memory filesystem this costs one pass and the bytes
 * of the tree, which is the price of the guarantee.
 *
 * Callers must hold the environment's exclusive lock (see
 * `EnvCore.exclusive`) — every path below reads then writes.
 */
export async function restoreBranch(
  vfs: Vfs,
  name: string,
): Promise<{ restored: number; removed: number; touched: string[] }> {
  const { snapshot } = await readBranch(vfs, name);
  const before = await captureTree(vfs);

  try {
    return await applyTree(vfs, snapshot);
  } catch (e) {
    // Best effort, and deliberately not allowed to mask the real failure: if
    // the rollback also fails the caller still sees why the restore did.
    try {
      await applyTree(vfs, before);
    } catch {
      throw new Error(
        `restoring checkpoint "${name}" failed part-way and the tree could not be rolled back — ` +
          `it is in a mixed state. Original failure: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    throw e;
  }
}

/** Make the tree outside `/.env` match `snapshot`. Not atomic on its own. */
async function applyTree(vfs: Vfs, snapshot: EnvSnapshot): Promise<{ restored: number; removed: number; touched: string[] }> {
  const wanted = new Set(snapshot.files.map((f) => normalizePath(f.path)));
  const touched: string[] = [];
  let removed = 0;
  for (const path of await vfs.files()) {
    if (isUnder(path, "/.env") || wanted.has(path)) continue;
    // Tolerate a path that is already gone. `vfs.files()` and the `rm` that
    // follows are two round trips against a filesystem the host may also own
    // (hostDirectory, a remote VFS), and "the file I was about to delete is
    // deleted" is success, not a reason to abandon a restore half-done.
    if (!(await vfs.exists(path))) continue;
    await vfs.rm(path);
    touched.push(path);
    removed += 1;
  }
  for (const dir of snapshot.dirs) {
    if (!isUnder(dir, "/.env")) await vfs.mkdir(dir);
  }
  for (const file of snapshot.files) {
    const p = normalizePath(file.path);
    await vfs.write(p, base64ToBytes(file.data));
    touched.push(p);
  }
  return { restored: snapshot.files.length, removed, touched };
}

export async function listBranches(vfs: Vfs): Promise<BranchInfo[]> {
  if (!(await vfs.exists(BRANCH_DIR))) return [];
  const out: BranchInfo[] = [];
  for (const entry of await vfs.list(BRANCH_DIR)) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const name = entry.name.slice(0, -".json".length);
    try {
      const stored = JSON.parse(new TextDecoder().decode(await vfs.read(`${BRANCH_DIR}/${entry.name}`))) as StoredBranch;
      out.push({
        name,
        files: stored.snapshot.files.length,
        bytes: stored.snapshot.files.reduce((n, f) => n + base64ToBytes(f.data).byteLength, 0),
        created: stored.created,
      });
    } catch {
      // A corrupt checkpoint should not stop the others being listed.
      out.push({ name, files: 0, bytes: 0, created: "(unreadable)" });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function dropBranch(vfs: Vfs, name: string): Promise<void> {
  await readBranch(vfs, name); // for the "no such checkpoint" message
  await vfs.rm(branchPath(name));
}
