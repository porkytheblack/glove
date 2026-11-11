import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderTurnDetector, HeuristicTurnDetector } from "../src/turn-detector";
import { ElevenLabsSTTAdapter } from "../src/adapters/eleven-labs/stt";

console.debug = () => {};

const source = { turnProbability: null as number | null };
const detector = new ProviderTurnDetector({ source, inner: new HeuristicTurnDetector() });

test("no probability leaves the inner decision alone", async () => {
  source.turnProbability = null;
  assert.deepEqual(await detector.decide("I need the"), { holdMs: 900, reason: "unfinished" });
});

test("a confident end of turn shortens the hold", async () => {
  source.turnProbability = 0.95;
  const d = await detector.decide("I need the");
  assert.equal(d.holdMs, 400);
  assert.match(d.reason, /^turn-done:0\.95\|unfinished$/);
});

test("a confident end of turn keeps the dictation hold", async () => {
  source.turnProbability = 0.95;
  const d = await detector.decide("my code is 0-0-7");
  assert.equal(d.holdMs, 2000);
  assert.match(d.reason, /^dictation/);
});

test("an unfinished turn lengthens the hold", async () => {
  source.turnProbability = 0.05;
  const d = await detector.decide("Book the table.");
  assert.equal(d.holdMs, 1500);
  assert.match(d.reason, /^turn-wait:0\.05\|statement$/);
});

test("mid-range probability passes through, tagged", async () => {
  source.turnProbability = 0.5;
  assert.deepEqual(await detector.decide("Book the table."), { holdMs: 600, reason: "statement|turn:0.50" });
});

test("ElevenLabsSTTAdapter reports the latest turn probability until a commit", () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "t" });
  assert.equal(stt.turnProbability, null);
  stt.handleMessage({ message_type: "partial_transcript", text: "hi", turn_probability: 0.3 });
  stt.handleMessage({ message_type: "partial_transcript", text: "hi there", turn_probability: 0.92 });
  assert.equal(stt.turnProbability, 0.92);
  stt.handleMessage({ message_type: "committed_transcript", text: "Hi there." });
  assert.equal(stt.turnProbability, null);
});
