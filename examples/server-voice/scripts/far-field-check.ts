// Can the room tell the caller from the table behind them?
//
//   pnpm tsx scripts/far-field-check.ts
//
// In a busy room the recognizer transcribes the next table perfectly well, and
// it is right to — that really is speech. Every model in the pipeline answers
// "is this speech", none of them answers "is this the person I am talking to".
// The only cue left is loudness relative to the caller's own level, since
// speech falls about 6dB per doubling of distance.
//
// The risk in a gate like this is entirely on the other side: cutting off a
// caller who mutters, moves the phone, or backs off the microphone is a far
// worse failure than transcribing a stranger. So every case here that ends in
// "must still be heard" matters more than the one that ends in "rejected".

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

/** 32ms of 16kHz audio at a given RMS — a noise burst, since only its level
 *  matters here; the VAD verdict is supplied directly. */
function frameAt(rms: number): Int16Array {
  const f = new Int16Array(512);
  for (let i = 0; i < f.length; i++) {
    f[i] = Math.round((i % 2 ? rms : -rms) * 32767);
  }
  return f;
}

function build(farFieldRatio?: number) {
  const heard: string[] = [];
  const dropped: string[] = [];
  const stt = new FakeSTT();
  const engine = new TurnEngine({
    stt: stt as unknown as ElevenLabsSTTAdapter,
    detector: { decide: async () => ({ holdMs: 0, reason: "test" }) } as never,
    farFieldRatio,
    hooks: {
      onUtterance: (t: string) => heard.push(t),
      onPartial: () => {},
      onTranscriptCorrection: () => {},
      onBargeIn: () => {},
      onBargeInWarning: () => {},
      onBargeInRetracted: () => {},
      onSpeechLikely: () => {},
      isAgentSpeaking: () => false,
      getTurnContext: () => [],
      onMetric: (n: string) => { if (n === "stt_far_field_dropped") dropped.push(n); },
    },
  });
  const vad = (engine as unknown as { vad: { emit(e: string, p: number): void } }).vad;
  return { stt, engine, vad, heard, dropped };
}

/** Feed `ms` of audio at `rms` while the VAD reports speech, with `text` in
 *  the recognizer's buffer, then let the sweeper decide. */
async function utterance(
  ctx: ReturnType<typeof build>,
  rms: number,
  text: string,
  ms = 700,
): Promise<void> {
  const frame = frameAt(rms);
  const frames = Math.round(ms / 32);
  for (let i = 0; i < frames; i++) {
    ctx.engine.processAudio(frame);
    ctx.vad.emit("speech_prob", 0.9);
  }
  ctx.stt.partial = text;
  ctx.stt.emit("partial", text);
  await sleep(1800);
}

/** Keep feeding near-silence so the decaying peaks age realistically. */
async function quiet(ctx: ReturnType<typeof build>, ms: number): Promise<void> {
  const frame = frameAt(0.0005);
  for (let i = 0; i < Math.round(ms / 32); i++) ctx.engine.processAudio(frame);
  await sleep(50);
}

const CALLER = 0.08;   // an arm's length away
const NEIGHBOUR = 0.012; // ~16dB down, the next table over

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      ${detail}`);
}

// ── the caller establishes who they are, then the neighbour talks ───────────
{
  const ctx = build();
  await utterance(ctx, CALLER, "I'm looking for a cargo ship");
  await quiet(ctx, 400);
  await utterance(ctx, NEIGHBOUR, "so then he told me they were closing early");
  check(
    "the next table is not part of the conversation",
    ctx.heard.length === 1 && ctx.dropped.length === 1,
    `heard ${JSON.stringify(ctx.heard)}, far-field drops ${ctx.dropped.length}`,
  );
  ctx.engine.dispose();
}

// ── the same caller, dropping to a mutter ──────────────────────────────────
{
  const ctx = build();
  await utterance(ctx, CALLER, "I'm looking for a cargo ship");
  await quiet(ctx, 400);
  // Half the level — quieter, but nothing like the next table.
  await utterance(ctx, CALLER * 0.5, "yeah, that one");
  check(
    "a caller who lowers their voice is still heard",
    ctx.heard.length === 2 && ctx.dropped.length === 0,
    `heard ${JSON.stringify(ctx.heard)}`,
  );
  ctx.engine.dispose();
}

// ── nobody has spoken yet: the gate must not act on an unset reference ──────
{
  const ctx = build();
  await utterance(ctx, NEIGHBOUR, "hello? are you there?");
  check(
    "the first thing said is heard, whoever said it",
    ctx.heard.length === 1 && ctx.dropped.length === 0,
    `heard ${JSON.stringify(ctx.heard)}`,
  );
  ctx.engine.dispose();
}

// ── a caller who moves further from the mic and stays there ────────────────
{
  const ctx = build();
  await utterance(ctx, CALLER, "I'm looking for a cargo ship");
  // They set the phone down. The reference has to follow them within a few
  // sentences or the room goes deaf for the rest of the call.
  await quiet(ctx, 25_000);
  await utterance(ctx, CALLER * 0.2, "sorry, still here");
  check(
    "a caller who backs off the mic is followed, not locked out",
    ctx.heard.length === 2,
    `heard ${JSON.stringify(ctx.heard)}`,
  );
  ctx.engine.dispose();
}

// ── a caller who moves away and keeps talking must not stay locked out ─────
{
  const ctx = build();
  await utterance(ctx, CALLER, "I'm looking for a cargo ship");
  // They set the phone down on the table and carry on. 25x quieter — far past
  // the gate, and the reference only falls on its own slow clock, so without
  // re-anchoring this caller is refused for the better part of a minute.
  for (const line of ["are you still there", "hello", "can you hear me"]) {
    await quiet(ctx, 200);
    await utterance(ctx, CALLER * 0.04, line);
  }
  await quiet(ctx, 200);
  await utterance(ctx, CALLER * 0.04, "okay good");
  check(
    "a caller who moves away and keeps talking is re-anchored, not lost",
    ctx.heard.includes("okay good"),
    `heard ${JSON.stringify(ctx.heard)} after ${ctx.dropped.length} rejections`,
  );
  ctx.engine.dispose();
}

// ── the escape hatch ───────────────────────────────────────────────────────
{
  const ctx = build(0);
  await utterance(ctx, CALLER, "I'm looking for a cargo ship");
  await quiet(ctx, 400);
  await utterance(ctx, NEIGHBOUR, "so then he told me they were closing early");
  check(
    "farFieldRatio 0 takes everything the recognizer hears",
    ctx.heard.length === 2 && ctx.dropped.length === 0,
    `heard ${JSON.stringify(ctx.heard)}`,
  );
  ctx.engine.dispose();
}

console.log(failed ? `\n${failed} case(s) failed` : "\nall cases passed");
process.exit(failed ? 1 : 0);
