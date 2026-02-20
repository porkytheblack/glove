import EventEmitter from "eventemitter3";
import type { STTAdapter, TTSAdapter, VADAdapter } from "./adapters/types";
import { AudioCapture } from "./audio-capture";
import { AudioPlayer } from "./audio-player";
import { splitSentences } from "./sentence-chunker";
import { extractText } from "./extract-text";
import { GloveVoiceError } from "./errors";
import { IGloveRunnable } from "glove-core";

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
        if (this.mode === "listening") this.emit("transcript", text, true);
      },
      final: (text) => {
        if (!text.trim()) return;
        this.emit("transcript", text, false);
        void this.handleTurn(text);
      },
      error: (err) => this.emit("error", err),
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
        this.vad = new VAD();
      }
      const vad = this.vad;

      this.vadHandlers = {
        speech_end: () => this.cfg.stt.flushUtterance(),
        speech_start: () => {
          if (this.mode === "thinking" || this.mode === "speaking") {
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
    this.abortController?.abort("interrupted");
    this.abortController = null;
    this.activeTTS?.destroy();
    this.activeTTS = null;
    this.player?.stop();
    this.vad?.reset();
    if (this.mode !== "idle") this.setMode("listening");
  }

  /**
   * Manual turn commit — flush the current utterance to STT.
   * Use in "manual" turnMode (push-to-talk). Also works in "vad" mode
   * as an explicit override (e.g. a "send" button).
   */
  commitTurn(): void {
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
    this.interrupt();

    // Turn ID prevents race: if a new turn starts while this one is in-flight,
    // the old turn detects the mismatch and bails out.
    const myTurnId = ++this.turnId;

    this.setMode("thinking");
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Fresh TTS adapter per turn — no listener leak
    const tts = this.cfg.createTTS();
    this.activeTTS = tts;

    tts.on("audio_chunk", (chunk) => {
      if (signal.aborted || this.turnId !== myTurnId) return;
      if (this.mode !== "speaking") this.setMode("speaking");
      this.player!.enqueue(chunk);
    });

    tts.on("done", () => {
      if (this.turnId !== myTurnId) return;
      this.player!.onDrained(() => {
        if (this.mode !== "idle") this.setMode("listening");
      });
    });

    tts.on("error", (err) => this.emit("error", err));

    // Open TTS in parallel with Glove — hides handshake latency
    const ttsReady = tts.open();

    try {
      const result = await this.glove.processRequest(transcript, signal);

      // Bail out if superseded by a newer turn
      if (signal.aborted || this.turnId !== myTurnId) {
        tts.destroy();
        return;
      }

      const responseText = extractText(result);
      if (!responseText) {
        this.setMode("listening");
        return;
      }

      this.emit("response", responseText);
      await ttsReady;

      if (signal.aborted || this.turnId !== myTurnId) {
        tts.destroy();
        return;
      }

      for (const sentence of splitSentences(responseText)) {
        if (signal.aborted || this.turnId !== myTurnId) break;
        tts.sendText(sentence);
      }

      if (!signal.aborted && this.turnId === myTurnId) tts.flush();
    } catch (err) {
      const e = err as Error;
      const isAbort = e.name === "AbortError" || e.message === "interrupted";
      if (!isAbort) {
        this.emit("error", new GloveVoiceError("ERR_GLOVE_REQUEST", e.message, { cause: e }));
        this.setMode("listening");
      }
      tts.destroy();
    }
  }

  // ─── Util ─────────────────────────────────────────────────────────────────

  private setMode(mode: VoiceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit("mode", mode);
  }
}
