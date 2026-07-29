// Does the neural VAD load, and does it tell speech from noise?
//
//   pnpm tsx scripts/vad-check.ts
//
// Speech is synthesized rather than recorded: a voiced excitation (glottal
// pulse train at ~120Hz) shaped by three formants, which is close enough to a
// vowel for Silero to score it as speech. The negative controls are the two
// things an ENERGY VAD gets wrong — loud broadband noise (which it calls
// speech) and a quiet talker (which it calls silence).

import "../lib/load-env";
import { SileroVADNode } from "../lib/silero-vad-node";

const SR = 16_000;

/** A vowel-ish sound: pulse train through three formant resonators. */
function vowel(seconds: number, gain = 0.3): Int16Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const period = Math.round(SR / 120); // 120Hz pitch
  for (let i = 0; i < n; i++) out[i] = i % period === 0 ? 1 : 0;

  for (const [f, bw] of [
    [700, 80],
    [1220, 90],
    [2600, 120],
  ]) {
    const r = Math.exp((-Math.PI * bw) / SR);
    const c = 2 * r * Math.cos((2 * Math.PI * f) / SR);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = out[i] + c * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round((out[i] / (peak || 1)) * gain * 32767);
  return pcm;
}

function noise(seconds: number, gain = 0.3): Int16Array {
  const n = Math.floor(SR * seconds);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round((Math.random() * 2 - 1) * gain * 32767);
  return pcm;
}

function silence(seconds: number): Int16Array {
  return new Int16Array(Math.floor(SR * seconds));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Feed a clip in 20ms chunks, as the client does, and report peak probability. */
async function feed(vad: SileroVADNode, pcm: Int16Array): Promise<number> {
  let peak = 0;
  const onProb = (p: number) => {
    peak = Math.max(peak, p);
  };
  vad.on("speech_prob", onProb);
  for (let i = 0; i + 320 <= pcm.length; i += 320) {
    vad.process(pcm.subarray(i, i + 320));
    await sleep(20); // realtime: 320 samples IS 20ms of audio
  }
  await sleep(120);
  vad.off("speech_prob", onProb);
  return peak;
}

const vad = new SileroVADNode();
const t0 = Date.now();
await vad.init();
console.log(`Silero loaded in ${Date.now() - t0}ms\n`);

const events: string[] = [];
vad.on("speech_start", () => events.push("speech_start"));
vad.on("speech_real_start", () => events.push("speech_real_start"));
vad.on("speech_end", () => events.push("speech_end"));
vad.on("vad_misfire", () => events.push("vad_misfire"));

const loudVowel = await feed(vad, vowel(1.0, 0.3));
await feed(vad, silence(0.8));
console.log(`speech (normal)  peak P=${loudVowel.toFixed(3)}  events: ${events.join(" → ") || "none"}`);

events.length = 0;
vad.reset();
const quietVowel = await feed(vad, vowel(1.0, 0.04)); // a soft talker
await feed(vad, silence(0.8));
console.log(`speech (quiet)   peak P=${quietVowel.toFixed(3)}  events: ${events.join(" → ") || "none"}`);

events.length = 0;
vad.reset();
const loudNoise = await feed(vad, noise(1.0, 0.3)); // loud but not speech
await feed(vad, silence(0.8));
console.log(`noise  (loud)    peak P=${loudNoise.toFixed(3)}  events: ${events.join(" → ") || "none"}`);

// ── the state machine, independent of the model's opinion ──────────────────
// The synthetic vowel above is static in a way real speech never is, so Silero
// only crosses the threshold intermittently and the run reads as a misfire.
// That says nothing about whether the tentative → confirmed → end sequence is
// wired correctly, so drive the state machine with probabilities directly.
events.length = 0;
vad.reset();
const sm = vad as unknown as { onProbability(p: number): void };
for (let i = 0; i < 20; i++) sm.onProbability(0.9); // sustained speech
for (let i = 0; i < 20; i++) sm.onProbability(0.1); // then silence
console.log(`\nstate machine (sustained speech → silence): ${events.join(" → ")}`);
const sequenceOk =
  events.join(",") === "speech_start,speech_real_start,speech_end";

events.length = 0;
vad.reset();
for (let i = 0; i < 2; i++) sm.onProbability(0.9); // a burst too short to count
for (let i = 0; i < 20; i++) sm.onProbability(0.1);
console.log(`state machine (short burst):                 ${events.join(" → ")}`);
const misfireOk = events.join(",") === "speech_start,vad_misfire";

const speechDetected = loudVowel > 0.5;
const quietDetected = quietVowel > 0.5;
const noiseRejected = loudNoise < 0.5;

console.log(
  `\nspeech detected: ${speechDetected} | quiet speech detected: ${quietDetected} | loud noise rejected: ${noiseRejected}`,
);
console.log(`turn sequence correct: ${sequenceOk} | short burst retracted: ${misfireOk}`);
const ok = speechDetected && noiseRejected && sequenceOk && misfireOk;
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
