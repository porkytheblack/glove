import { test } from "node:test";
import assert from "node:assert/strict";
import type { VideoAsset } from "../src/core/index";
import {
  type VideoFlowDefinition,
  runVideoFlow,
  validateVideoFlow,
} from "../src/flows/index";
import { InMemoryVideoFlowStore } from "../src/in-memory/index";

function flow(): VideoFlowDefinition {
  return {
    name: "arrival",
    shots: [
      { id: "close", intent: "Close-up", depends_on: ["wide"] },
      { id: "wide", intent: "Wide establishing shot" },
      { id: "exit", intent: "Exit", continuity: { from: "close", mode: "extend" } },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function asset(id: string): VideoAsset {
  return {
    id,
    mime: "video/mp4",
    width: 1280,
    height: 720,
    duration: 5,
    source: "flow",
    created_at: "2026-01-01T00:00:00Z",
  };
}

test("validateVideoFlow returns stable topological order and catches invalid graphs", () => {
  assert.deepEqual(validateVideoFlow(flow()).map((shot) => shot.id), ["wide", "close", "exit"]);
  assert.throws(
    () => validateVideoFlow({ ...flow(), shots: [{ id: "a", intent: "x", depends_on: ["missing"] }] }),
    /unknown shot/,
  );
  assert.throws(
    () =>
      validateVideoFlow({
        ...flow(),
        shots: [
          { id: "a", intent: "x", depends_on: ["b"] },
          { id: "b", intent: "x", depends_on: ["a"] },
        ],
      }),
    /cycle/,
  );
});

test("runVideoFlow checkpoints each shot and passes dependency continuity", async () => {
  const store = new InMemoryVideoFlowStore();
  const order: string[] = [];
  const updates: string[] = [];
  const run = await runVideoFlow(
    flow(),
    store,
    async (shot, ctx) => {
      order.push(shot.id);
      if (shot.id === "exit") {
        assert.equal(ctx.continuityAsset, "out-close");
        assert.deepEqual(ctx.dependencies, { close: ["out-close"] });
      }
      return [asset(`out-${shot.id}`)];
    },
    {
      onUpdate: (state) => {
        updates.push(`${state.status}:${state.shots.map((item) => item.status).join(",")}`);
      },
    },
  );

  assert.equal(run.status, "succeeded");
  assert.deepEqual(order, ["wide", "close", "exit"]);
  assert.ok(updates.length >= 8);
  assert.deepEqual((await store.getRun(run.id))?.shots.map((item) => item.assets[0]), [
    "out-close",
    "out-wide",
    "out-exit",
  ]);
});

test("failed flows resume without repeating successful shots", async () => {
  const store = new InMemoryVideoFlowStore();
  let fail = true;
  const calls: string[] = [];
  const generate = async (shot: { id: string }) => {
    calls.push(shot.id);
    if (shot.id === "close" && fail) throw new Error("provider timeout");
    return [asset(`out-${shot.id}`)];
  };
  const first = await runVideoFlow(flow(), store, generate);
  assert.equal(first.status, "failed");
  assert.deepEqual(calls, ["wide", "close"]);

  fail = false;
  const resumed = await runVideoFlow(first.definition, store, generate, { runId: first.id });
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(calls, ["wide", "close", "close", "exit"]);
  assert.equal(resumed.shots.find((item) => item.shot === "wide")?.attempts, 1);
  assert.equal(resumed.shots.find((item) => item.shot === "close")?.attempts, 2);
});
