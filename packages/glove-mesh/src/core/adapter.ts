import type {
  AgentIdentity,
  IncomingMeshMessage,
  MeshMessage,
} from "./types";

/**
 * Per-agent view of the mesh. Same shape as `McpAdapter` / `StoreAdapter`:
 * the consumer implements it, scoped to ONE agent on the network. If a host
 * process runs multiple agents, it constructs one MeshAdapter per agent.
 *
 * The framework calls these methods through `mountMesh`. The consumer is
 * responsible for the transport (in-process broker, Redis pub/sub, NATS,
 * HTTP webhooks, ...) and for any authentication concerns — `from` on
 * `MeshMessage` is sender-claimed and unverified.
 */
export interface MeshAdapter {
  /** For debugging / log correlation. Conventionally the agent id. */
  identifier: string;

  // ── Identity / registration ────────────────────────────────────────────

  /** Announce this agent on the network. Called by `mountMesh` on setup. */
  register(identity: AgentIdentity): Promise<void>;

  /** Remove this agent from the network. */
  unregister(): Promise<void>;

  /** Returns everyone currently on the network, including self. */
  listAgents(): Promise<AgentIdentity[]>;

  /** Look up a single agent by id. Returns null if not registered. */
  getAgent(id: string): Promise<AgentIdentity | null>;

  // ── Outbound ──────────────────────────────────────────────────────────

  /**
   * Send a directed message. Resolves when the transport has accepted it,
   * NOT when the recipient has handled it.
   */
  send(message: MeshMessage): Promise<void>;

  /**
   * Send to every other registered agent. The sender is excluded by the
   * adapter. `to` must not be set on the input.
   */
  broadcast(message: Omit<MeshMessage, "to">): Promise<void>;

  /**
   * Lightweight delivery/read confirmation. Routes back to the original
   * sender as an `IncomingMeshMessage` with `kind: "ack"`. The sender's
   * blocking send (if any) resolves on this.
   */
  acknowledge(messageId: string, note?: string): Promise<void>;

  // ── Inbound ───────────────────────────────────────────────────────────

  /**
   * Framework registers ONE handler per agent. The adapter invokes it for
   * every incoming message addressed to this agent (or broadcast, or an
   * ack of one of this agent's outbound sends).
   *
   * Handler errors MUST NOT bubble out of the adapter — log them and
   * continue so fan-out to other agents stays intact.
   *
   * Returns an unsubscribe function.
   */
  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void;
}
