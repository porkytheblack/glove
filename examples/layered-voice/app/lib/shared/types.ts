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

export type Phase = "idle" | "listening" | "front" | "worker" | "relay";

/**
 * Server → client events, streamed over SSE. The console renders the room
 * transcript from these plus a "backstage" view of the layered machinery.
 */
export type SessionEvent =
  // A new utterance was transcribed (echoed back so late subscribers see it).
  | { type: "utterance"; utterance: Utterance }
  // Nova produced no <speech> for this utterance — she judged it wasn't for her.
  | { type: "silent"; utteranceId: string; reason: string }
  // Streamed SPOKEN token from Nova (already parsed out of the <speech> tags).
  | { type: "delta"; role: AgentRole; text: string }
  // A finalized spoken line from Nova (the joined <speech> content of a turn).
  | { type: "say"; role: AgentRole; kind: "response" | "relay"; text: string }
  // Worker tool activity, surfaced in the backstage panel.
  | { type: "tool"; role: AgentRole; name: string; summary: string }
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
  // Current pipeline phase, for the status indicator.
  | { type: "phase"; phase: Phase }
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
