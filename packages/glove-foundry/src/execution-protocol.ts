import type { SignalSubscriber } from "station-signal";
import type { Schedule } from "station-schedules";
export const executionEvents = ["onSignalDiscovered", "onRunDispatched", "onRunStarted", "onRunCompleted", "onRunTimeout", "onRunRetry", "onRunFailed", "onRunCancelled", "onRunSkipped", "onRunRescheduled", "onCompleteError", "onLogOutput"] as const satisfies readonly (keyof SignalSubscriber)[];
export type ExecutionEvent = typeof executionEvents[number];
export interface DaemonInit {
  rootDir: string;
  directory: string;
  loader: string;
  agents: Array<{ route: string; filePath: string }>;
  runner: { pollIntervalMs: number; maxConcurrent: number; maxAttempts: number; retryBackoffMs: number };
}
export type DaemonCommand =
  | { method: "init"; options: DaemonInit }
  | { method: "trigger"; name: string; input: unknown }
  | { method: "get"; id: string }
  | { method: "list"; signalName?: string }
  | { method: "cancel"; id: string }
  | { method: "schedule.add"; schedule: Schedule }
  | { method: "schedule.delete"; id: string }
  | { method: "ping" }
  | { method: "stop" };
export interface DaemonRequest { id: number; command: DaemonCommand }
export type DaemonResponse = { id: number; value?: unknown; error?: string } | { event: ExecutionEvent; value: unknown };
