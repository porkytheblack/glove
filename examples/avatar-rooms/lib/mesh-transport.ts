// ─────────────────────────────────────────────────────────────────────────────
// The mesh, stretched across a process boundary.
//
// Delegation stays exactly what the paper describes — the front agent calls
// `glove_mesh_send_message` with `blocking: true`, gets a `mesh:waiting` inbox
// item, keeps the floor, and is woken when the worker's threaded reply resolves
// it. What changes here is only the TRANSPORT underneath: the two agents no
// longer share a process, so the in-process bus can't carry it.
//
// `MeshAdapter`'s contract anticipates exactly this ("in-process broker, Redis
// pub/sub, NATS, HTTP webhooks..."), so both sides are just adapters:
//
//   room process            RoomMeshAdapter.send(to: "worker")
//                             └─▶ research signal .trigger()  — fire and forget
//                                     │
//   signal child process            WorkerMeshAdapter delivers the request into
//                                   the worker's inbox, worker researches, then
//                                   .send(to: "front", in_reply_to: <id>)
//                                     └─▶ POST {replyUrl}
//                                             │
//   room process            /mesh endpoint ──▶ RoomMeshAdapter's subscriber
//                             └─▶ resolves the front agent's mesh:waiting item
//
// The signal is how the worker gets EXECUTED (own process, timeout, retries, a
// durable Run record); the mesh is still how the two agents TALK.
// ─────────────────────────────────────────────────────────────────────────────

import type { MeshAdapter } from "glove-mesh";
import type { AgentIdentity, IncomingMeshMessage, MeshMessage } from "glove-mesh";

export const FRONT_ID = "front";
export const WORKER_ID = "worker";

export const FRONT_IDENTITY: AgentIdentity = {
  id: FRONT_ID,
  name: "Voice Front",
  description: "Nova, the voice front desk. Owns the room and the conversation.",
  capabilities: ["voice"],
};

export const WORKER_IDENTITY: AgentIdentity = {
  id: WORKER_ID,
  name: "Service Worker",
  description:
    "Full shop-database tool surface: catalog, customers, ships, service, parts, quotes, financing, bookings.",
  capabilities: ["research", "tools"],
};

/** The wire shape of a mesh message crossing the HTTP hop. */
export interface MeshEnvelope {
  message: IncomingMeshMessage;
}

const ROSTER: Record<string, AgentIdentity> = {
  [FRONT_ID]: FRONT_IDENTITY,
  [WORKER_ID]: WORKER_IDENTITY,
};

/**
 * Base for both sides: the roster is static (this network is exactly two
 * agents), so registration and lookup need no coordination service.
 */
abstract class StaticRosterMeshAdapter implements MeshAdapter {
  protected handler: ((msg: IncomingMeshMessage) => Promise<void>) | null = null;

  constructor(readonly identifier: string) {}

  async register(): Promise<void> {
    /* the roster is fixed and known to both sides */
  }
  async unregister(): Promise<void> {
    this.handler = null;
  }
  async listAgents(): Promise<AgentIdentity[]> {
    return Object.values(ROSTER);
  }
  async getAgent(id: string): Promise<AgentIdentity | null> {
    return ROSTER[id] ?? null;
  }

  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  /** Hand a message to this agent's inbound handler. */
  async deliver(msg: IncomingMeshMessage): Promise<void> {
    if (!this.handler) return;
    try {
      await this.handler(msg);
    } catch (err) {
      // Contract: handler errors must not escape the adapter.
      console.error(`[mesh:${this.identifier}] inbound handler failed:`, err);
    }
  }

  abstract send(message: MeshMessage): Promise<void>;

  async broadcast(): Promise<void> {
    /* two-agent network — a broadcast is just a send, and nothing uses it */
  }

  async acknowledge(): Promise<void> {
    // Deliberately inert. An ack would resolve the front agent's pending item
    // before any findings exist — the exact failure the paper warns about — so
    // the worker's prompt forbids it and this makes it a no-op if it tries.
  }
}

// ── room side ────────────────────────────────────────────────────────────────

export interface RoomMeshAdapterConfig {
  /** Queue a research job. Fire-and-forget: resolves once queued, not answered. */
  dispatch(input: { request: string; messageId: string }): Promise<string>;
}

/**
 * The front agent's view of the mesh, inside the room beacon.
 *
 * `send()` does not wait for the worker — it queues the job and returns, which
 * is what keeps Nova responsive. The reply arrives later through `deliver()`,
 * called by the room's `/mesh` HTTP endpoint.
 */
export class RoomMeshAdapter extends StaticRosterMeshAdapter {
  constructor(private readonly cfg: RoomMeshAdapterConfig) {
    super(FRONT_ID);
  }

  async send(message: MeshMessage): Promise<void> {
    if (message.to !== WORKER_ID) {
      throw new Error(`No agent with id "${message.to}" on this mesh.`);
    }
    await this.cfg.dispatch({ request: message.content, messageId: message.id });
  }
}

// ── worker side ──────────────────────────────────────────────────────────────

export interface WorkerMeshAdapterConfig {
  /** The room's inbound mesh endpoint, e.g. http://127.0.0.1:4501/mesh */
  replyUrl: string;
  /** Shared secret proving this reply came from a job the room dispatched. */
  token: string;
}

/**
 * The worker's view of the mesh, inside a signal run.
 *
 * `send()` POSTs the reply back to the room. If the room is gone (restarted, or
 * the caller hung up) the POST fails and the error surfaces on the Run — the
 * findings are still recorded in the run's output, so nothing is lost silently.
 */
export class WorkerMeshAdapter extends StaticRosterMeshAdapter {
  constructor(private readonly cfg: WorkerMeshAdapterConfig) {
    super(WORKER_ID);
  }

  async send(message: MeshMessage): Promise<void> {
    if (message.to !== FRONT_ID) {
      throw new Error(`No agent with id "${message.to}" on this mesh.`);
    }
    const envelope: MeshEnvelope = { message: { ...message, kind: "direct" } };
    const res = await fetch(this.cfg.replyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mesh-token": this.cfg.token,
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new Error(`mesh reply rejected by room (${res.status})`);
    }
  }
}
