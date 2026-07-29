// Does a caller whose speech the VAD misses still get heard?
//
// The failure this guards against: freshness was measured from the VAD's
// verdict rather than from raw audio energy. Soft or distant speech that the
// energy VAD scored as silence produced no boundary, so the idle sweeper was
// the only thing left to commit the transcript — and the freshness gate then
// discarded it as a silence hallucination. The caller's real words never
// reached the agent: no answer, no delegation, no error.
//
// This drives the engine directly with a stub STT, feeding audio quiet enough
// to stay under the VAD threshold but loud enough to be obviously not silence.
//
//   pnpm tsx scripts/turn-engine-check.ts

import { EventEmitter } from "node:events";
import type { ElevenLabsSTTAdapter } from "glove-voice";
import { TurnEngine } from "../lib/turn-engine";

/** Stands in for Scribe: we drive its partials by hand. */
class StubSTT extends EventEmitter {
  currentPartial = "";
  flushed = 0;
  sendAudio(): void {}
  flushUtterance(): void {
    this.flushed++;
  }
  setPartial(text: string): void {
    this.currentPartial = text;
    this.emit("partial", text);
  }
}

/** RMS ≈ `level`, constant — no VAD-tripping transients. */
function frame(level: number): Int16Array {
  const pcm = new Int16Array(320);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(level * 32767 * (i % 2 ? 1 : -1));
  return pcm;
}

const stt = new StubSTT();
const utterances: string[] = [];
const dropped: string[] = [];

const engine = new TurnEngine({
  stt: stt as unknown as ElevenLabsSTTAdapter,
  detector: { decide: async () => ({ holdMs: 0, reason: "test" }) },
  hooks: {
    onUtterance: (t) => utterances.push(t),
    onPartial: () => {},
    onTranscriptCorrection: () => {},
    onBargeIn: () => {},
    onSpeechLikely: () => {},
    isAgentSpeaking: () => false,
    getTurnContext: () => [],
    onMetric: (name, _ms, data) => {
      if (name === "stt_phantom_dropped") dropped.push(String(data?.text ?? ""));
    },
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Soft speech: above the energy floor (0.004), below the VAD threshold (0.006),
// so no speech_start / speech_end ever fires.
console.log("feeding 1.5s of sub-threshold audio (the VAD will not fire)…");
for (let i = 0; i < 75; i++) {
  engine.processAudio(frame(0.005));
  await sleep(20);
}
console.log(`VAD saw speech: ${engine.isUserSpeaking} (expected false)`);

stt.setPartial("Nova, is hull KES-0007 still under warranty?");

// Let the idle sweeper run: it needs the transcript still for >1.2s.
await sleep(2200);

console.log(`\ndispatched : ${utterances.length ? JSON.stringify(utterances) : "(nothing)"}`);
console.log(`dropped    : ${dropped.length ? JSON.stringify(dropped) : "(nothing)"}`);

engine.dispose();
const ok = utterances.length === 1 && dropped.length === 0;
console.log(
  `\n${ok ? "PASS — soft speech reached the agent" : "FAIL — the caller's words were thrown away"}`,
);
process.exit(ok ? 0 : 1);
