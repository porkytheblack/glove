import assert from "node:assert/strict";
import { createS2SAdapter, listGeminiLiveModels } from "glove-voice-s2s";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("verify:live requires GEMINI_API_KEY.");

const requested = (process.env.S2S_MODEL ?? "models/gemini-3.1-flash-live-preview").replace(/^models\//, "");
const models = await listGeminiLiveModels({ apiKey });
const available = models.find((model) => model.name === requested);
assert.ok(
  available,
  `${requested} is not available to this key. Live models: ${models.map((item) => `${item.name} (${item.apiVersion})`).join(", ") || "none"}`,
);

const adapter = createS2SAdapter({
  provider: "gemini",
  apiKey,
  model: `models/${available.name}`,
  apiVersion: available.apiVersion,
  voice: "Puck",
});
const errors: Error[] = [];
adapter.on("error", (error) => errors.push(error));
await adapter.connect({ instructions: "This is a connection test. Do not speak unless prompted.", tools: [] });
await new Promise((resolve) => setTimeout(resolve, 1_000));
await adapter.disconnect();
assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));

process.stdout.write(`Gemini Live smoke check passed with ${available.name} on ${available.apiVersion}.\n`);
