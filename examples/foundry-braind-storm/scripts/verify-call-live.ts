import assert from "node:assert/strict";
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { RealtimeAgent, s2sDrivenModel } from "glove-voice-s2s";
import { briefingTools } from "../agents/briefing-line/briefing.tools.js";
import { readBriefingSnapshot, recordVoiceDirection } from "../agents/briefing-line/briefing-workspace.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("verify:call requires GEMINI_API_KEY.");

const stormId = `call-check-${Date.now()}`;
await recordVoiceDirection({
  stormId,
  direction: "The founding direction is to make the brand practical, exacting, and useful.",
  priority: "important",
  appliesTo: "the whole brand system",
});

const agent = new Glove({
  store: new MemoryStore(`braind-call-check:${stormId}`),
  model: s2sDrivenModel({
    label: "braind-storm-live-check",
    provider: "gemini",
    apiKey,
    model: process.env.S2S_MODEL ?? "models/gemini-3.1-flash-live-preview",
    voice: process.env.BRAIND_VOICE ?? "Kore",
    apiVersion: process.env.S2S_API_VERSION ?? "v1beta",
  }),
  displayManager: new Displaymanager(),
  systemPrompt: [
    "You are Mara Vale on a short automated verification call.",
    "Always use both tools requested by the caller before replying.",
    "Speak one concise sentence after the tools finish.",
  ].join("\n"),
  serverMode: true,
  compaction_config: { compaction_instructions: "Keep the current briefing and recorded direction." },
});
for (const tool of briefingTools(stormId)) agent.fold(tool);
const completedTools = new Set<string>();
const errors: Error[] = [];
let response = "";
const realtime = new RealtimeAgent({
  agent: agent.build(),
  onToolCall(name, phase) {
    if (phase === "done") completedTools.add(name);
  },
});
realtime.on("agent_said", (text) => { response = text; });
realtime.on("error", (error) => errors.push(error));

await realtime.start();
try {
  // Gemini resolves the WebSocket open before its setupComplete frame arrives.
  // Give the provider a brief setup window before sending the first turn.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  realtime.inject(
    "First call get_storm_briefing with headline detail. Then call record_direction with: Keep the launch voice plain-spoken and avoid futuristic language; priority important; applies to launch voice. Confirm when both are complete.",
    { respond: true },
  );
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && (completedTools.size < 2 || !response)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} finally {
  await realtime.stop().catch(() => undefined);
}

assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
assert.equal(completedTools.has("get_storm_briefing"), true, "Gemini Live did not retrieve the storm briefing.");
assert.equal(completedTools.has("record_direction"), true, "Gemini Live did not record caller direction.");
assert.ok(response.trim(), "Gemini Live completed the tools without a spoken response.");
const snapshot = await readBriefingSnapshot(stormId, "headline");
assert.equal(snapshot.recordedDirections.some((item) => item.includes("plain-spoken")), true);

process.stdout.write(`Braind Storm live briefing-line verification passed (${stormId}).\n`);
process.stdout.write(`Gemini Live invoked ${[...completedTools].join(" and ")} and returned a spoken confirmation.\n`);
