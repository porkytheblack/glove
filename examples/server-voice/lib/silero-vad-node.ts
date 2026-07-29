// ─────────────────────────────────────────────────────────────────────────────
// Silero VAD, server-side.
//
// The browser-hosted example defaults to the neural Silero VAD via
// `@ricky0123/vad-web`, which is onnxruntime-WEB and cannot run here. This is
// the same model (Silero v5) driven through onnxruntime-node, with the frame
// state machine that `vad-web` normally provides implemented directly.
//
// It matters more than "nicer defaults". The energy VAD decides speech by
// loudness against an adaptive noise floor, so it misses soft or distant
// talkers, and a missed boundary means the utterance is only picked up by the
// idle sweeper — late, or (before the freshness fix) not at all. Silero is a
// model that knows what speech SOUNDS like, so it fires on a quiet "mm-hmm"
// and ignores a slammed door.
//
// It also restores the tentative → confirmed distinction the energy VAD cannot
// express: `speech_start` on the first speech-ish frame, `speech_real_start`
// once it has survived `minSpeechMs`, and `vad_misfire` when it has not. That
// is what lets barge-in cut the agent off on CONFIRMED speech only, instead of
// the 250ms guess the energy path has to make.
//
// The model file ships inside `@ricky0123/vad-web`, which glove-voice already
// depends on — no download, no extra asset to host.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import EventEmitter from "eventemitter3";
import type { VADAdapter, VADAdapterEvents } from "glove-voice";

/** Silero v5 wants exactly 512 samples at 16 kHz — 32ms per frame. */
const FRAME_SAMPLES = 512;
/** Backlog beyond which frames are skipped rather than queued forever. */
const MAX_QUEUED_FRAMES = 16;
const MS_PER_FRAME = FRAME_SAMPLES / 16;

export interface SileroVADNodeConfig {
  /** Probability at or above which a frame is speech (default 0.5). */
  positiveSpeechThreshold?: number;
  /** …and below which it is silence. The gap is deliberate hysteresis. */
  negativeSpeechThreshold?: number;
  /** Trailing silence before end-of-speech (default 450ms). */
  redemptionMs?: number;
  /** Speech shorter than this is retracted as a misfire (default 250ms). */
  minSpeechMs?: number;
}

/** Locate silero_vad_v5.onnx inside the installed vad-web package. */
function findModel(): string | null {
  const require = createRequire(import.meta.url);
  for (const spec of ["@ricky0123/vad-web/package.json", "glove-voice/package.json"]) {
    try {
      const pkg = require.resolve(spec);
      const candidate = path.join(path.dirname(pkg), "dist", "silero_vad_v5.onnx");
      if (existsSync(candidate)) return candidate;
    } catch {
      /* not resolvable from here — try the next */
    }
  }
  return null;
}

export class SileroVADNode extends EventEmitter<VADAdapterEvents> implements VADAdapter {
  /** Silero can tell tentative speech from confirmed speech. */
  readonly supportsRealStart = true;

  private session: import("onnxruntime-node").InferenceSession | null = null;
  private ort: typeof import("onnxruntime-node") | null = null;
  /** Silero v5 carries a recurrent state across frames. */
  private state: Float32Array = new Float32Array(2 * 1 * 128);
  private readonly srTensorValue = BigInt64Array.from([BigInt(16000)]);

  /** Samples not yet formed into a whole 512-sample frame. */
  private carry: Float32Array = new Float32Array(0);

  private active = false;
  private speechFrames = 0;
  private redemptionFrames = 0;
  /** Frames run strictly in order — the model's state is recurrent, so a
   *  skipped frame corrupts the context the next one is scored against. */
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;

  private readonly positive: number;
  private readonly negative: number;
  private readonly redemptionLimit: number;
  private readonly minSpeechCount: number;

  constructor(cfg: SileroVADNodeConfig = {}) {
    super();
    this.positive = cfg.positiveSpeechThreshold ?? 0.5;
    this.negative = cfg.negativeSpeechThreshold ?? 0.35;
    this.redemptionLimit = Math.max(1, Math.round((cfg.redemptionMs ?? 450) / MS_PER_FRAME));
    this.minSpeechCount = Math.max(1, Math.round((cfg.minSpeechMs ?? 250) / MS_PER_FRAME));
  }

  /** Load the model. Throws if either the runtime or the weights are missing,
   *  so the caller can fall back to the energy VAD rather than run deaf. */
  async init(): Promise<void> {
    if (this.session) return;
    const modelPath = findModel();
    if (!modelPath) {
      throw new Error(
        "silero_vad_v5.onnx not found — it ships inside @ricky0123/vad-web (a glove-voice dependency).",
      );
    }
    this.ort = await import("onnxruntime-node");
    this.session = await this.ort.InferenceSession.create(modelPath, {
      // One frame at a time on one thread: this runs per 32ms of audio, per
      // caller, and must not fight the agent for CPU.
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
      executionMode: "sequential",
    } as never);
  }

  get isSpeaking(): boolean {
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.speechFrames = 0;
    this.redemptionFrames = 0;
    this.state = new Float32Array(2 * 1 * 128);
    this.carry = new Float32Array(0);
  }

  /**
   * Feed a PCM16 chunk. Chunks arrive at whatever size the client sends (20ms
   * here), so they are re-cut into the 512-sample frames the model expects.
   */
  process(pcm: Int16Array): void {
    if (!this.session) return; // not initialized — caller should have fallen back

    const incoming = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) incoming[i] = pcm[i] / 32768;

    const buf = new Float32Array(this.carry.length + incoming.length);
    buf.set(this.carry);
    buf.set(incoming, this.carry.length);

    let offset = 0;
    while (buf.length - offset >= FRAME_SAMPLES) {
      const frame = new Float32Array(buf.subarray(offset, offset + FRAME_SAMPLES));
      offset += FRAME_SAMPLES;
      // At realtime this queue never grows: a frame is 32ms of audio and scores
      // in ~1-2ms. A backlog means something is badly overloaded, and reporting
      // boundaries from seconds ago is worse than skipping ahead.
      if (this.queued >= MAX_QUEUED_FRAMES) continue;
      this.queued++;
      this.chain = this.chain.then(() => this.infer(frame)).finally(() => {
        this.queued--;
      });
    }
    this.carry = buf.slice(offset);
  }

  private async infer(frame: Float32Array): Promise<void> {
    if (!this.session || !this.ort) return;
    try {
      const { Tensor } = this.ort;
      const out = await this.session.run({
        input: new Tensor("float32", frame, [1, FRAME_SAMPLES]),
        state: new Tensor("float32", this.state, [2, 1, 128]),
        sr: new Tensor("int64", this.srTensorValue, []),
      });
      const prob = Number((out.output.data as Float32Array)[0]);
      this.state = out.stateN.data as Float32Array;
      this.onProbability(prob);
    } catch {
      /* a failed frame is a dropped frame; the next one will do */
    }
  }

  /** The frame state machine `@ricky0123/vad-web` provides in the browser. */
  private onProbability(prob: number): void {
    this.emit("speech_prob", prob);

    if (prob >= this.positive) {
      this.redemptionFrames = 0;
      if (!this.active) {
        this.active = true;
        this.speechFrames = 0;
        this.emit("speech_start"); // tentative — may still be retracted
      }
      this.speechFrames++;
      if (this.speechFrames === this.minSpeechCount) {
        this.emit("speech_real_start"); // survived the minimum — definitely a person
      }
      return;
    }

    if (!this.active) return;
    if (prob >= this.negative) return; // in the hysteresis band: hold the floor

    this.redemptionFrames++;
    if (this.redemptionFrames < this.redemptionLimit) return;

    const wasRealSpeech = this.speechFrames >= this.minSpeechCount;
    this.active = false;
    this.speechFrames = 0;
    this.redemptionFrames = 0;
    this.emit(wasRealSpeech ? "speech_end" : "vad_misfire");
  }
}
