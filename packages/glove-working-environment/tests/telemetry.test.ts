/**
 * What a host needs to see, without reverse-engineering it from an example.
 *
 * Both examples in this repo hand-rolled the same two things: per-tool timing
 * measured in their own loop, and a hand-maintained list of which verb names
 * change the tree. That list is wrong twice over — it drifts the moment a verb
 * is added, and it ignores `toolsWithPrefix`, so a host that renamed the verbs
 * matches nothing at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment, defineAdapter } from "../src/index";
import { call, callOk } from "./helpers";

test("every verb declares whether it can change the tree", async () => {
  const env = await createWorkingEnvironment({ vision: { describe: async () => "a picture" }, onPresent: () => {} });
  try {
    const byName = new Map(env.tools.map((t) => [t.name, t.mutates]));
    for (const [verb, expected] of [
      ["write_file", true], ["edit_file", true], ["rm", true], ["mv", true], ["cp", true],
      ["run_script", true], ["run_tests", true], ["undo", true], ["redo", true], ["checkpoint", true],
      ["read_file", false], ["ls", false], ["grep", false], ["describe", false],
      ["history", false], ["diff", false], ["view_image", false], ["present", false],
    ] as const) {
      assert.equal(byName.get(verb), expected, `${verb}.mutates should be ${expected}`);
    }
    // And it survives renaming, which a name-matching list cannot.
    const prefixed = env.toolsWithPrefix("desk_");
    assert.equal(prefixed.find((t) => t.name === "desk_write_file")?.mutates, true);
    assert.equal(prefixed.find((t) => t.name === "desk_ls")?.mutates, false);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("onVerb reports duration and whether the tree really changed", async () => {
  const seen: Array<{ name: string; ok: boolean; durationMs: number; mutated: boolean }> = [];
  const env = await createWorkingEnvironment({ onVerb: (e) => seen.push(e) });
  try {
    await callOk(env, "write_file", { path: "/tmp/a.txt", content: "hello" });
    await callOk(env, "read_file", { path: "/tmp/a.txt" });
    await call(env, "rm", { path: "/tmp/nope.txt" });

    assert.deepEqual(
      seen.map((e) => [e.name, e.ok, e.mutated]),
      [
        ["write_file", true, true],
        ["read_file", true, false],
        ["rm", false, false], // failed, so nothing changed
      ],
    );
    for (const e of seen) assert.ok(e.durationMs >= 0 && e.durationMs < 30_000, `implausible duration ${e.durationMs}`);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("a run_script that only reads reports mutated:false", async () => {
  // The thing a name-based list cannot know, and the reason `mutated` is
  // measured rather than declared: a UI should not refresh its file tree
  // because a script happened to be run.
  const seen: Array<{ name: string; mutated: boolean }> = [];
  const env = await createWorkingEnvironment({ onVerb: (e) => seen.push({ name: e.name, mutated: e.mutated }) });
  try {
    await env.fs.writeFile("/inbox/data.txt", "rows");
    await env.fs.writeFile(
      "/scripts/reader.js",
      `export default async function reader() {
         const fs = await import('env:fs');
         return { length: (await fs.readFile('/inbox/data.txt')).length };
       }`,
    );
    await env.fs.writeFile(
      "/scripts/writer.js",
      `export default async function writer() {
         const fs = await import('env:fs');
         await fs.writeFile('/out/result.txt', 'done');
         return { wrote: true };
       }`,
    );
    seen.length = 0;

    await callOk(env, "run_script", { path: "/scripts/reader.js" });
    await callOk(env, "run_script", { path: "/scripts/writer.js" });

    assert.deepEqual(seen, [
      { name: "run_script", mutated: false },
      { name: "run_script", mutated: true },
    ]);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("a throwing onVerb cannot fail the verb it is watching", async () => {
  const env = await createWorkingEnvironment({
    onVerb: () => {
      throw new Error("the host's metrics client fell over");
    },
  });
  try {
    const out = await callOk(env, "write_file", { path: "/tmp/a.txt", content: "hi" });
    assert.match(out, /created \/tmp\/a\.txt/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("counters track limit hits, spillovers and mutations", async () => {
  const env = await createWorkingEnvironment({ limits: { maxFileBytes: 2_000, maxToolResponseBytes: 400, maxToolResponseLines: 10 } });
  try {
    assert.deepEqual(env.counters, { limitHits: 0, spillovers: 0, mutations: 0 });

    await env.fs.writeFile("/tmp/small.txt", "ok");
    assert.equal(env.counters.mutations, 1);

    await assert.rejects(() => env.fs.writeFile("/tmp/big.txt", "x".repeat(5_000)), /size limit exceeded/);
    assert.equal(env.counters.limitHits, 1, "a refused write did not count as a limit hit");

    await env.fs.writeFile(
      "/scripts/chatty.js",
      `export default async function chatty() {
         return { rows: Array.from({ length: 400 }, (_, i) => 'row ' + i + ' of a long result') };
       }`,
    );
    const out = await callOk(env, "run_script", { path: "/scripts/chatty.js" });
    assert.ok(env.counters.spillovers >= 1, "an oversized response did not count as a spillover");

    // …and the spill really landed. It used to refuse its own write on a
    // tight maxFileBytes — truncating to exactly the cap and then appending
    // its marker, counted in characters against a cap measured in bytes —
    // which told the model its output was too big to show AND too big to
    // save, the one outcome the mechanism exists to prevent.
    assert.doesNotMatch(out, /could not spill/);
    const spilled = await env.fs.glob("/tmp/run-*.out");
    assert.equal(spilled.length, 1, "no spill file was written");
    const size = (await env.fs.stat(spilled[0]))!.size;
    assert.ok(size > 0 && size <= 2_000, `spill file is ${size} bytes, over the 2000-byte cap`);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("close() releases adapters that hold something, and survives one that throws", async () => {
  // `env:motion` keeps a browser warm between renders. Without this hook the
  // only ways it comes back are an idle timer or process exit, so a host that
  // closes fifty environments in a loop is holding fifty browsers.
  let released = 0;
  const warnings: string[] = [];
  const holdsSomething = defineAdapter({
    name: "warm",
    description: "Pretends to hold a resource.",
    types: `export function ping(): Promise<string>;`,
    close: () => {
      released += 1;
    },
    create: () => ({ ping: async () => "pong" }),
  });
  const misbehaves = defineAdapter({
    name: "grumpy",
    description: "Fails to let go.",
    types: `export function ping(): Promise<string>;`,
    close: () => {
      throw new Error("could not release the handle");
    },
    create: () => ({ ping: async () => "pong" }),
  });

  const env = await createWorkingEnvironment({
    stdlib: [holdsSomething, misbehaves],
    execution: { onWarning: (m) => warnings.push(m) },
  });
  await env.close({ graceMs: 100 });

  assert.equal(released, 1, "close() did not release the adapter");
  assert.equal(
    warnings.filter((w) => w.includes('"grumpy" failed to close')).length,
    1,
    "a failing adapter close was not reported",
  );
});
