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
import { GloveVoiceError } from "./errors";
import { IGloveRunnable, type SubscriberAdapter, type SubscriberEventDataMap } from "glove-core";
import type { VADConfig } from "./vad";

// ─── Types ─────────────────────────────────────────────────────────────────

export type VoiceMode = "idle" | "listening" | "thinking" | "speaking";

export type TurnMode = "vad" | "manual";

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
   */
  turnMode?: TurnMode;

  /** Override VAD — only used when turnMode is "vad" (default). */
  vad?: VADAdapter;

  /**
   * VAD configuration — only used when turnMode is "vad" and no custom vad is provided.
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

type GloveVoiceEvents = {
  mode: [mode: VoiceMode];
  /** partial=true while user is still speaking */
  transcript: [text: string, partial: boolean];
  /** Glove's text response, fires before TTS audio starts */
  response: [text: string];
  error: [error: GloveVoiceError | Error];
  /** Raw mic PCM chunk — emitted even when muted, for visualization */
  audio_chunk: [pcm: Int16Array];
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

    this.player = this.cfg.audio
      ? this.cfg.audio.createPlayer(this.sampleRate)
      : new AudioPlayer(this.sampleRate);
    await this.player.init();

    // Create bound handlers so we can remove them on stop()
    this.sttHandlers = {
      partial: (text) => {
        console.debug(`[GloveVoice] STT partial: "${text}"`);
        if (this.mode === "listening") this.emit("transcript", text, true);
      },
      final: (text) => {
        console.debug(`[GloveVoice] STT final: "${text}"`);
        if (!text.trim()) return;
        this.emit("transcript", text, false);
        void this.handleTurn(text);
      },
      error: (err) => {
        console.debug(`[GloveVoice] STT error:`, err);
        this.emit("error", err);
      },
    };

    this.cfg.stt.on("partial", this.sttHandlers.partial);
    this.cfg.stt.on("final", this.sttHandlers.final);
    this.cfg.stt.on("error", this.sttHandlers.error);

    // VAD mode: auto-detect speech boundaries + barge-in
    if (this.turnMode === "vad") {
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
          if (this.gate) {
            // Tentative-capable VADs hold audio until confirmation;
            // others open the gate immediately.
            if (confirms) this.gate.hold();
            else flushToSTT(this.gate.open());
          }
          if (!confirms) bargeIn();
        },
        speech_end: () => {
          // Only finalize when STT actually received this segment.
          if (!this.gate || this.gate.isOpen) this.cfg.stt.flushUtterance();
          this.gate?.close();
        },
      };

      if (confirms) {
        this.vadHandlers.speech_real_start = () => {
          // Open the gate BEFORE barge-in: interrupt() resets the VAD, and
          // the buffered pre-roll + confirmed speech must reach STT first.
          if (this.gate) flushToSTT(this.gate.open());
          bargeIn();
        };
        this.vadHandlers.vad_misfire = () => {
          if (this.gate) {
            // STT never saw the audio — drop it silently.
            this.gate.cancel();
          } else {
            // Ungated: STT has the audio; keep the old behavior of
            // finalizing so short utterances still get transcribed.
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

    this.captureHandlers = {
      chunk: (pcm) => {
        if (this.mode === "idle") return;
        this.emit("audio_chunk", pcm);
        if (this.muted) return;
        this.vad?.process(pcm);
        if (this.gate) {
          for (const chunk of this.gate.feed(pcm)) this.cfg.stt.sendAudio(chunk);
        } else {
          this.cfg.stt.sendAudio(pcm);
        }
      },
      error: (err) => this.emit("error", err),
    };

    this.capture.on("chunk", this.captureHandlers.chunk);
    this.capture.on("error", this.captureHandlers.error);

    // Connect STT then start mic
    await this.cfg.stt.connect();
    await this.capture.init();

    // In manual mode, start muted by default so the consumer controls
    // when audio flows (push-to-talk). Explicit startMuted overrides.
    const shouldMute = this.cfg.startMuted ?? (this.turnMode === "manual");
    if (shouldMute) this.muted = true;

    this.setMode("listening");
  }

  async stop(): Promise<void> {
    this.interrupt();

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
