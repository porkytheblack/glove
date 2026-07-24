// ─────────────────────────────────────────────────────────────────────────────
// Speech-to-speech adapter contract.
//
// The cascaded pipeline (glove-voice: VAD → STT → LLM → TTS) bottoms out
// around 1.3-1.6s voice-to-voice — every stage adds serial latency, and
// endpointing must be reconstructed from transcripts. A speech-to-speech
// (S2S) model collapses the cascade: audio in → one model → audio out, with
// turn-taking decided by the model LISTENING rather than by client
// heuristics. Production S2S APIs (OpenAI Realtime, Gemini Live, Amazon
// Nova Sonic) run 500-800ms voice-to-voice.
//
// What survives from the layered-agents architecture:
//   - The S2S model IS the thin front agent: persona, addressing judgment,
//     and the spoken channel all live in one model.
//   - Delegation still happens through TOOLS: the S2S model calls the same
//     mesh-send function, the heavy text worker runs unchanged, and the
//     result is INJECTED back into the live conversation for the model to
//     relay out loud (the §5 wakeup becomes injectText + a response trigger).
//   - Barge-in, endpointing, and echo handling move INTO the provider.
// ─────────────────────────────────────────────────────────────────────────────

import type EventEmitter from "eventemitter3";

/** A function tool exposed to the S2S model (JSON-Schema parameters). */
export interface S2STool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface S2SSessionConfig {
  /** System prompt / persona for the voice model. */
  instructions?: string;
  /** Voice id/name (provider-specific). */
  voice?: string;
  /** Tools the model may call mid-conversation. */
  tools?: S2STool[];
}

export type S2SEvents = {
  connected: [];
  disconnected: [];
  /** The provider's VAD heard the user start / stop speaking. */
  user_speech_started: [];
  user_speech_stopped: [];
  /** Transcription of what the USER said (when transcription is enabled). */
  user_transcript: [text: string, isFinal: boolean];
  /** Streaming transcript of what the AGENT is saying. */
  agent_transcript_delta: [text: string];
  /** One agent utterance finished (full transcript). */
  agent_transcript_done: [text: string];
  /** The agent started / finished audibly speaking. */
  agent_speech_started: [];
  agent_speech_stopped: [];
  /** The model called a tool — answer via sendToolResult(callId, …). */
  tool_call: [call: { callId: string; name: string; arguments: string }];
  /** The user barged in and the provider cancelled the response. */
  interrupted: [];
  error: [err: Error];
};

/**
 * A live speech-to-speech session: microphone in, agent audio out, tool
 * calls surfacing as events, and a text side-channel for injecting
 * out-of-band context (async worker results, typed messages, corrections).
 */
export interface S2SAdapter extends EventEmitter<S2SEvents> {
  /** Open the session: mic capture, peer connection, audio playback. */
  connect(config?: S2SSessionConfig): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Inject a TEXT item into the live conversation — the §5 wakeup path.
   * With `respond: true` the model is asked to speak in reaction (e.g. relay
   * a finished delegation); with false it's silent context (an overheard
   * typed line, a transcript correction).
   */
  injectText(text: string, opts?: { respond?: boolean; role?: "user" | "system" }): void;

  /** Deliver a tool result for a `tool_call` event; the model then continues
   *  (usually speaking the outcome). */
  sendToolResult(callId: string, output: unknown, opts?: { respond?: boolean }): void;

  /** Update session config mid-call (instructions, tools). */
  updateSession(patch: Partial<S2SSessionConfig>): void;

  /** Hard-stop the agent's current speech (manual barge-in). */
  interrupt(): void;

  readonly isConnected: boolean;
}
