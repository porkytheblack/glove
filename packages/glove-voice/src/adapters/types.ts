import type EventEmitter from "eventemitter3";

// ─── VAD ───────────────────────────────────────────────────────────────────

export type VADAdapterEvents = {
  /**
   * Speech (possibly tentative) started. Adapters with a minimum-duration
   * filter (Silero) fire this on the first positive frame — it may still be
   * retracted by `vad_misfire`. Adapters without a tentative phase fire it
   * once speech is established.
   */
  speech_start: [];
  /** User stopped speaking — fire STT flush after this */
  speech_end: [];
  /**
   * Speech confirmed past the minimum-duration filter — it is definitely a
   * person talking, not a noise burst. Only emitted by adapters that declare
   * `supportsRealStart: true`. Use this (not `speech_start`) for barge-in.
   */
  speech_real_start: [];
  /**
   * A tentative `speech_start` turned out to be shorter than the minimum
   * speech duration — treat it as noise. Only emitted by adapters that
   * declare `supportsRealStart: true`.
   */
  vad_misfire: [];
  /**
   * Per-frame speech probability in [0, 1]. Neural adapters emit the model
   * output; the energy VAD emits a normalized-energy proxy. Useful for
   * level meters and threshold tuning.
   */
  speech_prob: [prob: number];
};

/**
 * Voice Activity Detection adapter contract.
 *
 * Default: energy-based VAD (built-in). For noisy environments,
 * swap with Silero VAD (WASM) — same interface, drop-in replacement.
 */
export interface VADAdapter extends EventEmitter<VADAdapterEvents> {
  /** Process a PCM frame. Call on every AudioCapture "chunk" event. */
  process(pcm: Int16Array): void;

  /** Force reset — call when interrupting a turn. */
  reset(): void;

  /** True if speech is currently detected. */
  readonly isSpeaking: boolean;

  /**
   * True when the adapter distinguishes tentative speech (`speech_start`)
   * from confirmed speech (`speech_real_start`) and reports `vad_misfire`
   * for retracted starts. When true, GloveVoice opens the STT audio gate
   * and triggers barge-in on `speech_real_start` so noise bursts never
   * reach the STT provider or interrupt agent speech.
   */
  readonly supportsRealStart?: boolean;
}

// ─── STT ───────────────────────────────────────────────────────────────────

export type STTAdapterEvents = {
  /** Streaming partial — changes as more speech arrives */
  partial: [text: string];
  /** Stable, finalized transcript for the completed utterance */
  final: [text: string];
  error: [Error];
  close: [];
};

/**
 * Streaming speech-to-text adapter contract.
 *
 * Implementations: ElevenLabsSTTAdapter, DeepgramSTTAdapter, ...
 *
 * Auth is the adapter's responsibility — inject a `getToken` function
 * that calls your server, which holds the real API key.
 */
export interface STTAdapter extends EventEmitter<STTAdapterEvents> {
  /** Open the connection. Adapter fetches credentials internally. */
  connect(): Promise<void>;

  /** Send a raw PCM chunk (Int16Array, 16kHz mono). */
  sendAudio(pcm: Int16Array): void;

  /**
   * Signal end of utterance — adapter should finalize the current transcript.
   * Called by VAD when silence is detected.
   */
  flushUtterance(): void;

  /** Close the connection. */
  disconnect(): void;

  /** True if the underlying socket is open and ready. */
  readonly isConnected: boolean;

  /** The current in-progress partial transcript (for immediate UI). */
  readonly currentPartial: string;
}

// ─── TTS ───────────────────────────────────────────────────────────────────

export type TTSAdapterEvents = {
  /** Raw PCM audio chunk (Uint8Array, 16kHz mono), ready for AudioPlayer */
  audio_chunk: [pcm: Uint8Array];
  /** All audio for the current turn has been received */
  done: [];
  error: [Error];
};

/**
 * Streaming text-to-speech adapter contract.
 *
 * Open it in parallel with your Glove request to hide connection latency.
 * Send text chunks as they become available — first audio arrives fast.
 *
 * Implementations: ElevenLabsTTSAdapter, CartesiaTTSAdapter, ...
 */
export interface TTSAdapter extends EventEmitter<TTSAdapterEvents> {
  /**
   * Open the connection. Adapter fetches credentials internally.
   * Returns a promise that resolves once ready to accept text.
   */
  open(): Promise<void>;

  /**
   * Send a text chunk. Safe to call before open() resolves — adapters
   * should queue internally.
   */
  sendText(text: string): void;

  /**
   * Signal end of text stream — flush remaining audio.
   * Must be called once after all text has been sent.
   */
  flush(): void;

  /** Immediately destroy the connection, dropping any pending audio. */
  destroy(): void;

  readonly isReady: boolean;
}

// ─── Auth helpers ──────────────────────────────────────────────────────────

/**
 * A function that fetches a short-lived token from YOUR server.
 * Your server calls the provider's token endpoint using the real API key.
 *
 * @example
 * const getToken = async () => {
 *   const res = await fetch("/api/voice/stt-token");
 *   const { token } = await res.json();
 *   return token;
 * };
 */
export type GetTokenFn = () => Promise<string>;
