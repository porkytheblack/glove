import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MeshAdapter } from "glove-mesh";
import type {
  AgentIdentity,
  IncomingMeshMessage,
  MeshMessage,
} from "glove-mesh";

/**
 * Filesystem-backed MeshAdapter. Each agent holds an adapter scoped to its
 * own id; multiple adapters (in multiple processes, even on the same machine)
 * share a common `root` directory and communicate through it.
 *
 * Directory layout:
 *
 *   <root>/agents/<agentId>.json        — identity record per registered agent
 *   <root>/inbox/<agentId>/<msgId>.json — pending incoming messages for an agent
 *   <root>/sent/<msgId>.json            — outbound message metadata so the
 *                                          recipient's acknowledge() can find
 *                                          the original sender
 *
 * Writes use a tmp+rename pattern so a reader never sees a half-written file.
 * Subscribe polls the inbox directory at `pollIntervalMs`; on each pass it
 * reads any new files, hands them to the registered handler, and deletes them.
 *
 * Limitations (deliberate — this is test infrastructure, not a production
 * transport):
 *   - No file watching; polling only.
 *   - No retention or compaction of `<root>/sent/` (cleanup is by removing
 *     the entire root dir between test runs).
 *   - No authentication. `from` is sender-claimed, same as the in-memory
 *     reference adapter.
 *   - Single-writer assumption: one adapter instance per (root, agentId).
 *     Two adapter instances with the same id will both poll and consume
 *     each other's incoming messages.
 */
export interface FilesystemMeshAdapterOptions {
  root: string;
  agentId: string;
  /** ms between inbox polls. Default 100. */
  pollIntervalMs?: number;
}

export class FilesystemMeshAdapter implements MeshAdapter {
  identifier: string;
  private root: string;
  private agentDir: string;
  private inboxDir: string;
  private agentsDir: string;
  private sentDir: string;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private senderByMsgId = new Map<string, string>();
  private seen = new Set<string>();

  constructor(opts: FilesystemMeshAdapterOptions) {
    this.root = opts.root;
    this.identifier = opts.agentId;
    this.pollIntervalMs = opts.pollIntervalMs ?? 100;
    this.agentsDir = join(this.root, "agents");
    this.sentDir = join(this.root, "sent");
    this.inboxDir = join(this.root, "inbox");
    this.agentDir = join(this.inboxDir, opts.agentId);
    mkdirSync(this.agentsDir, { recursive: true });
    mkdirSync(this.sentDir, { recursive: true });
    mkdirSync(this.agentDir, { recursive: true });
  }

  async register(identity: AgentIdentity): Promise<void> {
    writeAtomic(
      join(this.agentsDir, `${identity.id}.json`),
      JSON.stringify(identity),
    );
  }

  async unregister(): Promise<void> {
    const path = join(this.agentsDir, `${this.identifier}.json`);
    if (existsSync(path)) rmSync(path);
  }

  async listAgents(): Promise<AgentIdentity[]> {
    if (!existsSync(this.agentsDir)) return [];
    const files = readdirSync(this.agentsDir).filter((f) =>
      f.endsWith(".json"),
    );
    const out: AgentIdentity[] = [];
    for (const f of files) {
      try {
        const raw = readFileSync(join(this.agentsDir, f), "utf8");
        out.push(JSON.parse(raw) as AgentIdentity);
      } catch {
        // Skip transient half-state.
      }
    }
    return out;
  }

  async getAgent(id: string): Promise<AgentIdentity | null> {
    const path = join(this.agentsDir, `${id}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as AgentIdentity;
    } catch {
      return null;
    }
  }

  async send(message: MeshMessage): Promise<void> {
    if (!message.to) {
      throw new Error("FilesystemMeshAdapter.send: message.to is required");
    }
    const incoming: IncomingMeshMessage = {
      ...message,
      kind: "direct",
    };
    this.writeInbox(message.to, incoming);
    this.writeSentRecord(message.id, message.from);
  }

  async broadcast(message: Omit<MeshMessage, "to">): Promise<void> {
    const agents = await this.listAgents();
    for (const peer of agents) {
      if (peer.id === message.from) continue;
      const incoming: IncomingMeshMessage = {
        ...message,
        id: `${message.id}-${peer.id}`,
        to: peer.id,
        kind: "broadcast",
      };
      this.writeInbox(peer.id, incoming);
    }
    this.writeSentRecord(message.id, message.from);
  }

  async acknowledge(messageId: string, note?: string): Promise<void> {
    const sender =
      this.senderByMsgId.get(messageId) ?? this.readSentRecord(messageId);
    if (!sender) {
      // Original sender unknown — silently drop, matching the in-memory
      // adapter's "unknown message" tolerance.
      return;
    }
    const ackId = `${messageId}-ack-${randomUUID()}`;
    const ack: IncomingMeshMessage = {
      id: ackId,
      from: this.identifier,
      to: sender,
      content: note ?? "acknowledged",
      created_at: new Date().toISOString(),
      kind: "ack",
      ack_of: messageId,
      ack_note: note,
    };
    this.writeInbox(sender, ack);
  }

  subscribe(
    handler: (msg: IncomingMeshMessage) => Promise<void>,
  ): () => void {
    if (this.pollTimer) {
      throw new Error(
        "FilesystemMeshAdapter.subscribe: already subscribed (one handler per adapter)",
      );
    }
    const tick = async (): Promise<void> => {
      if (!existsSync(this.agentDir)) return;
      let files: string[];
      try {
        files = readdirSync(this.agentDir);
      } catch {
        return;
      }
      files.sort(); // deterministic ordering; uuid prefix mostly sorts by creation
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        if (this.seen.has(f)) continue;
        this.seen.add(f);
        const full = join(this.agentDir, f);
        let msg: IncomingMeshMessage;
        try {
          msg = JSON.parse(readFileSync(full, "utf8")) as IncomingMeshMessage;
        } catch {
          // Half-written or corrupt — leave for the next pass; pop from seen
          // so we retry.
          this.seen.delete(f);
          continue;
        }
        // Track sender for direct/broadcast so a later acknowledge() routes back.
        if (msg.kind !== "ack") {
          this.senderByMsgId.set(msg.id, msg.from);
        }
        try {
          await handler(msg);
        } catch (err) {
          // Adapter contract: never bubble out of subscribe handler errors.
          console.warn(
            `[FilesystemMeshAdapter:${this.identifier}] handler threw on ${f}:`,
            err,
          );
        }
        try {
          rmSync(full);
        } catch {
          // Best-effort cleanup; another process may have raced. Keep `seen`
          // populated so we don't double-deliver.
        }
      }
    };
    // Run immediately so a message that landed before subscribe() is picked
    // up on the first poll, not after pollIntervalMs of latency.
    void tick();
    this.pollTimer = setInterval(() => {
      void tick();
    }, this.pollIntervalMs);
    return () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private writeInbox(agentId: string, msg: IncomingMeshMessage): void {
    const dir = join(this.inboxDir, agentId);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, `${msg.id}.json`), JSON.stringify(msg));
  }

  private writeSentRecord(messageId: string, from: string): void {
    writeAtomic(
      join(this.sentDir, `${messageId}.json`),
      JSON.stringify({ id: messageId, from }),
    );
    this.senderByMsgId.set(messageId, from);
  }

  private readSentRecord(messageId: string): string | null {
    const path = join(this.sentDir, `${messageId}.json`);
    if (!existsSync(path)) return null;
    try {
      const rec = JSON.parse(readFileSync(path, "utf8")) as { from: string };
      return rec.from ?? null;
    } catch {
      return null;
    }
  }
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
