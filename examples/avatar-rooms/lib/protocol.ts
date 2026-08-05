// ─────────────────────────────────────────────────────────────────────────────
// The wire protocol between the browser and the gateway.
//
// This is deliberately tiny, because that is the whole point of the
// architecture: the client is an audio duct, not an agent. It captures the
// microphone, ships raw PCM up, plays raw PCM back down, and renders whatever
// the server tells it to render. It holds no API keys, runs no VAD, makes no
// endpointing decisions, and knows nothing about agents, models, or tools.
//
// Two frame types share one WebSocket:
//   • BINARY frames are audio, and only audio. 16 kHz mono signed 16-bit PCM,
//     little-endian, in both directions. No headers, no base64, no JSON
//     wrapper — a Int16Array's bytes, straight down the socket.
//   • TEXT frames are JSON control/telemetry messages, typed below.
//
// PCM at 16 kHz costs 32 KB/s per direction. That is more than Opus would, and
// it is chosen on purpose: it needs no codec on either end, it is exactly the
// format both ElevenLabs Scribe (in) and ElevenLabs TTS (out, pcm_16000) speak,
// so the gateway never transcodes, and it keeps the client trivially portable.
// Swapping in Opus is a transport concern that changes neither end's logic.
// ─────────────────────────────────────────────────────────────────────────────

/** Audio format, fixed in both directions. */
export const SAMPLE_RATE = 16_000;

export type SpeakerRole = "operator" | "customer" | "bystander";

/** One of the people in the room. Nova hears them all, labelled, and decides
 *  for herself which lines were aimed at her. */
export interface Speaker {
  id: SpeakerRole;
  /** e.g. "Sam (you)" */
  displayName: string;
  /** e.g. "Sam" */
  shortName: string;
  /** Shown in the UI and included in the front agent's prompt roster. */
  description: string;
}

// ── client → server ──────────────────────────────────────────────────────────

export type ClientMessage =
  /** Who is at the microphone now. The room has several speakers and Nova
   *  decides for herself whether a line was aimed at her, so every utterance
   *  is labelled. */
  | { t: "speaker"; speaker: SpeakerRole }
  /** Type instead of talk — same path as a spoken utterance, minus the audio. */
  | { t: "say"; speaker: SpeakerRole; text: string }
  /** The avatar session died under the client (e.g. Anam's plan cap
   *  force-ends conversations) — ask the room to mint a fresh one. The room
   *  answers with `avatar_view`. */
  | { t: "avatar_refresh" }
  /** Client-side playback finished draining. Lets the gateway reopen the STT
   *  gate at the moment the room actually goes quiet rather than guessing. */
  | { t: "playback_done"; turnId: number }
  /** The CLIENT's local VAD confirmed a person is talking over the agent. It
   *  has already stopped playback on its own; this asks the room to make the
   *  interruption official. The room still applies its own judgment. */
  | { t: "barge_in" };

// ── server → client ──────────────────────────────────────────────────────────

export type ServerMessage =
  /** Handshake: the session is live and what it was configured with. */
  | {
      t: "ready";
      sessionId: string;
      config: Record<string, unknown>;
      speakers: Array<{ id: SpeakerRole; displayName: string; description: string }>;
      assistantName: string;
    }
  /** Live transcript of the current speaker, for display only. */
  | { t: "partial"; text: string }
  /** A committed utterance — what the agent was actually given. */
  | { t: "utterance"; speaker: SpeakerRole; text: string }
  /** A span of the agent's spoken text, streamed as it is generated. The
   *  audio for it arrives as binary frames tagged with the same turnId. */
  | { t: "speech"; turnId: number; text: string }
  /** The agent's turn finished generating. */
  | { t: "speech_end"; turnId: number }
  /** Barge-in: drop every buffered sample immediately. The gateway has already
   *  stopped generating; this stops what is queued in the browser. */
  | { t: "clear" }
  /** Someone MAY be interrupting — the very first speech-ish frame, tens of
   *  milliseconds in, before it could possibly be confirmed as a person. Stop
   *  playback NOW but keep the buffer: a `clear` follows if it is real, a
   *  `resume` if it was a cough. This is what makes the agent feel like it
   *  stops the instant you open your mouth. */
  | { t: "pause" }
  /** The pause above was a false alarm — pick playback back up where it was. */
  | { t: "resume" }
  /** Coarse session state, for the status pill. */
  | { t: "state"; listening: boolean; speaking: boolean; thinking: boolean }
  /** A delegation's lifecycle, so the UI can show the worker at work. */
  | { t: "delegation"; jobId: string; phase: "queued" | "done" | "failed"; detail?: string }
  /** A Tavus interaction event the BROWSER must relay into the Daily call
   *  via sendAppMessage — interactions travel only over the data channel,
   *  and the browser is the participant we already have in the room. */
  | { t: "avatar_interaction"; event: Record<string, unknown> }
  /** An Anam client command the BROWSER must apply to its SDK session —
   *  passthrough audio input lives on the client (sendAudioChunk /
   *  endSequence / interruptPersona), so the duct is the courier here too. */
  | { t: "avatar_command"; command: Record<string, unknown> }
  /** A fresh avatar attach point after an `avatar_refresh` — the same
   *  view fields the ready config carries. */
  | { t: "avatar_view"; provider: string; url?: string; sessionToken?: string }
  /** Timings, mirrored from the gateway's metrics log. */
  | { t: "metric"; name: string; ms?: number; data?: Record<string, unknown> }
  | { t: "error"; message: string };

export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}
