import type { StoreAdapter, InboxItem } from "glove-core";
import type { MeshAdapter } from "../core/adapter";
import {
  type AgentIdentity,
  type IncomingMeshMessage,
  MeshStoreUnsupportedError,
} from "../core/types";

export type PendingMap = Map<string, string>; // msg_id -> inbox_item_id

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function generateMessageId(senderId: string): string {
  return `msg_${senderId}_${Date.now()}_${randomSuffix()}`;
}

export function generateInboxItemId(): string {
  return `inbox_${Date.now()}_${randomSuffix()}`;
}

export function assertInboxCapable(
  store: StoreAdapter,
): asserts store is StoreAdapter &
  Required<
    Pick<
      StoreAdapter,
      "getInboxItems" | "addInboxItem" | "updateInboxItem" | "getResolvedInboxItems"
    >
  > {
  const ok =
    typeof store.getInboxItems === "function" &&
    typeof store.addInboxItem === "function" &&
    typeof store.updateInboxItem === "function" &&
    typeof store.getResolvedInboxItems === "function";
  if (!ok) throw new MeshStoreUnsupportedError();
}

/**
 * Build the resolved InboxItem that surfaces an incoming mesh message on the
 * recipient's next ask(). Tag is namespaced so consumers can filter mesh
 * traffic out of inbox history.
 */
export function buildInboxItemFromIncoming(
  msg: IncomingMeshMessage,
  peerName: string,
): InboxItem {
  const isBroadcast = msg.kind === "broadcast";
  const tag = isBroadcast
    ? `mesh:broadcast:from:${msg.from}`
    : `mesh:from:${msg.from}`;
  const replyNote = msg.in_reply_to ? ` (replying to ${msg.in_reply_to})` : "";
  const kindLabel = isBroadcast ? "Broadcast" : "Message";
  const request = `${kindLabel} from "${peerName}" (${msg.from}) [message id: ${msg.id}]${replyNote}`;
  return {
    id: generateInboxItemId(),
    tag,
    request,
    response: msg.content,
    status: "resolved",
    blocking: false,
    created_at: msg.created_at,
    resolved_at: nowIso(),
  };
}

/**
 * Resolve a pending blocking item for an earlier outbound send. The item was
 * inserted by the send/broadcast tool when `blocking: true`; this looks it up
 * via the closure map and flips its status. Returns true if an item was
 * resolved.
 */
export async function resolvePendingFor(
  sendMessageId: string,
  responseText: string,
  store: Required<
    Pick<StoreAdapter, "updateInboxItem">
  >,
  pending: PendingMap,
): Promise<boolean> {
  const inboxItemId = pending.get(sendMessageId);
  if (!inboxItemId) return false;
  await store.updateInboxItem(inboxItemId, {
    status: "resolved",
    response: responseText,
    resolved_at: nowIso(),
  });
  pending.delete(sendMessageId);
  return true;
}

/** Look up the peer name from the adapter, falling back to the id. */
export async function peerNameOrId(
  adapter: MeshAdapter,
  id: string,
): Promise<string> {
  try {
    const agent = await adapter.getAgent(id);
    return agent?.name ?? id;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[glove-mesh] adapter.getAgent("${id}") threw — falling back to id:`, err);
    return id;
  }
}

/**
 * Where a blocking send waits for its ack or reply. Inbox mode records a
 * pending blocking inbox item; event mode keeps the wait in memory and shows
 * it to the model as runtime context.
 */
export interface PendingWaits {
  /** Record that `messageId` is waiting. Throws if it cannot be recorded. */
  begin(messageId: string, request: string, createdAt: string): Promise<void>;
  /** The send failed: drop the wait without reporting a resolution. */
  cancel(messageId: string, reason: string): Promise<void>;
  /** An ack or reply arrived. Returns true when a wait was resolved. */
  resolve(messageId: string, response: string): Promise<boolean>;
}

/** Blocking sends as pending blocking inbox items (the original behaviour). */
export function inboxWaits(
  store: Required<Pick<StoreAdapter, "addInboxItem" | "updateInboxItem">>,
  pending: PendingMap,
): PendingWaits {
  return {
    async begin(messageId, request, createdAt) {
      const item: InboxItem = {
        id: generateInboxItemId(),
        tag: `mesh:waiting:${messageId}`,
        request,
        response: null,
        status: "pending",
        blocking: true,
        created_at: createdAt,
        resolved_at: null,
      };
      await store.addInboxItem(item);
      pending.set(messageId, item.id);
    },
    async cancel(messageId, reason) {
      const inboxItemId = pending.get(messageId);
      if (!inboxItemId) return;
      // Roll back the pending entry no matter what — even if the inbox
      // update fails, the in-memory pending map must not leak.
      try {
        await store.updateInboxItem(inboxItemId, {
          status: "consumed",
          response: reason,
          resolved_at: nowIso(),
        });
      } catch (rollbackErr) {
        // eslint-disable-next-line no-console
        console.warn(`[glove-mesh] failed to roll back pending inbox item ${inboxItemId}:`, rollbackErr);
      } finally {
        pending.delete(messageId);
      }
    },
    resolve: (messageId, response) => resolvePendingFor(messageId, response, store, pending),
  };
}

export interface ToolContext {
  adapter: MeshAdapter;
  identity: AgentIdentity;
  /** How blocking sends wait for their ack or reply. */
  waits: PendingWaits;
}
