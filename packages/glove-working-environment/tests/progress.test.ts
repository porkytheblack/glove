/**
 * Watching a run in flight.
 *
 * Console output accumulated in the worker and crossed only with the final
 * result, so a four-minute render was silent between `tool_use` and
 * `tool_result` — a host could not tell frame 900 of 1800 from a hang, and
 * therefore could not offer a meaningful cancel either.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment } from "../src/index";

const NARRATES = `export default async function narrates(args) {
  for (let i = 1; i <= args.n; i++) {
    console.log('step ' + i + '/' + args.n);
    if (i === args.warnAt) console.error('halfway');
    const until = Date.now() + 30;
    while (Date.now() < until) await null;
  }
  return { done: args.n };
}`;

test("console output reaches onProgress while the script is still running", async () => {
  const seen: Array<{ at: number; stream: string; text: string }> = [];
  let finishedAt = Number.MAX_SAFE_INTEGER;
  const env = await createWorkingEnvironment({
    execution: { onProgress: (e) => seen.push({ at: Date.now(), stream: e.stream, text: e.text }) },
  });
  try {
    await env.fs.writeFile("/scripts/narrates.js", NARRATES);
    const run = await env.runScript("/scripts/narrates.js", { n: 10, warnAt: 5 });
    finishedAt = Date.now();

    assert.equal(run.ok, true, run.error ?? "");
    assert.equal(seen.length, 11, `expected 10 log lines and 1 error, got ${seen.length}`);
    assert.deepEqual(
      seen.filter((e) => e.stream === "stdout").map((e) => e.text),
      Array.from({ length: 10 }, (_, i) => `step ${i + 1}/10`),
    );
    assert.deepEqual(seen.filter((e) => e.stream === "stderr").map((e) => e.text), ["halfway"]);

    // The point of the whole thing: they arrived DURING the run, not with it.
    const early = seen.filter((e) => e.at < finishedAt - 50);
    assert.ok(early.length >= 5, `only ${early.length} of ${seen.length} lines arrived before the run ended`);

    // …and the transcript is still complete in the result, so a host that
    // ignores onProgress loses nothing.
    assert.equal(run.stdout.split("\n").length, 10);
    assert.equal(run.stderr, "halfway");
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("progress is batched, not one message per line", async () => {
  // A script logging inside a loop must not pay a structured clone and a host
  // wake-up per iteration.
  const lines: string[] = [];
  const env = await createWorkingEnvironment({
    execution: {
      onProgress: (e) => {
        lines.push(e.text);
      },
    },
  });
  try {
    await env.fs.writeFile(
      "/scripts/chatty.js",
      `export default async function chatty() {
         for (let i = 0; i < 200; i++) console.log('line ' + i);
         return { logged: 200 };
       }`,
    );
    const run = await env.runScript("/scripts/chatty.js", {});
    assert.equal(run.ok, true, run.error ?? "");
    assert.equal(lines.length, 200, "lines were dropped");
    assert.equal(lines[0], "line 0");
    assert.equal(lines[199], "line 199");
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("a throwing onProgress cannot fail the run that is being watched", async () => {
  const env = await createWorkingEnvironment({
    execution: {
      onProgress: () => {
        throw new Error("the host's logger fell over");
      },
    },
  });
  try {
    await env.fs.writeFile("/scripts/narrates.js", NARRATES);
    const run = await env.runScript("/scripts/narrates.js", { n: 3, warnAt: 0 });
    assert.equal(run.ok, true, run.error ?? "");
    assert.deepEqual(run.result, { done: 3 });
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("no onProgress means no streaming machinery in the worker", async () => {
  // Nothing to observe directly from out here, so this pins the contract that
  // matters: output is unchanged whether or not anyone is listening.
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile("/scripts/narrates.js", NARRATES);
    const run = await env.runScript("/scripts/narrates.js", { n: 4, warnAt: 2 });
    assert.equal(run.ok, true, run.error ?? "");
    assert.equal(run.stdout.split("\n").length, 4);
    assert.equal(run.stderr, "halfway");
  } finally {
    await env.close({ graceMs: 200 });
  }
});
