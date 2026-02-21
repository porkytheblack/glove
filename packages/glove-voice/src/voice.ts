import EventEmitter from "eventemitter3";
import type { STTAdapter, TTSAdapter, VADAdapter } from "./adapters/types";
import { AudioCapture } from "./audio-capture";
import { AudioPlayer } from "./audio-player";
import { SentenceBuffer } from "./sentence-chunker";
import { GloveVoiceError } from "./errors";
import { IGloveRunnable, SubscriberAdapter } from "glove-core";
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
}

type GloveVoiceEvents = {
  mode: [mode: VoiceMode];
  /** partial=true while user is still speaking */
  transcript: [text: string, partial: boolean];
  /** Glove's text response, fires before TTS audio starts */
  response: [text: string];
  error: [error: GloveVoiceError | Error];
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
  private capture: AudioCapture | null = null;
  private player: AudioPlayer | null = null;
  private vad: VADAdapter | null = null;
  private abortController: AbortController | null = null;
  private activeTTS: TTSAdapter | null = null;
  private turnId = 0;
  private turnMode: TurnMode;
  private sampleRate: number;

  // Bound handlers for listener cleanup
  private sttHandlers: { partial: (t: string) => void; final: (t: string) => void; error: (e: Error) => void } | null = null;
  private vadHandlers: { speech_start: () => void; speech_end: () => void } | null = null;
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

    this.player = new AudioPlayer(this.sampleRate);
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
        // Default: longer silence threshold (40 frames ~= 1600ms) for natural pauses
        this.vad = new VAD(this.cfg.vadConfig ?? { silentFrames: 40 });
      }
      const vad = this.vad;

      this.vadHandlers = {
        speech_end: () => this.cfg.stt.flushUtterance(),
        speech_start: () => {
          if (this.mode === "thinking" || this.mode === "speaking") {
            // Don't barge-in when a blocking UI (e.g. checkout form) is active —
            // its pushAndWait resolver is still pending in the display manager.
            if (this.glove.displayManager.resolverStore.size > 0) return;
            this.interrupt();
          }
        },
      };

      vad.on("speech_end", this.vadHandlers.speech_end);
      vad.on("speech_start", this.vadHandlers.speech_start);
    }

    // Mic → STT (+ VAD if enabled)
    this.capture = new AudioCapture(this.sampleRate);

    this.captureHandlers = {
      chunk: (pcm) => {
        if (this.mode === "idle") return;
        this.cfg.stt.sendAudio(pcm);
        this.vad?.process(pcm);
      },
      error: (err) => this.emit("error", err),
    };

    this.capture.on("chunk", this.captureHandlers.chunk);
    this.capture.on("error", this.captureHandlers.error);

    // Connect STT then start mic
    await this.cfg.stt.connect();
    await this.capture.init();

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

    const subscriber: SubscriberAdapter = {
      record: async (event_type: string, data: any) => {
        if (stale()) return;

        if (event_type === "text_delta") {
          const text: string = data.text;
          stream.responseText += text;

          // Open TTS lazily on first text — avoids opening for tool-only responses
          if (!stream.tts) {
            console.debug(`[GloveVoice] text_delta — opening TTS`);
            openFreshTTS();
          }

          for (const sentence of buffer.push(text)) {
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
