import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostDirectory, inMemoryFs, mountFs, withAccess, withMeta } from "../src/index";
import { runVfsConformance } from "../src/testing";

test("the in-memory backend is contract-conformant", async () => {
  const passed = await runVfsConformance(() => inMemoryFs());
  assert.ok(passed.length >= 15, `only ${passed.length} checks ran`);
});

test("a host directory overlay is contract-conformant", async () => {
  const roots: string[] = [];
  try {
    await runVfsConformance(async () => {
      const root = await mkdtemp(join(tmpdir(), "glove-vfs-"));
      roots.push(root);
      return hostDirectory(root);
    });
  } finally {
    for (const root of roots) await rmDir(root, { recursive: true, force: true });
  }
});

// Each wrapper is a Vfs in its own right, and a stack of them is where a
// contract quietly stops holding — so every layer runs the same suite.
test("a mounted tree is contract-conformant", async () => {
  await runVfsConformance(() => mountFs([{ at: "/", fs: inMemoryFs() }]));
});

test("a mounted tree with a nested mount is contract-conformant", async () => {
  await runVfsConformance(() =>
    mountFs([
      { at: "/", fs: inMemoryFs() },
      { at: "/memory", fs: inMemoryFs() },
    ]),
  );
});

test("an access-guarded tree is contract-conformant when everything is granted", async () => {
  await runVfsConformance(() => withAccess(inMemoryFs(), { default: "write" }));
});

test("a metadata-bearing tree is contract-conformant", async () => {
  await runVfsConformance(() => withMeta(inMemoryFs()));
});

test("the whole stack together is contract-conformant", async () => {
  await runVfsConformance(() =>
    withAccess(
      withMeta(
        mountFs([
          { at: "/", fs: inMemoryFs() },
          { at: "/memory", fs: inMemoryFs() },
        ]),
        { lexical: true },
      ),
      { default: "write", rules: [{ path: "/corpus", access: "read" }] },
    ),
  );
});
