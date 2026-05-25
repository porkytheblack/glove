export type AgentMode = "triggered" | "concurrent";

export type RunKind = "trigger" | "recurring" | "notify";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
export const DEFAULT_MAX_ATTEMPTS = 1;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_MAX_CONCURRENT = 5;
export const DEFAULT_RETRY_BACKOFF_MS = 1_000;
export const DEFAULT_WARM_HEARTBEAT_MS = 5_000;
export const DEFAULT_WARM_RESTART_MAX = 5;
export const DEFAULT_WARM_RESTART_BACKOFF_MS = 1_000;

export interface Run {
  id: string;
  agentName: string;
  kind: RunKind;
  input: string;
  output?: string;
  error?: string;
  status: RunStatus;
  attempts: number;
  maxAttempts: number;
  timeout: number;
  interval?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export type RunPatch = Partial<
  Omit<Run, "id" | "agentName" | "kind" | "createdAt">
>;
