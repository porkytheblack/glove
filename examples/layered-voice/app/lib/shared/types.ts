// Types shared across the server orchestrator and the browser console.
// Keep this file free of server-only imports — it is pulled into client code.

/** Who is speaking into the room. This is the "custom sender" identity. */
export type SpeakerRole = "operator" | "customer" | "bystander";

/** Which of the two agents an event belongs to. */
export type AgentRole = "front" | "worker";

export interface Speaker {
  id: SpeakerRole;
  /** e.g. "Sam (you)" */
  displayName: string;
  /** e.g. "Sam" */
  shortName: string;
  /** Shown in the UI and included in the front agent's prompt roster. */
  description: string;
}

export interface Utterance {
  id: string;
  speaker: SpeakerRole;
  text: string;
  /** ISO timestamp. */
  ts: string;
}

export interface AgentStats {
  tokensIn: number;
  tokensOut: number;
  turns: number;
}

/**
 * A single voice/latency measurement. Server-measured records (front latency,
 * worker/relay latency, first-spoken-token) and client-measured records (STT
 * latency, time-to-first-audio, barge-ins, TTS timings) are both appended to a
 * local JSONL file for offline analysis, and streamed to the live HUD.
 */
export interface MetricRecord {
  ts: string; // ISO timestamp
  sessionId: string;
  source: "server" | "client";
  /** e.g. "front_ttft_ms", "time_to_first_audio_ms", "barge_in". */
  name: string;
  /** Duration in ms, when the metric is a timing. */
  ms?: number;
  utteranceId?: string;
  /** Any extra context (char counts, etc.). */
  data?: Record<string, unknown>;
}

/**
 * The FRONT pipeline's phase. The worker runs concurrently in the background,
 * so its activity is a separate signal (`worker_busy`), not a phase.
 */
export type Phase = "idle" | "listening" | "front" | "relay";

/**
 * Server → client events, streamed over SSE. The console renders the room
 * transcript from these plus a "backstage" view of the layered machinery.
 */
export type SessionEvent =
  // A new utterance was transcribed (echoed back so late subscribers see it).
  | { type: "utterance"; utterance: Utterance }
  // Nova produced no <speech> for this utterance — she judged it wasn't for her.
  | { type: "silent"; utteranceId: string; reason: string }
  // An audio-channel event was logged into Nova's history (barge-in cut,
  // TTS failure). `text` is the human-readable version for the room view.
  | { type: "note"; noteKind: "interruption" | "speech-failure" | "missed-delegation" | "transcript-correction"; text: string }
  // Streamed SPOKEN token from Nova (already parsed out of the <speech> tags).
  // `turnId` identifies the server-side front turn, so a barge-in can void
  // exactly that turn's remaining tokens client-side.
  | { type: "delta"; role: AgentRole; text: string; turnId?: number }
  // A finalized spoken line from Nova (the joined <speech> content of a turn).
  | { type: "say"; role: AgentRole; kind: "response" | "relay"; text: string; turnId?: number }
  // Worker tool activity, surfaced in the backstage panel. `summary` is the
  // one-line view; `detail` is the full input payload for the expanded view.
  | { type: "tool"; role: AgentRole; name: string; summary: string; detail?: string }
  // A mesh message crossed between agents (the delegation and its reply).
  | {
      type: "mesh";
      direction: "delegate" | "reply";
      from: AgentRole;
      to: AgentRole;
      content: string;
    }
  // Per-agent token / turn stats (front stays thin; worker carries the weight).
  | { type: "stats"; stats: Record<AgentRole, AgentStats> }
  // Current FRONT pipeline phase, for the status indicator.
  | { type: "phase"; phase: Phase }
  // The background worker started/finished researching (concurrent with front).
  | { type: "worker_busy"; busy: boolean }
  // A server-measured latency metric (also appended to the metrics file).
  | { type: "metric"; metric: MetricRecord }
  // Something went wrong (e.g. missing API key).
  | { type: "error"; message: string };

export interface SessionConfig {
  sessionId: string;
  speakers: Speaker[];
  /** The assistant's spoken name. */
  assistantName: string;
}
