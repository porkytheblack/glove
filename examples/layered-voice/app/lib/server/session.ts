// ─────────────────────────────────────────────────────────────────────────────
// Session orchestrator
//
// Owns one voice session's two agents and the in-process mesh between them,
// and runs the pipeline for every utterance:
//
//   utterance (speaker-labelled) ──► front (Nova)
//                                      │  streams raw text; only <speech>…</speech>
//                                      │  spans are parsed out and emitted as
//                                      │  spoken deltas (speech-parser.ts)
//                                      │
//                                      ├── no speech emitted → Nova stayed quiet
//                                      │   (she judged the line wasn't for her)
//                                      │
//                                      └── delegation? drain it:
//                                            worker.processRequest ──► reply over mesh
//                                            front relay turn ──► spoken via <speech>
//
// There is no separate addressing monitor — Nova hears every line and decides
// herself. All progress streams to subscribers as SessionEvents (→ SSE).
// ─────────────────────────────────────────────────────────────────────────────

import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";
import type { IGloveRunnable, SubscriberAdapter } from "glove-core";
import { buildFrontAgent } from "./front-agent";
import { buildWorkerAgent } from "./worker-agent";
import { frameUtterance, ASSISTANT_NAME } from "./speakers";
import { SpeechTagParser } from "./speech-parser";
import { logMetric } from "./metrics";
import type {
  AgentRole,
  AgentStats,
  MetricRecord,
  Phase,
  SessionEvent,
  SpeakerRole,
  Utterance,
} from "../shared/types";

type Listener = (e: SessionEvent) => void;

const MAX_DELEGATION_ROUNDS = 4;

function emptyStats(): AgentStats {
  return { tokensIn: 0, tokensOut: 0, turns: 0 };
}

function compact(input: unknown, max = 140): string {
  let s: string;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class Session {
  readonly id: string;
  private front!: IGloveRunnable;
  private worker!: IGloveRunnable;
  private network = new MeshNetwork();
  private listeners = new Set<Listener>();
  private stats: Record<AgentRole, AgentStats> = {
    front: emptyStats(),
    worker: emptyStats(),
  };
  private queue: Promise<unknown> = Promise.resolve();
  private currentFrontKind: "response" | "relay" = "response";
  // The live <speech> parser for the front turn in flight (null between turns).
  private speechParser: SpeechTagParser | null = null;
  private uttSeq = 0;
  private buildError: string | null = null;
  // Metric bookkeeping for the current addressed turn.
  private currentUtteranceId: string | null = null;
  private turnStartAt = 0;
  private ttftPending = false;
  readonly ready: Promise<void>;

  constructor(id: string) {
    this.id = id;
    this.ready = this.init();
  }

  // ── event fan-out ──────────────────────────────────────────────────────────
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: SessionEvent) {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        /* a dead SSE connection must not break the pipeline */
      }
    }
  }

  getBuildError(): string | null {
    return this.buildError;
  }

  /** Emit a server-measured metric to the live HUD and append it to the file. */
  private metric(name: string, ms?: number, data?: Record<string, unknown>) {
    const rec: MetricRecord = {
      ts: new Date().toISOString(),
      sessionId: this.id,
      source: "server",
      name,
      ...(ms != null ? { ms: Math.round(ms) } : {}),
      ...(this.currentUtteranceId ? { utteranceId: this.currentUtteranceId } : {}),
      ...(data ? { data } : {}),
    };
    this.emit({ type: "metric", metric: rec });
    void logMetric(rec);
  }

  snapshotStats(): Record<AgentRole, AgentStats> {
    return {
      front: { ...this.stats.front },
      worker: { ...this.stats.worker },
    };
  }

  // ── per-agent event translation ────────────────────────────────────────────
  private makeSubscriber(role: AgentRole): SubscriberAdapter {
    return {
      record: async (type, data) => {
        switch (type) {
          case "token_consumption": {
            const c = (data as { consumption: { tokens_in: number; tokens_out: number } }).consumption;
            this.stats[role].tokensIn += c.tokens_in ?? 0;
            this.stats[role].tokensOut += c.tokens_out ?? 0;
            this.stats[role].turns += 1;
            this.emit({ type: "stats", stats: this.snapshotStats() });
            break;
          }
          case "text_delta": {
            // Nova's raw stream goes through the <speech> parser — only in-tag
            // spans surface as spoken deltas. Worker text is never surfaced.
            if (role === "front") {
              this.speechParser?.push((data as { text: string }).text);
            }
            break;
          }
          case "tool_use": {
            const d = data as { name: string; input: unknown };
            if (d.name === "glove_mesh_send_message") {
              const input = (d.input ?? {}) as { content?: string };
              if (role === "front") {
                this.emit({ type: "mesh", direction: "delegate", from: "front", to: "worker", content: input.content ?? "" });
              } else if (role === "worker") {
                this.emit({ type: "mesh", direction: "reply", from: "worker", to: "front", content: input.content ?? "" });
              }
            } else if (d.name.startsWith("glove_mesh_")) {
              // other mesh tools — not surfaced
            } else if (role === "worker") {
              this.emit({ type: "tool", role, name: d.name, summary: compact(d.input) });
            }
            break;
          }
          default:
            break;
        }
      },
    };
  }

  // ── build agents + mesh ────────────────────────────────────────────────────
  private async init(): Promise<void> {
    try {
      this.front = buildFrontAgent();
      this.worker = buildWorkerAgent();
    } catch (err) {
      this.buildError =
        (err as Error)?.message ??
        "Failed to build agents. Is your model provider API key set? (see .env.example)";
      return;
    }

    this.front.addSubscriber(this.makeSubscriber("front"));
    this.worker.addSubscriber(this.makeSubscriber("worker"));

    await mountMesh(this.front, {
      adapter: new InMemoryMeshAdapter(this.network, "front"),
      identity: {
        id: "front",
        name: "Voice Front",
        description: `${ASSISTANT_NAME}, the voice front desk.`,
        capabilities: ["voice"],
      },
    });
    await mountMesh(this.worker, {
      adapter: new InMemoryMeshAdapter(this.network, "worker"),
      identity: {
        id: "worker",
        name: "Service Worker",
        description: "Full shop-database tool surface: catalog, customers, ships, service, parts, quotes, financing, bookings.",
        capabilities: ["research", "tools"],
      },
    });
  }

  // ── one front turn, with live <speech> parsing ─────────────────────────────
  /**
   * Run the front agent once. Its raw stream is piped through a fresh
   * SpeechTagParser; in-tag text is emitted live as spoken `delta` events.
   * Returns everything Nova actually said (empty string = she stayed quiet).
   */
  private async runFrontTurn(prompt: string): Promise<string> {
    const parser = new SpeechTagParser((text) => {
      if (this.ttftPending) {
        this.ttftPending = false;
        this.metric("front_ttft_ms", Date.now() - this.turnStartAt);
      }
      this.emit({ type: "delta", role: "front", text });
    });
    this.speechParser = parser;
    try {
      await this.front.processRequest(prompt);
    } finally {
      this.speechParser = null;
    }
    const speech = parser.finish();
    if (speech) {
      this.emit({ type: "say", role: "front", kind: this.currentFrontKind, text: speech });
    }
    return speech;
  }

  // ── public entry: handle one tagged utterance (serialized) ─────────────────
  handleUtterance(role: SpeakerRole, text: string): Promise<void> {
    const run = this.queue.then(() => this._handle(role, text));
    // keep the chain alive even if this turn throws
    this.queue = run.catch(() => {});
    return run;
  }

  private async _handle(role: SpeakerRole, text: string): Promise<void> {
    await this.ready;
    if (this.buildError) {
      this.emit({ type: "error", message: this.buildError });
      return;
    }

    const utt: Utterance = {
      id: `u${++this.uttSeq}_${Date.now()}`,
      speaker: role,
      text,
      ts: new Date().toISOString(),
    };
    this.currentUtteranceId = utt.id;
    this.emit({ type: "utterance", utterance: utt });

    // Every line goes to Nova; whether to speak is her call.
    this.emit({ type: "phase", phase: "front" });
    this.currentFrontKind = "response";
    this.turnStartAt = Date.now();
    this.ttftPending = true;
    const speech = await this.runFrontTurn(frameUtterance(role, text));
    this.ttftPending = false;
    this.metric("front_turn_ms", Date.now() - this.turnStartAt, { spoke: speech.length > 0 });

    if (!speech) {
      this.emit({
        type: "silent",
        utteranceId: utt.id,
        reason: `${ASSISTANT_NAME} produced no <speech> — she judged this wasn't addressed to her.`,
      });
    }

    await this.drainDelegations();
    this.metric("roundtrip_ms", Date.now() - this.turnStartAt);
    this.emit({ type: "phase", phase: "idle" });
  }

  // ── drain any pending mesh delegations: worker → reply → proactive relay ────
  private async drainDelegations(): Promise<void> {
    for (let round = 0; round < MAX_DELEGATION_ROUNDS; round++) {
      const items = (await this.front.store.getInboxItems?.()) ?? [];
      const pending = items.filter((i) => i.status === "pending" && i.tag.startsWith("mesh:waiting:"));
      if (pending.length === 0) return;

      // Worker handles every delegation in its inbox and replies over the mesh.
      this.emit({ type: "phase", phase: "worker" });
      const wt0 = Date.now();
      await this.worker.processRequest(
        'You have new delegated request(s) in your inbox. Handle each one with your tools, then reply to the front agent (id "front") via glove_mesh_send_message with in_reply_to set to the message id shown in the inbox line. Do NOT acknowledge — reply only.',
      );
      this.metric("worker_ms", Date.now() - wt0);

      // The reply resolves the front's pending item and lands in its inbox;
      // the front relays it proactively (the §5 wakeup, driven here).
      this.emit({ type: "phase", phase: "relay" });
      this.currentFrontKind = "relay";
      const rt0 = Date.now();
      this.turnStartAt = rt0;
      this.ttftPending = true;
      await this.runFrontTurn(
        "A delegated request has resolved and its result is in your inbox. Relay it to whoever asked — inside <speech> tags, one or two natural spoken sentences with just the key facts. Do not re-delegate unless there is a genuinely new question to answer.",
      );
      this.ttftPending = false;
      this.metric("relay_ms", Date.now() - rt0);
      this.currentFrontKind = "response";
    }
  }
}

// ── Registry singleton (survives Next.js HMR via globalThis) ─────────────────
const g = globalThis as unknown as { __layeredVoiceSessions?: Map<string, Session> };
const REGISTRY: Map<string, Session> = g.__layeredVoiceSessions ?? (g.__layeredVoiceSessions = new Map());

export function createSession(): Session {
  const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const session = new Session(id);
  REGISTRY.set(id, session);
  // Soft cap to avoid unbounded growth in a long-lived dev server.
  if (REGISTRY.size > 50) {
    const oldest = REGISTRY.keys().next().value;
    if (oldest && oldest !== id) REGISTRY.delete(oldest);
  }
  return session;
}

export function getSession(id: string): Session | undefined {
  return REGISTRY.get(id);
}
