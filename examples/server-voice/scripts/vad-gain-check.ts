// At what level does Silero stop hearing a real interruption?
//
//   pnpm tsx scripts/vad-gain-check.ts
//
// The barge-in sim streams full-amplitude speech and passes; a browser does
// not. While the agent's audio is playing, the browser's echo canceller ducks
// the near-end microphone too — the caller's interruption reaches the room at
// a fraction of its true level. This measures exactly how much attenuation the
// VAD tolerates before `speech_real_start` (the barge-in trigger) stops firing,
// using real synthesized speech rather than a synthetic vowel.

import "../lib/load-env";
import { SileroVADNode } from "../lib/silero-vad-node";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY not set");

const VOICE = "JBFqnCBsd6RMkjVDRZzb";

async function speech(text: string): Promise<Int16Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_16000`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

function scaled(pcm: Int16Array, gain: number): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.round(pcm[i] * gain);
  return out;
}

function rms(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pcm = await speech("Hey, hold on a second, stop right there.");
console.log(`${(pcm.length / 16000).toFixed(2)}s of speech\n`);
console.log("gain   rms      peakP   confirmed  (speech_real_start = barge-in trigger)");

for (const gain of [1.0, 0.5, 0.25, 0.12, 0.06, 0.03, 0.015]) {
  const vad = new SileroVADNode();
  await vad.init();
  let peak = 0;
  let confirmed = false;
  vad.on("speech_prob", (p: number) => {
    peak = Math.max(peak, p);
  });
  vad.on("speech_real_start", () => {
    confirmed = true;
  });
  const clip = scaled(pcm, gain);
  for (let i = 0; i + 320 <= clip.length; i += 320) {
    vad.process(clip.subarray(i, i + 320));
  }
  await sleep(300); // let the inference chain drain
  console.log(
    `${gain.toFixed(3)}  ${rms(clip).toFixed(4)}  ${peak.toFixed(3)}   ${confirmed ? "YES" : "no"}`,
  );
}
process.exit(0);
