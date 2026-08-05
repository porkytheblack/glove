// Does one sentence reach the agent exactly once?
//
//   pnpm tsx scripts/dedupe-check.ts
//
// Seen in the room transcript: the operator's line printed twice and Nova
// answered it twice, with two different replies. The buffer dedupe compared
// what we had already sent against the recognizer's current partial with
// character-exact string checks — but Scribe re-punctuates text it has already
// settled on, so the SAME sentence comes back as "Yeah, yeah, that's right."
// after being sent as "Yeah. Yeah, that's right." That matches neither the
// equality test nor either prefix test, so it fell through to "genuinely fresh
// utterance" and dispatched a second time.
//
// The dedupe has three jobs and this exercises all of them, because fixing the
// duplicate by simply swallowing more is how the opposite bug gets made: a
// caller who repeats themselves must still be heard.

import { TurnEngine } from "../lib/turn-engine";
import type { ElevenLabsSTTAdapter } from "glove-voice";

type Handler = (...args: never[]) => void;

class FakeSTT {
  partial = "";
  committed: string[] = [];
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
  // Scribe does NOT clear its partial on flush — it clears when the commit
  // lands, which is the window this whole guard exists to cover.
  flushUtterance() { this.committed.push(this.partial); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function build() {
  const sent: string[] = [];
  const stt = new FakeSTT();
  const engine = new TurnEngine({
    stt: stt as unknown as ElevenLabsSTTAdapter,
    detector: { decide: async () => ({ holdMs: 0, reason: "test" }) } as never,
    hooks: {
      onUtterance: (t: string) => sent.push(t),
      onPartial: () => {},
      onTranscriptCorrection: () => {},
      onBargeIn: () => {},
      onBargeInWarning: () => {},
      onBargeInRetracted: () => {},
      onSpeechLikely: () => {},
      isAgentSpeaking: () => false,
      getTurnContext: () => [],
      onMetric: () => {},
    },
  });
  const vad = (engine as unknown as { vad: { emit(e: string, p: number): void } }).vad;
  return { stt, engine, vad, sent };
}

/** Speak, let the sweeper commit, then let Scribe re-emit `echo`. */
async function run(say: string, echo: string, alsoSay?: string): Promise<string[]> {
  const { stt, engine, vad, sent } = build();
  for (let f = 0; f < 30; f++) vad.emit("speech_prob", 0.9);
  stt.partial = say;
  stt.emit("partial", stt.partial);
  await sleep(1800); // sweeper commits

  // Scribe re-sends the buffer, re-punctuated, before its commit lands.
  for (let f = 0; f < 30; f++) vad.emit("speech_prob", 0.9);
  stt.partial = echo;
  stt.emit("partial", stt.partial);
  await sleep(1800);

  if (alsoSay !== undefined) {
    stt.emit("final", echo); // the commit finally lands, clearing the buffer
    stt.partial = alsoSay;
    for (let f = 0; f < 30; f++) vad.emit("speech_prob", 0.9);
    stt.emit("partial", stt.partial);
    await sleep(1800);
  }
  engine.dispose();
  return sent;
}

const cases = [
  {
    name: "re-punctuated echo of a sent line is not a new utterance",
    say: "Yeah. Yeah, that's right.",
    echo: "Yeah, yeah, that's right.",
    want: 1,
  },
  {
    name: "a genuine continuation still gets through",
    say: "Yeah. Yeah, that's right.",
    echo: "Yeah, yeah, that's right. It's for cargo.",
    want: 2,
  },
  {
    name: "the caller repeating themselves is still heard",
    say: "Hello?",
    echo: "Hello?",
    alsoSay: "Hello?",
    want: 2,
  },
];

let failed = 0;
for (const c of cases) {
  const sent = await run(c.say, c.echo, c.alsoSay);
  const ok = sent.length === c.want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`      dispatched ${sent.length} (want ${c.want}): ${JSON.stringify(sent)}`);
}

console.log(failed ? `\n${failed} case(s) failed` : "\nall cases passed");
process.exit(failed ? 1 : 0);
