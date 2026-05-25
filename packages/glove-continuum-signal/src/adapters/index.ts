import type { Run, RunPatch, RunStatus } from "../types.js";

/**
 * Persistence contract for ContinuumRunner.
 *
 * Mirrors station-signal's `SignalQueueAdapter` with two deltas:
 *   1. `agentName` replaces `signalName` throughout.
 *   2. Steps dropped — the Glove turn IS the unit of work; fine-grained
 *      observability lives on the forwarded subscriber event stream
 *      (`agent:event` IPC envelopes), not as relational `Step` rows.
 *
 * The parent runner is the single source of truth for run status. Children
 * (bootstrap subprocesses) never call this adapter directly — they only emit
 * IPC envelopes that the parent translates to `updateRun`.
 */
export interface ContinuumAdapter {
  addRun(run: Run): Promise<void>;
  removeRun(id: string): Promise<void>;
  getRunsDue(): Promise<Run[]>;
  getRunsRunning(): Promise<Run[]>;
  getRun(id: string): Promise<Run | null>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  listRuns(agentName: string): Promise<Run[]>;

  /** Whether any run for the given agent has one of the specified statuses. Used for recurring dedup. */
  hasRunWithStatus(agentName: string, statuses: RunStatus[]): Promise<boolean>;

  /** Delete runs in terminal statuses older than the cutoff. Returns count deleted. */
  purgeRuns(olderThan: Date, statuses: RunStatus[]): Promise<number>;

  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}

/**
 * Metadata describing how to reconstruct an adapter. Kept in the public
 * surface for parity with station-signal and for future wrappers (a remote
 * trigger router, for example), but the continuum runner does NOT use it
 * for the bootstrap path — children never touch the adapter.
 */
export interface AdapterManifest {
  name: string;
  options: Record<string, unknown>;
  moduleUrl?: string;
}

export interface SerializableAdapter extends ContinuumAdapter {
  toManifest(): AdapterManifest;
}

export function isSerializableAdapter(
  adapter: ContinuumAdapter,
): adapter is SerializableAdapter {
  return typeof (adapter as SerializableAdapter).toManifest === "function";
}

export { MemoryAdapter } from "./memory.js";
export { registerAdapter, createAdapter, hasAdapter } from "./registry.js";
export type { TriggerAdapter } from "./trigger.js";
export { HttpTriggerAdapter, type HttpTriggerOptions } from "./http-trigger.js";
