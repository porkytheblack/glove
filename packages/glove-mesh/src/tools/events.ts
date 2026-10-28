import type { AgentEvent } from "glove-core";
import type { IncomingMeshMessage } from "../core/types";
import type { PendingWaits } from "./common";

interface Wait {
  request: string;
  createdAt: string;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

/**
 * Blocking sends in event mode: waits live here, the model sees them through
 * {@link renderWaits} as runtime context on every model call, and the ack or
 * reply that ends one arrives as an event.
 */
export class EventWaits implements PendingWaits {
  private waits = new Map<string, Wait>();

  async begin(messageId: string, request: string, createdAt: string) {
    this.waits.set(messageId, { request, createdAt });
  }

  async cancel(messageId: string) {
    this.waits.delete(messageId);
  }

  async resolve(messageId: string) {
    return this.waits.delete(messageId);
  }

  /** The `<mesh_waiting>` block for runtime context, or null when nothing waits. */
  render(): string | null {
    if (!this.waits.size) return null;
    const lines = [...this.waits].map(([id, wait]) =>
      `<waiting message_id="${escapeAttr(id)}" since="${escapeAttr(wait.createdAt)}">${escapeText(wait.request)}</waiting>`);
    return [
      `<mesh_waiting note="Blocking mesh sends still waiting for an acknowledgement or reply. Do not act on their answers until they arrive.">`,
      ...lines,
      `</mesh_waiting>`,
    ].join("\n");
  }
}

/** An incoming direct message or broadcast as a Glove event. */
export function eventFromIncoming(
  msg: IncomingMeshMessage,
  peerName: string,
  whenIdle: AgentEvent["whenIdle"],
): AgentEvent {
  const isBroadcast = msg.kind === "broadcast";
  const header = `${isBroadcast ? "Broadcast" : "Message"} from "${peerName}" (${msg.from})` +
    (msg.in_reply_to ? `, replying to your message ${msg.in_reply_to}` : "") +
    `. Acknowledge or reply using message id ${msg.id}.`;
  return {
    id: msg.id,
    source: `mesh:${msg.from}`,
    kind: msg.in_reply_to ? "reply" : msg.kind,
    content: `${header}\n\n${msg.content}`,
    ...(whenIdle ? { whenIdle } : {}),
    metadata: { mesh: { kind: msg.kind, from: msg.from, ...(msg.in_reply_to ? { in_reply_to: msg.in_reply_to } : {}) } },
    receivedAt: msg.created_at,
  };
}

/** An ack that ended one of this agent's blocking sends, as a Glove event. */
export function eventFromAck(
  msg: IncomingMeshMessage,
  peerName: string,
  whenIdle: AgentEvent["whenIdle"],
): AgentEvent {
  return {
    // Adapters are not required to give acks an id of their own.
    id: msg.id || `ack:${msg.ack_of}:${msg.from}`,
    source: `mesh:${msg.from}`,
    kind: "ack",
    content: `"${peerName}" (${msg.from}) acknowledged your message ${msg.ack_of}` +
      (msg.ack_note ? `: ${msg.ack_note}` : "."),
    ...(whenIdle ? { whenIdle } : {}),
    metadata: { mesh: { kind: "ack", from: msg.from, ack_of: msg.ack_of } },
    receivedAt: msg.created_at,
  };
}
