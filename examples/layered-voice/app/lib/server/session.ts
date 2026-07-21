// ─────────────────────────────────────────────────────────────────────────────
// Session orchestrator
//
// Owns one voice session's two agents and the in-process mesh between them.
// Delegation is genuinely ASYNC (paper §3): Nova's blocking mesh send only
// creates a pending `mesh:waiting:<id>` inbox item — her turn ends right after
// the spoken ack. The worker runs in the background on its own queue while the
// room keeps talking; Nova can handle other utterances meanwhile (the pending
// reminder keeps her honest about what's still in flight).
//
//   utterance ──► front turn (speech parsed from <speech> tags) ──► ends
//                    │ delegated?             ▲
//                    ▼ (fire-and-forget)      │ queued relay turn (§5 wakeup):
//               worker queue ── research ── reply lands in Nova's inbox
//
// The wakeup respects the paper's rules: relays are COALESCED (one relay turn
// however many replies arrived) and the USER TURN WINS (if a user utterance
// consumed the result first, the queued relay finds nothing and stays silent).
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

const WORKER_DRAIN_PROMPT =
  'You have new delegated request(s) in your inbox. Handle each one with your tools, then reply to the front agent (id "front") via glove_mesh_send_message with in_reply_to set to the message id shown in the inbox line. Do NOT acknowledge — reply only.';

const RELAY_PROMPT =
  "A delegated request has resolved and its result is in your inbox. Relay it to whoever asked — inside <speech> tags, one or two natural spoken sentences with just the key facts. Do not re-delegate unless there is a genuinely new question to answer.";

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
  // Front turns (user utterances + queued relays) serialize on this chain.
  private queue: Promise<unknown> = Promise.resolve();
  // Worker runs serialize on their own chain — CONCURRENT with front turns.
  private workerQueue: Promise<unknown> = Promise.resolve();
  // mesh:waiting tags already handed to the worker (so we don't double-run).
  private dispatched = new Set<string>();
  private relayQueued = false;
  private workerBusy = 0;
  private currentFrontKind: "response" | "relay" = "response";
  // The live <speech> parser for the front turn in flight (null between turns).
  private speechParser: SpeechTagParser | null = null;
  private uttSeq = 0;
  private buildError: string | null = null;
  // Metric bookkeeping for the front turn in flight.
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

  isWorkerBusy(): boolean {
    return this.workerBusy > 0;
  }

  private setWorkerBusy(delta: 1 | -1) {
    this.workerBusy = Math.max(0, this.workerBusy + delta);
    this.emit({ type: "worker_busy", busy: this.workerBusy > 0 });
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
  /**
   * Resolves when NOVA'S turn is done — not when any delegation resolves.
   * Delegated work continues in the background and is relayed when it lands.
   */
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

    // Fire-and-forget: hand any new delegations to the worker and RETURN.
    // Nova is free for the next utterance while the worker researches.
    await this.kickWorker();
    this.emit({ type: "phase", phase: "idle" });
  }

  // ── async delegation: background worker + queued relay wakeup ──────────────
  /**
   * Scan Nova's inbox for pending `mesh:waiting` items not yet handed to the
   * worker, and schedule ONE background worker run for the batch. Cheap —
   * only dispatches, never waits for the research.
   */
  private async kickWorker(): Promise<void> {
    const items = (await this.front.store.getInboxItems?.()) ?? [];
    const fresh = items.filter(
      (i) =>
        i.status === "pending" &&
        i.tag.startsWith("mesh:waiting:") &&
        !this.dispatched.has(i.tag),
    );
    if (fresh.length === 0) return;
    for (const i of fresh) this.dispatched.add(i.tag);

    const dispatchedAt = Date.now();
    this.workerQueue = this.workerQueue
      .then(async () => {
        this.setWorkerBusy(1);
        const wt0 = Date.now();
        try {
          await this.worker.processRequest(WORKER_DRAIN_PROMPT);
        } catch (err) {
          this.emit({ type: "error", message: `Worker run failed: ${(err as Error)?.message ?? String(err)}` });
        }
        this.metric("worker_ms", Date.now() - wt0);
        this.setWorkerBusy(-1);
        // The reply already landed in Nova's inbox (mesh handler). Wake her.
        this.queueRelay(dispatchedAt);
      })
      .catch(() => {});
  }

  /**
   * The §5 wakeup: queue a relay turn on the FRONT chain so it serializes
   * behind any in-flight user utterance. Coalesced — replies that arrive while
   * a relay is queued share the one turn (inbox injection batches naturally).
   * User turn wins — if a user utterance already consumed the results, the
   * relay finds nothing resolved and is skipped entirely.
   */
  private queueRelay(dispatchedAt: number): void {
    if (this.relayQueued) return;
    this.relayQueued = true;
    this.queue = this.queue
      .then(async () => {
        this.relayQueued = false;
        const resolved = (await this.front.store.getResolvedInboxItems?.()) ?? [];
        const meshResolved = resolved.filter(
          (i) => i.tag.startsWith("mesh:from:") || i.tag.startsWith("mesh:waiting:"),
        );
        if (meshResolved.length === 0) return; // consumed by a user turn — its answer covered it

        this.emit({ type: "phase", phase: "relay" });
        this.currentFrontKind = "relay";
        const rt0 = Date.now();
        this.turnStartAt = rt0;
        this.ttftPending = true;
        await this.runFrontTurn(RELAY_PROMPT);
        this.ttftPending = false;
        this.metric("relay_ms", Date.now() - rt0);
        this.metric("delegation_roundtrip_ms", Date.now() - dispatchedAt);
        this.currentFrontKind = "response";
        this.emit({ type: "phase", phase: "idle" });

        // The relay itself may have delegated a follow-up.
        await this.kickWorker();
      })
      .catch(() => {});
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
