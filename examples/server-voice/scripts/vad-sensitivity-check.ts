// At what speaking level does each threshold start hearing you?
//
//   pnpm tsx scripts/vad-sensitivity-check.ts
//
// "I have to shout" is a threshold problem, not a bug. Silero's recommended
// 0.5 assumes a quiet room and a close mic; outdoors or across a desk, ordinary
// speech scores under it. This sweeps real synthesized speech down through
// quieter levels and reports the quietest one each threshold still CONFIRMS —
// confirmation being what actually commits a turn.

import "../lib/load-env";
import { SileroVADNode } from "../lib/silero-vad-node";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY not set");

const res = await fetch(
  "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=pcm_16000",
  {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "How much does the Kestrel cost?",
      model_id: "eleven_flash_v2_5",
    }),
  },
);
if (!res.ok) throw new Error(`TTS ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const speech = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quieter speech buried in room noise — what being outdoors actually does. */
function at(gain: number, noise: number): Int16Array {
  const out = new Int16Array(speech.length);
  for (let i = 0; i < speech.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767,
      Math.round(speech[i] * gain + (Math.random() * 2 - 1) * noise * 32767)));
  }
  return out;
}

async function confirms(pcm: Int16Array, positive: number, negative: number): Promise<boolean> {
  const vad = new SileroVADNode({
    positiveSpeechThreshold: positive,
    negativeSpeechThreshold: negative,
  });
  await vad.init();
  let confirmed = false;
  vad.on("speech_real_start", () => { confirmed = true; });
  for (let i = 0; i + 320 <= pcm.length; i += 320) vad.process(pcm.subarray(i, i + 320));
  await sleep(400);
  return confirmed;
}

const LEVELS = [1.0, 0.5, 0.25, 0.12, 0.06, 0.03];
const NOISE = 0.004; // a plausible outdoor floor

console.log("speaking level →  0.50 (Silero default)   0.35 (our default)");
let bestOld = 0;
let bestNew = 0;
for (const gain of LEVELS) {
  const pcm = at(gain, NOISE);
  const oldT = await confirms(pcm, 0.5, 0.35);
  const newT = await confirms(pcm, 0.35, 0.25);
  if (oldT) bestOld = gain;
  if (newT) bestNew = gain;
  console.log(`  gain ${gain.toFixed(3)}  →       ${oldT ? "heard" : "  —  "}                ${newT ? "heard" : "  —  "}`);
}

console.log(`\nquietest heard — default 0.50: gain ${bestOld}, ours 0.35: gain ${bestNew}`);
const better = bestNew <= bestOld;
console.log(better ? "\nPASS — the lower threshold hears at least as quiet a talker" : "\nFAIL");
process.exit(better ? 0 : 1);
