// Types shared across the server orchestrator and the browser console.
// Keep this file free of server-only imports — it is pulled into client code.

/** Who is speaking into the room. This is the "custom sender" identity. */
export type SpeakerRole = "operator" | "customer" | "bystander";

/** Which of the three agents an event belongs to. */
export type AgentRole = "front" | "worker" | "monitor";

/** The addressing-monitor's verdict: who is the latest utterance aimed at? */
export type Addressee = "assistant" | "human" | "ambiguous";

export interface Speaker {
  id: SpeakerRole;
  /** e.g. "Sam (you)" */
  displayName: string;
  /** e.g. "Sam" */
  shortName: string;
  /** Shown in the UI and fed to the monitor so it knows the roster. */
  description: string;
}

export interface Utterance {
  id: string;
  speaker: SpeakerRole;
  text: string;
  /** ISO timestamp. */
  ts: string;
}

export interface AddressingVerdict {
  addressee: Addressee;
  /** 0..1 — the monitor's confidence in the addressee call. */
  confidence: number;
  /** One short sentence explaining the call. Shown in the UI. */
  reason: string;
}

export interface AgentStats {
  tokensIn: number;
  tokensOut: number;
  turns: number;
}

/**
 * A single voice/latency measurement. Server-measured records (monitor/front/
 * worker/relay latency, front time-to-first-token) and client-measured records
 * (STT latency, time-to-first-audio, barge-ins, TTS timings) are both appended
 * to a local JSONL file for offline analysis, and streamed to the live HUD.
 */
export interface MetricRecord {
  ts: string; // ISO timestamp
  sessionId: string;
  source: "server" | "client";
  /** e.g. "monitor_ms", "front_ttft_ms", "time_to_first_audio_ms", "barge_in". */
  name: string;
  /** Duration in ms, when the metric is a timing. */
  ms?: number;
  utteranceId?: string;
  /** Any extra context (char counts, addressee, etc.). */
  data?: Record<string, unknown>;
}

export type Phase =
  | "idle"
  | "listening"
  | "classifying"
  | "front"
  | "worker"
  | "relay";

/**
 * Server → client events, streamed over SSE. The console renders the room
 * transcript from these plus a "backstage" view of the layered machinery.
 */
export type SessionEvent =
  // A new utterance was transcribed (echoed back so late subscribers see it).
  | { type: "utterance"; utterance: Utterance }
  // The monitor decided who the utterance was addressed to.
  | { type: "verdict"; utteranceId: string; verdict: AddressingVerdict }
  // Nova stayed quiet because the utterance wasn't addressed to her.
  | { type: "silent"; utteranceId: string; reason: string }
  // Streamed token from an agent (front = Nova's spoken words).
  | { type: "delta"; role: AgentRole; text: string }
  // A finalized line from an agent. For the front, this is what Nova "says".
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
