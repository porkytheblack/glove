import assert from "node:assert/strict";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Displaymanager, Glove, MemoryStore, createAdapter } from "glove-core";
import { runStorm } from "../lib/workforce.js";

if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY before running verify:live.");
const stormId = `live-check-${Date.now()}`;
const lead = new Glove({
  store: new MemoryStore(`braind-live:${stormId}`),
  model: createAdapter({ provider: "gemini", model: process.env.BRAIND_TEXT_MODEL ?? "gemini-3.5-flash-lite", apiKey: process.env.GEMINI_API_KEY, stream: false, maxTokens: 12_000, reasoningEffort: "low" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are Mara Vale, a decisive brand lead. Synthesize the shared team's work and make a clear recommendation.",
  serverMode: true,
  compaction_config: { compaction_instructions: "Retain decisions and artifact paths." },
}).build();

const result = await runStorm(lead, {
  stormId,
  brief: "Create a confident brand and focused launch idea for Northstar, a privacy-first AI project room for independent architects. It should feel exacting and creative, not futuristic or corporate.",
  skillPacks: ["marketing"],
  generateImage: true,
  remoteSkills: false,
});

assert.match(result.reply, /Northstar|architect|brand/i);
assert.equal(result.activity.length, 5);
assert.equal(result.artifacts.some((artifact) => artifact.name === "brand-system.docx"), true);
assert.equal(result.artifacts.some((artifact) => artifact.name === "04-key-art.png" || artifact.name === "04-image-generation-note.md"), true);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".braind-storm", "workspaces", stormId, "out");
await access(resolve(root, "brand-system.docx"));
assert.ok((await stat(resolve(root, "brand-system.docx"))).size > 1_000);
if (result.imageGenerated) {
  assert.ok((await stat(resolve(root, "04-key-art.png"))).size > 10_000);
} else {
  assert.ok((await stat(resolve(root, "04-image-generation-note.md"))).size > 100);
}

process.stdout.write(`Braind Storm live verification passed (${stormId}).\n`);
process.stdout.write(`Generated ${result.artifacts.length} artifacts through ${result.activity.length} mesh handoffs, including a Word brand system${result.imageGenerated ? " and Gemini key art" : "; Gemini image rendering degraded cleanly because this key has no image quota"}.\n`);
