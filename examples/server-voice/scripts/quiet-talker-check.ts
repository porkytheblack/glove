// Can the room hear someone the VAD cannot?
//
//   pnpm tsx scripts/quiet-talker-check.ts
//
// Reported from the field: Scribe logs a full sentence as a partial, commits
// it, and the room does nothing with it — no reply, and the words never even
// reach the transcript panel. The cause was the phantom gate, which took its
// entire opinion of "did anybody speak" from Silero's per-frame probability at
// the same threshold used for turn boundaries. Outdoors, on a far or quiet
// microphone, the recognizer stays perfectly intelligible while the VAD stops
// clearing that bar — so the weaker listener silently vetoed the stronger one
// and every word was discarded as a hallucination.
//
// Drive the engine directly: the VAD never fires a boundary in any of these
// cases (that is the point — a boundary would set the freshness clock by
// itself), leaving the sweeper to pick the transcript up. Assert that a quiet
// talker gets through and a dead-room hallucination still does not.

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

/**
 * Speak `text` one fragment at a time over a VAD that only ever reports
 * `prob` — no speech_start, no speech_end, exactly as a far microphone
 * behaves — then wait long enough for the idle sweeper to act.
 */
async function say(text: string, prob: number): Promise<string[]> {
  const seen: string[] = [];
  const stt = new FakeSTT();
  const engine = new TurnEngine({
    stt: stt as unknown as ElevenLabsSTTAdapter,
    detector: { decide: async () => ({ holdMs: 0, reason: "test" }) } as never,
    hooks: {
      onUtterance: (t: string) => seen.push(`utterance:${t}`),
      onPartial: () => {},
      onTranscriptCorrection: () => {},
      onBargeIn: () => {},
      onBargeInWarning: () => {},
      onBargeInRetracted: () => {},
      onSpeechLikely: () => {},
      isAgentSpeaking: () => false,
      getTurnContext: () => [],
      onMetric: (n: string) => { if (n === "stt_phantom_dropped") seen.push("DROPPED"); },
    },
  });

  const vad = (engine as unknown as { vad: { emit(e: string, p: number): void } }).vad;
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    // 32ms frames, as Silero sees them.
    for (let f = 0; f < 8; f++) vad.emit("speech_prob", prob);
    stt.partial = words.slice(0, i + 1).join(" ");
    stt.emit("partial", stt.partial);
    await sleep(60);
  }
  // The room goes quiet; the sweeper has SWEEP_STILL_MS + a tick to notice.
  await sleep(1900);
  engine.dispose();
  return seen;
}

const cases: Array<{ name: string; prob: number; text: string; want: "utterance" | "DROPPED" }> = [
  // Below the old 0.35 bar, above the new direct-evidence bar. This is the
  // reported failure: a normal voice, badly placed.
  { name: "far mic, VAD below the boundary threshold", prob: 0.2,
    text: "yeah it's my first time here", want: "utterance" },
  // Under even the evidence bar — the room is alive but Silero is not
  // convinced. The growing transcript is the only witness left.
  { name: "whisper, only the recognizer hears it", prob: 0.08,
    text: "so you can hear me", want: "utterance" },
  // The case the gate exists for: nothing is making any sound and a canned
  // phrase appears whole.
  { name: "dead room, canned phrase", prob: 0.01, text: "Yes.", want: "DROPPED" },
];

let failed = 0;
for (const c of cases) {
  const seen = await say(c.text, c.prob);
  const ok = c.want === "DROPPED"
    ? seen.includes("DROPPED") && !seen.some((e) => e.startsWith("utterance:"))
    : seen.some((e) => e.startsWith("utterance:")) && !seen.includes("DROPPED");
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`      p=${c.prob} want=${c.want} got=[${seen.join(", ")}]`);
}

console.log(failed ? `\n${failed} case(s) failed` : "\nall cases passed");
process.exit(failed ? 1 : 0);
