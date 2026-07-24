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
import { frontProviderSort, modelFor, PROVIDER } from "./models";
import { createAgentStore } from "./stores";
import { frameUtterance, ASSISTANT_NAME } from "./speakers";
import {
  frameInterruption,
  frameSpeechFailure,
  frameTranscriptCorrection,
  frameWorkerResult,
  frameWorkerTrouble,
} from "./events";
import { SpeechTagParser, type SpeechParseStats } from "./speech-parser";
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

// Spoken phrases that signal Nova is promising a lookup. If a turn speaks one
// of these but never calls glove_mesh_send_message, nothing was dispatched —
// flag it (metric + room note) instead of letting the room wait in silence.
const PROMISE_RE =
  /\b(one (moment|sec(ond)?)|moment please|let me (check|see|look|pull|find|get)|i(?:'|’)?ll (check|look|pull|get|find)|checking (on )?that|looking (that|it|into) up|pulling (that|it) up|right away|hold on|give me a (sec|second|moment)|bear with me)\b/i;

const WORKER_DRAIN_PROMPT =
  'You have new delegated request(s) in your inbox. Handle each one with your tools, then reply to the front agent (id "front") via glove_mesh_send_message with in_reply_to set to the message id shown in the inbox line. Do NOT acknowledge — reply only.';

function emptyStats(): AgentStats {
  return { tokensIn: 0, tokensOut: 0, turns: 0 };
}

function stringify(input: unknown): string {
  try {
    return typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function compact(input: unknown, max = 140): string {
  const s = stringify(input).replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Full payload for the expanded backstage view, bounded so SSE frames stay sane. */
function detailOf(input: unknown, max = 4000): string {
  const s = stringify(input);
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more chars)` : s;
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
  // Worker-inbox item ids already handed to the worker (so we don't double-run).
  private dispatched = new Set<string>();
  // Did the front turn in flight call glove_mesh_send_message? Read after the
  // turn to catch "promised out loud but never delegated" protocol slips.
  private frontDelegatedThisTurn = false;
  private relayQueued = false;
  private workerBusy = 0;
  // Per-worker-run effort counters (worker runs are serialized, so one set is safe).
  private workerRunToolCalls = 0;
  private workerRunReplies = 0;
  private currentFrontKind: "response" | "relay" = "response";
  // True between the front agent's compaction_start/compaction_end — its
  // summary generation streams text_delta like any turn and must NEVER reach
  // the speech parser (glove-voice gotcha: the summary is not narrated).
  private frontCompacting = false;
  // The live <speech> parser for the front turn in flight (null between turns).
  private speechParser: SpeechTagParser | null = null;
  // Protocol stats of the most recent front turn (set by runFrontTurn).
  private lastSpeechStats: SpeechParseStats | null = null;
  private uttSeq = 0;
  // Monotonic id for front turns, stamped on delta/say events so the client
  // can void EXACTLY the interrupted turn's remaining tokens on barge-in.
  private frontTurnSeq = 0;
  private buildError: string | null = null;
  // Front model actually in use (per-session override or the env/default one).
  private frontModel: string | undefined;
  // Metric bookkeeping for the front turn in flight.
  private currentUtteranceId: string | null = null;
  private turnStartAt = 0;
  private ttftPending = false;
  readonly ready: Promise<void>;

  constructor(id: string, opts?: { frontModel?: string }) {
    this.id = id;
    this.frontModel = opts?.frontModel || modelFor("front");
    this.ready = this.init(opts?.frontModel);
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
          case "compaction_start": {
            if (role === "front") this.frontCompacting = true;
            break;
          }
          case "compaction_end": {
            if (role === "front") this.frontCompacting = false;
            break;
          }
          case "text_delta": {
            // Nova's raw stream goes through the <speech> parser — only in-tag
            // spans surface as spoken deltas. Compaction-summary deltas are
            // ignored entirely (never spoken); worker text is never surfaced.
            if (role === "front" && !this.frontCompacting) {
              this.speechParser?.push((data as { text: string }).text);
            }
            break;
          }
          case "tool_use": {
            const d = data as { name: string; input: unknown };
            if (d.name === "glove_mesh_send_message") {
              const input = (d.input ?? {}) as { content?: string };
              if (role === "front") {
                this.frontDelegatedThisTurn = true;
                this.emit({ type: "mesh", direction: "delegate", from: "front", to: "worker", content: input.content ?? "" });
                // Kick the worker as soon as the send lands instead of waiting
                // for Nova's whole turn (she still streams her ack and a
                // post-tool round after this). Idempotent — the end-of-turn
                // kick is the backstop if the inbox item hasn't landed yet.
                setTimeout(() => void this.kickWorker(), 200);
              } else if (role === "worker") {
                this.workerRunReplies += 1;
                this.emit({ type: "mesh", direction: "reply", from: "worker", to: "front", content: input.content ?? "" });
              }
            } else if (d.name.startsWith("glove_mesh_")) {
              // other mesh tools — not surfaced
            } else if (role === "worker") {
              this.workerRunToolCalls += 1;
              this.emit({ type: "tool", role, name: d.name, summary: compact(d.input), detail: detailOf(d.input) });
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
  private async init(frontModelOverride?: string): Promise<void> {
    try {
      // In sqlite mode both stores share one DB file, scoped by these ids —
      // mesh inbox traffic and transcripts persist and are inspectable.
      this.front = buildFrontAgent(createAgentStore(`${this.id}_front`), frontModelOverride);
      this.worker = buildWorkerAgent(createAgentStore(`${this.id}_worker`));
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

    // Demarcate this session's run in the metrics file: which models produced
    // everything that follows (evals group and compare on this record).
    this.metric("session_config", undefined, {
      provider: PROVIDER,
      frontModel: this.frontModel ?? "(provider default)",
      workerModel: modelFor("worker") ?? "(provider default)",
      frontReasoning: process.env.FRONT_REASONING ?? "low",
      frontProviderSort: frontProviderSort() ?? "off",
    });
  }

  // ── one front turn, with live <speech> parsing ─────────────────────────────
  /**
   * Run the front agent once. Its raw stream is piped through a fresh
   * SpeechTagParser; in-tag text is emitted live as spoken `delta` events.
   * Returns everything Nova actually said (empty string = she stayed quiet).
   */
  private async runFrontTurn(prompt: string): Promise<string> {
    const turnId = ++this.frontTurnSeq;
    const parser = new SpeechTagParser((text) => {
      if (this.ttftPending) {
        this.ttftPending = false;
        this.metric("front_ttft_ms", Date.now() - this.turnStartAt);
      }
      this.emit({ type: "delta", role: "front", text, turnId });
    });
    this.speechParser = parser;
    this.frontDelegatedThisTurn = false;
    try {
      await this.front.processRequest(prompt);
    } finally {
      this.speechParser = null;
    }
    const speech = parser.finish();
    this.lastSpeechStats = parser.stats;
    // The turn's transcript, into the same JSONL as the timings: what Nova was
    // given, everything she generated (silent notes and all), and what was
    // actually spoken. This is the eval surface — addressing decisions and
    // answer quality get judged off these records, joined to the latency
    // metrics by sessionId/utteranceId.
    this.metric("front_transcript", undefined, {
      kind: this.currentFrontKind,
      input: prompt.slice(0, 1500),
      raw: parser.raw.slice(0, 6000),
      spoken: speech.slice(0, 3000),
      spoke: speech.length > 0,
      delegated: this.frontDelegatedThisTurn,
      model: this.frontModel ?? "(provider default)",
    });
    if (parser.stats.unclosed) {
      // Protocol violation worth trending: the model opened <speech> and never
      // closed it. Tolerated at runtime, but a prompt-tuning signal.
      this.metric("speech_tag_unclosed", undefined, { kind: this.currentFrontKind });
    }
    if (speech) {
      this.emit({ type: "say", role: "front", kind: this.currentFrontKind, text: speech, turnId });
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
    let speech: string;
    try {
      speech = await this.runFrontTurn(frameUtterance(role, text));
    } catch (err) {
      // A failed model call must be VISIBLE — previously it was swallowed by
      // the queue chain and the UI just looked hung mid-"front" phase.
      const msg = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.error("[layered-voice] front turn failed:", err);
      this.metric("front_error", undefined, { message: compact(msg, 300) });
      this.emit({ type: "error", message: `Front turn failed: ${compact(msg, 300)}` });
      this.ttftPending = false;
      this.emit({ type: "phase", phase: "idle" });
      return;
    }
    this.ttftPending = false;
    const st = this.lastSpeechStats;
    this.metric("front_turn_ms", Date.now() - this.turnStartAt, {
      spoke: speech.length > 0,
      speaker: role,
      // Was the worker researching while Nova handled this? (async interleaving)
      workerBusy: this.workerBusy > 0,
      // Did this turn actually dispatch a delegation?
      delegated: this.frontDelegatedThisTurn,
      // <speech> protocol health for this turn
      spokenChars: st?.spokenChars ?? 0,
      discardedChars: st?.discardedChars ?? 0,
      speechBlocks: st?.blocks ?? 0,
      unclosedTag: st?.unclosed ?? false,
    });

    if (!speech) {
      this.emit({
        type: "silent",
        utteranceId: utt.id,
        reason: `${ASSISTANT_NAME} produced no <speech> — she judged this wasn't addressed to her.`,
      });
    } else if (!this.frontDelegatedThisTurn && PROMISE_RE.test(speech)) {
      // Nova spoke like she was kicking off a lookup but never called the mesh
      // send tool — the single most confusing failure (the room hears "one
      // moment please" and then nothing ever happens). Surface it loudly.
      this.metric("promised_without_delegation", undefined, { speech: compact(speech, 200) });
      this.emit({
        type: "note",
        noteKind: "missed-delegation",
        text: `${ASSISTANT_NAME} said she'd check but never called glove_mesh_send_message — nothing was dispatched to the worker`,
      });
    }

    // Fire-and-forget: hand any new delegations to the worker and RETURN.
    // Nova is free for the next utterance while the worker researches.
    await this.kickWorker();
    this.emit({ type: "phase", phase: "idle" });
  }

  // ── audio-channel events: logged into Nova's history as tagged notices ─────
  /**
   * The user barged in: log a <user-interruption> notice carrying the heard
   * prefix (tags synthetically closed) so the model knows how much of its last
   * line actually reached the room. Chained on the front queue so it can never
   * splice into the middle of an in-flight turn's message sequence — and so it
   * lands BEFORE the interrupting utterance's own turn reads history.
   */
  noteInterruption(heardText: string): void {
    const heard = heardText.trim();
    this.queue = this.queue
      .then(async () => {
        if (this.buildError) return;
        await this.front.store.appendMessages?.([{ sender: "user", text: frameInterruption(heard) }]);
        this.metric("user_interruption", undefined, { heardChars: heard.length });
        this.emit({
          type: "note",
          noteKind: "interruption",
          text: heard
            ? `interrupted — the room heard only: “${heard}”`
            : "interrupted before any audio played",
        });
      })
      .catch(() => {});
  }

  /**
   * The STT layer revised an already-dispatched line. Runs a FULL front turn
   * (not just a history note): the correction may change Nova's answer or a
   * delegation, and the notice instructs her to stay silent when nothing
   * meaningful changed — a silent turn is cheap.
   */
  noteTranscriptCorrection(sent: string, actual: string): void {
    this.queue = this.queue
      .then(async () => {
        if (this.buildError) return;
        this.metric("stt_correction", undefined, {
          sentChars: sent.length,
          actualChars: actual.length,
        });
        this.emit({
          type: "note",
          noteKind: "transcript-correction",
          text: `transcript corrected — you actually said: “${compact(actual, 120)}”`,
        });
        this.emit({ type: "phase", phase: "front" });
        this.currentFrontKind = "response";
        this.turnStartAt = Date.now();
        this.ttftPending = true;
        try {
          await this.runFrontTurn(frameTranscriptCorrection(sent, actual));
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          // eslint-disable-next-line no-console
          console.error("[layered-voice] correction turn failed:", err);
          this.emit({ type: "error", message: `Correction turn failed: ${compact(msg, 300)}` });
        }
        this.ttftPending = false;
        // The corrected line may have changed what needs looking up.
        await this.kickWorker();
        this.emit({ type: "phase", phase: "idle" });
      })
      .catch(() => {});
  }

  /** TTS failed: the line was generated but the room never heard it. */
  noteSpeechFailure(detail?: string): void {
    this.queue = this.queue
      .then(async () => {
        if (this.buildError) return;
        await this.front.store.appendMessages?.([{ sender: "user", text: frameSpeechFailure(detail) }]);
        this.metric("speech_failure", undefined, { ...(detail ? { detail } : {}) });
        this.emit({
          type: "note",
          noteKind: "speech-failure",
          text: "speech failed to play — the room didn't hear Nova's last line",
        });
      })
      .catch(() => {});
  }

  // ── async delegation: background worker + queued relay wakeup ──────────────
  /**
   * Scan the WORKER's inbox for delegations not yet handed to it, and schedule
   * ONE background worker run for the batch. Cheap — only dispatches, never
   * waits for the research.
   *
   * Dispatch keys off the worker's own `mesh:from:*` items (every inbound mesh
   * message lands there as a resolved item, whatever the sender's `blocking`
   * flag was). It used to key off the front's `mesh:waiting:*` reminders,
   * which exist ONLY for blocking sends — so any delegation where the model
   * omitted `blocking: true` (the schema default is false) sat in the worker's
   * inbox forever and the worker never ran.
   */
  private async kickWorker(): Promise<void> {
    const items = (await this.worker.store.getInboxItems?.()) ?? [];
    const fresh = items.filter(
      (i) =>
        i.status === "resolved" &&
        i.tag.startsWith("mesh:from:") &&
        !this.dispatched.has(i.id),
    );
    if (fresh.length === 0) return;
    for (const i of fresh) this.dispatched.add(i.id);

    const dispatchedAt = Date.now();
    this.metric("delegation_dispatched", undefined, { count: fresh.length });
    this.workerQueue = this.workerQueue
      .then(async () => {
        // Worker runs serialize — a batch can sit behind an earlier run.
        this.metric("worker_queue_wait_ms", Date.now() - dispatchedAt);
        this.setWorkerBusy(1);
        this.workerRunToolCalls = 0;
        this.workerRunReplies = 0;
        const wt0 = Date.now();
        let failed = false;
        try {
          await this.worker.processRequest(WORKER_DRAIN_PROMPT);
        } catch (err) {
          failed = true;
          this.emit({ type: "error", message: `Worker run failed: ${(err as Error)?.message ?? String(err)}` });
        }
        this.metric("worker_ms", Date.now() - wt0, {
          delegations: fresh.length,
          toolCalls: this.workerRunToolCalls,
          replies: this.workerRunReplies,
          failed,
        });
        this.setWorkerBusy(-1);
        if (this.workerRunReplies === 0) {
          // §8: silence is indistinguishable from a hang — the front would be
          // left waiting on its mesh:waiting reminder forever. Surface it as a
          // <worker-trouble> notice instead so Nova can level with the asker.
          this.metric("worker_no_reply", undefined, { delegations: fresh.length, failed });
          this.queueTrouble(
            failed
              ? "the worker run errored out before answering"
              : "the worker finished without sending back any result",
          );
        } else {
          // The reply already landed in Nova's inbox (mesh handler). Wake her.
          this.queueRelay(dispatchedAt);
        }
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
        if (meshResolved.length === 0) {
          // §5 "user turn wins": a user utterance consumed the results first,
          // so Nova already wove them into that answer — no relay needed.
          this.metric("relay_skipped", undefined, { reason: "user_turn_won" });
          return;
        }

        this.emit({ type: "phase", phase: "relay" });
        this.currentFrontKind = "relay";
        const rt0 = Date.now();
        this.turnStartAt = rt0;
        this.ttftPending = true;
        let speech: string;
        try {
          speech = await this.runFrontTurn(frameWorkerResult());
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          // eslint-disable-next-line no-console
          console.error("[layered-voice] relay turn failed:", err);
          this.metric("front_error", undefined, { message: compact(msg, 300), relay: true });
          this.emit({ type: "error", message: `Relay turn failed: ${compact(msg, 300)}` });
          this.ttftPending = false;
          this.currentFrontKind = "response";
          this.emit({ type: "phase", phase: "idle" });
          return;
        }
        this.ttftPending = false;
        this.metric("relay_ms", Date.now() - rt0, {
          spoke: speech.length > 0,
          // >2 resolved items in one relay = coalescing in action (each
          // delegation resolves as a waiting item + a reply item).
          items: meshResolved.length,
          unclosedTag: this.lastSpeechStats?.unclosed ?? false,
        });
        this.metric("delegation_roundtrip_ms", Date.now() - dispatchedAt);
        this.currentFrontKind = "response";
        this.emit({ type: "phase", phase: "idle" });

        // The relay itself may have delegated a follow-up.
        await this.kickWorker();
      })
      .catch(() => {});
  }

  /**
   * §8 failure wakeup: the delegation produced no reply. Clear the stale
   * mesh:waiting reminders (the notice supersedes them — otherwise Nova
   * carries "still waiting" forever) and run a spoken turn framed as
   * <worker-trouble> so she levels with the asker.
   */
  private queueTrouble(reason: string): void {
    this.queue = this.queue
      .then(async () => {
        // Clear whatever mesh:waiting reminders the front is still carrying —
        // only blocking sends create them, so there may be none at all.
        const stale = ((await this.front.store.getInboxItems?.()) ?? []).filter(
          (i) => i.status === "pending" && i.tag.startsWith("mesh:waiting:"),
        );
        for (const it of stale) {
          await this.front.store.updateInboxItem?.(it.id, {
            status: "consumed",
            response: `No result: ${reason}.`,
            resolved_at: new Date().toISOString(),
          });
        }

        this.emit({ type: "phase", phase: "relay" });
        this.currentFrontKind = "relay";
        const rt0 = Date.now();
        this.turnStartAt = rt0;
        this.ttftPending = true;
        let speech: string;
        try {
          speech = await this.runFrontTurn(frameWorkerTrouble(reason));
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          // eslint-disable-next-line no-console
          console.error("[layered-voice] trouble turn failed:", err);
          this.emit({ type: "error", message: `Trouble-notice turn failed: ${compact(msg, 300)}` });
          this.ttftPending = false;
          this.currentFrontKind = "response";
          this.emit({ type: "phase", phase: "idle" });
          return;
        }
        this.ttftPending = false;
        this.metric("relay_ms", Date.now() - rt0, {
          spoke: speech.length > 0,
          trouble: true,
          items: stale.length,
        });
        this.currentFrontKind = "response";
        this.emit({ type: "phase", phase: "idle" });
      })
      .catch(() => {});
  }
}

// ── Registry singleton (survives Next.js HMR via globalThis) ─────────────────
const g = globalThis as unknown as { __layeredVoiceSessions?: Map<string, Session> };
const REGISTRY: Map<string, Session> = g.__layeredVoiceSessions ?? (g.__layeredVoiceSessions = new Map());

export function createSession(opts?: { frontModel?: string }): Session {
  const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const session = new Session(id, opts);
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
