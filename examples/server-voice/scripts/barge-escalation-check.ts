// Does a pause survive a VAD that calls the interruption a misfire?
//
//   pnpm tsx scripts/barge-escalation-check.ts
//
// This is the failure the sim CANNOT reproduce: attenuating clean speech is
// not the same as an echo canceller mangling double-talk, and it is the
// mangling that makes Silero score a real interruption as too-short noise.
// Reported from the browser as: she pauses, then carries on reading the same
// line. So drive the engine directly — feed it a misfire while the recognizer
// is producing words, and assert the pause is NOT retracted.

import { TurnEngine } from "../lib/turn-engine";
import type { ElevenLabsSTTAdapter } from "glove-voice";

type Handler = (...args: never[]) => void;

/** Just enough STT to drive the engine: a partial we control by hand. */
class FakeSTT {
  partial = "";
  private handlers = new Map<string, Handler[]>();
  on(ev: string, fn: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this as never;
  }
  emit(ev: string, ...args: unknown[]) {
    for (const h of this.handlers.get(ev) ?? []) (h as (...a: unknown[]) => void)(...args);
  }
  get currentPartial() { return this.partial; }
  sendAudio() {}
  flushUtterance() { this.partial = ""; }
}

const events: string[] = [];
const stt = new FakeSTT();

const engine = new TurnEngine({
  stt: stt as unknown as ElevenLabsSTTAdapter,
  detector: { decide: async () => ({ holdMs: 5000, reason: "test" }) } as never,
  hooks: {
    onUtterance: () => events.push("utterance"),
    onPartial: () => {},
    onTranscriptCorrection: () => {},
    onBargeIn: () => events.push("BARGE_IN"),
    onBargeInWarning: () => events.push("pause"),
    onBargeInRetracted: () => events.push("RESUME"),
    onSpeechLikely: () => {},
    isAgentSpeaking: () => true, // she is mid-sentence throughout
    getTurnContext: () => [],
    onMetric: (n) => { if (n === "barge_in_by_transcript") events.push("escalated"); },
  },
});

// The agent takes the floor.
engine.setGateOpen(false);

const vad = (engine as unknown as { vad: { emit(e: string): void } }).vad;

// ── case 1: a real interruption the VAD mis-scores as a misfire ─────────────
vad.emit("speech_start");            // → tentative pause
stt.partial = "okay hold on";        // the recognizer hears actual words
stt.emit("partial", stt.partial);
vad.emit("vad_misfire");             // the VAD gets it wrong

const cutNotResumed = events.includes("BARGE_IN") && !events.includes("RESUME");
console.log(`case 1 — words spoken, VAD says misfire`);
console.log(`  events: ${events.join(" → ")}`);
console.log(`  ${cutNotResumed ? "PASS" : "FAIL"} — expected a barge-in and NO resume\n`);

// ── case 2: an actual false alarm — nothing was transcribed ─────────────────
events.length = 0;
engine.setGateOpen(false);
vad.emit("speech_start");            // → tentative pause
vad.emit("vad_misfire");             // nothing was said; retract

const resumed = events.includes("RESUME") && !events.includes("BARGE_IN");
console.log(`case 2 — cough, nothing transcribed`);
console.log(`  events: ${events.join(" → ")}`);
console.log(`  ${resumed ? "PASS" : "FAIL"} — expected a resume and NO barge-in\n`);

engine.dispose();
const ok = cutNotResumed && resumed;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
