import type {
  SubscriberEvent,
  SubscriberEventDataMap,
} from "glove-core";
import type { AgentMode, Run } from "../types.js";

/**
 * Envelope wrapping a forwarded Glove `SubscriberEvent` with the agent
 * identity it came from. One callback handles every event type — wrappers
 * fan out per-type trivially.
 *
 * `runId` is nullable so warm-agent events emitted during factory setup or
 * background work between notifies aren't dropped.
 */
export interface AgentEventEnvelope<
  T extends SubscriberEvent["type"] = SubscriberEvent["type"],
> {
  agentName: string;
  runId: string | null;
  mode: AgentMode;
  event_type: T;
  data: SubscriberEventDataMap[T];
  timestamp: string;
}

/**
 * Subscriber interface for ContinuumRunner lifecycle events.
 * All methods are optional — implement only the events you care about.
 *
 * Lifecycle callbacks mirror station-signal's `SignalSubscriber`. Two
 * continuum-specific additions:
 *   - `onAgentReady` — concurrent subprocess finished its factory and is
 *     ready to receive `notify` envelopes.
 *   - `onAgentEvent` — every Glove `SubscriberEvent` forwarded from any
 *     child subprocess, wrapped with the agent identity.
 */
export interface ContinuumSubscriber {
  onAgentDiscovered?(event: {
    agentName: string;
    mode: AgentMode;
    filePath: string;
  }): void;

  onAgentSpawned?(event: {
    agentName: string;
    mode: AgentMode;
    pid: number;
    startedAt: Date;
  }): void;

  onAgentReady?(event: { agentName: string }): void;

  onAgentTerminated?(event: {
    agentName: string;
    reason: string;
    restartScheduled: boolean;
  }): void;

  onAgentRestarted?(event: { agentName: string; restartCount: number }): void;

  onRunDispatched?(event: { run: Run }): void;
  onRunStarted?(event: { run: Run }): void;
  onRunCompleted?(event: { run: Run; output?: string }): void;
  onRunTimeout?(event: { run: Run }): void;
  onRunRetry?(event: { run: Run; attempt: number; maxAttempts: number }): void;
  onRunFailed?(event: { run: Run; error?: string }): void;
  onRunCancelled?(event: { run: Run }): void;
  onRunSkipped?(event: { run: Run; reason: string }): void;
  onRunRescheduled?(event: { run: Run; nextRunAt: Date }): void;

  /** IPC ack from the warm child that it accepted a notify envelope. */
  onNotifyDelivered?(event: { run: Run }): void;

  /** onComplete handler threw (the run is still recorded as completed). */
  onCompleteError?(event: { run: Run; error: string }): void;

  /** stdout/stderr captured from the child process. */
  onLogOutput?(event: {
    run: Run | null;
    agentName: string;
    level: "stdout" | "stderr";
    message: string;
  }): void;

  /** Forwarded Glove subscriber event from inside a child subprocess. */
  onAgentEvent?(envelope: AgentEventEnvelope): void;
}

export { ConsoleSubscriber } from "./console.js";
