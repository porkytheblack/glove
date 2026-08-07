// A 5-second answer to "Gemini connects but nothing happens".
//
//   pnpm probe:gemini
//
// Drives the EXACT path the room drives — the real front agent, its real
// tools, `RealtimeAgent` deriving the session from the model slot — minus
// the microphone, and prints what the provider says back. The close reason
// is where the diagnosis lives: Gemini validates the setup frame strictly
// and rejects the whole session over a single unsupported schema key, which
// from the outside looks like silence rather than an error.

import "../lib/load-env";
import { MemoryStore } from "glove-core";
import { RealtimeAgent, listGeminiLiveModels } from "glove-voice-s2s";
import { buildS2SFrontAgent } from "../lib/s2s-front-agent";

const apiKey = process.env.GEMINI_API_KEY ?? "";
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set — put it in .env.local (see .env.example).");
  process.exit(1);
}

/** What THIS key can actually open a Live session with, and from where. */
async function reportAvailableModels(): Promise<void> {
  const models = await listGeminiLiveModels({ apiKey });
  if (models.length === 0) {
    console.log(
      "\nNo models on this key report bidiGenerateContent support on either\n" +
        "v1beta or v1alpha — which usually means the key itself lacks Live access.",
    );
    return;
  }
  console.log("\nModels THIS key can open a Live session with:\n");
  for (const m of models) {
    console.log(`  S2S_MODEL=${m.name}${m.apiVersion === "v1beta" ? "" : `  S2S_API_VERSION=${m.apiVersion}`}`);
  }
  console.log("\n(Copy one of those lines into .env.local.)");
}

if (process.argv.includes("--list")) {
  await reportAvailableModels();
  process.exit(0);
}

const agent = buildS2SFrontAgent(new MemoryStore("probe"), {
  provider: "gemini",
  apiKey,
  ...(process.env.S2S_MODEL ? { model: process.env.S2S_MODEL } : {}),
  ...(process.env.S2S_VOICE ? { voice: process.env.S2S_VOICE } : {}),
});
const rt = new RealtimeAgent({
  agent,
  excludeTools: ["glove_mesh_broadcast", "glove_mesh_acknowledge"],
});

console.log(
  `probing gemini with ${rt.exposedTools.length} tools: ` +
    `${rt.exposedTools.map((t) => t.name).join(", ")}\n`,
);

let samples = 0;
let transcript = "";
rt.adapter.on("error", (err) => console.error(`✗ ${err.message}`));
rt.adapter.on("audio", (pcm) => void (samples += pcm.length));
rt.adapter.on("disconnected", () => console.log("· socket closed"));
rt.on("error", (err) => console.error(`✗ agent: ${err.message}`));
rt.on("agent_delta", (text) => void (transcript += text));

await rt.start();
console.log("· session started");

// Text in, audio out — the same round trip as a spoken turn, minus the mic.
rt.inject("Say hello in exactly three words.", { respond: true });

await new Promise((r) => setTimeout(r, 8_000));
await rt.stop().catch(() => {});

console.log("");
if (samples > 0) {
  console.log(
    `✓ WORKING — ${samples} audio samples back` +
      (transcript ? `, transcript: "${transcript.trim()}"` : ""),
  );
  process.exit(0);
}
console.log(
  "✗ NO AUDIO CAME BACK.\n" +
    "  If an error printed above, that IS the diagnosis — a rejected setup frame\n" +
    "  (bad model id, wrong API version, unsupported tool-schema keys, bad key)\n" +
    "  closes the session and leaves every call silent.",
);
// "not found for API version …" has three different causes the message can't
// tell apart — so answer it from the key itself rather than leaving a guess.
await reportAvailableModels().catch(() => {});
process.exit(1);
