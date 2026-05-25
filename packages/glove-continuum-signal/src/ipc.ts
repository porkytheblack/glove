import type { SubscriberEvent } from "glove-core";

/**
 * Messages sent from the parent runner to a child subprocess via Node IPC.
 *
 * Triggered children never receive `notify` — they get all their input via
 * env vars at spawn time. Concurrent children stay alive and receive `notify`
 * envelopes for each work item.
 */
export type ParentToChildMessage =
  | { type: "notify"; runId: string; input: unknown }
  | { type: "stop"; reason?: string };

/**
 * Messages sent from a child subprocess to the parent runner.
 *
 * The parent runner is the single source of truth for run status (see H1 in
 * station-signal). Children never write directly to the adapter; they only
 * emit IPC envelopes and the parent translates to `updateRun`.
 *
 * `agent:event` carries forwarded Glove `SubscriberEvent`s — anything the
 * child's IPC-forwarding subscriber records inside the running Glove.
 */
export type ChildToParentMessage =
  | { type: "ready"; agentName: string }
  | { type: "run:started"; runId: string; agentName: string; timestamp: string }
  | {
      type: "run:completed";
      runId: string;
      agentName: string;
      output?: string;
      timestamp: string;
    }
  | {
      type: "run:failed";
      runId: string;
      agentName: string;
      error: string;
      retryable: boolean;
      timestamp: string;
    }
  | { type: "notify:started"; runId: string; agentName: string; timestamp: string }
  | {
      type: "notify:completed";
      runId: string;
      agentName: string;
      output?: string;
      timestamp: string;
    }
  | {
      type: "notify:failed";
      runId: string;
      agentName: string;
      error: string;
      timestamp: string;
    }
  | { type: "onComplete:error"; runId: string; agentName: string; error: string }
  | {
      type: "agent:event";
      agentName: string;
      runId: string | null;
      event_type: SubscriberEvent["type"];
      data: unknown;
      timestamp: string;
    };

/** Public alias matching station's naming convention. */
export type IPCMessage = ChildToParentMessage;

/**
 * Send a message to the parent over the IPC channel. Resolves once the
 * underlying `process.send` flush callback fires (H4 — let IPC drain before
 * exit). No-op when there is no IPC channel (process not spawned via
 * `child_process.fork` / `spawn(..., { stdio: [..., "ipc"] })`).
 */
export function sendIPC(msg: ChildToParentMessage): Promise<void> {
  return new Promise((resolve) => {
    if (typeof process.send === "function") {
      process.send(msg, () => resolve());
    } else {
      resolve();
    }
  });
}
