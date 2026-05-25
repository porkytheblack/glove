import type { MeshAdapter } from "../core/adapter";
import {
  type AgentIdentity,
  type IncomingMeshMessage,
  type MeshMessage,
  MeshUnknownAgentError,
  MeshUnknownMessageError,
} from "../core/types";

type Handler = (msg: IncomingMeshMessage) => Promise<void>;

const DEFAULT_SENDER_TABLE_CAPACITY = 1024;

/**
 * Shared in-process bus. Construct ONCE per "mesh"; pass the same instance
 * to every InMemoryMeshAdapter in the process. This is the wire-compatible
 * analogue of an external pub/sub broker — substitute a real one in
 * production by implementing `MeshAdapter` directly over your transport.
 */
export class MeshNetwork {
  private agents = new Map<string, AgentIdentity>();
  private handlers = new Map<string, Set<Handler>>();
  // Bounded LRU: message_id -> original sender id. Lets `acknowledge`
  // route the ack back without the consumer threading sender on every call.
  private senderTable = new Map<string, string>();
  private readonly senderTableCapacity: number;

  constructor(opts: { senderTableCapacity?: number } = {}) {
    this.senderTableCapacity =
      opts.senderTableCapacity ?? DEFAULT_SENDER_TABLE_CAPACITY;
  }

  registerAgent(id: string, identity: AgentIdentity): void {
    this.agents.set(id, identity);
    if (!this.handlers.has(id)) this.handlers.set(id, new Set());
  }

  unregisterAgent(id: string): void {
    this.agents.delete(id);
    this.handlers.delete(id);
  }

  listAgents(): AgentIdentity[] {
    return [...this.agents.values()];
  }

  getAgent(id: string): AgentIdentity | null {
    return this.agents.get(id) ?? null;
  }

  attachHandler(agentId: string, h: Handler): () => void {
    let set = this.handlers.get(agentId);
    if (!set) {
      set = new Set();
      this.handlers.set(agentId, set);
    }
    set.add(h);
    return () => {
      set?.delete(h);
    };
  }

  /** Route a directed message. Records sender for future ack lookup. */
  async deliverDirect(msg: MeshMessage): Promise<void> {
    // Always remember the sender first — keeps ack routing consistent even
    // when validation fails (mirrors the contract of a real broker, which
    // can't easily roll back its sender bookkeeping on a rejected publish).
    this.rememberSender(msg.id, msg.from);
    if (!msg.to) {
      throw new MeshUnknownAgentError("(missing `to` field)");
    }
    if (!this.agents.has(msg.to)) {
      throw new MeshUnknownAgentError(msg.to);
    }
    await this.fanOut(msg.to, { ...msg, kind: "direct" });
  }

  /** Fan out to everyone except the sender. */
  async deliverBroadcast(msg: MeshMessage): Promise<void> {
    this.rememberSender(msg.id, msg.from);
    // Source of truth is the registration table, not the handler map.
    // An agent that registered but hasn't subscribed yet still counts as a
    // recipient (delivery to that agent is a no-op via fanOut).
    const recipients = [...this.agents.keys()].filter((id) => id !== msg.from);
    for (const recipient of recipients) {
      await this.fanOut(recipient, { ...msg, kind: "broadcast" });
    }
  }

  /** Deliver an ack back to the original sender. */
  async deliverAck(
    originalSenderId: string,
    ackOf: string,
    fromId: string,
    note?: string,
  ): Promise<void> {
    const ack: IncomingMeshMessage = {
      id: `ack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from: fromId,
      to: originalSenderId,
      content: note ?? "",
      created_at: new Date().toISOString(),
      kind: "ack",
      ack_of: ackOf,
      ack_note: note,
    };
    await this.fanOut(originalSenderId, ack);
  }

  /** Look up the sender of a message by its id. */
  resolveSenderFor(messageId: string): string | null {
    return this.senderTable.get(messageId) ?? null;
  }

  private rememberSender(messageId: string, senderId: string): void {
    // Touch as MRU.
    if (this.senderTable.has(messageId)) this.senderTable.delete(messageId);
    this.senderTable.set(messageId, senderId);
    while (this.senderTable.size > this.senderTableCapacity) {
      const oldest = this.senderTable.keys().next().value;
      if (oldest === undefined) break;
      this.senderTable.delete(oldest);
    }
  }

  private async fanOut(agentId: string, msg: IncomingMeshMessage): Promise<void> {
    const set = this.handlers.get(agentId);
    if (!set || set.size === 0) return;
    for (const h of [...set]) {
      try {
        await h(msg);
      } catch (err) {
        // Per adapter contract: handler errors must not bubble.
        // eslint-disable-next-line no-console
        console.warn("[glove-mesh] in-memory handler threw:", err);
      }
    }
  }
}

/**
 * Reference per-agent MeshAdapter that talks to an in-process MeshNetwork.
 * Useful for dev, tests, and single-host setups. For cross-process or
 * distributed messaging, implement `MeshAdapter` directly over your transport.
 */
export class InMemoryMeshAdapter implements MeshAdapter {
  readonly identifier: string;

  constructor(
    private readonly network: MeshNetwork,
    private readonly agentId: string,
  ) {
    this.identifier = `in-memory-mesh-${agentId}`;
  }

  async register(identity: AgentIdentity): Promise<void> {
    this.network.registerAgent(this.agentId, identity);
  }

  async unregister(): Promise<void> {
    this.network.unregisterAgent(this.agentId);
  }

  async listAgents(): Promise<AgentIdentity[]> {
    return this.network.listAgents();
  }

  async getAgent(id: string): Promise<AgentIdentity | null> {
    return this.network.getAgent(id);
  }

  async send(message: MeshMessage): Promise<void> {
    await this.network.deliverDirect({ ...message, from: this.agentId });
  }

  async broadcast(message: Omit<MeshMessage, "to">): Promise<void> {
    await this.network.deliverBroadcast({ ...message, from: this.agentId });
  }

  async acknowledge(messageId: string, note?: string): Promise<void> {
    const originalSender = this.network.resolveSenderFor(messageId);
    if (!originalSender) throw new MeshUnknownMessageError(messageId);
    await this.network.deliverAck(originalSender, messageId, this.agentId, note);
  }

  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void {
    return this.network.attachHandler(this.agentId, handler);
  }
}
