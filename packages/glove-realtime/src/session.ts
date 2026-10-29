// ─────────────────────────────────────────────────────────────────────────────
// RealtimeSession — a built Glove, running on a realtime provider.
//
// The adapter owns the provider's half of the agent (see types.ts). This
// class owns Glove's half, and its job is translation: every primitive an
// agent was authored with keeps meaning the same thing on a live session.
//
//   Glove primitive              on a realtime session
//   ───────────────              ─────────────────────
//   tools (fold, replaceTools)   registered with the provider; re-registered
//                                when the set changes mid-call; executed
//                                through glove-core's Executor — validation,
//                                retries, summaries, subagent brackets
//   requiresPermission           enforced: the store's decision, then a
//                                policy (display stack, allow, deny, yours)
//   store                        user/agent turns, tool call/result pairs and
//                                compaction summaries are written as ordinary
//                                Messages, so the next text turn knows what
//                                was said on the call — and a fresh session
//                                is seeded from what the store holds
//   runtime context providers    "iteration" and "request" deliveries
//                                injected as one superseding snapshot ("request"
//                                read only at open and each user turn);
//                                "history" saved to the store when it changes
//                                and injected once, as a text turn saves it
//   events (emitEvent)           the call holds the agent's turn queue, so
//                                events join the call instead of waking the
//                                text model: silently at the next turn or tool
//                                result, spoken about at the next pause
//   inbox                        resolved items injected and consumed, pending
//                                blocking items in the context snapshot
//   subscribers                  receive the same SubscriberEvents a text
//                                turn emits (text_delta, tool_use,
//                                tool_use_result, token_consumption,
//                                compaction_*, skill/subagent events)
//   compaction                   Glove decides WHEN (context tokens vs a
//                                limit); the adapter decides HOW
//
// …and the session's own lifecycle: connect, reconnect with backoff, resume
// with the provider's handle (or re-seed from the store when there is none),
// move to a fresh connection before the provider's goAway lands, and end.
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from "eventemitter3";
import {
  AbortError,
  Context,
  Executor,
  type IGloveRunnable,
  type Message,
  type ModelAdapter,
  type NotifySubscribersFunction,
  type SubscriberAdapter,
  type SubscriberEvent,
  type Tool,
  type ToolCall,
  type ToolResult,
  type ToolResultData,
  type TurnHold,
} from "glove-core";
import { createRealtimeAdapter, isRealtimeModel } from "./create-adapter";
import {
  pendingBlockingText,
  renderTranscript,
  resolvedInboxText,
  runtimeImages,
  runtimeText,
  toHistory,
  toToolSpec,
  toWireResult,
  type HistoryOptions,
} from "./translate";
import type {
  RealtimeAdapter,
  RealtimeAudioFormat,
  RealtimeEvent,
  RealtimeHistoryItem,
  RealtimeInjection,
  RealtimeMedia,
  RealtimeOutputModality,
  RealtimeSessionSpec,
  RealtimeToolSpec,
  RealtimeUsage,
} from "./types";
import { asError } from "./wire";

export type RealtimeSessionState = "idle" | "connecting" | "open" | "reconnecting" | "closing" | "closed";

export interface PermissionRequest {
  tool: string;
  input: unknown;
  /** Aborts when the call is cancelled or the session stops: withdraw the question. */
  signal: AbortSignal;
}

/**
 * Who answers a `requiresPermission` gate the store hasn't decided.
 *
 * - `display` — the agent's display stack (`permission_request` renderer),
 *   exactly as a text turn asks. Right when a screen accompanies the call.
 * - `deny` / `allow` — fixed; not written back to the store.
 * - a function — your own ruling (a verbal confirmation flow, a policy
 *   engine). Its answer is written to the store like a display answer.
 */
export type PermissionPolicy = "display" | "deny" | "allow" | ((request: PermissionRequest) => boolean | Promise<boolean>);

export interface RealtimeCompactionConfig {
  /**
   * Compact when the provider reports a context this large, in tokens.
   * Unset: never compact from Glove — the provider's native window
   * management (where it has one) is all there is.
   */
  contextLimit?: number;
  /** What the summary should keep. */
  instructions?: string;
  /**
   * A TEXT model to write the summary when the adapter can't summarise
   * itself. Without one, the summary is the recent transcript.
   */
  model?: ModelAdapter;
  /** Recent turns kept verbatim after the summary. Default 6. */
  keepRecent?: number;
}

export interface RealtimeSessionConfig {
  /** A built Glove: its prompt, tools, store and context providers drive the session. */
  agent: IGloveRunnable;
  /** The provider session. Default: built from `realtimeModel(...)` on the agent's model slot. */
  adapter?: RealtimeAdapter;
  /** Instructions for the realtime model. Default: the agent's system prompt. */
  instructions?: string;
  /** Response modality. Default audio when the provider can produce it. */
  output?: RealtimeOutputModality;
  voice?: string;
  /** Tools withheld from the provider. Calls to them are refused. */
  excludeTools?: string[];
  /** Tools that run while the conversation continues, where the provider allows it. */
  nonBlockingTools?: string[];
  /** Default: `deny` for a serverMode agent (nobody to ask), else `display`. */
  permissions?: PermissionPolicy;
  /**
   * Retries per failed tool call. Default 0: on a call, a retry is dead air,
   * and the model can decide to try again itself.
   */
  maxToolRetries?: number;
  /** Write turns, tool activity and summaries to the agent's store. Default true. */
  persist?: boolean;
  /** Seed fresh provider sessions with stored history. Default 30 items / 12k chars. */
  history?: HistoryOptions | false;
  compaction?: RealtimeCompactionConfig | false;
  /** Recover from dropped provider sessions. Default 3 attempts, 500 ms backoff, doubling. */
  reconnect?: { attempts?: number; backoffMs?: number; maxBackoffMs?: number } | false;
  /** End the session after this long. */
  maxDurationMs?: number;
  /**
   * Runs before the session opens and at the start of every user turn, after
   * the agent's own turn preparers (`addTurnPreparer`, which glove-memory's
   * goals and forms register themselves). For per-turn work that isn't
   * registered on the agent. Prompt or tool changes either makes are sent to
   * the provider. An error fails `start()`; mid-call it is reported and the
   * turn goes ahead.
   */
  beforeTurn?: () => void | Promise<void>;
  /**
   * Hold the agent's turn queue for the call (`holdTurns`). Events emitted on
   * the agent (`emitEvent`: delegation updates, webhooks, other agents) then
   * join the call instead of waking the text model, and text requests on the
   * same agent wait until the call ends. Default true. False leaves events to
   * the agent's event policy.
   */
  events?: boolean;
  /** Resume a provider session from a stored handle. */
  resumeHandle?: string;
}

export interface ToolActivity {
  callId: string;
  name: string;
  input: unknown;
}

export type RealtimeSessionEvents = {
  state: [state: RealtimeSessionState, previous: RealtimeSessionState];
  /** Every standardized adapter event, unfiltered. */
  event: [event: RealtimeEvent];
  user_delta: [text: string];
  user_said: [text: string];
  agent_delta: [text: string];
  agent_said: [text: string];
  /** Agent audio for the host to play, in `format`. */
  audio: [pcm: Int16Array, format: RealtimeAudioFormat];
  /** Flush queued playback. */
  interrupted: [];
  user_speech_started: [];
  user_speech_stopped: [];
  agent_speech_started: [];
  agent_speech_stopped: [];
  tool_started: [call: ToolActivity];
  tool_finished: [call: ToolActivity, result: ToolResultData, durationMs: number];
  context_refreshed: [text: string];
  compacted: [summary: string, outcome: string];
  resumable: [handle: string];
  usage: [usage: RealtimeUsage];
  ended: [reason: string];
  error: [error: Error];
};

const DEFAULT_COMPACTION_INSTRUCTIONS =
  "Summarize this conversation for your own future reference. Keep who the user is, what they asked for, " +
  "decisions made, tool results that still matter, promises made, and anything left open. Be concise and factual.";

const RUNTIME_KEY = "glove.runtime_context";

/** Turns kept in memory, for sessions that don't persist. */
const MAX_LOG = 400;

/** Subscriber events that come from the Glove itself rather than a model turn. */
const EXTENSION_EVENTS = new Set<SubscriberEvent["type"]>([
  "runtime_context", "hook_invoked", "skill_invoked", "subagent_invoked", "subagent_completed",
]);

interface PendingCall {
  controller: AbortController;
  epoch: number;
  cancelled: boolean;
}

export class RealtimeSession extends EventEmitter<RealtimeSessionEvents> {
  readonly agent: IGloveRunnable;
  readonly adapter: RealtimeAdapter;

  private readonly cfg: RealtimeSessionConfig;
  private readonly excluded: Set<string>;
  private readonly nonBlocking: Set<string>;
  private readonly subscribers: SubscriberAdapter[] = [];
  private _state: RealtimeSessionState = "idle";
  private unsubscribe: (() => void) | null = null;
  private handle: string | undefined;
  /** Identity of the provider conversation. Bumps whenever a FRESH provider
   *  session replaces it; work begun under an older epoch must not answer
   *  into the new one. */
  private epoch = 0;
  private pending = new Map<string, PendingCall>();
  private writes: Promise<void> = Promise.resolve();
  private lastContext: string | undefined;
  private contextRefresh: Promise<void> | null = null;
  private sentImages = new Set<string>();
  private toolSignature = "";
  private instructions = "";
  private contextTokens = 0;
  private compacting: Promise<boolean> | null = null;
  private compactWhenIdle = false;
  private reconnecting: Promise<void> | null = null;
  private durationTimer: ReturnType<typeof setTimeout> | undefined;
  private subagentDepth = 0;
  /** This session's turns, for compaction when nothing is persisted. */
  private log: RealtimeHistoryItem[] = [];
  /** Continuous providers: fragments since the last role switch. */
  private fragment: { role: "user" | "assistant"; text: string } | null = null;
  /**
   * Reasons store writes are being held back, and what they're holding.
   * `transcript`: the user stopped speaking and the transcription of what
   * they said comes asynchronously, often after the reply has started; the
   * reply must not land in the store ahead of the question. `compaction`:
   * the summary must be written before anything said while it was being
   * made, or the split at the summary would hide those turns.
   */
  private holds = new Set<"transcript" | "compaction">();
  private held: Message[][] = [];
  private transcriptTimer: ReturnType<typeof setTimeout> | undefined;
  /** Tool results and injections waiting for a provider session to come back. */
  private deferred: Array<{ epoch: number; send: () => void }> = [];
  /** The agent's turn queue, held for the call. */
  private hold: TurnHold | null = null;
  private holdRequest: AbortController | null = null;
  /** Events queued on the agent that haven't reached the call yet. */
  private eventsWaiting = false;
  private eventDelivery: Promise<void> | null = null;
  /** "request"-delivered context, read at open and at each user turn. */
  private requestContext = "";
  /** "history"-delivered context last told to the call, by key. A save can
   *  still be held back (a late transcript) when the next turn compares. */
  private historySent = new Map<string, string>();
  /** Who is talking, to deliver events at a pause. */
  private userSpeaking = false;
  private agentBusy = false;
  /** A response was asked for and hasn't started yet. */
  private expectingResponse = false;
  private expectTimer: ReturnType<typeof setTimeout> | undefined;

  /** Forwards the Glove's own subscriber events (skills, subagent runs) into this session's subscribers. */
  private readonly gloveBridge: SubscriberAdapter = {
    record: async (type, data) => {
      // Model-turn events from the Glove belong to a subagent run started by
      // one of our tool calls (the dispatcher fans the parent's subscribers
      // out to the child). Outside one, they are a concurrent TEXT turn on
      // the same agent and not this session's business.
      // Events this session forwarded to the agent come back through here:
      // they already reached the session's own subscribers.
      if (this.forwarded.has(data as object)) return;
      if (EXTENSION_EVENTS.has(type) || this.subagentDepth > 0) await this.notifySession(type, data);
    },
  };
  private readonly forwarded = new WeakSet<object>();

  /** Our Executors report here: subagent brackets are tracked, everything is forwarded. */
  private readonly executorBridge: SubscriberAdapter = {
    record: async (type, data) => {
      if (type === "subagent_invoked") this.subagentDepth++;
      if (type === "subagent_completed") this.subagentDepth = Math.max(0, this.subagentDepth - 1);
      await this.notify(type, data);
    },
  };

  constructor(config: RealtimeSessionConfig) {
    super();
    this.cfg = config;
    this.agent = config.agent;
    if (config.adapter) {
      this.adapter = config.adapter;
    } else if (isRealtimeModel(config.agent.model)) {
      this.adapter = createRealtimeAdapter(config.agent.model.realtime);
    } else {
      throw new Error(
        "RealtimeSession needs a provider: pass `adapter`, or build the agent with model: realtimeModel({ provider, ... }).",
      );
    }
    this.excluded = new Set(config.excludeTools ?? []);
    this.nonBlocking = new Set(config.nonBlockingTools ?? []);
    this.handle = config.resumeHandle;
    const output = config.output ?? "audio";
    if (!this.adapter.capabilities.output.includes(output)) {
      throw new Error(`${this.adapter.provider} can't produce ${output} output (it produces ${this.adapter.capabilities.output.join(", ")}).`);
    }
  }

  get state(): RealtimeSessionState {
    return this._state;
  }

  /** The latest provider resumption handle. Persist it to resume after a restart. */
  get resumeHandle(): string | undefined {
    return this.handle;
  }

  /** The Glove tools this session exposes, in registration order. */
  get tools(): ReadonlyArray<Tool<unknown>> {
    return this.agent.tools.filter((tool) => !this.excluded.has(tool.name));
  }

  /** The tools as the provider sees them. */
  get exposedTools(): RealtimeToolSpec[] {
    const nonBlocking = this.adapter.capabilities.tools.nonBlocking;
    return this.tools.map((tool) => toToolSpec(tool, nonBlocking && this.nonBlocking.has(tool.name)));
  }

  addSubscriber(subscriber: SubscriberAdapter): this {
    this.subscribers.push(subscriber);
    return this;
  }

  removeSubscriber(subscriber: SubscriberAdapter): void {
    const index = this.subscribers.indexOf(subscriber);
    if (index !== -1) this.subscribers.splice(index, 1);
  }

  /**
   * Everything the call produces goes to the session's subscribers and to the
   * agent's own (`addSubscriber` on the Glove), so modules and UIs listening
   * on the agent see a call as they see a text turn.
   */
  private notify: NotifySubscribersFunction = async (type, data) => {
    const agentSide = typeof this.agent.notifySubscribers === "function"
      ? (this.forwarded.add(data as object), this.agent.notifySubscribers(type, data).catch((error) => { this.emit("error", asError(error)); }))
      : undefined;
    await Promise.all([this.notifySession(type, data), agentSide]);
  };

  private notifySession: NotifySubscribersFunction = async (type, data) => {
    await Promise.all(this.subscribers.map(async (subscriber) => {
      try {
        await subscriber.record(type, data);
      } catch (error) {
        this.emit("error", asError(error));
      }
    }));
  };

  /** `_state` read without narrowing: it changes across every await. */
  private stateNow(): RealtimeSessionState {
    return this._state;
  }

  private setState(next: RealtimeSessionState): void {
    if (next === this._state) return;
    const previous = this._state;
    this._state = next;
    this.emit("state", next, previous);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async start(options: { resumeHandle?: string } = {}): Promise<void> {
    if (this._state !== "idle" && this._state !== "closed") return;
    if (options.resumeHandle) this.handle = options.resumeHandle;
    this.setState("connecting");
    this.unsubscribe = this.adapter.subscribe((event) => this.onEvent(event));
    this.agent.addSubscriber(this.gloveBridge);
    try {
      this.acquireHold();
      await this.prepareTurn();
      await this.adapter.open(await this.buildSpec(true));
    } catch (error) {
      // stop() ran while this was starting and cleans up itself.
      if (this.stateNow() === "closing" || this.stateNow() === "closed") throw error;
      this.teardown();
      this.setState("closed");
      throw error;
    }
    if (this.stateNow() !== "open" && this.stateNow() !== "connecting") {
      // stop() won the race against an adapter that couldn't cancel its
      // open: don't leave a provider session running that nobody hears.
      await this.adapter.close().catch(() => {});
      return;
    }
    if (this.cfg.maxDurationMs) {
      this.durationTimer = setTimeout(() => void this.stop("time limit"), this.cfg.maxDurationMs);
    }
  }

  async stop(reason = "stopped"): Promise<void> {
    if (this._state === "idle" || this._state === "closed" || this._state === "closing") return;
    this.setState("closing");
    for (const call of this.pending.values()) call.controller.abort();
    try {
      await this.adapter.close();
    } catch (error) {
      this.emit("error", asError(error));
    } finally {
      // Continuous providers keep transcribing until the close completes.
      this.flushFragment();
      this.releaseHold("transcript");
      this.releaseHold("compaction");
      await this.writes;
      // The agent's turn queue is free by the time stop() resolves.
      await this.hold?.release();
      this.teardown();
      this.setState("closed");
      this.emit("ended", reason);
    }
  }

  private teardown(): void {
    clearTimeout(this.durationTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.agent.removeSubscriber(this.gloveBridge);
    for (const call of this.pending.values()) call.controller.abort();
    this.pending.clear();
    this.lastContext = undefined;
    this.sentImages.clear();
    this.subagentDepth = 0;
    this.fragment = null;
    this.holds.clear();
    this.held = [];
    clearTimeout(this.transcriptTimer);
    this.deferred = [];
    this.holdRequest?.abort();
    this.holdRequest = null;
    void this.hold?.release();
    this.hold = null;
    this.eventsWaiting = false;
    this.requestContext = "";
    this.historySent.clear();
    this.userSpeaking = false;
    this.agentBusy = false;
    this.expectingResponse = false;
    clearTimeout(this.expectTimer);
    ++this.epoch;
  }

  /** The spec for a new provider session: current prompt and tools, plus
   *  either a resumption handle or seed history from the store. */
  private async buildSpec(allowResume: boolean): Promise<RealtimeSessionSpec> {
    this.instructions = this.cfg.instructions ?? this.agent.getSystemPrompt();
    const tools = this.exposedTools;
    this.toolSignature = signature(tools);
    const caps = this.adapter.capabilities;
    const resumeHandle = allowResume && caps.resumption ? this.handle : undefined;
    const spec: RealtimeSessionSpec = {
      instructions: this.instructions,
      tools,
      output: this.cfg.output ?? "audio",
      ...(this.cfg.voice ? { voice: this.cfg.voice } : {}),
      ...(resumeHandle ? { resumeHandle } : {}),
    };
    if (!resumeHandle && this.cfg.history !== false && caps.context.historySeed) {
      const history = await this.storedHistory(this.cfg.history || undefined);
      if (history.length) spec.history = history;
    }
    return spec;
  }

  private async storedHistory(options?: HistoryOptions): Promise<RealtimeHistoryItem[]> {
    if (this.cfg.persist === false) return this.log.slice(-(options?.maxItems ?? 30));
    // Context applies the same compaction split a text turn sees.
    const messages = await new Context(this.agent.store).getMessages();
    return toHistory(messages, options);
  }

  /** A dropped provider session: reopen, resuming where we can, re-seeding where we can't. */
  private recover(reason?: string): void {
    if (this._state !== "open" || this.reconnecting) return;
    const policy = this.cfg.reconnect;
    if (policy === false) {
      void this.stop(reason ?? "provider closed the session");
      return;
    }
    this.setState("reconnecting");
    this.flushFragment();
    const attempts = policy?.attempts ?? 3;
    const run = (async () => {
      let delay = policy?.backoffMs ?? 500;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (this._state !== "reconnecting") return;
        try {
          // A stale handle shouldn't burn every attempt: resume first, then seed.
          await this.adapter.open(await this.buildSpec(attempt === 1));
          // stop() may have run while this was opening: don't leave a
          // provider session running that nobody is listening to.
          if ((this._state as RealtimeSessionState) !== "open") await this.adapter.close().catch(() => {});
          return;
        } catch (error) {
          this.emit("error", asError(error));
          if (attempt === attempts) break;
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, policy?.maxBackoffMs ?? 8_000);
        }
      }
      if (this._state !== "reconnecting") return;
      await this.writes;
      this.teardown();
      this.setState("closed");
      this.emit("ended", reason ?? "provider closed the session");
    })().finally(() => {
      this.reconnecting = null;
    });
    this.reconnecting = run;
  }

  /** Move to a fresh connection before the provider ends this one. */
  private async moveBeforeGoAway(): Promise<void> {
    if (this._state !== "open" || !this.handle || this.reconnecting) return;
    this.setState("reconnecting");
    const run = (async () => {
      try {
        await this.adapter.close();
        await this.adapter.open(await this.buildSpec(true));
        if (this._state !== "open") await this.adapter.close().catch(() => {});
      } catch (error) {
        this.emit("error", asError(error));
        this._state = "open"; // let recover() take it from here
        this.reconnecting = null;
        this.recover("resumption failed");
      }
    })().finally(() => {
      if (this.reconnecting === run) this.reconnecting = null;
    });
    this.reconnecting = run;
  }

  // ── inbound events ────────────────────────────────────────────────────────

  private onEvent(event: RealtimeEvent): void {
    this.emit("event", event);
    switch (event.type) {
      case "session.opened":
        if (!event.resumed) {
          // A fresh provider conversation: results for calls the old one
          // made have nowhere to go, any earlier context snapshot is gone,
          // and an older handle would resume the conversation this replaced
          // (a compacted one, say). The new session issues its own.
          ++this.epoch;
          this.lastContext = undefined;
          this.sentImages.clear();
          this.deferred = [];
          this.handle = undefined;
        }
        if (this._state === "connecting" || this._state === "reconnecting") this.setState("open");
        if (event.resumed) this.flushDeferred();
        // A resumed conversation still holds its last snapshot: only a change
        // is worth sending. Events that waited for the user's next message
        // (deferred while the agent was idle) go in silently.
        void this.contextTurn(!event.resumed, "request")
          .then(() => this.flushEventsWhenQuiet())
          .catch((error) => this.emit("error", asError(error)));
        break;
      case "session.closed":
        if (!event.expected) this.recover(event.reason);
        break;
      case "session.going_away":
        void this.moveBeforeGoAway();
        break;
      case "session.resumable":
        this.handle = event.handle;
        this.emit("resumable", event.handle);
        break;

      case "input.speech_started":
        this.userSpeaking = true;
        this.agent.notifyUserActivity?.();
        this.emit("user_speech_started");
        // The start of a user turn is the last moment new state can land
        // before the model answers it.
        void this.startTurn();
        break;
      case "input.speech_stopped":
        this.userSpeaking = false;
        // Server-side turn detection answers what was just said.
        this.expectResponse();
        this.emit("user_speech_stopped");
        if (this.adapter.capabilities.transcripts === "turns") {
          this.holds.add("transcript");
          clearTimeout(this.transcriptTimer);
          // Transcription can be off or fail; don't hold the store hostage.
          this.transcriptTimer = setTimeout(() => this.releaseHold("transcript"), 4_000);
        }
        break;
      case "input.transcript":
        if (!event.final) this.emit("user_delta", event.text);
        else if (event.text.trim()) this.userSaid(event.text.trim());
        break;

      case "output.audio":
        this.emit("audio", event.pcm, event.format);
        break;
      case "output.speech_started":
        this.responseStarted();
        this.emit("agent_speech_started");
        break;
      case "output.speech_stopped":
        this.agentBusy = false;
        this.emit("agent_speech_stopped");
        this.flushEventsWhenQuiet();
        break;
      case "response.started":
        this.responseStarted();
        break;
      case "response.done":
        this.agentBusy = false;
        this.flushEventsWhenQuiet();
        break;
      case "output.transcript":
      case "output.text":
        if (!event.final) {
          this.emit("agent_delta", event.text);
          void this.notify("text_delta", { text: event.text });
        } else if (event.text.trim()) {
          this.agentSaid(event.text.trim());
        }
        break;
      case "transcript.fragment":
        this.onFragment(event.role, event.text);
        break;

      case "tool.call":
        this.flushFragment();
        void this.runTool(event.callId, event.name, event.arguments);
        break;
      case "tool.cancelled":
        for (const id of event.callIds) {
          const call = this.pending.get(id);
          if (!call) continue;
          call.cancelled = true;
          call.controller.abort();
        }
        break;

      case "interrupted":
        this.emit("interrupted");
        break;
      case "usage":
        void this.onUsage(event.usage);
        break;
      case "error":
        this.emit("error", event.error);
        break;
    }
  }

  private remember(item: RealtimeHistoryItem): void {
    this.log.push(item);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private userSaid(text: string): void {
    this.remember({ role: "user", text });
    if (this.cfg.persist !== false && this.holds.has("transcript")) {
      // The question goes ahead of the reply that was held for it.
      this.held.unshift([{ sender: "user", text }]);
      this.releaseHold("transcript");
    } else {
      this.persist([{ sender: "user", text }]);
    }
    this.emit("user_said", text);
  }

  private agentSaid(text: string): void {
    this.remember({ role: "assistant", text });
    this.persist([{ sender: "agent", text }]);
    this.emit("agent_said", text);
    void this.notify("model_response_complete", { text, stop_reason: "end_turn" });
  }

  /**
   * Continuous providers never mark a turn final. For the store, a change of
   * speaker (or a tool call, or the end) is taken as the boundary; live
   * captions get every fragment as it arrives.
   */
  private onFragment(role: "user" | "assistant", text: string): void {
    // Captions (`text_delta`) come from the adapter's `output.transcript`
    // deltas; fragments only decide what the store records as a turn.
    if (this.fragment && this.fragment.role !== role) this.flushFragment();
    this.fragment = { role, text: (this.fragment?.text ?? "") + text };
  }

  private flushFragment(): void {
    const fragment = this.fragment;
    this.fragment = null;
    const text = fragment?.text.trim();
    if (!fragment || !text) return;
    if (fragment.role === "user") this.userSaid(text);
    else this.agentSaid(text);
  }

  private persist(messages: Message[]): void {
    if (this.cfg.persist === false) return;
    if (this.holds.size) this.held.push(messages);
    else this.write(messages);
  }

  private releaseHold(reason: "transcript" | "compaction"): void {
    if (reason === "transcript") clearTimeout(this.transcriptTimer);
    if (!this.holds.delete(reason) || this.holds.size) return;
    for (const messages of this.held.splice(0)) this.write(messages);
  }

  private write(messages: Message[]): void {
    this.writes = this.writes
      .then(() => this.agent.store.appendMessages(messages))
      .catch((error) => { this.emit("error", asError(error)); });
  }

  private async onUsage(usage: RealtimeUsage): Promise<void> {
    this.emit("usage", usage);
    if (usage.contextTokens !== undefined) this.contextTokens = usage.contextTokens;
    if (usage.tokensIn || usage.tokensOut) {
      const consumption = {
        tokens_in: usage.tokensIn,
        tokens_out: usage.tokensOut,
        ...(usage.cachedTokensIn !== undefined ? { cache_read_input_tokens: usage.cachedTokensIn } : {}),
      };
      try {
        if (this.cfg.persist !== false) await this.agent.store.addTokens(consumption);
      } catch (error) {
        this.emit("error", asError(error));
      }
      await this.notify("token_consumption", { consumption });
    }
    const limit = this.cfg.compaction ? this.cfg.compaction.contextLimit : undefined;
    if (limit && this.contextTokens >= limit) {
      if (this.pending.size) this.compactWhenIdle = true;
      else void this.compact().catch((error) => this.emit("error", asError(error)));
    }
  }

  // ── tools ─────────────────────────────────────────────────────────────────

  /**
   * Run one call through glove-core's Executor.
   *
   * Every branch answers the provider — an unknown tool, bad JSON, a denied
   * permission, a throw. In a text turn a lost result is a retry; on a call
   * the provider waits for it and the caller listens to silence.
   */
  private async runTool(callId: string, name: string, rawArgs: string): Promise<void> {
    if (this._state !== "open" && this._state !== "reconnecting") return;
    const epoch = this.epoch;
    const controller = new AbortController();
    const pending: PendingCall = { controller, epoch, cancelled: false };
    this.pending.set(callId, pending);
    const startedAt = Date.now();
    let input: unknown = {};
    let result: ToolResult;

    let badJson = false;
    try {
      input = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      input = rawArgs;
      badJson = true;
    }
    void this.notify("tool_use", { id: callId, name, input });
    this.emit("tool_started", { callId, name, input });

    try {
      if (badJson) throw new ToolRefusal("Arguments were not valid JSON.");
      const tools = this.tools as Tool<unknown>[];
      const tool = tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (tool && await gated(tool, input) && !(await this.permit(tool, input, controller.signal))) {
        throw new ToolRefusal(`Permission denied for tool "${tool.name}". The user has not granted permission to run this tool.`);
      }

      // A fresh Executor per call: calls run concurrently on a live session,
      // and the Executor's stack is per batch. No store: the gate above
      // already ran with this session's policy.
      const executor = new Executor(this.cfg.maxToolRetries ?? 0);
      executor.tools = tools;
      executor.addSubscriber(this.executorBridge);
      executor.addToolCallToStack({ tool_name: name, input_args: input, id: callId });
      const handOver = (request: unknown) => {
        const renderer = typeof (request as { renderer?: unknown })?.renderer === "string"
          ? (request as { renderer: string }).renderer
          : "generic";
        return this.agent.displayManager.pushAndWait({ renderer, input: request });
      };
      const [first] = await executor.executeToolStack(handOver, controller.signal);
      result = first ?? { tool_name: name, call_id: callId, result: { status: "error", data: null, message: "The tool produced no result." } };
    } catch (error) {
      const message = error instanceof ToolRefusal ? error.message : `Tool failed: ${asError(error).message}`;
      result = { tool_name: name, call_id: callId, result: { status: "error", data: null, message }, duration_ms: Date.now() - startedAt };
      // The Executor reports its own results; refusals made here are reported here.
      void this.notify("tool_use_result", { ...result, id: callId, name });
    }

    this.pending.delete(callId);
    const durationMs = result.duration_ms ?? Date.now() - startedAt;
    this.emit("tool_finished", { callId, name, input }, result.result, durationMs);

    // The call and its result enter the store together, so a later text turn
    // never sees a call without its result.
    const toolCall: ToolCall = { tool_name: name, input_args: input, id: callId };
    this.persist([
      { sender: "agent", text: "", tool_calls: [toolCall] },
      { sender: "user", text: "tool results", tool_results: [result] },
    ]);

    const live = () => !pending.cancelled && epoch === this.epoch && (this._state === "open" || this._state === "reconnecting");
    if (live()) {
      // A tool may have folded new tools or changed state: register the new
      // surface (waiting out a provider that reconnects to apply it) and
      // refresh context BEFORE the result triggers the next turn. A failure
      // here must not relabel a tool that already succeeded.
      await this.syncSession();
      try { await this.refreshContext(); } catch (error) { this.emit("error", asError(error)); }
      // Events that arrived during the call join here, as they join a text
      // turn at its tool-step boundary; the result's response covers them.
      try { await this.deliverEvents("loop", false); } catch (error) { this.emit("error", asError(error)); }
      if (live()) {
        this.expectResponse();
        this.deliver(epoch, () => this.adapter.sendToolResult({ callId, name, output: toWireResult(result.result) }));
      }
    }

    if (this.compactWhenIdle && this.pending.size === 0) {
      this.compactWhenIdle = false;
      void this.compact().catch((error) => this.emit("error", asError(error)));
    }
  }

  private async permit(tool: Tool<unknown>, input: unknown, signal: AbortSignal): Promise<boolean> {
    const store = this.agent.store;
    if (store.getPermission) {
      const status = await store.getPermission(tool.name, input);
      if (status === "granted") return true;
      if (status === "denied") return false;
    }
    const policy = this.cfg.permissions ?? (this.agent.serverMode ? "deny" : "display");
    if (policy === "allow") return true;
    if (policy === "deny") return false;

    // A cancelled call or a stopped session withdraws the question rather
    // than leaving it on screen with nobody waiting for the answer.
    const aborted = new Promise<never>((_, reject) => {
      const abort = () => reject(new AbortError("The permission request was withdrawn."));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    aborted.catch(() => {});
    let answer: Promise<unknown>;
    let withdraw = () => {};
    if (policy === "display") {
      const display = this.agent.displayManager;
      const request = { renderer: "permission_request", toolName: tool.name, toolInput: input };
      answer = display.pushAndWait({ renderer: "permission_request", input: request });
      const slot = display.stack.find((entry) => entry.input === request);
      withdraw = () => {
        if (!slot) return;
        display.reject(slot.id, new AbortError("The permission request was withdrawn."));
        display.removeSlot(slot.id);
      };
    } else {
      answer = Promise.resolve(policy({ tool: tool.name, input, signal }));
    }
    answer.catch(() => {});
    let allowed: boolean;
    try {
      allowed = Boolean(await Promise.race([answer, aborted]));
    } catch (error) {
      withdraw();
      throw error;
    }
    await store.setPermission?.(tool.name, allowed ? "granted" : "denied", input);
    return allowed;
  }

  /** Send now, or once the provider session is back if it's reconnecting. */
  private deliver(epoch: number, send: () => void): void {
    if (epoch !== this.epoch) return;
    if (!this.adapter.isOpen) {
      this.deferred.push({ epoch, send });
      return;
    }
    try {
      send();
    } catch (error) {
      this.emit("error", asError(error));
    }
  }

  private flushDeferred(): void {
    for (const { epoch, send } of this.deferred.splice(0)) this.deliver(epoch, send);
  }

  /** The agent's turn preparers (goals, forms), then `beforeTurn`. */
  private async prepareTurn(): Promise<void> {
    if (typeof this.agent.prepareTurn === "function") await this.agent.prepareTurn();
    await this.cfg.beforeTurn?.();
  }

  private async startTurn(): Promise<void> {
    try {
      await this.prepareTurn();
      await this.syncSession();
    } catch (error) {
      this.emit("error", asError(error));
    }
    try { await this.contextTurn(false, "loop"); } catch (error) { this.emit("error", asError(error)); }
  }

  /**
   * A turn boundary (open, or the user starting to speak): what a text
   * request reads once — history-delivered context, "request" context, events
   * waiting — then the snapshot.
   */
  private async contextTurn(force: boolean, phase: "loop" | "request"): Promise<void> {
    await this.saveHistoryContext();
    await this.refresh(force, true);
    await this.deliverEvents(phase, false);
  }

  /**
   * Context registered with `delivery: "history"` is saved to the store when
   * its value changes, exactly as a request saves it, and told to the call
   * once. Without a hold (an older glove-core, `events: false`), it rides in
   * the snapshot instead.
   */
  private async saveHistoryContext(): Promise<void> {
    const hold = this.hold;
    if (!hold || !this.adapter.isOpen) return;
    // Compared against the store's visible history: let earlier writes land.
    await this.writes;
    const saved = (await hold.historyContext())
      .filter((message) => !message.context_key || this.historySent.get(message.context_key) !== message.text);
    if (!saved.length) return;
    for (const message of saved) if (message.context_key) this.historySent.set(message.context_key, message.text);
    this.persist(saved);
    const epoch = this.epoch;
    for (const message of saved) {
      this.deliver(epoch, () => this.adapter.inject({ kind: "context", text: message.text }));
    }
  }

  // ── events ────────────────────────────────────────────────────────────────

  /**
   * Ask for the agent's turn queue without waiting for it: the call opens at
   * once. A text turn already running keeps the events that arrive until it
   * ends; then the call holds the queue and takes what waits.
   */
  private acquireHold(): void {
    if (this.cfg.events === false || typeof this.agent.holdTurns !== "function") return;
    const request = new AbortController();
    this.holdRequest = request;
    this.agent.holdTurns({ signal: request.signal, onEvent: () => this.onAgentEvent() }).then((hold) => {
      if (request.signal.aborted || this.holdRequest !== request) {
        void hold.release();
        return;
      }
      this.holdRequest = null;
      this.hold = hold;
      // Events deferred before the call (or queued behind the turn it waited
      // for) go in now; an open session takes them silently.
      this.eventsWaiting = true;
      if (this.adapter.isOpen) void this.deliverEvents("request", false).catch((error) => this.emit("error", asError(error)));
    }, () => {});
  }

  private onAgentEvent(): void {
    this.eventsWaiting = true;
    this.flushEventsWhenQuiet();
  }

  private responseStarted(): void {
    this.agentBusy = true;
    this.expectingResponse = false;
    clearTimeout(this.expectTimer);
  }

  /** A response was asked for: don't start another before it begins. */
  private expectResponse(): void {
    this.expectingResponse = true;
    clearTimeout(this.expectTimer);
    // A response that never starts (nothing to say, a provider without
    // response events) must not hold events back for good.
    this.expectTimer = setTimeout(() => {
      this.expectingResponse = false;
      this.flushEventsWhenQuiet();
    }, 5_000);
  }

  /**
   * An event that arrives while nobody is talking is like a wake in a text
   * agent: the model hears it and may speak. Otherwise it waits for the
   * pause, or goes in silently at the next user turn or tool result.
   */
  private flushEventsWhenQuiet(): void {
    if (!this.eventsWaiting || this.eventDelivery) return;
    const quiet = this._state === "open" && this.adapter.isOpen && !this.userSpeaking && !this.agentBusy &&
      !this.expectingResponse && this.pending.size === 0;
    if (!quiet) return;
    const run = this.deliverEvents("loop", true)
      .catch((error) => { this.emit("error", asError(error)); })
      .finally(() => { this.eventDelivery = null; });
    this.eventDelivery = run;
  }

  /** Take the agent's queued events and give them to the call. */
  private async deliverEvents(phase: "loop" | "request", respond: boolean): Promise<void> {
    const hold = this.hold;
    if (!hold || !this.adapter.isOpen) return;
    this.eventsWaiting = false;
    const message = await hold.takeEvents(phase);
    if (!message) return;
    // Saved once, where a text turn saves it. A fresh provider session is
    // seeded from the store, so a reconnect can't lose it.
    this.persist([message]);
    const epoch = this.epoch;
    if (this.adapter.capabilities.input.includes("image")) {
      for (const image of runtimeImages([message])) {
        this.deliver(epoch, () => this.adapter.sendMedia({ kind: "image", mimeType: image.source!.media_type, data: image.source!.data! }));
      }
    }
    if (respond) this.expectResponse();
    this.deliver(epoch, () => this.adapter.inject({ kind: "context", text: message.text, respond }));
  }

  /**
   * Send the agent's current prompt and tools if either changed. Tools fold
   * new tools mid-call (discovery, MCP refresh) and modules rewrite the prompt
   * as state moves (a goal's `configure`); the provider has to hear about it.
   */
  private async syncSession(): Promise<void> {
    const applied: Array<void | Promise<void>> = [];
    try {
      const instructions = this.cfg.instructions ?? this.agent.getSystemPrompt();
      if (instructions !== this.instructions) {
        this.instructions = instructions;
        applied.push(this.adapter.setInstructions(instructions));
      }
      const tools = this.exposedTools;
      const next = signature(tools);
      if (next !== this.toolSignature) {
        this.toolSignature = next;
        applied.push(this.adapter.setTools(tools));
      }
      // A provider that reconnects to apply a change settles once the new
      // session is open.
      await Promise.all(applied);
    } catch (error) {
      this.emit("error", asError(error));
    }
  }

  // ── context ───────────────────────────────────────────────────────────────

  /**
   * Inject the agent's current runtime context and inbox state.
   *
   * Resolved inbox items are announced once and consumed, as a text turn
   * would. Runtime snapshots are keyed, so providers that can remove items
   * replace the previous snapshot; the rest append one that says it
   * supersedes. Identical snapshots are not re-sent.
   */
  async refreshContext(force = false): Promise<void> {
    return this.refresh(force, false);
  }

  /** `request`: a turn boundary, where "request" context is read again. */
  private async refresh(force: boolean, request: boolean): Promise<void> {
    if (this.contextRefresh) {
      await this.contextRefresh;
      if (!force && !request) return;
    }
    const run = this.doRefreshContext(force, request).finally(() => {
      if (this.contextRefresh === run) this.contextRefresh = null;
    });
    this.contextRefresh = run;
    return run;
  }

  private async doRefreshContext(force: boolean, request: boolean): Promise<void> {
    if (!this.adapter.isOpen) return;
    const epoch = this.epoch;
    const store = this.agent.store;
    const parts: string[] = [];

    // "request" context is frozen between user turns, as a text request
    // freezes it between tool steps; "iteration" context is read every time.
    const messages: Message[] = [];
    if (request) {
      const frozen = await this.agent.getRuntimeContext(undefined, "request");
      // Without a hold, history-delivered context can't be saved: it rides here.
      if (!this.hold) frozen.push(...await this.agent.getRuntimeContext(undefined, "history"));
      if (epoch !== this.epoch) return;
      this.requestContext = runtimeText(frozen);
      messages.push(...frozen);
    }
    const iteration = await this.agent.getRuntimeContext(undefined, "iteration");
    if (epoch !== this.epoch) return;
    messages.push(...iteration);
    const text = [this.requestContext, runtimeText(iteration)].filter(Boolean).join("\n\n");
    if (text) parts.push(text);

    if (store.getResolvedInboxItems && store.updateInboxItem) {
      const resolved = await store.getResolvedInboxItems();
      if (epoch !== this.epoch) return;
      // Only consumed once it has actually reached a provider session; a
      // reconnect in between leaves it resolved for the next refresh.
      if (resolved.length && this.adapter.isOpen && epoch === this.epoch) {
        const inbox = resolvedInboxText(resolved);
        this.persist([{ sender: "user", framework_context: "inbox", text: inbox }]);
        this.adapter.inject({ kind: "context", text: inbox });
        for (const item of resolved) await store.updateInboxItem(item.id, { status: "consumed" });
      }
    }
    if (store.getInboxItems) {
      const blocking = (await store.getInboxItems()).filter((item) => item.status === "pending" && item.blocking);
      if (blocking.length) parts.push(pendingBlockingText(blocking));
    }
    if (epoch !== this.epoch) return;

    if (this.adapter.capabilities.input.includes("image")) {
      for (const image of runtimeImages(messages)) {
        const data = image.source!.data!;
        const key = `${data.length}:${data.slice(0, 64)}:${data.slice(-64)}`;
        if (this.sentImages.has(key)) continue;
        this.sentImages.add(key);
        this.adapter.sendMedia({ kind: "image", mimeType: image.source!.media_type, data });
      }
    }

    const snapshot = parts.join("\n\n");
    if (!this.adapter.isOpen || epoch !== this.epoch) return;
    if (!force && snapshot === this.lastContext) return;
    if (!snapshot && !this.lastContext) {
      this.lastContext = snapshot;
      return;
    }
    this.lastContext = snapshot;
    this.adapter.inject({
      kind: "context",
      key: RUNTIME_KEY,
      text: `Current runtime context (supersedes earlier runtime snapshots):\n${snapshot || "No active runtime context."}`,
    });
    this.emit("context_refreshed", snapshot);
  }

  /** Re-send the prompt and tools — after changing them on the agent. */
  async refreshSession(): Promise<void> {
    await this.syncSession();
    await this.refreshContext();
  }

  // ── compaction ────────────────────────────────────────────────────────────

  /**
   * Replace the provider conversation with a summary.
   *
   * Glove decides WHEN (the context limit, or you), and writes the summary to
   * the store as a compaction message — the same split a text turn's
   * compaction makes, so both see one history. The adapter decides HOW:
   * edit the conversation in place, or reconnect seeded with the summary.
   * Resolves false when the provider can't apply a summary.
   */
  compact(): Promise<boolean> {
    if (this.compacting) return this.compacting;
    const run = this.doCompact().finally(() => {
      this.compacting = null;
    });
    this.compacting = run;
    return run;
  }

  private async doCompact(): Promise<boolean> {
    const caps = this.adapter.capabilities.compaction;
    if (caps.apply === "none" || !this.adapter.isOpen) return false;
    const config = this.cfg.compaction || {};
    const instructions = config.instructions ?? DEFAULT_COMPACTION_INSTRUCTIONS;
    const keep = config.keepRecent ?? 6;
    // Everything said from here on is written after the summary, where the
    // split at the summary keeps it visible.
    this.holds.add("compaction");
    try {
      await this.writes;
      await this.notify("compaction_start", { current_token_consumption: this.contextTokens });

      const history = await this.storedHistory({ maxItems: 400, maxChars: 200_000 });
      let summary = "";
      let tokensIn = 0;
      let tokensOut = 0;
      if (caps.summarize && this.adapter.summarize) {
        summary = await this.adapter.summarize(instructions);
      } else if (config.model) {
        const messages: Message[] = this.cfg.persist === false
          ? this.log.map((item) => ({ sender: item.role === "assistant" ? "agent" : "user", text: item.text }))
          : await new Context(this.agent.store).getMessages();
        config.model.setSystemPrompt(this.instructions);
        const result = await config.model.prompt(
          { messages: [...messages, { sender: "user", text: instructions, is_compaction_request: true }] },
          async () => {},
        );
        summary = result.messages.filter((m) => m.sender === "agent").map((m) => m.text).join("\n");
        tokensIn = result.tokens_in;
        tokensOut = result.tokens_out;
      }
      // No model to write it: the transcript itself. The summary covers the
      // whole conversation — the store keeps only what follows it.
      if (!summary.trim()) summary = renderTranscript(history) || "No earlier conversation.";

      const outcome = await this.adapter.compact({ summary, recent: history.slice(-keep) });
      if (outcome === "unsupported") return false;

      const summaryMessage: Message = {
        sender: "user",
        text: `[Conversation summary from compaction]\n\n${summary}\n\n[End of summary - the conversation continues from here]`,
        is_compaction: true,
      };
      if (this.cfg.persist !== false) this.write([summaryMessage]);
      await this.writes;
      if (this.cfg.persist !== false) await this.agent.store.resetCounters();
      this.log = this.log.slice(-keep);
      this.contextTokens = 0;
      await this.notify("compaction_end", {
        current_token_consumption: 0,
        summary_message: summaryMessage,
        consumption: { tokens_in: tokensIn, tokens_out: tokensOut },
      });
      this.emit("compacted", summary, outcome);
      // In place, the snapshot item went with everything else. A reconnect
      // re-sent it when the new session opened.
      await this.refreshContext(outcome === "in_place");
      return true;
    } finally {
      this.releaseHold("compaction");
    }
  }

  // ── host API ──────────────────────────────────────────────────────────────

  /** Caller audio, in `adapter.inputFormat`. */
  sendAudio(pcm: Int16Array): void {
    this.adapter.sendAudio(pcm);
  }

  /** A typed message from the user: saved and answered. */
  say(text: string): void {
    this.flushFragment();
    this.agent.notifyUserActivity?.();
    this.expectResponse();
    this.remember({ role: "user", text });
    this.persist([{ sender: "user", text }]);
    this.adapter.sendText(text);
  }

  /** An image (a screenshot, a photo), or a camera frame. */
  sendMedia(media: RealtimeMedia): void {
    if (!this.adapter.capabilities.input.includes(media.kind)) {
      throw new Error(`${this.adapter.provider} takes no ${media.kind} input (it takes ${this.adapter.capabilities.input.join(", ")}).`);
    }
    this.adapter.sendMedia(media);
  }

  sendImage(data: string | Uint8Array, mimeType = "image/jpeg"): void {
    this.sendMedia({ kind: "image", mimeType, data });
  }

  sendVideoFrame(data: string | Uint8Array, mimeType = "image/jpeg"): void {
    this.sendMedia({ kind: "video", mimeType, data });
  }

  /**
   * A synthetic prompt: a delegation result to relay, a reminder, framework
   * state. `persist` also writes it to the store as a user-side message.
   */
  inject(injection: RealtimeInjection & { persist?: boolean }): void {
    const { persist, ...rest } = injection;
    if (persist) this.persist([{ sender: "user", text: rest.text }]);
    this.adapter.inject(rest);
  }

  /** Ask the model to speak now — a greeting, after silent context. */
  respond(instructions?: string): void {
    this.adapter.respond(instructions ? { instructions } : undefined);
  }

  /** Stop the agent's current output (manual barge-in). */
  interrupt(): void {
    this.adapter.interrupt();
  }

  /** For providers whose `speechLifecycle` is `host`: real playback state. */
  notifyPlayback(speaking: boolean): void {
    this.adapter.notifyPlayback?.(speaking);
  }
}

class ToolRefusal extends Error {}

async function gated(tool: Tool<unknown>, input: unknown): Promise<boolean> {
  return typeof tool.requiresPermission === "function"
    ? Boolean(await tool.requiresPermission(input))
    : Boolean(tool.requiresPermission);
}

function signature(tools: RealtimeToolSpec[]): string {
  return JSON.stringify(tools.map((tool) => [tool.name, tool.description, tool.behavior ?? "", tool.parameters]));
}
