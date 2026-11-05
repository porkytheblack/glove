/**
 * Delivery receipts: what happened when a handler tried to tell someone about
 * an event (a voice call speaking it at a pause, for one).
 *
 * A receipt is keyed by the event's journal id, so every redelivery of the
 * same event finds it. It lives in its own part of the data adapter, apart
 * from workspace entries: agent workspace tools never see or change it.
 *
 * "accepted" means the provider's transport took the text locally. It does
 * not mean anyone heard it: neither a finished run nor a written transcript
 * proves that. Recovery treats it as said and never says it again.
 */
import { createHash } from "node:crypto";
import type { FoundryDataAdapter } from "./primitives.js";
import { Effect } from "effect";

/**
 * queued: never attempted. Kept when a call ends; a late-chat policy may take it.
 * dispatching: an attempt began and its outcome may be unknown. Never replayed
 *   into another run or call, and never sent to chat instead.
 * accepted: the provider took it. Redelivery acknowledges without saying it again.
 * suppressed: fresh preparation said nothing is due. Redelivery stays silent.
 * redirecting: a provably undispatched event is being handed to a late-chat
 *   effect under `effectId`; recovery retries that effect, never voice.
 * redirected: the late-chat effect finished.
 */
export type FoundryEventReceiptStatus =
  | "queued"
  | "dispatching"
  | "accepted"
  | "suppressed"
  | "redirecting"
  | "redirected";

export interface FoundryEventReceipt {
  /** The event's journal id: one receipt per event per conversation. */
  readonly id: string;
  /** The event's own id, as its sender gave it. */
  readonly eventId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly status: FoundryEventReceiptStatus;
  /** The run and call that last moved it, `<runId>/<callId>`. Another generation never replays a dispatch. */
  readonly generation?: string;
  readonly runId?: string;
  /** What was dispatched (accepted) or about to be (dispatching). */
  readonly text?: string;
  /** Why it was suppressed. */
  readonly reason?: string;
  /** The idempotency key of its late-chat effect, derived from the event. */
  readonly effectId?: string;
  /** Set once the transcript line for an accepted event is written. */
  readonly transcriptMessageId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dispatchedAt?: string;
  readonly acceptedAt?: string;
  readonly settledAt?: string;
}

export interface FoundryEventReceiptFilter {
  readonly agentId?: string;
  readonly conversationId?: string;
  readonly status?: FoundryEventReceiptStatus | ReadonlyArray<FoundryEventReceiptStatus>;
}

export function matchesReceiptFilter(receipt: FoundryEventReceipt, filter: FoundryEventReceiptFilter = {}): boolean {
  if (filter.agentId && receipt.agentId !== filter.agentId) return false;
  if (filter.conversationId && receipt.conversationId !== filter.conversationId) return false;
  if (filter.status) {
    const statuses = typeof filter.status === "string" ? [filter.status] : filter.status;
    if (!statuses.includes(receipt.status)) return false;
  }
  return true;
}

export function assertEventReceipt(receipt: FoundryEventReceipt): void {
  if (!receipt.id || !receipt.eventId) throw new Error("Event receipt must name its event.");
  if (!receipt.agentId || !receipt.conversationId) throw new Error("Event receipt must name its conversation.");
}

/** The late-chat effect id for an event: the same on every retry. */
export function lateChatEffectId(receiptId: string): string {
  return `effect_${createHash("sha256").update(`late-chat\0${receiptId}`).digest("hex")}`;
}

/** The transcript message id for an event's spoken line: the same on every repair. */
export function eventTranscriptMessageId(receiptId: string): string {
  return `foundry-event:${receiptId}`;
}

export interface EventReceiptStore {
  /** False when the data adapter has no receipt methods: receipts last only as long as this process. */
  readonly durable: boolean;
  get(id: string): Promise<FoundryEventReceipt | null>;
  /** Insert if absent. False, and no change, when it exists. */
  claim(receipt: FoundryEventReceipt): Promise<boolean>;
  put(receipt: FoundryEventReceipt): Promise<void>;
}

const processReceipts = new WeakMap<object, Map<string, FoundryEventReceipt>>();

/** Receipts through the application's data adapter, or in this process when it keeps none. */
export function eventReceiptStore(data: FoundryDataAdapter): EventReceiptStore {
  if (data.claimEventReceipt && data.putEventReceipt && data.getEventReceipt) {
    return {
      durable: true,
      get: (id) => Effect.runPromise(data.getEventReceipt!(id)),
      claim: (receipt) => Effect.runPromise(data.claimEventReceipt!(receipt)),
      put: (receipt) => Effect.runPromise(data.putEventReceipt!(receipt)),
    };
  }
  let local = processReceipts.get(data);
  if (!local) processReceipts.set(data, local = new Map());
  const memory = local;
  return {
    durable: false,
    async get(id) { const receipt = memory.get(id); return receipt ? structuredClone(receipt) : null; },
    async claim(receipt) {
      assertEventReceipt(receipt);
      if (memory.has(receipt.id)) return false;
      memory.set(receipt.id, structuredClone(receipt));
      return true;
    },
    async put(receipt) { assertEventReceipt(receipt); memory.set(receipt.id, structuredClone(receipt)); },
  };
}
