import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryVideoAssetStore,
  InMemoryVideoFlowStore,
  InMemoryVideoLibrary,
  InMemoryVideoReviewStore,
} from "../src/in-memory/index";

test("in-memory video asset store isolates bytes and filters metadata", async () => {
  const store = new InMemoryVideoAssetStore();
  const bytes = new Uint8Array([1, 2, 3]);
  const value = await store.put(bytes, {
    name: "Hero Clip",
    mime: "video/mp4",
    width: 1920,
    height: 1080,
    duration: 6,
    source: "generated",
    tags: ["hero", "night"],
  });
  bytes[0] = 9;
  const read = await store.bytes(value.id);
  assert.equal(read[0], 1);
  read[0] = 7;
  assert.equal((await store.bytes(value.id))[0], 1);
  assert.equal((await store.list({ tags: ["hero"], name_contains: "clip" })).length, 1);
  assert.equal((await store.list({ source: "imported" })).length, 0);
  await store.remove(value.id);
  await assert.rejects(store.bytes(value.id), /not found/);
});

test("in-memory library and flow store return defensive copies", async () => {
  const library = new InMemoryVideoLibrary();
  await library.saveCharacter({
    name: "mira",
    appearance: "a sky courier in a blue jacket",
    created_at: "a",
    updated_at: "b",
  });
  const character = await library.getCharacter("mira");
  character!.appearance = "changed";
  assert.match((await library.getCharacter("mira"))!.appearance, /sky courier/);

  const flows = new InMemoryVideoFlowStore();
  await flows.saveFlow({
    name: "one",
    shots: [{ id: "a", intent: "x" }],
    created_at: "a",
    updated_at: "b",
  });
  const saved = await flows.getFlow("one");
  saved!.shots[0]!.intent = "changed";
  assert.equal((await flows.getFlow("one"))!.shots[0]!.intent, "x");
});

test("in-memory review store keeps ordered, defensive review history", async () => {
  const reviews = new InMemoryVideoReviewStore();
  const base = {
    asset: "vid_one",
    score: 70,
    brief: "one bird",
    summary: "needs work",
    strengths: [],
    issues: [],
    reviewer: "reviewer",
    created_at: "a",
  };
  await reviews.save({ ...base, id: "vrev_1", decision: "revise" });
  await reviews.save({ ...base, id: "vrev_2", decision: "pass", score: 90, created_at: "b" });
  const latest = await reviews.latest("vid_one");
  assert.equal(latest?.id, "vrev_2");
  latest!.summary = "mutated";
  assert.equal((await reviews.latest("vid_one"))?.summary, "needs work");
  assert.equal((await reviews.list("vid_one")).length, 2);
});
