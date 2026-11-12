import EventEmitter from "eventemitter3";
import type {
  STTAdapter,
  TTSAdapter,
  VADAdapter,
  AudioIO,
  AudioCaptureAdapter,
  AudioPlayerAdapter,
} from "./adapters/types";
import { AudioCapture } from "./audio-capture";
import { AudioPlayer } from "./audio-player";
import { SentenceBuffer } from "./sentence-chunker";
import { SpeechGate } from "./speech-gate";
import { SpeakerTracker, type LabeledSpeakerTurn, type SpeakerInfo } from "./speakers";
import type { PendingSpeakers, SpeakerSource, SpeakerTurn } from "./adapters/types";
import { GloveVoiceError } from "./errors";
import { IGloveRunnable, type SubscriberAdapter, type SubscriberEventDataMap } from "glove-core";
import type { VADConfig } from "./vad";

// ─── Types ─────────────────────────────────────────────────────────────────

export type VoiceMode = "idle" | "listening" | "thinking" | "speaking";

export type TurnMode = "vad" | "manual" | "stt";

export type TTSFactory = () => TTSAdapter;

export interface GloveVoiceConfig {
  /** STT adapter — any provider implementing STTAdapter */
  stt: STTAdapter;

  /** TTS factory — returns a fresh adapter per turn. */
  createTTS: TTSFactory;

  /**
   * Turn detection mode (default: "vad").
   *
   * - "vad": VAD auto-detects speech boundaries and commits turns.
   *          Barge-in interrupts agent speech when user starts talking.
   * - "manual": Push-to-talk. Call `commitTurn()` to end the user's turn.
   *             No VAD is used — the consumer controls turn boundaries.
   *             Call `interrupt()` explicitly for barge-in behavior.
   * - "stt": The STT provider decides where the turn ends, e.g. ElevenLabs
   *          Scribe v3 Live with `commitStrategy: "turn_prediction"`. The
   *          local VAD still drives barge-in and speech gating, but it never
   *          commits: audio keeps flowing to STT after the speaker pauses so
   *          the provider can judge whether they are done. If the provider
   *          has not committed `sttTurnTimeoutMs` after the VAD heard speech
   *          end, GloveVoice commits as a fallback. Needs an adapter with
   *          `detectsTurns: true`.
   */
  turnMode?: TurnMode;

  /**
   * `turnMode: "stt"` only. How long after the local VAD hears speech end to
   * wait for the provider's commit before committing anyway (default: 2500).
   */
  sttTurnTimeoutMs?: number;

  /**
   * While the speech gate is closed, send one captured mic frame to STT this
   * often, so the provider does not close the session for being idle (Scribe
   * does after 15s without audio). The frame is real room tone, never
   * synthetic silence, which recognizers can turn into words.
   *
   * Default: 8000 when the STT adapter labels speakers, because a reconnect
   * starts speaker ids over and the labels with them; otherwise 0 (off), and
   * an idle session simply reconnects. Not sent while muted.
   */
  sttKeepAliveMs?: number;

  /**
   * Speaker awareness, for several people on one microphone.
   *
   * On by default when the STT adapter labels speakers (`stt.speakers`, e.g.
   * `ElevenLabsSTTAdapter({ diarize: true })`): the agent is told who said
   * what once a second speaker is heard, and `voice.speakers` tracks who is
   * talking and how much. Pass `false` to ignore the labels, or an object to
   * tune it.
   */
  speakers?: boolean | VoiceSpeakersConfig;

  /** Override VAD — used when turnMode is "vad" (default) or "stt". */
  vad?: VADAdapter;

  /**
   * VAD configuration — used when turnMode is "vad" or "stt" and no custom vad is provided.
   * Increase silentFrames for longer pauses before ending speech (default: 40 frames ~= 1600ms).
   */
  vadConfig?: VADConfig;

  /** Audio sample rate in Hz (default: 16000). Must match STT/TTS adapter expectations. */
  sampleRate?: number;

  /**
   * Only forward mic audio to STT while the VAD reports speech
   * (default: true in "vad" turn mode; not applicable in "manual" mode).
   *
   * With gating on, background noise never reaches the STT provider —
   * which prevents hallucinated transcripts from keyboards / traffic /
   * music, and stops billing for silence. When a speech segment opens,
   * a pre-roll buffer (`speechGatePrerollMs`) is flushed first so the
   * first syllable isn't clipped.
   *
   * With a VAD that supports confirmed speech (`SileroVADAdapter`), audio
   * is held until speech survives the minimum-duration filter, so short
   * noise bursts are discarded entirely. Set to `false` to restore the
   * old always-streaming behavior.
   */
  speechGating?: boolean;

  /**
   * Pre-roll audio (ms) flushed to STT when a gated speech segment opens
   * (default: 800 — matches Silero's preSpeechPadMs).
   */
  speechGatePrerollMs?: number;

  /**
   * Extra `getUserMedia` audio constraints merged over the defaults
   * (echoCancellation / noiseSuppression / autoGainControl / voiceIsolation
   * all default to true). Use to pick a device or opt out of a default.
   * Browser-only — custom `audio` implementations may ignore it.
   */
  micConstraints?: MediaTrackConstraints;

  /**
   * Platform audio IO. Defaults to the browser implementations
   * (getUserMedia + AudioWorklet capture, Web Audio playback).
   *
   * On React Native / Expo, pass `createNativeAudioIO()` from
   * `glove-voice-native` — the rest of the pipeline (VAD, speech gating,
   * STT/TTS adapters, barge-in) is platform-neutral and runs unchanged.
   */
  audio?: AudioIO;

  /**
   * Start the pipeline with mic muted (default: false).
   *
   * When true, `start()` initializes the full pipeline (mic, STT, speaker)
   * but does not forward audio to STT/VAD until `unmute()` is called.
   *
   * Defaults to `true` when `turnMode` is `"manual"` — in push-to-talk
   * the consumer controls when audio flows, so starting muted avoids
   * the race between `start()` resolving and calling `mute()`.
   */
  startMuted?: boolean;
}

export interface VoiceSpeakersConfig {
  /**
   * When the agent's input carries speaker labels (default: "auto").
   *
   * - "auto": plain text while only one speaker has been heard; from the
   *   moment a second one appears, every line starts with who said it
   *   (`[Speaker A] ...`) and stays that way.
   * - "always": label from the first utterance.
   * - "never": never label; speakers are still tracked for `voice.speakers`.
   */
  label?: "auto" | "always" | "never";
  /**
   * How long to wait for the provider's speaker labels after an utterance is
   * finalized before using draft labels or plain text (default: 350ms). The
   * wait is skipped while one known speaker is the only one talking.
   */
  waitMs?: number;
  /** Names for provider speaker ids known ahead of time, e.g. `{ speaker_0: "Sarah" }`. */
  names?: Record<string, string>;
  /** Build the agent's text yourself from the labelled turns. */
  format?: (turns: LabeledSpeakerTurn[], plainText: string) => string;
}

type GloveVoiceEvents = {
  mode: [mode: VoiceMode];
  /** partial=true while user is still speaking */
  transcript: [text: string, partial: boolean];
  /** Glove's text response, fires before TTS audio starts */
  response: [text: string];
  error: [error: GloveVoiceError | Error];
  /** Raw mic PCM chunk — emitted even when muted, for visualization */
  audio_chunk: [pcm: Int16Array];
  /** The speaker list changed: someone new, new stats, a merge or a name. */
  speakers: [speakers: SpeakerInfo[]];
  /** Who said the utterance that was just sent to the agent. `text` is the plain transcript. */
  speaker_turns: [turns: LabeledSpeakerTurn[], text: string];
};

// ─── GloveVoice ────────────────────────────────────────────────────────────

/**
 * Wraps a Glove instance with a full-duplex voice pipeline.
 *
 *   Mic → VAD → STTAdapter → glove.processRequest() → TTSAdapter → Speaker
 *
 * Glove is the intelligence layer. STT/TTS are swappable adapters.
 * All Glove tools, displayManager, and context management work normally.
 *
 * @example VAD mode (default) — hands-free
 * const voice = new GloveVoice(glove, {
 *   stt: new ElevenLabsSTTAdapter({ getToken: ... }),
 *   createTTS: () => new ElevenLabsTTSAdapter({ getToken: ..., voiceId: "..." }),
 * });
 * voice.on("mode", mode => updateUI(mode));
 * await voice.start();
 *
 * @example Provider turn detection — Scribe v3 Live decides when you're done
 * const voice = new GloveVoice(glove, {
 *   stt: new ElevenLabsSTTAdapter({ getToken: ..., commitStrategy: "turn_prediction" }),
 *   createTTS: () => new ElevenLabsTTSAdapter({ getToken: ..., voiceId: "..." }),
 *   turnMode: "stt",
 * });
 *
 * @example Manual mode — push-to-talk
 * const voice = new GloveVoice(glove, {
 *   stt: new ElevenLabsSTTAdapter({ getToken: ... }),
 *   createTTS: () => new ElevenLabsTTSAdapter({ getToken: ..., voiceId: "..." }),
 *   turnMode: "manual",
 * });
 * await voice.start();
 * // User holds button → releases → call commitTurn()
 * voice.commitTurn();
 */
export class GloveVoice extends EventEmitter<GloveVoiceEvents> {
  private mode: VoiceMode = "idle";
  private capture: AudioCaptureAdapter | null = null;
  private player: AudioPlayerAdapter | null = null;
  private vad: VADAdapter | null = null;
  private abortController: AbortController | null = null;
  private activeTTS: TTSAdapter | null = null;
  private turnId = 0;
  private turnMode: TurnMode;
  private sampleRate: number;
  private muted = false;
  private narrateAbort: (() => void) | null = null;
  private gate: SpeechGate | null = null;
  /** turnMode "stt": fallback commit if the provider never ends the turn. */
  private sttTurnTimer: ReturnType<typeof setTimeout> | null = null;
  /** turnMode "stt": the provider committed since the speaker last started. */
  private providerCommitted = false;
  /** turnMode "stt": a tentative speech start paused the fallback; a misfire restores it. */
  private sttFallbackSuspended = false;

  // Speaker awareness (see `speakers` in the config)
  private readonly speakerTracker = new SpeakerTracker();
  private speakerSource: SpeakerSource | null = null;
  private speakerCfg: VoiceSpeakersConfig = {};
  private speakerCleanup: (() => void)[] = [];
  private pendingNames = new Map<string, string>();
  /** True once the agent's input is labelled; it then stays labelled. */
  private labelling = false;
  /** Keeps utterances in order while their speaker labels are awaited. */
  private attribution: Promise<void> = Promise.resolve();
  /** Bumped on stop(), so work queued for an old session is dropped. */
  private session = 0;
  /** When audio last went to STT, for `sttKeepAliveMs`. */
  private lastSttAudioAt = 0;

  // Bound handlers for listener cleanup
  private sttHandlers: { partial: (t: string) => void; final: (t: string) => void; error: (e: Error) => void } | null = null;
  private vadHandlers: {
    speech_start: () => void;
    speech_end: () => void;
    speech_real_start?: () => void;
    vad_misfire?: () => void;
  } | null = null;
  private captureHandlers: { chunk: (pcm: Int16Array) => void; error: (e: Error) => void } | null = null;

  constructor(
    private readonly glove: IGloveRunnable,
    private readonly cfg: GloveVoiceConfig
  ) {
    super();
    this.turnMode = cfg.turnMode ?? "vad";
    this.sampleRate = cfg.sampleRate ?? 16_000;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.mode !== "idle") throw new Error("GloveVoice already started");
    if (this.turnMode === "manual" && this.cfg.stt.detectsTurns) {
      console.warn(
        "[GloveVoice] turnMode \"manual\" with an STT adapter that ends turns on its own " +
          "(detectsTurns: true). The provider will commit whenever the speaker pauses, so a " +
          "push-to-talk hold can be split into several turns. Use commitStrategy: \"manual\" " +
          "on the adapter for push-to-talk, or turnMode: \"stt\".",
      );
    }
    if (this.turnMode === "stt" && !this.cfg.stt.detectsTurns) {
      throw new Error(
        'GloveVoice turnMode "stt" needs an STT adapter that detects turns ' +
          '(detectsTurns: true), e.g. ElevenLabsSTTAdapter with commitStrategy: "turn_prediction".',
      );
    }

    this.player = this.cfg.audio
      ? this.cfg.audio.createPlayer(this.sampleRate)
      : new AudioPlayer(this.sampleRate);
    await this.player.init();

    // Create bound handlers so we can remove them on stop()
    this.sttHandlers = {
      partial: (text) => {
        console.debug(`[GloveVoice] STT partial: "${text}"`);
        if (this.mode === "listening") this.emit("transcript", text, true);
        // turnMode "stt": words are arriving while nobody is speaking and no
        // fallback is waiting. That is speech the provider has heard but not
        // committed, for example an utterance whose fallback was cancelled by
        // a late commit for the one before it. Make sure it gets committed.
        if (
          this.turnMode === "stt" &&
          text.trim() &&
          this.mode !== "idle" &&
          !this.vad?.isSpeaking &&
          !this.sttTurnTimer &&
          !this.sttFallbackSuspended
        ) {
          this.armSttTurnTimer();
        }
      },
      final: (text) => {
        console.debug(`[GloveVoice] STT final: "${text}"`);
        if (this.turnMode === "stt") this.onProviderCommit(text.trim().length > 0);
        if (!text.trim()) return;
        this.emit("transcript", text, false);
        const source = this.speakerSource;
        if (!source) {
          void this.handleTurn(text);
          return;
        }
        // Ask now, while this is still the adapter's latest utterance.
        const pending = source.forFinal();
        const session = this.session;
        const step = this.attribution.then(() => this.attribute(text, pending, session));
        this.attribution = step.then(
          () => undefined,
          () => undefined,
        );
        void step
          .catch(() => text)
          .then((forAgent) => {
            if (session !== this.session || this.mode === "idle") return;
            void this.handleTurn(forAgent);
          });
      },
      error: (err) => {
        console.debug(`[GloveVoice] STT error:`, err);
        this.emit("error", err);
      },
    };

    this.setupSpeakers();

    this.cfg.stt.on("partial", this.sttHandlers.partial);
    this.cfg.stt.on("final", this.sttHandlers.final);
    this.cfg.stt.on("error", this.sttHandlers.error);

    // VAD mode: auto-detect speech boundaries + barge-in.
    // STT mode: the same VAD gates audio and drives barge-in; the provider commits.
    if (this.turnMode === "vad" || this.turnMode === "stt") {
      const providerTurns = this.turnMode === "stt";
      if (this.cfg.vad) {
        this.vad = this.cfg.vad;
      } else {
        const { VAD } = await import("./vad");
        // Default: ~1600ms of trailing silence for natural pauses
        this.vad = new VAD(this.cfg.vadConfig ?? { silenceMs: 1600 });
      }
      const vad = this.vad;

      // ── Speech gating ──────────────────────────────────────────────────
      // On by default: STT only receives audio for speech segments (plus a
      // pre-roll), so background noise is never transcribed. With a VAD
      // that confirms speech (Silero), audio is held until speech survives
      // the minimum-duration filter — noise bursts are discarded entirely.
      const gating = this.cfg.speechGating ?? true;
      const confirms = vad.supportsRealStart === true;
      this.gate = gating
        ? new SpeechGate({
            sampleRate: this.sampleRate,
            prerollMs: this.cfg.speechGatePrerollMs,
          })
        : null;

      const flushToSTT = (chunks: Int16Array[]) => {
        for (const chunk of chunks) this.cfg.stt.sendAudio(chunk);
      };

      // Barge-in on *confirmed* speech when the VAD can tell the
      // difference, so a door slam doesn't cut the agent off mid-sentence.
      const bargeIn = () => {
        if (this.mode === "thinking" || this.mode === "speaking") {
          // Don't barge-in when a blocking UI (e.g. checkout form) is active —
          // its pushAndWait resolver is still pending in the display manager.
          if (this.glove.displayManager.resolverStore.size > 0) return;
          this.interrupt();
        }
      };

      this.vadHandlers = {
        speech_start: () => {
          if (providerTurns) {
            if (confirms) {
              // Tentative: this may be a noise burst. Pause the fallback and
              // let speech_real_start drop it or vad_misfire restore it.
              if (this.sttTurnTimer) {
                this.clearSttTurnTimer();
                this.sttFallbackSuspended = true;
              }
            } else {
              // The speaker resumed: the provider is still judging this turn.
              this.clearSttTurnTimer();
              this.providerCommitted = false;
            }
          }
          if (this.gate) {
            // Tentative-capable VADs hold audio until confirmation;
            // others open the gate immediately.
            if (confirms) this.gate.hold();
            else flushToSTT(this.gate.open());
          }
          if (!confirms) bargeIn();
        },
        speech_end: () => {
          if (providerTurns) {
            if (this.gate && !this.gate.isOpen) return;
            // The provider already ended this turn and has heard nothing
            // since: the segment is done.
            if (this.providerCommitted && !this.cfg.stt.currentPartial.trim()) {
              this.gate?.close();
              return;
            }
            // Keep streaming: the provider needs the pause to decide the
            // turn is over. The gate closes when it commits, or the fallback
            // commits for it.
            this.armSttTurnTimer();
            return;
          }
          // Only finalize when STT actually received this segment.
          if (!this.gate || this.gate.isOpen) this.cfg.stt.flushUtterance();
          this.gate?.close();
        },
      };

      if (confirms) {
        this.vadHandlers.speech_real_start = () => {
          if (providerTurns) {
            // Confirmed: the speaker resumed and the provider is still judging.
            this.sttFallbackSuspended = false;
            this.clearSttTurnTimer();
            this.providerCommitted = false;
          }
          // Open the gate BEFORE barge-in: interrupt() resets the VAD, and
          // the buffered pre-roll + confirmed speech must reach STT first.
          if (this.gate) flushToSTT(this.gate.open());
          bargeIn();
        };
        this.vadHandlers.vad_misfire = () => {
          if (providerTurns && this.sttFallbackSuspended) {
            // It was noise. The utterance before it still needs its fallback.
            this.sttFallbackSuspended = false;
            this.armSttTurnTimer();
          }
          if (this.gate) {
            // STT never saw the audio — drop it silently.
            this.gate.cancel();
          } else if (!providerTurns) {
            // Ungated: STT has the audio; keep the old behavior of
            // finalizing so short utterances still get transcribed.
            // (In "stt" mode the provider decides.)
            this.cfg.stt.flushUtterance();
          }
        };
        vad.on("speech_real_start", this.vadHandlers.speech_real_start);
        vad.on("vad_misfire", this.vadHandlers.vad_misfire);
      }

      vad.on("speech_end", this.vadHandlers.speech_end);
      vad.on("speech_start", this.vadHandlers.speech_start);
    }

    // Mic → VAD → (gate) → STT
    this.capture = this.cfg.audio
      ? this.cfg.audio.createCapture(this.sampleRate, this.cfg.micConstraints)
      : new AudioCapture(this.sampleRate, this.cfg.micConstraints);

    const keepAliveMs =
      this.cfg.sttKeepAliveMs ?? (this.speakerSource ? 8000 : 0);
    this.lastSttAudioAt = Date.now();

    this.captureHandlers = {
      chunk: (pcm) => {
        if (this.mode === "idle") return;
        this.emit("audio_chunk", pcm);
        if (this.muted) return;
        this.vad?.process(pcm);
        if (this.gate) {
          const out = this.gate.feed(pcm);
          const now = Date.now();
          if (out.length > 0) {
            for (const chunk of out) this.cfg.stt.sendAudio(chunk);
            this.lastSttAudioAt = now;
          } else if (
            keepAliveMs > 0 &&
            !this.gate.isPending &&
            now - this.lastSttAudioAt >= keepAliveMs
          ) {
            // Gate closed and STT has heard nothing for a while: one frame of
            // room tone keeps the session (and its speaker ids) alive.
            this.cfg.stt.sendAudio(pcm);
            this.lastSttAudioAt = now;
          }
        } else {
          this.cfg.stt.sendAudio(pcm);
        }
      },
      error: (err) => this.emit("error", err),
    };

    this.capture.on("chunk", this.captureHandlers.chunk);
    this.capture.on("error", this.captureHandlers.error);

    // Connect STT then start mic
    try {
      await this.cfg.stt.connect();
      await this.capture.init();
    } catch (err) {
      // A failed start must not leave the speaker subscription and the
      // context provider behind: a retry would register them again.
      for (const cleanup of this.speakerCleanup.splice(0)) cleanup();
      this.speakerSource = null;
      throw err;
    }

    // In manual mode, start muted by default so the consumer controls
    // when audio flows (push-to-talk). Explicit startMuted overrides.
    const shouldMute = this.cfg.startMuted ?? (this.turnMode === "manual");
    if (shouldMute) this.muted = true;

    this.setMode("listening");
  }

  async stop(): Promise<void> {
    this.interrupt();
    this.clearSttTurnTimer();
    this.session += 1;
    this.sttFallbackSuspended = false;
    for (const cleanup of this.speakerCleanup.splice(0)) cleanup();
    this.speakerSource = null;

    // Remove all listeners we registered
    if (this.sttHandlers) {
      this.cfg.stt.off("partial", this.sttHandlers.partial);
      this.cfg.stt.off("final", this.sttHandlers.final);
      this.cfg.stt.off("error", this.sttHandlers.error);
      this.sttHandlers = null;
    }
    if (this.vadHandlers && this.vad) {
      this.vad.off("speech_end", this.vadHandlers.speech_end);
      this.vad.off("speech_start", this.vadHandlers.speech_start);
      if (this.vadHandlers.speech_real_start) {
        this.vad.off("speech_real_start", this.vadHandlers.speech_real_start);
      }
      if (this.vadHandlers.vad_misfire) {
        this.vad.off("vad_misfire", this.vadHandlers.vad_misfire);
      }
      this.vadHandlers = null;
    }
    if (this.captureHandlers && this.capture) {
      this.capture.off("chunk", this.captureHandlers.chunk);
      this.capture.off("error", this.captureHandlers.error);
      this.captureHandlers = null;
    }

    await this.capture?.destroy();
    this.cfg.stt.disconnect();
    await this.player?.destroy();
    this.capture = null;
    this.player = null;
    this.vad = null;
    this.gate = null;
    this.muted = false;
    this.setMode("idle");
  }

  /**
   * Abort in-flight Glove request + stop TTS playback.
   * Automatically called on barge-in (VAD mode) or manually by consumer.
   */
  interrupt(): void {
    console.debug(`[GloveVoice] interrupt() called — aborting request, clearing TTS/audio/slots`);

    // Abort any in-flight Glove request
    this.abortController?.abort(new DOMException("interrupted", "AbortError"));
    this.abortController = null;

    // Resolve any in-flight narrate() before destroying TTS/player
    this.narrateAbort?.();
    this.narrateAbort = null;

    // Destroy active TTS session
    this.activeTTS?.destroy();
    this.activeTTS = null;

    // Immediately stop audio playback
    this.player?.stop();

    // Clear display slots — but only non-blocking ones.
    // If there are pending pushAndWait resolvers (e.g. checkout form),
    // the unAbortable tool is still running and needs its UI.
    if (this.glove.displayManager.resolverStore.size === 0) {
      void this.glove.displayManager.clearStack();
    }

    // Reset VAD state
    this.vad?.reset();

    // A gate stuck holding tentative audio would otherwise fail-open later —
    // drop the tentative buffer. An OPEN gate is left alone: barge-in happens
    // mid-utterance and the segment's speech_end will close it.
    if (this.gate?.isPending) this.gate.cancel();

    if (this.mode !== "idle") this.setMode("listening");
  }

  /**
   * Manual turn commit — flush the current utterance to STT.
   * Use in "manual" turnMode (push-to-talk). Also works in "vad" mode
   * as an explicit override (e.g. a "send" button).
   */
  commitTurn(): void {
    console.debug(`[GloveVoice] commitTurn() called — mode=${this.mode}, stt.isConnected=${this.cfg.stt.isConnected}`);
    if (this.mode !== "listening") return;
    this.cfg.stt.flushUtterance();
  }

  /** Stop forwarding mic audio to STT/VAD. Audio chunks still emitted for visualization. */
  mute(): void {
    this.muted = true;
  }

  /** Resume forwarding mic audio to STT/VAD. */
  unmute(): void {
    this.muted = false;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Speak arbitrary text through TTS without involving the model.
   * Resolves when all audio has finished playing.
   *
   * Auto-mutes the mic during narration to prevent feedback into STT/VAD.
   * Safe to call from `pushAndWait` tool handlers.
   *
   * @example
   * // Inside a tool's pushAndWait handler:
   * await voice.narrate("Here is your order summary.");
   */
  async narrate(text: string): Promise<void> {
    if (!this.player) throw new Error("GloveVoice not started");

    const wasMuted = this.muted;
    this.mute();

    const tts = this.cfg.createTTS();
    this.activeTTS = tts;
    const buffer = new SentenceBuffer();

    // Track whether this narration was interrupted so we can resolve
    // instead of hanging when interrupt() destroys the TTS + clears the player.
    let interrupted = false;

    tts.on("audio_chunk", (chunk) => {
      if (!interrupted) this.player!.enqueue(chunk);
    });

    try {
      await tts.open();

      for (const sentence of buffer.push(text)) {
        tts.sendText(sentence);
      }
      const remainder = buffer.flush();
      if (remainder) tts.sendText(remainder);
      tts.flush();

      await new Promise<void>((resolve, reject) => {
        // interrupt() calls narrateAbort before destroying TTS/player,
        // so we resolve cleanly instead of hanging.
        this.narrateAbort = () => {
          interrupted = true;
          resolve();
        };

        tts.on("done", () => {
          this.player!.onDrained(resolve);
        });
        tts.on("error", (err) => {
          // TTS adapters may emit an error when destroyed mid-stream.
          // If already aborted by interrupt(), just resolve.
          if (interrupted) return;
          reject(err);
        });
      });
    } finally {
      this.narrateAbort = null;
      // Only destroy if interrupt() hasn't already done it
      if (this.activeTTS === tts) {
        tts.destroy();
        this.activeTTS = null;
      }
      if (!wasMuted) this.unmute();
    }
  }

  get currentMode(): VoiceMode {
    return this.mode;
  }

  get isActive(): boolean {
    return this.mode !== "idle";
  }

  // ─── Speakers ──────────────────────────────────────────────────────────────

  /**
   * Everyone heard on the microphone so far, with labels and how much each
   * has talked. Empty unless the STT adapter labels speakers.
   */
  get speakers(): SpeakerInfo[] {
    return this.speakerTracker.list();
  }

  /**
   * Who has done most of the talking, overall or over the last `windowMs`.
   * Talking most is not the same as talking to the agent: treat it as a hint.
   */
  dominantSpeaker(windowMs?: number): SpeakerInfo | null {
    return this.speakerTracker.dominant(windowMs);
  }

  /**
   * Give a speaker a name; their lines are labelled with it from then on.
   * Accepts the provider id ("speaker_0"), the current label ("Speaker A")
   * or an earlier name. Returns false if nobody matches.
   */
  nameSpeaker(idOrLabel: string, name: string): boolean {
    const ok = this.speakerTracker.name(idOrLabel, name);
    if (ok) this.emit("speakers", this.speakerTracker.list());
    return ok;
  }

  private setupSpeakers(): void {
    const option = this.cfg.speakers;
    const source = this.cfg.stt.speakers;
    if (option === false || !source?.enabled) return;

    this.speakerCfg = typeof option === "object" ? option : {};
    this.speakerSource = source;
    // A new STT session starts its speaker ids over.
    this.speakerTracker.reset();
    this.labelling = this.speakerCfg.label === "always";
    this.pendingNames = new Map(Object.entries(this.speakerCfg.names ?? {}));

    this.speakerCleanup.push(
      source.subscribe({
        segment: (turns) => {
          this.speakerTracker.record(turns);
          this.speakersChanged();
        },
        merged: (from, to) => {
          this.speakerTracker.merge(from, to);
          this.speakersChanged();
        },
        reset: () => {
          // The STT session reconnected and numbers its speakers afresh, so
          // earlier ids, names and stats no longer apply to them.
          this.speakerTracker.restart();
          this.pendingNames.clear();
          this.emit("speakers", this.speakerTracker.list());
        },
      }),
    );

    // Tell the agent how to read the labels, who is here and who talks most.
    // Read once per request and never saved, so it is always current.
    const unregister = this.glove.addContextProvider?.(
      () =>
        this.labelling
          ? `<voice-speakers>\n${this.speakerTracker.describe()}\n</voice-speakers>`
          : null,
      { delivery: "request" },
    );
    if (unregister) this.speakerCleanup.push(unregister);
  }

  private speakersChanged(): void {
    for (const [id, name] of this.pendingNames) {
      if (this.speakerTracker.has(id) && this.speakerTracker.name(id, name)) {
        this.pendingNames.delete(id);
      }
    }
    if (this.speakerCfg.label !== "never" && this.speakerTracker.count >= 2) this.labelling = true;
    this.emit("speakers", this.speakerTracker.list());
  }

  /** Work out who said `text` and return what the agent should read. */
  private async attribute(text: string, pending: PendingSpeakers, session: number): Promise<string> {
    // A stop() since this utterance was queued: leave the tracker alone, it
    // may already belong to a new session.
    if (session !== this.session) return text;
    const cfg = this.speakerCfg;
    const tracker = this.speakerTracker;
    const draft = pending.draft;

    let turns: SpeakerTurn[] | null;
    if (cfg.label === "never") {
      turns = draft;
    } else if (!this.labelling && this.isLoneKnownSpeaker(draft)) {
      // One person, the same one as before: nothing to wait for.
      turns = draft;
    } else {
      turns = (await this.settledWithin(pending, cfg.waitMs ?? 350)) ?? draft;
      if (session !== this.session) return text;
    }
    if (!turns || turns.length === 0) return text;

    if (tracker.observe(turns)) this.speakersChanged();

    // The finalized transcript is what was said, down to its punctuation.
    // Labels only say where each speaker's part starts and ends: they are
    // laid over the final text when they cover the same words. Draft labels
    // come from an earlier partial and can be missing its end.
    const aligned = alignToFinal(turns, text);
    if (aligned) {
      turns = aligned;
    } else {
      const ids = new Set(turns.map((t) => t.speakerId));
      const only = ids.size === 1 ? turns[0].speakerId : null;
      if (!only) return text;
      turns = [{ speakerId: only, text }];
    }

    const labeled = tracker.labelTurns(turns);
    this.emit("speaker_turns", labeled, text);
    if (!this.labelling || !labeled.some((t) => t.label)) return text;

    const formatted = tracker.format(turns);
    return cfg.format ? cfg.format(labeled, text) : formatted;
  }

  private isLoneKnownSpeaker(draft: SpeakerTurn[] | null): boolean {
    if (!draft || draft.length === 0) return false;
    const first = draft[0].speakerId;
    if (!first || draft.some((t) => t.speakerId !== first)) return false;
    const tracker = this.speakerTracker;
    return tracker.count === 0 || (tracker.count === 1 && tracker.has(first));
  }

  private settledWithin(pending: PendingSpeakers, ms: number): Promise<SpeakerTurn[] | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      pending.settled.then(
        (turns) => {
          clearTimeout(timer);
          resolve(turns);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
  }

  // ─── Provider turn detection (turnMode "stt") ──────────────────────────────

  /**
   * The provider ended the turn: stop the fallback and close the gate.
   *
   * When a turn follows, the gate closes even if the VAD still hears speech.
   * handleTurn() interrupts, which resets the VAD without a speech_end, so
   * nothing later would close it and silence would keep streaming to STT. If
   * the speaker carries on, the VAD starts a new segment and the gate's
   * pre-roll covers the gap.
   */
  private onProviderCommit(turnFollows: boolean): void {
    this.clearSttTurnTimer();
    this.sttFallbackSuspended = false;
    this.providerCommitted = true;
    if (this.gate?.isOpen && (turnFollows || !this.vad?.isSpeaking)) this.gate.close();
  }

  private armSttTurnTimer(): void {
    this.clearSttTurnTimer();
    const ms = this.cfg.sttTurnTimeoutMs ?? 2500;
    this.sttTurnTimer = setTimeout(() => {
      this.sttTurnTimer = null;
      if (this.mode === "idle") return;
      console.debug(`[GloveVoice] provider did not commit within ${ms}ms — committing`);
      this.cfg.stt.flushUtterance();
      this.gate?.close();
    }, ms);
  }

  private clearSttTurnTimer(): void {
    if (this.sttTurnTimer) {
      clearTimeout(this.sttTurnTimer);
      this.sttTurnTimer = null;
    }
  }

  // ─── Core pipeline ────────────────────────────────────────────────────────

  private async handleTurn(transcript: string): Promise<void> {
    console.debug(`[GloveVoice] handleTurn("${transcript}")`);
    this.interrupt();

    const myTurnId = ++this.turnId;
    const stale = () => signal.aborted || this.turnId !== myTurnId;

    this.setMode("thinking");
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // ── Streaming TTS ────────────────────────────────────────────────────────
    // Text tokens stream through SentenceBuffer → TTS in real-time.
    // Each model_response_complete flushes the current TTS session and prepares
    // a fresh adapter for the next model response (after tool execution).
    // All text across the turn is spoken — tool-calling responses included.

    const buffer = new SentenceBuffer();
    let ttsGeneration = 0;
    const stream = {
      tts: null as TTSAdapter | null,
      ttsReady: null as Promise<boolean> | null,
      responseText: "",
    };

    const openFreshTTS = () => {
      const myGen = ++ttsGeneration;
      const tts = this.cfg.createTTS();
      stream.tts = tts;
      this.activeTTS = tts;

      tts.on("audio_chunk", (chunk) => {
        if (stale()) return;
        if (this.mode !== "speaking") this.setMode("speaking");
        this.player!.enqueue(chunk);
      });

      // Only the LAST TTS adapter's done event triggers the listening transition.
      // Earlier adapters (from intermediate model responses) finish on their own.
      tts.on("done", () => {
        if (ttsGeneration !== myGen || stale()) return;
        this.player!.onDrained(() => {
          if (this.mode !== "idle") this.setMode("listening");
        });
      });

      tts.on("error", (err) => {
        this.emit("error", err);
        if (this.mode !== "idle") this.setMode("listening");
      });

      stream.ttsReady = tts.open().then(
        () => { console.debug(`[GloveVoice] TTS ready`); return true; },
        (err) => { console.error(`[GloveVoice] TTS open failed:`, err); return false; },
      );
    };

    const sendSentence = async (sentence: string) => {
      if (!stream.tts || !stream.ttsReady || stale()) return;
      const ok = await stream.ttsReady;
      if (!ok || stale()) return;
      stream.tts.sendText(sentence);
    };

    // ── Subscriber: text_delta → SentenceBuffer → TTS ────────────────────────

    let compacting = false;

    const subscriber: SubscriberAdapter = {
      record: async (event_type, data) => {
        if (stale()) return;

        if (event_type === "compaction_start") {
          compacting = true;
          return;
        }
        if (event_type === "compaction_end") {
          compacting = false;
          return;
        }

        if (event_type === "text_delta") {
          // Don't narrate the compaction summary
          if (compacting) return;
          const e = data as SubscriberEventDataMap["text_delta"];
          stream.responseText += e.text;

          // Open TTS lazily on first text — avoids opening for tool-only responses
          if (!stream.tts) {
            console.debug(`[GloveVoice] text_delta — opening TTS`);
            openFreshTTS();
          }

          for (const sentence of buffer.push(e.text)) {
            console.debug(`[GloveVoice] streaming sentence to TTS: "${sentence.slice(0, 60)}"`);
            await sendSentence(sentence);
          }
        } else if (event_type === "model_response_complete") {
          // End of one model response. Flush any partial sentence, close this
          // TTS session, and null out so the next text_delta opens a fresh one.
          // This avoids ElevenLabs' 20s idle timeout during tool execution.
          const remainder = buffer.flush();
          if (remainder) {
            console.debug(`[GloveVoice] flushing remainder: "${remainder.slice(0, 60)}"`);
            await sendSentence(remainder);
          }
          if (stream.tts && stream.ttsReady && !stale()) {
            const ok = await stream.ttsReady;
            if (ok && !stale()) stream.tts.flush();
          }
          stream.tts = null;
          stream.ttsReady = null;
        }
      },
    };

    this.glove.addSubscriber(subscriber);

    try {
      console.debug(`[GloveVoice] calling processRequest...`);
      await this.glove.processRequest(transcript, signal);

      if (stale()) {
        stream.tts?.destroy();
        return;
      }

      if (stream.responseText) {
        this.emit("response", stream.responseText);
      } else {
        console.debug(`[GloveVoice] no response text — returning to listening`);
        if (this.mode !== "idle") this.setMode("listening");
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err ?? "unknown error"));
      const isAbort =
        e.name === "AbortError" ||
        e.message === "interrupted" ||
        e.message.includes("aborted") ||
        (typeof err === "string" && err === "interrupted");

      if (isAbort) {
        console.debug(`[GloveVoice] handleTurn aborted:`, e.message);
      } else {
        console.error(`[GloveVoice] handleTurn error:`, e.message);
        this.emit("error", new GloveVoiceError("ERR_GLOVE_REQUEST", e.message, { cause: e }));
      }

      stream.tts?.destroy();
      if (this.mode !== "idle") this.setMode("listening");
    } finally {
      this.glove.removeSubscriber(subscriber);
    }
  }

  // ─── Util ─────────────────────────────────────────────────────────────────

  private setMode(mode: VoiceMode): void {
    if (this.mode === mode) return;
    console.debug(`[GloveVoice] ${this.mode} → ${mode}`);
    this.mode = mode;
    this.emit("mode", mode);
  }
}

/** The words of a transcript, ignoring case, punctuation and spacing. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Speaker turns with the wording of the finalized transcript: each turn keeps
 * its speaker and takes its stretch of `text`, so the final's punctuation and
 * casing survive. Null when the turns do not cover the same words as `text`,
 * or a boundary falls inside one of its tokens.
 */
function alignToFinal(turns: SpeakerTurn[], text: string): SpeakerTurn[] | null {
  const counts = turns.map((t) => wordsOf(t.text).length);
  const spoken = turns.flatMap((t) => wordsOf(t.text));
  const final = wordsOf(text);
  if (spoken.length !== final.length || spoken.some((w, i) => w !== final[i])) return null;

  const tokens = text.trim().split(/\s+/);
  const out: SpeakerTurn[] = [];
  let at = 0;
  for (let i = 0; i < turns.length; i++) {
    if (counts[i] === 0) continue; // a turn of sounds only; its tokens join a neighbour
    const piece: string[] = [];
    let have = 0;
    while (at < tokens.length && have < counts[i]) {
      have += wordsOf(tokens[at]).length;
      piece.push(tokens[at++]);
    }
    if (have !== counts[i]) return null;
    // Tokens without a word ("-", "...") stay with the turn they follow.
    while (at < tokens.length && wordsOf(tokens[at]).length === 0) piece.push(tokens[at++]);
    out.push({ ...turns[i], text: piece.join(" ") });
  }
  return out.length > 0 ? out : null;
}
