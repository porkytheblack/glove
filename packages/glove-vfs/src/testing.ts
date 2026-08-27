/**
 * Conformance suite for {@link Vfs} implementations.
 *
 * The contract is nine methods, which sounds too small to get wrong, and
 * isn't: the interesting cases are the ones a backend never hits until a real
 * agent finds them — writing through a path whose parent is a file, listing a
 * directory that only exists because something below it does, `rm` of a
 * subtree, and the byte accounting a storage budget depends on. A backend
 * that passes this behaves like every other one, which is the whole premise
 * of a shared tree.
 *
 * ```ts
 * test("my backend", async () => {
 *   await runVfsConformance(() => myBackend());
 * });
 * ```
 */
import { toBytes, toText, type Vfs } from "./types";

export class ConformanceError extends Error {
  constructor(
    readonly check: string,
    detail: string,
  ) {
    super(`vfs conformance — ${check}: ${detail}`);
  }
}

export interface ConformanceOptions {
  /** Skip checks a backend legitimately cannot satisfy (e.g. a read-only tree). */
  skip?: string[];
}

/**
 * Run every check against a fresh tree from `make`. Resolves with the names
 * of the checks that passed; throws {@link ConformanceError} on the first
 * failure, naming the check and what it saw.
 */
export async function runVfsConformance(
  make: () => Vfs | Promise<Vfs>,
  options: ConformanceOptions = {},
): Promise<string[]> {
  const skip = new Set(options.skip ?? []);
  const passed: string[] = [];

  const check = async (name: string, fn: (vfs: Vfs) => Promise<void>): Promise<void> => {
    if (skip.has(name)) return;
    const vfs = await make();
    try {
      await fn(vfs);
    } catch (e) {
      if (e instanceof ConformanceError) throw e;
      throw new ConformanceError(name, e instanceof Error ? e.message : String(e));
    }
    passed.push(name);
  };

  const fail = (name: string, detail: string): never => {
    throw new ConformanceError(name, detail);
  };

  await check("round-trips bytes", async (vfs) => {
    await vfs.write("/a.txt", toBytes("hello"));
    const got = toText(await vfs.read("/a.txt"));
    if (got !== "hello") fail("round-trips bytes", `read back ${JSON.stringify(got)}`);
  });

  await check("creates parent directories on write", async (vfs) => {
    await vfs.write("/deep/nested/file.txt", toBytes("x"));
    const stat = await vfs.stat("/deep/nested");
    if (stat?.kind !== "dir") fail("creates parent directories on write", `/deep/nested stat is ${JSON.stringify(stat)}`);
    if (!(await vfs.exists("/deep"))) fail("creates parent directories on write", "/deep does not exist");
  });

  await check("normalizes paths", async (vfs) => {
    await vfs.write("/a/b.txt", toBytes("1"));
    if (toText(await vfs.read("/a//b.txt")) !== "1") fail("normalizes paths", "/a//b.txt did not resolve");
    if (toText(await vfs.read("/a/./b.txt")) !== "1") fail("normalizes paths", "/a/./b.txt did not resolve");
    if (toText(await vfs.read("/a/c/../b.txt")) !== "1") fail("normalizes paths", "/a/c/../b.txt did not resolve");
  });

  await check("refuses paths escaping the root", async (vfs) => {
    let threw = false;
    try {
      await vfs.read("/../etc/passwd");
    } catch {
      threw = true;
    }
    if (!threw) fail("refuses paths escaping the root", "/../etc/passwd resolved instead of throwing");
  });

  await check("overwrites in place", async (vfs) => {
    await vfs.write("/a.txt", toBytes("first"));
    await vfs.write("/a.txt", toBytes("second"));
    if (toText(await vfs.read("/a.txt")) !== "second") fail("overwrites in place", "content did not change");
    const files = await vfs.files();
    if (files.filter((f) => f === "/a.txt").length !== 1) fail("overwrites in place", `duplicate entries: ${files}`);
  });

  await check("lists immediate children only", async (vfs) => {
    await vfs.write("/dir/one.txt", toBytes("1"));
    await vfs.write("/dir/sub/two.txt", toBytes("2"));
    const names = (await vfs.list("/dir")).map((e) => `${e.kind}:${e.name}`).sort();
    if (names.join(",") !== "dir:sub,file:one.txt") fail("lists immediate children only", names.join(","));
  });

  await check("removes a file", async (vfs) => {
    await vfs.write("/a.txt", toBytes("x"));
    await vfs.rm("/a.txt");
    if (await vfs.exists("/a.txt")) fail("removes a file", "still exists after rm");
  });

  await check("removes a directory recursively", async (vfs) => {
    await vfs.write("/dir/one.txt", toBytes("1"));
    await vfs.write("/dir/sub/two.txt", toBytes("2"));
    await vfs.rm("/dir");
    const left = (await vfs.files()).filter((f) => f.startsWith("/dir"));
    if (left.length) fail("removes a directory recursively", `left behind: ${left.join(", ")}`);
  });

  await check("stat distinguishes files from directories", async (vfs) => {
    await vfs.write("/dir/a.txt", toBytes("abc"));
    const file = await vfs.stat("/dir/a.txt");
    if (file?.kind !== "file" || file.size !== 3) fail("stat distinguishes files from directories", JSON.stringify(file));
    if ((await vfs.stat("/dir"))?.kind !== "dir") fail("stat distinguishes files from directories", "/dir is not a dir");
    if ((await vfs.stat("/nope")) !== null) fail("stat distinguishes files from directories", "missing path is not null");
  });

  await check("mkdir creates an empty directory", async (vfs) => {
    await vfs.mkdir("/empty");
    if ((await vfs.stat("/empty"))?.kind !== "dir") fail("mkdir creates an empty directory", "not a directory");
    if ((await vfs.list("/empty")).length !== 0) fail("mkdir creates an empty directory", "not empty");
  });

  await check("files() returns sorted file paths only", async (vfs) => {
    await vfs.mkdir("/z-empty");
    await vfs.write("/b.txt", toBytes("b"));
    await vfs.write("/a/c.txt", toBytes("c"));
    const files = await vfs.files();
    if (files.some((f) => f === "/z-empty")) fail("files() returns sorted file paths only", "a directory was listed");
    if ([...files].sort().join(",") !== files.join(",")) fail("files() returns sorted file paths only", "not sorted");
  });

  await check("totalSize tracks writes and removals", async (vfs) => {
    const start = await vfs.totalSize();
    await vfs.write("/a.bin", new Uint8Array(10));
    const grown = await vfs.totalSize();
    if (grown !== start + 10) fail("totalSize tracks writes and removals", `expected ${start + 10}, got ${grown}`);
    await vfs.write("/a.bin", new Uint8Array(4));
    if ((await vfs.totalSize()) !== start + 4) {
      fail("totalSize tracks writes and removals", `overwrite left ${await vfs.totalSize()}`);
    }
    await vfs.rm("/a.bin");
    if ((await vfs.totalSize()) !== start) fail("totalSize tracks writes and removals", `rm left ${await vfs.totalSize()}`);
  });

  await check("refuses to write through a file", async (vfs) => {
    await vfs.write("/a.txt", toBytes("x"));
    let threw = false;
    try {
      await vfs.write("/a.txt/child.txt", toBytes("y"));
    } catch {
      threw = true;
    }
    if (!threw) fail("refuses to write through a file", "/a.txt/child.txt was accepted");
  });

  await check("reading a missing path throws", async (vfs) => {
    let threw = false;
    try {
      await vfs.read("/nope.txt");
    } catch {
      threw = true;
    }
    if (!threw) fail("reading a missing path throws", "resolved instead");
  });

  await check("preserves binary content", async (vfs) => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    await vfs.write("/blob.bin", bytes);
    const got = await vfs.read("/blob.bin");
    if (got.byteLength !== bytes.byteLength || bytes.some((b, i) => got[i] !== b)) {
      fail("preserves binary content", `got ${[...got].join(",")}`);
    }
  });

  return passed;
}
