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

export interface ToolContext {
  adapter: MeshAdapter;
  identity: AgentIdentity;
  store: Required<
    Pick<
      StoreAdapter,
      "getInboxItems" | "addInboxItem" | "updateInboxItem" | "getResolvedInboxItems"
    >
  >;
  pending: PendingMap;
}
