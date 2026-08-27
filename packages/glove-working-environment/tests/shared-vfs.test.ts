/**
 * The working environment no longer owns a private filesystem — it takes a
 * `glove-vfs` tree, which is the same tree the memory resource store and the
 * REPL functions act on. These tests hold that seam: a composed, guarded,
 * metadata-bearing tree has to work as the environment's `filesystem`, and
 * what a script writes has to be visible from outside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  inMemoryFs,
  mountFs,
  toBytes,
  toText,
  withAccess,
  withMeta,
  fromSnapshot,
  type Vfs,
} from "glove-vfs";
import { fsFns } from "glove-vfs/fns";
import { vfsResources } from "glove-vfs/resources";

import { createWorkingEnvironment } from "../src/index";
import { callErr, callOk } from "./helpers";

test("the environment runs on a composed glove-vfs tree", async () => {
  const shared = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/memory", fs: inMemoryFs() },
  ]);
  const env = await createWorkingEnvironment({ filesystem: shared, execution: { size: 1 } });
  try {
    await callOk(env, "write_file", { path: "/out/report.md", content: "# Report" });
    // Visible on the raw tree, at the same path, with no export step.
    assert.equal(toText(await shared.read("/out/report.md")), "# Report");
  } finally {
    await env.close();
  }
});

test("a script's output is immediately a memory resource", async () => {
  const shared = withMeta(
    mountFs([
      { at: "/", fs: inMemoryFs() },
      { at: "/memory", fs: inMemoryFs() },
    ]),
    { lexical: true },
  );
  const resources = vfsResources(shared, { schema: {}, root: "/memory" });
  const env = await createWorkingEnvironment({ filesystem: shared, execution: { size: 1 } });

  try {
    await callOk(env, "write_file", {
      path: "/memory/notes/findings.md",
      content: "Revenue is up.",
    });

    const file = await resources.read("/memory/notes/findings.md", { range: [1, -1] });
    assert.equal((file.body as { text: string }).text, "Revenue is up.");

    const hits = await resources.searchSemantic!("revenue");
    assert.deepEqual(
      hits.map((h) => h.path),
      ["/memory/notes/findings.md"],
    );
  } finally {
    await env.close();
  }
});

test("the REPL functions see what the environment wrote", async () => {
  const shared = mountFs([{ at: "/", fs: inMemoryFs() }]);
  const fns = fsFns(shared);
  const env = await createWorkingEnvironment({ filesystem: shared, execution: { size: 1 } });

  try {
    await callOk(env, "write_file", { path: "/out/a.txt", content: "hello" });
    const read = fns.find((f) => f.name === "fs__read")!;
    assert.equal(await read.call({ path: "/out/a.txt" }), "hello");

    const write = fns.find((f) => f.name === "fs__write")!;
    await write.call({ path: "/tmp/from-repl.txt", content: "repl" });
    assert.match(await callOk(env, "read_file", { path: "/tmp/from-repl.txt" }), /repl/);
  } finally {
    await env.close();
  }
});

test("a filesystem-level access policy binds the environment's own verbs", async () => {
  const shared: Vfs = withAccess(mountFs([{ at: "/", fs: inMemoryFs() }]), {
    rules: [{ path: "/corpus", access: "read", note: "curated upstream" }],
  });
  const env = await createWorkingEnvironment({ filesystem: shared, execution: { size: 1 } });

  try {
    assert.match(await callErr(env, "write_file", { path: "/corpus/x.md", content: "nope" }), /read-only|curated upstream/);
  } finally {
    await env.close();
  }
});

test("the environment's snapshot still round-trips on a shared tree", async () => {
  const shared = mountFs([{ at: "/", fs: inMemoryFs() }]);
  const env = await createWorkingEnvironment({ filesystem: shared, execution: { size: 1 } });
  try {
    await callOk(env, "write_file", { path: "/out/a.txt", content: "persisted" });
    const snap = await env.snapshot();
    assert.ok(snap.files.some((f) => f.path === "/out/a.txt"));

    const restored = await createWorkingEnvironment({ filesystem: fromSnapshot(snap), execution: { size: 1 } });
    try {
      assert.match(await callOk(restored, "read_file", { path: "/out/a.txt" }), /persisted/);
    } finally {
      await restored.close();
    }
  } finally {
    await env.close();
  }
});

test("a raw byte write outside the environment is picked up by its verbs", async () => {
  const shared = mountFs([{ at: "/", fs: inMemoryFs() }]);
  const env = await createWorkingEnvironment({ filesystem: shared, execution: { size: 1 } });
  try {
    await shared.write("/inbox/dropped.txt", toBytes("from the host"));
    assert.match(await callOk(env, "ls", { path: "/inbox" }), /dropped\.txt/);
  } finally {
    await env.close();
  }
});
