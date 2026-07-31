// How long does a FINISHED sentence sit in the buffer before it commits?
//
//   pnpm tsx scripts/commit-latency-check.ts
//
// Both cases are replayed verbatim from a live call transcript.
//
// Case 1 is Scribe re-punctuating a transcript it has otherwise settled on,
// once a second, forever: "Okay. Okay, thanks." → "Okay. Okay. Thanks." → back
// again. Nothing about the words changed, but the raw strings differ, so the
// stillness clock that the sweeper waits on kept resetting. In the field that
// sentence went unsent for thirteen seconds.
//
// Case 2 is worse and quieter: the VAD stops scoring anything at all while the
// recognizer keeps transcribing normally. Full duplex means audio never stops
// arriving, so the gap-based reset in processAudio can never fire — the state
// stays bad and the room never takes another turn. The live log read "no voice
// for 77221ms" shortly before the call had to be restarted.

import { TurnEngine } from "../lib/turn-engine";
import type { ElevenLabsSTTAdapter } from "glove-voice";

type Handler = (...args: never[]) => void;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Just past VAD_DEAF_MS in the engine. */
const VAD_DEAF_WAIT = 10_500;

function build() {
  const events: Array<{ name: string; at: number }> = [];
  const stt = new FakeSTT();
  const engine = new TurnEngine({
    stt: stt as unknown as ElevenLabsSTTAdapter,
    detector: { decide: async () => ({ holdMs: 0, reason: "test" }) } as never,
    hooks: {
      onUtterance: () => events.push({ name: "utterance", at: Date.now() }),
      onPartial: () => {},
      onTranscriptCorrection: () => {},
      onBargeIn: () => {},
      onBargeInWarning: () => {},
      onBargeInRetracted: () => {},
      onSpeechLikely: () => {},
      isAgentSpeaking: () => false,
      getTurnContext: () => [],
      onMetric: (n: string) => events.push({ name: n, at: Date.now() }),
    },
  });
  const vad = (engine as unknown as { vad: { emit(e: string, p: number): void } }).vad;
  return { stt, engine, vad, events };
}

let failed = 0;

// ── case 1: punctuation churn must not hold the transcript open ─────────────
{
  const { stt, engine, vad, events } = build();
  // Real voice, then the sentence is done.
  for (let f = 0; f < 30; f++) vad.emit("speech_prob", 0.9);
  stt.partial = "Okay. Okay, thanks.";
  stt.emit("partial", stt.partial);
  const settledAt = Date.now();

  // Scribe now flip-flops the punctuation once a second, as it did live.
  const flips = ["Okay. Okay. Thanks.", "Okay. Okay, thanks."];
  for (let i = 0; i < 6 && !events.some((e) => e.name === "utterance"); i++) {
    await sleep(1000);
    stt.partial = flips[i % 2];
    stt.emit("partial", stt.partial);
  }
  await sleep(600);

  const sent = events.find((e) => e.name === "utterance");
  const ms = sent ? sent.at - settledAt : -1;
  // The sweeper's own floor is SWEEP_STILL_MS (1200) + a 400ms tick.
  const ok = sent !== undefined && ms < 2500;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  punctuation churn on a settled sentence`);
  console.log(`      committed after ${ms}ms (want < 2500ms, live measured ~13000ms)`);
  engine.dispose();
}

// ── case 2: a VAD that has gone deaf gets reset, not trusted ────────────────
{
  const { stt, engine, vad, events } = build();
  let resets = 0;
  const rawVad = vad as unknown as { reset?: () => void };
  const originalReset = rawVad.reset?.bind(rawVad);
  rawVad.reset = () => { resets++; originalReset?.(); };

  // A normal utterance establishes that the VAD was working.
  for (let f = 0; f < 30; f++) vad.emit("speech_prob", 0.9);
  stt.partial = "yeah that works";
  stt.emit("partial", stt.partial);

  // …and now it dies. No probability events at all, while Scribe keeps
  // producing new words — exactly the live signature.
  await sleep(VAD_DEAF_WAIT);
  stt.partial = "yeah that works so I was going to ask about the delivery";
  stt.emit("partial", stt.partial);
  await sleep(200);

  const ok = resets === 1 && events.some((e) => e.name === "vad_deaf_reset");
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  deaf VAD is reset while the recognizer still hears words`);
  console.log(`      resets=${resets} (want 1), metric=${events.some((e) => e.name === "vad_deaf_reset")}`);
  engine.dispose();
}

console.log(failed ? `\n${failed} case(s) failed` : "\nall cases passed");
process.exit(failed ? 1 : 0);
