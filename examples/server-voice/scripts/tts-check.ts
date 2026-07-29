// Isolate the TTS path: open a socket exactly as a room does, send a short
// line, flush, and report whether any audio comes back.
//
//   pnpm tsx scripts/tts-check.ts "some text"

import "../lib/load-env";
import { ElevenLabsTTSAdapter } from "glove-voice";
import { createElevenLabsTTSToken } from "glove-voice/server";

const TEXT = process.argv[2] ?? "Right here. What do you need?";
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(5)}ms`;

const tts = new ElevenLabsTTSAdapter({
  getToken: () => createElevenLabsTTSToken(apiKey),
  voiceId: process.env.VOICE_ID ?? "uYXf8XasLslADfZ2MB4u",
  model: process.env.TTS_MODEL ?? "eleven_flash_v2_5",
  outputFormat: "pcm_16000",
  // The same schedule the room uses — note the first threshold is 60 chars,
  // which is longer than plenty of real replies.
  generationConfig: { chunkLengthSchedule: [60, 120, 160, 250] },
});

let bytes = 0;
tts.on("audio_chunk", (c: Uint8Array) => {
  if (bytes === 0) console.log(`${at()} FIRST AUDIO`);
  bytes += c.byteLength;
});
tts.on("done", () => console.log(`${at()} done`));
tts.on("error", (e: Error) => console.log(`${at()} ERROR ${e.message}`));

await tts.open();
console.log(`${at()} open — sending ${TEXT.length} chars`);
tts.sendText(TEXT, { flush: false });
tts.flush();
console.log(`${at()} flushed (EOS)`);

await new Promise((r) => setTimeout(r, 12_000));
console.log(`\n${bytes} bytes of audio`);
console.log(bytes > 0 ? "PASS" : "FAIL — the socket produced no audio");
tts.destroy();
process.exit(bytes > 0 ? 0 : 1);
