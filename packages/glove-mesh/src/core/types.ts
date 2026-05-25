/**
 * Identity an agent announces when it joins a mesh. The `id` is stable and
 * unique on the network; everything else helps peers (and the model) decide
 * who to talk to.
 */
export interface AgentIdentity {
  id: string;
  name: string;
  description: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Outbound message authored by an agent's tool call. The `from` field is
 * sender-claimed — there is no authentication in v1, so adapters that care
 * must add their own signing/verification on top.
 */
export interface MeshMessage {
  /** Sender-generated id. */
  id: string;
  /** Sender id. Unverified. */
  from: string;
  /** Recipient id. Omitted on broadcast. */
  to?: string;
  /** Optional: the message id this is in reply to. */
  in_reply_to?: string;
  /** Free-form text content. */
  content: string;
  /** ISO-8601 send timestamp. */
  created_at: string;
  /** Whether the sender is blocked waiting for ack/reply. */
  blocking?: boolean;
  /** Opaque metadata channel. */
  metadata?: Record<string, unknown>;
}

/**
 * Message handed to the per-agent subscribe handler. The `kind` discriminator
 * tells the framework whether to surface this as new inbox content or as an
 * acknowledgement that resolves an earlier blocking send.
 */
export interface IncomingMeshMessage extends MeshMessage {
  kind: "direct" | "broadcast" | "ack";
  /** When kind === "ack", the id of the original message being acknowledged. */
  ack_of?: string;
  /** When kind === "ack", optional note the acknowledger wrote. */
  ack_note?: string;
}

export class MeshError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "MeshError";
    this.code = code;
  }
}

export class MeshNotRegisteredError extends MeshError {
  constructor(message?: string) {
    super("not_registered", message);
    this.name = "MeshNotRegisteredError";
  }
}

export class MeshUnknownAgentError extends MeshError {
  constructor(agentId: string) {
    super("unknown_agent", `No agent with id "${agentId}".`);
    this.name = "MeshUnknownAgentError";
  }
}

export class MeshUnknownMessageError extends MeshError {
  constructor(messageId: string) {
    super("unknown_message", `No record of message "${messageId}".`);
    this.name = "MeshUnknownMessageError";
  }
}

export class MeshStoreUnsupportedError extends MeshError {
  constructor() {
    super(
      "store_unsupported",
      "The provided StoreAdapter does not implement inbox methods; glove-mesh requires getInboxItems/addInboxItem/updateInboxItem/getResolvedInboxItems.",
    );
    this.name = "MeshStoreUnsupportedError";
  }
}
