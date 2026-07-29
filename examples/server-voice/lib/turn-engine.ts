// ─────────────────────────────────────────────────────────────────────────────
// The commitment engine — "has this person finished speaking, and what exactly
// did they say?" — running SERVER-SIDE.
//
// This is a faithful port of the engine that lives in the browser in
// `examples/layered-voice` (app/lib/client/useVoice.ts). Every behavior here
// was found by debugging real conversations, so the port keeps them intact:
//
//   • dispatch-from-partial — commit the live partial instead of waiting for
//     the STT provider's commit round trip, then swallow the confirming final.
//   • prefix dedupe — Scribe's buffer keeps growing across utterances, so
//     strip what was already sent rather than re-sending it.
//   • freshness gate — Whisper-family models hallucinate ("Yes.", "Okay.")
//     out of silence; only commit text if real voice was heard in the last 3s.
//   • transcript-growth re-scoring — a partial that grows while a hold is
//     pending is proof the speaker wasn't done; supersede the old decision.
//   • adaptive pacing — the gap between a VAD boundary and the speaker picking
//     the thought back up is a measured thinking-pause; an EMA of those gaps
//     scales future holds, so deliberate talkers earn patience automatically.
//   • stable-flush — in a noisy room the VAD can stay "speaking" indefinitely
//     (a TV is speech too), so a still transcript is re-checked against the
//     detector rather than dispatched blind.
//   • idle sweep — a boundary that fires while the gate is closed would
//     otherwise strand text in the buffer forever.
//
// What CHANGED in the move server-side, and why it's better here:
//   - The turn detector is an in-process call, not an HTTP round trip.
//   - Tuning is server config: no client deploy, no stale bundle running
//     last week's endpointing.
//   - There is no token minting. The gateway holds the ElevenLabs key and
//     opens the STT socket directly.
// ─────────────────────────────────────────────────────────────────────────────

import type { TurnContextMessage, TurnDetectorAdapter, VADAdapter } from "glove-voice";
import { VAD, ElevenLabsSTTAdapter } from "glove-voice";
import { SileroVADNode } from "./silero-vad-node";

/** Only commit transcript text if real voice was heard this recently. */
const VOICE_FRESH_MS = 3000;
/** RMS floor for "there was sound" — well under speech, well over silence. */
const VOICE_ENERGY_FLOOR = 0.004;
/** Trailing silence before the VAD calls end-of-speech. The floor of send latency. */
export const VAD_SILENCE_MS = 450;
/** Re-check a still transcript through the detector after this long. */
const STABLE_CHECK_MS = 1500;
/** …and again this often while the detector stays unsure. */
const STABLE_RECHECK_MS = 800;
/** Idle sweeper tick. */
const SWEEP_TICK_MS = 400;
/** A transcript untouched this long while idle gets swept out. */
const SWEEP_STILL_MS = 1200;
/** Baseline thinking-pause, and the divisor that turns the EMA into a scale. */
const PAUSE_EMA_SEED_MS = 700;
/** Never scale a hold beyond this. */
const MAX_SCALED_HOLD_MS = 2800;
/** Only uncertain holds get scaled — confident short ones stay snappy. */
const SCALE_THRESHOLD_MS = 500;

export type DispatchSource = "endpoint" | "stable" | "hold" | "sweep";

export interface TurnEngineHooks {
  /** A complete utterance is ready for the agent. */
  onUtterance(text: string): void;
  /** The live partial changed (for the UI). */
  onPartial(text: string): void;
  /** The STT's final pass revised text that was already dispatched. */
  onTranscriptCorrection(sent: string, actual: string): void;
  /** A human started talking — cut the agent off if it is speaking. */
  onBargeIn(): void;
  /** Speech very likely incoming: a good moment to open the TTS socket. */
  onSpeechLikely(): void;
  /** Is the agent's audio playing right now? */
  isAgentSpeaking(): boolean;
  /** Recent room turns, to sharpen the end-of-utterance model. */
  getTurnContext(): TurnContextMessage[];
  onMetric(name: string, ms?: number, data?: Record<string, unknown>): void;
}

export interface TurnEngineConfig {
  stt: ElevenLabsSTTAdapter;
  detector: TurnDetectorAdapter;
  hooks: TurnEngineHooks;
  vadSilenceMs?: number;
  /** RMS above which the energy VAD calls a frame speech. */
  vadThreshold?: number;
}

export class TurnEngine {
  private readonly stt: ElevenLabsSTTAdapter;
  private vad: VADAdapter;
  private readonly detector: TurnDetectorAdapter;
  private readonly hooks: TurnEngineHooks;

  /** Feed mic audio to STT? Closed while the agent speaks so its own voice,
   *  echoed by the room, never lands in the transcript. */
  private gateOpen = true;
  private disposed = false;

  private lastDispatched = "";
  private pendingConfirm: string | null = null;
  private lastVoiceAt = 0;
  private lastPartialAt = 0;
  private speechEndAt = 0;
  private userSpeaking = false;

  private holdTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private readonly sweepTimer: NodeJS.Timeout;
  private decideSeq = 0;
  private pauseEmaMs = PAUSE_EMA_SEED_MS;

  private readonly cfg: TurnEngineConfig;

  constructor(cfg: TurnEngineConfig) {
    this.cfg = cfg;
    this.stt = cfg.stt;
    this.detector = cfg.detector;
    this.hooks = cfg.hooks;
    // Start on the energy VAD so audio arriving before init() is never
    // dropped; `useSilero()` swaps in the neural one once its model is loaded.
    this.vad = this.buildEnergyVad();
    this.wireVad();

    this.stt.on("partial", () => this.onPartial());
    this.stt.on("final", (t) => this.onFinal(t));

    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_TICK_MS);
  }

  private buildEnergyVad(): VAD {
    return new VAD({
      silenceMs: this.cfg.vadSilenceMs ?? VAD_SILENCE_MS,
      sampleRate: 16_000,
      // Biased toward hearing speech: a false boundary costs a slightly early
      // commit, a missed one costs the whole utterance.
      threshold: this.cfg.vadThreshold ?? 0.006,
      noiseFloorMultiplier: 2,
    });
  }

  private wireVad(): void {
    this.vad.on("speech_start", () => this.onSpeechStart());
    this.vad.on("speech_end", () => this.onSpeechEnd());
    // Only Silero reports these. `speech_real_start` is speech that survived
    // the minimum duration — the right moment to cut the agent off — and
    // `vad_misfire` retracts a burst that did not.
    this.vad.on?.("speech_real_start", () => this.onSpeechConfirmed());
    this.vad.on?.("vad_misfire", () => {
      this.userSpeaking = false;
    });
  }

  /**
   * Replace the energy VAD with the neural one. Called by the session once the
   * Silero model has loaded; on failure the energy VAD simply stays in place.
   */
  useSilero(silero: SileroVADNode): void {
    this.vad.removeAllListeners();
    this.vad = silero;
    this.wireVad();
  }

  // ── Audio in ───────────────────────────────────────────────────────────────

  /** Feed one PCM16 chunk from the client. */
  processAudio(pcm: Int16Array): void {
    if (this.disposed) return;

    // Freshness is measured from RAW ENERGY, not from the VAD's verdict.
    //
    // This gate exists to drop transcripts hallucinated out of silence, so the
    // question it needs answered is "was there any sound just now?" — not "did
    // the VAD's adaptive threshold call it speech?". Tying it to the VAD state
    // machine meant that whenever the VAD missed soft or distant speech, the
    // boundary never fired, the idle sweeper picked the transcript up, and the
    // gate then threw away the caller's REAL words as a phantom. Nothing
    // reached the agent, so nothing was answered and nothing delegated.
    //
    // True silence still sits far below this floor, so the phantom guard keeps
    // working.
    if (rms(pcm) > VOICE_ENERGY_FLOOR) this.lastVoiceAt = Date.now();

    // The VAD always sees the audio — that is how barge-in is detected while
    // the gate is closed. Only STT is gated.
    this.vad.process(pcm);
    if (this.gateOpen) this.stt.sendAudio(pcm);
  }

  /** Close the gate while the agent speaks; open it when it stops. */
  setGateOpen(open: boolean): void {
    this.gateOpen = open;
  }

  get isUserSpeaking(): boolean {
    return this.userSpeaking || this.vad.isSpeaking;
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.sweepTimer);
    this.cancelPendingCommit();
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.vad.removeAllListeners();
  }

  // ── Buffer bookkeeping ─────────────────────────────────────────────────────

  /**
   * The part of the STT buffer that has NOT been dispatched yet. Scribe's
   * partial keeps growing across utterances: after sending "Hey, my name is
   * Sam." the next partial may read "Hey, my name is Sam. I need help." —
   * re-dispatching that raw would duplicate the intro.
   */
  private livePartial(): string {
    let p = this.stt.currentPartial?.trim() ?? "";
    if (this.lastDispatched) {
      if (p.startsWith(this.lastDispatched)) {
        p = p.slice(this.lastDispatched.length).trim();
      } else if (this.lastDispatched.startsWith(p)) {
        p = ""; // stale echo of what was already sent
      } else {
        this.lastDispatched = ""; // buffer reset — a genuinely fresh utterance
      }
    }
    return p;
  }

  /** Drop buffer content WITHOUT dispatching (a silence hallucination):
   *  commit it so the buffer resets, then swallow the confirming final. */
  private discardPartial(source: string, text: string): void {
    this.hooks.onMetric("stt_phantom_dropped", undefined, {
      chars: text.length,
      source,
      quietForMs: this.lastVoiceAt ? Date.now() - this.lastVoiceAt : -1,
      text: text.slice(0, 80),
    });
    this.lastDispatched = this.stt.currentPartial?.trim() ?? text;
    this.pendingConfirm = text;
    this.stt.flushUtterance();
    this.hooks.onPartial("");
  }

  private dispatchFromPartial(source: DispatchSource): boolean {
    const text = this.livePartial();
    if (!text) return false;
    // No voice heard recently — this text is an STT hallucination born from
    // silence or noise, not something anyone said.
    if (Date.now() - this.lastVoiceAt > VOICE_FRESH_MS) {
      this.discardPartial(source, text);
      return false;
    }
    this.lastDispatched = this.stt.currentPartial?.trim() ?? text;
    const endAt = this.speechEndAt;
    this.speechEndAt = 0;
    this.hooks.onMetric("stt_dispatch_ms", endAt ? Date.now() - endAt : 0, {
      chars: text.length,
      source,
    });
    this.pendingConfirm = text;
    this.stt.flushUtterance();
    this.hooks.onPartial("");
    this.hooks.onUtterance(text);
    return true;
  }

  // ── Turn commitment ────────────────────────────────────────────────────────

  /** Slow, deliberate speakers earn longer holds; fast ones keep snappy commits. */
  private holdScale(): number {
    return Math.min(Math.max(this.pauseEmaMs / PAUSE_EMA_SEED_MS, 1), 3);
  }

  private cancelPendingCommit(): void {
    this.decideSeq += 1; // invalidates in-flight decide() results too
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  /**
   * The single entry point for "should this utterance be sent yet?" — called
   * at each VAD boundary and whenever the transcript grows while a hold is
   * pending.
   */
  private scheduleTurnDecision(): void {
    const partial = this.livePartial();
    if (!partial) {
      // Nothing new to send. Only fall back to the commit round trip when the
      // buffer is truly empty (STT lagging the boundary) — committing a buffer
      // of already-dispatched text would duplicate it via the final handler.
      if (!(this.stt.currentPartial ?? "").trim()) this.stt.flushUtterance();
      return;
    }
    const id = ++this.decideSeq;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    void Promise.resolve(this.detector.decide(partial, this.hooks.getTurnContext())).then(
      ({ holdMs, reason }) => {
        if (id !== this.decideSeq) return; // superseded by growth or a new boundary
        if (this.disposed || !this.gateOpen) return;
        if (this.userSpeaking) return; // they resumed — wait for the next boundary
        if (holdMs <= 0) {
          this.dispatchFromPartial("endpoint");
          return;
        }
        const scaled =
          holdMs > SCALE_THRESHOLD_MS
            ? Math.min(Math.round(holdMs * this.holdScale()), MAX_SCALED_HOLD_MS)
            : holdMs;

        // The hold is measured from the moment the SPEAKER stopped, not from
        // now. Re-scoring happens every time a late transcript update lands,
        // and STT keeps emitting partials for a second or more after the audio
        // ends — so restarting the timer on each one silently stacked holds and
        // made every turn arrive ~2.5x later than the detector asked for.
        // Growth still supersedes the decision (the fuller text is scored);
        // it just cannot push the deadline further out.
        const anchor = this.speechEndAt || Date.now();
        const remaining = Math.max(0, scaled - (Date.now() - anchor));
        this.hooks.onMetric("endpoint_hold", scaled, {
          chars: partial.length,
          reason,
          scale: Number(this.holdScale().toFixed(2)),
          waited: Date.now() - anchor,
          remaining,
        });
        if (remaining === 0) {
          this.dispatchFromPartial("hold");
          return;
        }
        this.holdTimer = setTimeout(() => {
          this.holdTimer = null;
          if (id !== this.decideSeq) return;
          if (this.disposed || !this.gateOpen) return;
          if (this.userSpeaking) return; // they picked the thought back up
          this.dispatchFromPartial("hold");
        }, remaining);
      },
    );
  }

  // ── STT events ─────────────────────────────────────────────────────────────

  private onPartial(): void {
    this.lastPartialAt = Date.now();
    const live = this.livePartial();
    this.hooks.onPartial(live);

    // Transcript grew while a commit was pending → the speaker wasn't done.
    // Re-score with the fuller text instead of dispatching a stale fragment.
    if (live && this.holdTimer && !this.vad.isSpeaking && this.gateOpen) {
      this.scheduleTurnDecision();
    }

    // Stable-transcript path: when the VAD stays "speaking" through a noisy
    // room, speech_end may fire late or never. Consult the detector rather
    // than dispatching blind (an earlier version dispatched directly here and
    // chopped thinking pauses).
    if (this.stableTimer) clearTimeout(this.stableTimer);
    if (!live) return;
    const stableCheck = () => {
      this.stableTimer = null;
      if (this.disposed || !this.gateOpen) return;
      if (!this.vad.isSpeaking) return; // speech_end owns this case
      if (this.livePartial() !== live) return; // grew — its own timer is running
      void Promise.resolve(this.detector.decide(live, this.hooks.getTurnContext())).then(
        ({ holdMs, reason }) => {
          if (this.disposed || !this.gateOpen) return;
          if (this.livePartial() !== live) return;
          if (holdMs <= SCALE_THRESHOLD_MS) {
            this.hooks.onMetric("stt_stable_flush", undefined, { chars: live.length, reason });
            this.dispatchFromPartial("stable");
          } else if (!this.stableTimer) {
            this.stableTimer = setTimeout(stableCheck, STABLE_RECHECK_MS);
          }
        },
      );
    };
    this.stableTimer = setTimeout(stableCheck, STABLE_CHECK_MS);
  }

  private onFinal(raw: string): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    const text = raw.trim();

    // The confirm for an utterance already dispatched from its partial:
    // swallow it, but report when the committed text materially differs.
    const confirm = this.pendingConfirm;
    if (confirm !== null) {
      this.pendingConfirm = null;
      // However this resolves, the committed text is fully accounted for —
      // nothing from this utterance may linger in the buffer or the display.
      this.lastDispatched = text || confirm;
      this.hooks.onPartial("");
      if (text && normalize(text) !== normalize(confirm)) {
        this.hooks.onMetric("stt_final_mismatch", undefined, {
          sentChars: confirm.length,
          finalChars: text.length,
        });
        this.hooks.onTranscriptCorrection(confirm, text);
      }
      return;
    }

    this.hooks.onPartial("");
    if (!text) return;
    // Dedupe here too — a commit of a buffer that still carried already-sent
    // words must not repeat them.
    let fresh = text;
    if (this.lastDispatched) {
      if (fresh.startsWith(this.lastDispatched)) {
        fresh = fresh.slice(this.lastDispatched.length).trim();
      } else if (this.lastDispatched.startsWith(fresh)) {
        fresh = "";
      }
    }
    if (!fresh) return;
    // Same phantom gate as the partial path: auto-commits can deliver silence
    // hallucinations straight here.
    if (Date.now() - this.lastVoiceAt > VOICE_FRESH_MS) {
      this.hooks.onMetric("stt_phantom_dropped", undefined, {
        chars: fresh.length,
        source: "final",
        quietForMs: this.lastVoiceAt ? Date.now() - this.lastVoiceAt : -1,
        text: fresh.slice(0, 80),
      });
      return;
    }
    const endAt = this.speechEndAt;
    this.speechEndAt = 0;
    if (endAt && Date.now() - endAt < 10_000) {
      this.hooks.onMetric("stt_final_ms", Date.now() - endAt, { chars: fresh.length });
    }
    this.hooks.onUtterance(fresh);
  }

  // ── VAD events ─────────────────────────────────────────────────────────────

  private onSpeechStart(): void {
    this.userSpeaking = true;
    this.lastVoiceAt = Date.now();
    // Resuming after a boundary = a measured thinking-pause for this speaker.
    if (this.speechEndAt) {
      const gap = Date.now() - this.speechEndAt;
      if (gap > 0 && gap < 5000) this.pauseEmaMs = 0.7 * this.pauseEmaMs + 0.3 * gap;
    }
    // Still the same utterance — cancel any pending commit.
    this.cancelPendingCommit();
    // Speech (and probably a reply) is coming: open the TTS socket now, so the
    // handshake overlaps STT and model time.
    this.hooks.onSpeechLikely();
    // Silero reports confirmed speech separately, so barge-in waits for that
    // (see onSpeechConfirmed). The energy VAD cannot, so it emulates one: cut
    // the agent off only if the "speech" is still going 250ms later. The hold
    // floor of 400ms sits above this deliberately.
    if (!this.vad.supportsRealStart && this.hooks.isAgentSpeaking()) {
      setTimeout(() => {
        if (this.vad.isSpeaking && this.hooks.isAgentSpeaking()) {
          this.gateOpen = true; // route this utterance to STT
          this.hooks.onBargeIn();
        }
      }, 250);
    }
  }

  /** Silero only: speech that outlasted the minimum, so definitely a person. */
  private onSpeechConfirmed(): void {
    if (!this.hooks.isAgentSpeaking()) return;
    this.gateOpen = true; // route this utterance to STT
    this.hooks.onBargeIn();
  }

  private onSpeechEnd(): void {
    this.userSpeaking = false;
    this.speechEndAt = Date.now();
    this.lastVoiceAt = Date.now();
    if (this.gateOpen) this.scheduleTurnDecision();
  }

  // ── Idle sweep ─────────────────────────────────────────────────────────────

  /**
   * A boundary can fire while the gate is closed (agent mid-audio), or a hold
   * can bail on a VAD blip — and then nothing re-examines the leftover
   * transcript; it just sits there until the provider auto-commits. Whenever
   * we are idle and the transcript has been still, dispatch it.
   */
  private sweep(): void {
    if (this.disposed || !this.gateOpen) return;
    if (this.userSpeaking || this.vad.isSpeaking) return;
    if (this.hooks.isAgentSpeaking()) return;
    if (this.holdTimer) return; // an endpoint hold owns this buffer
    if (Date.now() - this.lastPartialAt < SWEEP_STILL_MS) return;
    const live = this.livePartial();
    if (!live) return;
    this.hooks.onMetric("stt_sweep", undefined, { chars: live.length });
    this.dispatchFromPartial("sweep");
  }
}

/** Root-mean-square amplitude of a PCM16 frame, normalized to 0..1. */
function rms(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
