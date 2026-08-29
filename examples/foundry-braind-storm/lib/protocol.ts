export const WORKSPACE_ID = "braind-storm";
export const LEAD_AGENT_ID = "braind-storm-lead";
export const LEAD_CONVERSATION_ID = "braind-storm-lead-room";
export const BRIEFING_AGENT_ID = "braind-storm-briefing-line";
export const BRIEFING_CONVERSATION_ID = "braind-storm-briefing-line-room";
export const CAMPAIGN_AGENT_ID = "braind-storm-campaign-orchestrator";
export const CAMPAIGN_CONVERSATION_ID = "braind-storm-campaign-control-room";

export const TEAM = [
  { id: "lead", name: "Mara Vale", role: "Brand lead", phase: "eye" },
  { id: "scout", name: "Iris Signal", role: "Culture & market scout", phase: "sense" },
  { id: "strategist", name: "Theo North", role: "Positioning & GTM", phase: "shape" },
  { id: "maker", name: "Noor Static", role: "Creative director", phase: "make" },
  { id: "critic", name: "Vera Proof", role: "Brand critic", phase: "pressure-test" },
] as const;

export interface StormArtifact {
  path: string;
  name: string;
  kind: "document" | "image";
  size: number;
  href: string;
}

export interface StormActivity {
  at: string;
  from: string;
  to: string;
  label: string;
  artifact?: string;
}

export type StormTelemetryKind = "storm" | "agent" | "model" | "mesh" | "tool" | "artifact";
export type StormTelemetryStatus = "queued" | "active" | "complete" | "warning" | "error";

/** A user-safe work trace. `detail` describes intent and outcomes, never hidden model chain-of-thought. */
export interface StormTelemetry {
  at: string;
  kind: StormTelemetryKind;
  status: StormTelemetryStatus;
  step: string;
  title: string;
  detail: string;
  agent?: (typeof TEAM)[number]["id"];
  peer?: (typeof TEAM)[number]["id"];
  artifact?: string;
  progress?: number;
  attempt?: number;
}

export interface StormFoundryEvent {
  id: string;
  sequence: number;
  timestamp: string;
  type: string;
  category: string;
  agent?: string;
  runId?: string;
  data: unknown;
}

export interface StormResult {
  stormId: string;
  reply: string;
  artifacts: StormArtifact[];
  activity: StormActivity[];
  skills: string[];
  imageGenerated: boolean;
}
