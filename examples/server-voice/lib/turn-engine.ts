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
/** Direct acoustic evidence that a person made a sound, for the phantom gate's
 *  clock ONLY. Deliberately far below the turn-boundary threshold: this asks
 *  "was that a human?", not "is this a turn". Held at the boundary threshold it
 *  let the weaker of our two listeners veto the stronger one — Scribe would
 *  transcribe a quiet talker in an outdoor room perfectly while Silero scored
 *  the same audio 0.2, and every word of it was discarded as a hallucination. */
const VOICE_EVIDENCE_PROB = 0.15;
/** The room is not acoustically DEAD. True silence sits under this; speech at
 *  any distance or volume clears it. Its only job is to separate "quiet person"
 *  from "no person", which is the distinction the phantom gate actually needs. */
const ROOM_ACTIVE_PROB = 0.05;
/** A VAD that has scored NOTHING for this long while the recognizer keeps
 *  producing new words is not a quiet room — it is a broken listener. */
const VAD_DEAF_MS = 10_000;
/** Don't reset a deaf VAD more often than this; a genuine dead patch would
 *  otherwise reset it on every partial. */
const VAD_DEAF_RESET_COOLDOWN_MS = 5_000;
/** A trailing addition shorter than this is transcription lag, not a
 *  correction worth interrupting the conversation over. */
const TAIL_EXTENSION_CHARS = 24;
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
/** Reusable 20ms silence frame for keeping the STT session warm. */
const SILENCE_FRAME = new Int16Array(320);
/** Feed STT silence if no client audio has arrived for this long — a detached
 *  room must not let Scribe's idle timer kill the session, or the next
 *  caller's first words race the reconnect handshake and lose. */
const STT_IDLE_KEEPALIVE_MS = 4000;
/** A break in the incoming audio longer than this resets the VAD before
 *  processing resumes — its recurrent state does not survive gaps. */
const AUDIO_GAP_RESET_MS = 1500;

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
  /** The FIRST speech-ish frame — maybe a person, maybe a door. If the agent
   *  is speaking, pause its playback instantly; onBargeIn or onBargeInRetracted
   *  resolves the maybe within a few hundred ms. */
  onBargeInWarning(): void;
  /** The warning above was noise, not a person — resume playback. */
  onBargeInRetracted(): void;
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

  /** May transcripts DISPATCH to the agent? Audio always flows (full duplex);
   *  this closes while the agent speaks so the transcript accumulated during
   *  her turn is claimed by a barge-in or swallowed — see setGateOpen. */
  private gateOpen = true;
  private disposed = false;

  private lastDispatched = "";
  private pendingConfirm: string | null = null;
  private lastVoiceAt = 0;
  private lastActivityAt = 0;
  private lastVadResetAt = 0;
  private evidenceText = "";
  private lastPartialAt = 0;
  private lastPartialText = "";
  private lastAudioFedAt = 0;
  private lastKeepaliveAt = 0;
  private probPeak = 0;
  private probFrames = 0;
  private speechEndAt = 0;
  private userSpeaking = false;

  /** Set by a confirmed barge-in just before the gate opens: the transcript
   *  accumulated while it was closed belongs to the caller. */
  private claimBufferOnOpen = false;
  /** A tentative pause is in flight, awaiting confirmation or retraction. */
  private warningOutstanding = false;
  /** Scribe's buffer as it stood when that pause fired — anything beyond it
   *  is words spoken over the agent. */
  private partialAtWarning = "";

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
    // Rolling peak probability, surfaced every couple of seconds while audio
    // flows. When "the room stopped hearing me" happens in the field, this is
    // the difference between guessing and knowing whether the VAD went dead.
    this.vad.on?.("speech_prob", (p: number) => {
      // The phantom gate's clock: a frame Silero scores as even plausibly
      // speech counts as "voice was heard". Robust where raw energy is not —
      // AGC'd room tone scores ~0.0 here, an echo-cancelled interruption ~0.9.
      if (p >= VOICE_EVIDENCE_PROB) this.lastVoiceAt = Date.now();
      if (p >= ROOM_ACTIVE_PROB) this.lastActivityAt = Date.now();
      this.probPeak = Math.max(this.probPeak, p);
      this.probFrames++;
      if (this.probFrames >= 64) {
        this.hooks.onMetric("vad_prob_peak", undefined, {
          peak: Number(this.probPeak.toFixed(3)),
          active: this.vad.isSpeaking,
          gate: this.gateOpen,
        });
        this.probPeak = 0;
        this.probFrames = 0;
      }
    });
    this.vad.on("speech_start", () => this.onSpeechStart());
    this.vad.on("speech_end", () => this.onSpeechEnd());
    // Only Silero reports these. `speech_real_start` is speech that survived
    // the minimum duration — the right moment to cut the agent off — and
    // `vad_misfire` retracts a burst that did not.
    this.vad.on?.("speech_real_start", () => this.onSpeechConfirmed());
    this.vad.on?.("vad_misfire", () => {
      this.userSpeaking = false;
      // Only retract a pause the transcript has NOT confirmed. Silero scoring
      // echo-cancelled double-talk routinely calls a real interruption a
      // misfire — it is judging mangled audio on duration — and resuming on
      // that verdict is exactly the "she pauses, then carries on reading the
      // same line" failure. If words came out of that audio, a person spoke,
      // and the VAD does not get to overrule them.
      if (this.transcriptGrewSinceWarning()) return;
      this.warningOutstanding = false;
      this.hooks.onBargeInRetracted();
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

  /**
   * Feed one PCM16 chunk from the client. FULL DUPLEX: every frame reaches
   * both the VAD and STT, always — including while the agent is speaking.
   *
   * The gate no longer decides whether audio flows; it decides whether the
   * resulting TRANSCRIPT belongs to the caller (see setGateOpen). Three
   * predecessors of this design all failed in the field:
   *   - not feeding STT while she talks starved Scribe's idle timer and lost
   *     whatever the caller said during the reconnect;
   *   - substituting SILENCE kept the socket alive but fed Scribe exactly the
   *     input Whisper-family models hallucinate on — phantom "Yes." utterances
   *     appeared in the transcript out of literal zeros;
   *   - a 1.2s pre-roll capped how much of an interruption could be recovered.
   * Real audio, continuously, has none of these problems. The agent's own
   * voice is kept out by the browser's echo canceller upstream, and anything
   * that leaks past it is swallowed when her turn ends unclaimed (setGateOpen).
   */
  processAudio(pcm: Int16Array): void {
    if (this.disposed) return;

    // Freshness — the phantom gate's clock — comes from the VAD's per-frame
    // probability, not from raw energy (see the speech_prob handler). A fixed
    // energy floor fails in both directions on a real microphone: automatic
    // gain control amplifies room tone past any floor low enough to hear a
    // ducked interruption, so the phantom gate never dropped anything in the
    // field; and echo-cancelled interruptions sit below any floor high enough
    // to block hallucinations. Silero scores both correctly. The energy floor
    // survives only as the fallback while the energy VAD is in place.
    if (!this.vad.supportsRealStart && rms(pcm) > VOICE_ENERGY_FLOOR) {
      this.lastVoiceAt = Date.now();
      this.lastActivityAt = Date.now();
    }

    // A recurrent model must not resume against a stale state. Silero v5
    // carries an LSTM state across frames, and when audio stops mid-utterance
    // (a caller drops without a proper goodbye) that state freezes wherever it
    // was. Resumed twenty seconds later it is garbage to the model: measured
    // live, the SAME voice that scored 0.999 before the gap scored 0.137
    // after it — the room's ears were still on, but the model behind them was
    // gone, permanently. A zero state is the model's designed starting point;
    // a stale one is not.
    if (this.lastAudioFedAt && Date.now() - this.lastAudioFedAt > AUDIO_GAP_RESET_MS) {
      this.vad.reset?.();
      this.userSpeaking = false;
      this.hooks.onMetric("vad_gap_reset", Date.now() - this.lastAudioFedAt);
    }

    this.vad.process(pcm);
    this.lastAudioFedAt = Date.now();
    this.stt.sendAudio(pcm);
  }

  /**
   * Forget everything half-heard.
   *
   * Scribe's partial is a running buffer, not a per-utterance one, and it does
   * not belong to a socket — so a caller who leaves mid-sentence leaves their
   * fragment behind. The next caller's first words get appended to it, and what
   * gets committed is both utterances glued together: "…under warranty? Nova,
   * is hull 0007 still under warranty?" from a single question. That doubled
   * text then reads as a correction and the agent answers it twice, which is
   * what the duplicate replies actually were.
   *
   * Committing the stale buffer (rather than only clearing ours) is what makes
   * this stick: the fragment lives on Scribe's side, and a commit is the only
   * way to make it let go. The confirming final is swallowed by `pendingConfirm`.
   */
  resetTranscript(): void {
    this.cancelPendingCommit();
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    const stale = this.stt.currentPartial?.trim() ?? "";
    if (stale) {
      this.pendingConfirm = stale;
      this.stt.flushUtterance();
    }
    // Marked as already-sent rather than cleared: if any of it resurfaces in a
    // later partial, `livePartial()` strips it as a prefix instead of handing
    // the next caller words the previous one spoke.
    this.lastDispatched = stale;
    this.evidenceText = "";
    this.speechEndAt = 0;
    this.userSpeaking = false;
    this.hooks.onPartial("");
  }

  /** Has the recognizer produced new words since the tentative pause? */
  private transcriptGrewSinceWarning(): boolean {
    const now = this.stt.currentPartial?.trim() ?? "";
    if (!now || now === this.partialAtWarning) return false;
    // Growth only counts as an interruption if it is ADDITIONAL speech, not
    // Scribe revising what it already had.
    return now.length > this.partialAtWarning.length;
  }

  /** The caller's own VAD beat ours to an interruption: whatever the closed
   *  gate has accumulated is theirs, not echo to be swallowed. */
  claimTranscriptOnOpen(): void {
    this.claimBufferOnOpen = true;
    this.warningOutstanding = false;
    this.lastVoiceAt = Date.now();
  }

  /**
   * The gate, in full duplex, is about OWNERSHIP of the transcript, not about
   * whether audio flows (it always flows).
   *
   * Closed (agent speaking): nothing dispatches. Whatever Scribe transcribes
   * accumulates — that is what makes an interruption complete from its first
   * word, with no pre-roll cap.
   *
   * Open again, two ways:
   *   - via a confirmed barge-in (claimBufferOnOpen set): the accumulated
   *     transcript IS the caller's interruption — keep every word of it.
   *   - via the agent simply finishing: nobody claimed that stretch, so
   *     whatever accumulated during it can only be echo the canceller let
   *     through, a backchannel "mm-hmm" that deliberately did not cut her, or
   *     a hallucination — swallow it rather than hand it to the agent.
   * The swallow is skipped if the caller is mid-speech at the seam (their
   * words are in that buffer and a boundary is coming to dispatch them).
   *
   * The gate also sets the VAD's posture: while she speaks, thresholds drop
   * (setDucked) because the echo canceller both removes her voice from the
   * mic (so false positives are cheap) and mangles the caller's (so true
   * positives score low).
   */
  setGateOpen(open: boolean): void {
    if (open !== this.gateOpen) this.hooks.onMetric(open ? "gate_open" : "gate_close");
    // A pause only belongs to the turn it was raised against.
    if (!open) {
      this.warningOutstanding = false;
      this.partialAtWarning = this.stt.currentPartial?.trim() ?? "";
    }
    (this.vad as Partial<SileroVADNode>).setDucked?.(!open);
    if (open && !this.gateOpen && !this.claimBufferOnOpen && !this.isUserSpeaking) {
      const unclaimed = this.stt.currentPartial?.trim() ?? "";
      if (unclaimed) {
        this.hooks.onMetric("gated_buffer_discarded", undefined, {
          chars: unclaimed.length,
          text: unclaimed.slice(0, 80),
        });
        this.resetTranscript();
      }
    }
    this.gateOpen = open;
    this.claimBufferOnOpen = false;
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
    const p = this.stt.currentPartial?.trim() ?? "";
    if (!this.lastDispatched) return p;

    // Text IDENTICAL to what we last sent is ambiguous, and the two readings
    // are opposites. While that dispatch's commit is still in flight, Scribe is
    // just re-sending the buffer and this is an echo to swallow. Once the
    // commit has landed the buffer is empty, so the same words arriving again
    // are the caller genuinely repeating themselves — and treating THAT as an
    // echo is why asking "Hello?" a second time was silently eaten, which from
    // the room is indistinguishable from the agent having stopped listening.
    if (p === this.lastDispatched) return this.pendingConfirm !== null ? "" : p;

    if (p.startsWith(this.lastDispatched)) {
      return p.slice(this.lastDispatched.length).trim();
    }
    if (this.lastDispatched.startsWith(p)) return ""; // a stale, shorter echo
    this.lastDispatched = ""; // buffer reset — a genuinely fresh utterance
    return p;
  }

  /**
   * THE RECOGNIZER IS A WITNESS TO VOICE, NOT JUST TO WORDS.
   *
   * Scribe hears through conditions Silero gives up on: a quiet talker, a far
   * microphone, wind, a phone held at waist height. So when the two disagree
   * about whether anybody spoke at all, growing text is the better witness —
   * words do not assemble themselves out of an empty room.
   *
   * Except when they do, which is the whole reason this gate exists. The
   * discriminator is the room, not the text: a silence hallucination arrives as
   * a whole canned phrase ("Yes.", "Thank you.") into audio that is genuinely
   * dead, so growth is admitted as evidence only while something is still
   * making noise. That bar sits at the noise floor, low enough that a whisper
   * clears it and only true silence does not.
   */
  private noteTranscriptEvidence(raw: string): void {
    const text = raw.trim();
    if (!text || text === this.evidenceText) return;
    // A strictly shorter prefix of what we already saw is Scribe re-sending a
    // stale buffer, not new speech.
    const grew = !this.evidenceText || !this.evidenceText.startsWith(text);
    this.evidenceText = text;
    if (!grew) return;

    // A VAD THAT HEARS NOTHING WHILE SOMEONE IS TALKING HAS DIED.
    //
    // Silero v5 carries an LSTM state across frames, and a state that goes bad
    // stays bad — measured earlier at the same voice scoring 0.999 before a
    // gap and 0.137 after it. `processAudio` resets on a gap in incoming
    // audio, but full duplex means audio never stops arriving, so that rescue
    // can no longer fire and nothing else ever clears the state. Seen live:
    // "no voice for 77221ms" while Scribe transcribed the whole time, after
    // which the room never took another turn and the call had to be restarted.
    //
    // New words with no acoustic evidence behind them for ten full seconds is
    // that failure, not a quiet talker. A zero state is the model's designed
    // starting point, so hand it one and let the next frames speak for
    // themselves — this deliberately does NOT admit the current text, because
    // if a person really is mid-sentence the reset pays for itself within a
    // frame or two and the sweeper still has the buffer.
    if (this.lastVoiceAt && Date.now() - this.lastVoiceAt > VAD_DEAF_MS) {
      if (Date.now() - this.lastVadResetAt > VAD_DEAF_RESET_COOLDOWN_MS) {
        this.lastVadResetAt = Date.now();
        this.vad.reset?.();
        this.userSpeaking = false;
        console.warn(
          `[turn] VAD scored nothing for ${Date.now() - this.lastVoiceAt}ms ` +
            `while the recognizer kept hearing words — resetting it`,
        );
        this.hooks.onMetric("vad_deaf_reset", Date.now() - this.lastVoiceAt, {
          text: text.slice(0, 60),
        });
      }
      return;
    }

    if (!this.lastActivityAt || Date.now() - this.lastActivityAt > VOICE_FRESH_MS) return;
    this.lastVoiceAt = Date.now();
  }

  /** Drop buffer content WITHOUT dispatching (a silence hallucination):
   *  commit it so the buffer resets, then swallow the confirming final. */
  private discardPartial(source: string, text: string): void {
    // Loud on the console, not just in the metrics file. Dropping a transcript
    // is the one decision in this engine that is completely invisible from
    // outside — Scribe logs the words, the room silently declines them, and
    // what the operator sees is a working recognizer attached to an agent that
    // has stopped answering. If we are going to throw away something a person
    // may have said, we say so where they are already looking.
    console.warn(
      `[turn] dropped as phantom (${source}, no voice for ${
        this.lastVoiceAt ? Date.now() - this.lastVoiceAt : -1
      }ms): "${text.slice(0, 80)}"`,
    );
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
    // Stillness means the TRANSCRIPT stopped changing, not that messages
    // stopped arriving. Scribe re-sends the same partial roughly once a second
    // for as long as audio flows, so stamping this unconditionally kept the
    // buffer permanently "fresh" and the idle sweeper — the thing that exists
    // precisely to rescue a transcript no boundary picked up — could never
    // fire. A caller saying "Hello?" into a room that had stopped taking turns
    // watched it accumulate for fifteen seconds and never send.
    const raw = this.stt.currentPartial?.trim() ?? "";
    // STILLNESS IS ABOUT WORDS, NOT PUNCTUATION.
    //
    // Scribe keeps re-punctuating a transcript it has otherwise settled on,
    // once a second, indefinitely: "Okay. Okay, thanks." → "Okay. Okay.
    // Thanks." → back again. Compared raw, every one of those flips reads as
    // the caller still talking, so the stillness clock never ages and the
    // sweeper never fires. Measured live: a finished sentence sat unsent for
    // 13 seconds while the comma moved back and forth.
    //
    // Normalizing to words alone is what makes the difference between a
    // revision and a re-render — the same comparison `onFinal` already uses to
    // decide whether a committed transcript really differs from what was sent.
    const settled = normalize(raw);
    if (settled !== this.lastPartialText) {
      this.lastPartialText = settled;
      this.lastPartialAt = Date.now();
    }
    this.noteTranscriptEvidence(raw);
    // THE TRANSCRIPT IS THE AUTHORITY ON WHETHER SOMEONE INTERRUPTED.
    //
    // Audio reaches Scribe even while the agent holds the floor (full duplex),
    // so words appearing during her turn are the strongest evidence available
    // that a person is talking over her — stronger than any VAD verdict on
    // audio the echo canceller has already mangled. When a tentative pause is
    // outstanding and real text arrives, escalate it to a full barge-in rather
    // than waiting for a VAD confirmation that may never come.
    if (this.warningOutstanding && this.transcriptGrewSinceWarning() && this.hooks.isAgentSpeaking()) {
      this.warningOutstanding = false;
      this.lastVoiceAt = Date.now();
      this.claimBufferOnOpen = true;
      this.hooks.onMetric("barge_in_by_transcript", undefined, {
        text: (this.stt.currentPartial ?? "").slice(0, 60),
      });
      this.setGateOpen(true);
      this.hooks.onBargeIn();
    }

    const live = this.livePartial();
    // A partial with no recent voice behind it is a hallucination forming. It
    // must not dispatch (the freshness gate below handles that), but it must
    // not be DISPLAYED either — "OPERATOR: Yes." flickering into the
    // transcript while the room is silent reads as the mic inventing words.
    const fresh = Date.now() - this.lastVoiceAt <= VOICE_FRESH_MS;
    this.hooks.onPartial(fresh ? live : "");

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
        const sent = normalize(confirm);
        const actual = normalize(text);
        // A pure TAIL EXTENSION is transcription lag, not a mishearing: we
        // committed from the partial and the recognizer then appended the last
        // word or two. Nothing already said was wrong, so raising a correction
        // just makes the agent answer the same thing twice — observed live as
        // "been out." → "been out for," producing two full replies.
        //
        // A long addition is different: that is real content the agent has not
        // heard, so it still goes through.
        const addition = actual.startsWith(sent) ? actual.slice(sent.length).trim() : null;
        if (addition !== null && addition.length < TAIL_EXTENSION_CHARS) {
          this.hooks.onMetric("stt_tail_extension", undefined, {
            added: addition,
            chars: addition.length,
          });
        } else {
          this.hooks.onMetric("stt_final_mismatch", undefined, {
            sentChars: confirm.length,
            finalChars: text.length,
          });
          this.hooks.onTranscriptCorrection(confirm, text);
        }
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
      console.warn(
        `[turn] dropped as phantom (final, no voice for ${
          this.lastVoiceAt ? Date.now() - this.lastVoiceAt : -1
        }ms): "${fresh.slice(0, 80)}"`,
      );
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
    this.hooks.onMetric("vad_start", undefined, { gate: this.gateOpen });
    // Tens of milliseconds after the caller's first sound: too early to KNOW
    // it is a person, exactly the right time to stop talking over them. The
    // session pauses playback without dropping anything; confirmation (cut for
    // real) or a misfire (resume) follows within a few hundred ms either way.
    if (this.hooks.isAgentSpeaking()) {
      this.partialAtWarning = this.stt.currentPartial?.trim() ?? "";
      this.warningOutstanding = true;
      this.hooks.onBargeInWarning();
    }
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
          this.claimBufferOnOpen = true; // the accumulated transcript is the caller's
          this.setGateOpen(true);
          this.hooks.onBargeIn();
        } else {
          // The 250ms probe found silence — whatever tripped the VAD is gone.
          this.hooks.onBargeInRetracted();
        }
      }, 250);
    }
  }

  /** Silero only: speech that outlasted the minimum, so definitely a person. */
  private onSpeechConfirmed(): void {
    this.warningOutstanding = false;
    // Confirmed human speech means we should be listening, full stop. The gate
    // exists to keep the AGENT's own voice out of the transcript, and this is
    // the model saying the sound is a person who has been talking for at least
    // `minSpeechMs` — so opening it is not conditional on whether her audio
    // happens to be playing at this instant. It used to be, and an utterance
    // that started in the seam (after her last chunk, before the caller's
    // playback_done, or inside the post-speech deadband) was never transcribed
    // at all: no partial, no commit, no trace beyond the caller repeating
    // themselves.
    this.hooks.onMetric("vad_confirmed", undefined, { gate: this.gateOpen });
    this.claimBufferOnOpen = true; // the accumulated transcript is the caller's
    this.setGateOpen(true);
    if (this.hooks.isAgentSpeaking()) this.hooks.onBargeIn();
  }

  private onSpeechEnd(): void {
    this.hooks.onMetric("vad_end", undefined, { gate: this.gateOpen });
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
    if (this.disposed) return;
    // STT keepalive is not gated on anything except audio actually flowing —
    // it matters MOST while nobody is attached. It keeps its OWN clock:
    // refreshing `lastAudioFedAt` here would blind the VAD gap detector,
    // which must measure silence in CLIENT audio, not in what we synthesize.
    if (
      Date.now() - this.lastAudioFedAt > STT_IDLE_KEEPALIVE_MS &&
      Date.now() - this.lastKeepaliveAt > STT_IDLE_KEEPALIVE_MS
    ) {
      this.lastKeepaliveAt = Date.now();
      this.stt.sendAudio(SILENCE_FRAME);
    }
    if (!this.gateOpen) return;
    if (this.userSpeaking || this.vad.isSpeaking) return;
    // Deliberately NOT gated on `isAgentSpeaking()`. The gate above is already
    // the authority on whether this audio should be transcribed at all, and an
    // open gate while the agent speaks is the barge-in case: something already
    // decided this utterance belongs to the caller. Checking both meant an
    // interruption made during a long reply was transcribed, held, and then
    // quietly dropped — the transcript sat in the buffer until the provider
    // auto-committed it minutes later, against whatever was being said by then.
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
