// glove
// closed - tool registering
// open - tools that need to collect information from the user
// allow for resumption - e.g if it's a social login and the user's done logging in
// how do you achieve undos? include something in the do, that can be undone

import z from "zod";
import { AbortError, Agent, AgentFrameworkHooks, ContentPart, Context, Executor, HandOverFunction, Message, ModelAdapter, ModelPromptResult, NotifySubscribersFunction, Observer, PromptMachine, StoreAdapter, SubscriberAdapter, Tool, ToolResultData } from "./core";
import {
  AgentEvent,
  defaultEventFormatter,
  defaultEventPolicy,
  escapeXml,
  EventDisposition,
  EventFormatter,
  EventPolicy,
  EventPolicyState,
  EventQueueAdapter,
  MemoryEventQueue,
} from "./events";
import { MemoryStore } from "./utils";
import { createTaskTool } from "./tools/task-tool";
import { createInboxTool } from "./tools/inbox-tool";
import { DisplayManagerAdapter } from "./display-manager";
import {
  AgentControls,
  createSkillInvokeTool,
  createSubAgentInvokeTool,
  DefineSkillArgs,
  DefineSubAgentArgs,
  formatSkillMessage,
  HookHandler,
  parseTokens,
  RegisteredSkill,
  RegisteredSubAgent,
  renderSkillToolDescription,
  renderSubAgentToolDescription,
} from "./extensions";


export interface GloveFoldArgs<I> {
  name: string,
  description: string
  /** Zod schema — preferred for tools you author. Validated locally on input. */
  inputSchema?: z.ZodType<I>,
  /** Raw JSON Schema — for bridged tools (MCP, OpenAPI). Skips local validation. */
  jsonSchema?: Record<string, unknown>,
  /**
   * Gate the tool behind a permission check.
   *
   * - `boolean` — applies to every invocation.
   * - `(input) => boolean | Promise<boolean>` — called with the model-supplied
   *   input on every call and awaited; resolve `true` to require a check for
   *   this call, `false` to skip it (e.g. read-only commands).
   *
   * When the gate is on, the store is consulted via `getPermission(name, input)`
   * and a permission prompt is rendered through the display stack.
   */
  requiresPermission?: boolean | ((input: I) => boolean | Promise<boolean>),
  unAbortable?: boolean,
  /**
   * Tool implementation.
   *
   * Arguments:
   * - `input` — parsed and validated by `inputSchema` when provided. With
   *   `jsonSchema` alone, raw model arguments pass through; the implementation
   *   or bridged service is responsible for validation.
   * - `display` — the parent's `DisplayManagerAdapter`.
   * - `glove` — the running `Glove` instance. Use it from tools that need
   *   to fold additional tools at runtime (e.g. the discovery subagent's
   *   activate tool). Most tools ignore it.
   * - `signal` — the active request's `AbortSignal`. Forward into any
   *   long-running internal work (nested agent runs, fetches, ...) so
   *   abort propagates. Tools that ignore it still get the executor's
   *   abortable-promise unwind for free.
   */
  do: (
    input: I,
    display: DisplayManagerAdapter,
    glove: IGloveRunnable,
    signal?: AbortSignal,
  ) => Promise<ToolResultData>,
  generateToolSummary?: (summaryArgs?: unknown) => Promise<string>
}

/** Read current external state for the model. How it reaches the model is the provider's `delivery`. */
export type RuntimeContextValue = string | ContentPart[] | null | undefined;
export type RuntimeContextProvider = (signal?: AbortSignal) => RuntimeContextValue | Promise<RuntimeContextValue>;

/**
 * - `"iteration"` (default): re-read before every model call, including
 *   between tool steps, and appended transiently at the input tail. Use it
 *   for state a tool can change mid-request (a browser screenshot).
 * - `"request"`: read once per request and frozen transiently just before the
 *   request's message, so the prefix is identical on every tool step.
 * - `"history"`: read once per request and saved to history before the
 *   request's message — only when the value differs from the one this
 *   provider saved last. It then ages into the background like any other
 *   message, and the model can reason over it without a tool call. After
 *   compaction removes it, the next request saves it again. Text only.
 */
export type RuntimeContextDelivery = "iteration" | "request" | "history";

export interface RuntimeContextOptions {
  delivery?: RuntimeContextDelivery;
  /**
   * Stable name for this provider's saved messages. Required for `"history"`:
   * the saved text is wrapped in `<context key="…">`, which is how the last
   * saved value is found again with any store, including after a restart.
   */
  key?: string;
}

/** Work that must finish before any turn starts (a request or an event wake). */
export type TurnPreparer = (signal?: AbortSignal) => void | Promise<void>;

export interface TurnHoldOptions {
  /** Stop waiting for the turns ahead; `holdTurns` rejects. */
  signal?: AbortSignal;
  /** Called for each event queued while the hold is in place. */
  onEvent?: (event: AgentEvent) => void;
}

/** The turn queue, held by a runtime that drives the agent itself. */
export interface TurnHold {
  /**
   * Take the queued events as one message, or null when none wait. `phase`
   * is passed to the formatter: `"request"` for events that waited for the
   * user's next message, `"loop"` (default) for ones that arrived during the
   * hold. Taken events count as delivered; save the message with the
   * conversation.
   */
  takeEvents: (phase?: "loop" | "request") => Promise<Message | null>;
  /**
   * History-delivered context (`delivery: "history"`) whose value differs
   * from the one last saved in the store's visible history: the messages a
   * request would save before its own message. Save them before the user's
   * next turn.
   */
  historyContext: (signal?: AbortSignal) => Promise<Array<Message>>;
  /**
   * Give the queue back. Events left queued go to the event policy. Resolves
   * once the queue is free.
   */
  release: () => Promise<void>;
}

export interface IGloveRunnable {
  /**
   * Run `prepare` at the start of every turn, inside the turn queue: before a
   * request's hooks and skills, and before an event wake. A throw fails that
   * turn. Use it instead of wrapping `processRequest`, which wakes bypass.
   */
  addTurnPreparer: (prepare: TurnPreparer) => () => void
  /**
   * Run the turn preparers, in registration order. Requests and event wakes
   * run them inside the turn queue on their own; runtimes that drive the
   * agent without `processRequest` (a realtime session) call this at their
   * own turn boundaries.
   */
  prepareTurn: (signal?: AbortSignal) => Promise<void>
  /**
   * Deliver an event to the subscribers added with `addSubscriber`. For
   * runtimes that run the agent outside `processRequest` (a realtime session
   * executing tools and transcribing speech), so modules and UIs listening on
   * the agent see that activity as they would a text turn's.
   */
  notifySubscribers: NotifySubscribersFunction
  /**
   * Hold the turn queue for a runtime that drives the agent itself (a
   * realtime call). Waits for the turns ahead, then holds the queue until
   * `release`: requests and event wakes wait behind it, and events emitted
   * meanwhile are queued for the holder (`onEvent`, `takeEvents`) instead of
   * waking the model.
   */
  holdTurns: (options?: TurnHoldOptions) => Promise<TurnHold>
  /** Supply context for the model; `options.delivery` decides when and how. Returns an unregister function. */
  addContextProvider: (provider: RuntimeContextProvider, options?: RuntimeContextOptions) => () => void
  /**
   * Resolve current snapshots without saving anything, for external runtimes
   * such as realtime voice. Pass `delivery` to read only those providers.
   */
  getRuntimeContext: (signal?: AbortSignal, delivery?: RuntimeContextDelivery) => Promise<Array<Message>>
  /**
   * Deliver a spontaneous event from a third party. While a turn runs it joins
   * at the next tool-step boundary; while idle the event policy wakes the
   * agent, defers it to the next request, or drops it. Saved to history once.
   */
  emitEvent: (event: AgentEvent) => Promise<EventDisposition>
  /** Tell the event policy a user is present (typing, a live voice session). */
  notifyUserActivity: () => void
  /** Run queued spontaneous events as an awaited turn, without manufacturing a user request. */
  processEvents: (signal?: AbortSignal) => Promise<ModelPromptResult | Message | undefined>
  processRequest: (request: string | ContentPart[], signal?: AbortSignal) => Promise<ModelPromptResult | Message>
  setModel: (model: ModelAdapter) => void
  setSystemPrompt: (prompt: string) => void
  getSystemPrompt: () => string
  /** Swap the display manager for this Glove. Useful for subagents that want to share the parent's display stack mid-run. */
  setDisplayManager: (displayManager: DisplayManagerAdapter) => void
  addSubscriber: (subscriber: SubscriberAdapter) => void
  removeSubscriber: (subscriber: SubscriberAdapter) => void
  /** Fold a tool. Legal at any time, including after build. */
  fold: <I>(args: GloveFoldArgs<I>) => IGloveRunnable
  /** Atomically replace a caller-owned set of tools. Legal after build. */
  replaceTools: (
    previousNames: Iterable<string>,
    nextTools: ReadonlyArray<GloveFoldArgs<unknown>>,
  ) => IGloveRunnable
  /** Register a `/name` hook that can mutate agent state or short-circuit a turn. */
  defineHook: (name: string, handler: HookHandler) => IGloveRunnable
  /** Register a `/name` skill that injects context as a synthetic user message. */
  defineSkill: (args: DefineSkillArgs) => IGloveRunnable
  /** Register a subagent factory the agent can route to via the `glove_invoke_subagent` tool. The factory receives the parent store and controls and returns a fully-built child Glove. The user's `@name` mention in their text reaches the model verbatim and acts as a routing signal. */
  defineSubAgent: (args: DefineSubAgentArgs) => IGloveRunnable
  rebuild: (store?: StoreAdapter)=> IGloveRunnable
  readonly displayManager: DisplayManagerAdapter
  readonly model: ModelAdapter
  readonly serverMode: boolean
  /** The StoreAdapter backing this agent's persistence. Exposed for
   *  integrations (e.g. glove-mesh) that need to write resolved inbox
   *  items without going through the model's tool path. */
  readonly store: StoreAdapter
  /**
   * The tools folded into this agent, in registration order.
   *
   * Read-only, and readable WITHOUT running the loop — which is the point.
   * Some runtimes own the agent loop themselves and cannot hand it to Glove:
   * a realtime speech-to-speech model decides its own turn-taking and calls
   * tools from inside the provider's session, so it needs the schemas up
   * front to configure that session, then executes each call through the
   * same `Tool.run` everything else uses. Exposing the registry is what lets
   * a tool be authored once and work in both modes. Same door serves
   * anything else that needs the surface without the loop — exporting it
   * over MCP, generating documentation, auditing permissions.
   */
  readonly tools: ReadonlyArray<Tool<unknown>>
}


export interface IGloveBuilder {
  addTurnPreparer: (prepare: TurnPreparer) => () => void,
  addContextProvider: (provider: RuntimeContextProvider, options?: RuntimeContextOptions) => () => void,
  fold: <I>(args: GloveFoldArgs<I>) => IGloveBuilder,
  replaceTools: (
    previousNames: Iterable<string>,
    nextTools: ReadonlyArray<GloveFoldArgs<unknown>>,
  ) => IGloveBuilder,
  defineHook: (name: string, handler: HookHandler) => IGloveBuilder,
  defineSkill: (args: DefineSkillArgs) => IGloveBuilder,
  defineSubAgent: (args: DefineSubAgentArgs) => IGloveBuilder,
  setDisplayManager: (displayManager: DisplayManagerAdapter) => IGloveBuilder,
  addSubscriber: (subscriber: SubscriberAdapter) => IGloveBuilder,
  build: (store?: StoreAdapter)=> IGloveRunnable
}

interface CompactionConfig {
  max_turns?: number,
  compaction_instructions: string,
  compaction_context_limit?: number
}


interface GloveConfig {
  store?: StoreAdapter,
  model: ModelAdapter,
  displayManager: DisplayManagerAdapter,
  systemPrompt: string,
  /**
   * Default false. When true, signals to integrations (e.g. mountMcp) that no
   * UI is present. Drives default permission gating and default discovery
   * ambiguity policy. Treat as the canonical "I am headless" flag.
   */
  serverMode?: boolean,
  maxRetries?: number,
  maxConsecutiveErrors?: number,
  compaction_config: CompactionConfig,
  enableToolResultSummary?: boolean,
  events?: GloveEventsConfig
}

export interface GloveEventsConfig {
  /** Where events wait. Defaults to an in-memory queue. */
  queue?: EventQueueAdapter,
  /** What an idle agent does with an event. Defaults to {@link defaultEventPolicy}. */
  policy?: EventPolicy,
  /** How queued events become a message. Defaults to escaped `<event>` XML. */
  formatter?: EventFormatter,
  /** How long `notifyUserActivity` counts the user as present. Default 15 000 ms. */
  userActivityWindowMs?: number,
  /** Deferred events wake the agent after this long without a request. Default 60 000 ms; `Infinity` holds them. */
  deferTimeoutMs?: number,
}

interface RegisteredContextProvider {
  delivery: RuntimeContextDelivery
  key?: string
}

const CONTEXT_DELIVERIES = new Set<RuntimeContextDelivery>(["iteration", "request", "history"])

function contextOpenTag(key: string): string {
  return `<context key="${escapeXml(key)}"`
}

/** Most recent saved message for a history-delivered provider, found by its wrapper. */
function lastSavedContext(history: ReadonlyArray<Message>, key: string): Message | undefined {
  const open = contextOpenTag(key)
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message.sender === "user" && message.text?.startsWith(open) &&
        (message.text.length === open.length || message.text[open.length] === ">" || message.text[open.length] === " ")) {
      return message
    }
  }
  return undefined
}

function isExpired(event: AgentEvent, now = Date.now()): boolean {
  if (!event.expiresAt) return false
  const at = Date.parse(event.expiresAt)
  return Number.isFinite(at) && at <= now
}

/** Wait for the turns ahead; reject at once if this request is aborted while it waits. */
function waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous
  if (signal.aborted) return Promise.reject(signal.reason ?? new AbortError())
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new AbortError())
    signal.addEventListener("abort", onAbort, { once: true })
    previous.then(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    })
  })
}

const CONSUMED_EVENT_MEMORY = 1000


export class Glove implements IGloveBuilder, IGloveRunnable {

  private _displayManager: DisplayManagerAdapter
  readonly serverMode: boolean
  private _store: StoreAdapter
  private context: Context
  private promptMachine: PromptMachine
  private observer: Observer
  private executor: Executor
  private agent: Agent

  private hooks = new Map<string, HookHandler>()
  private skills = new Map<string, RegisteredSkill>()
  private subAgents = new Map<string, RegisteredSubAgent>()
  private subAgentInvokeTool: Tool<unknown> | null = null
  private skillInvokeTool: Tool<unknown> | null = null
  private taskTool: Tool<unknown> | null = null
  private inboxTool: Tool<unknown> | null = null

  private subscribers: Array<SubscriberAdapter> = []
  private contextProviders = new Map<RuntimeContextProvider, RegisteredContextProvider>()
  private turnPreparers = new Set<TurnPreparer>()
  private turnHolds = new Set<(event: AgentEvent) => void>()
  private compactionConfig: CompactionConfig

  // Turns (requests and event wakes) run one at a time, in arrival order.
  private turnTail: Promise<void> = Promise.resolve()
  private pendingTurns = 0

  private eventQueue: EventQueueAdapter
  private eventPolicy: EventPolicy
  private eventFormatter: EventFormatter
  private userActivityWindowMs: number
  private deferTimeoutMs: number
  private lastUserActivity = Number.NEGATIVE_INFINITY
  private consumedEventIds = new Set<string>()
  private deferTimer: ReturnType<typeof setTimeout> | undefined
  private dispatching = false

  private store_defined = false
  private built = false


  constructor(config: GloveConfig) {
    if (config.store) {
      this._store = config.store
      this.store_defined = true
    } else {
      this._store = new MemoryStore(`glove_${Date.now()}`)
    }
    this._displayManager = config.displayManager
    this.serverMode = config.serverMode ?? false
    this.compactionConfig = config.compaction_config
    this.eventQueue = config.events?.queue ?? new MemoryEventQueue()
    this.eventPolicy = config.events?.policy ?? defaultEventPolicy
    this.eventFormatter = config.events?.formatter ?? defaultEventFormatter
    this.userActivityWindowMs = config.events?.userActivityWindowMs ?? 15_000
    this.deferTimeoutMs = config.events?.deferTimeoutMs ?? 60_000

    this.context = new Context(this.store)
    this.promptMachine = new PromptMachine(config.model, this.context,config.systemPrompt, config.enableToolResultSummary)
    this.executor = new Executor(config.maxRetries, this.store)
    this.registerTaskTool()
    this.registerInboxTool()

    this.observer = new Observer(this.store, this.context, this.promptMachine, this.compactionConfig?.compaction_instructions, this.compactionConfig?.max_turns, this.compactionConfig?.compaction_context_limit)

    this.agent = this.createAgent()

  }

  private createAgent(): Agent {
    const framework: AgentFrameworkHooks = {
      beforeRequest: async (history, signal) => [
        ...await this.resolveHistoryContext(history, signal),
        ...await this.drainEvents("request"),
      ],
      frozenContext: (signal) => this.getRuntimeContext(signal, "request"),
      drainEvents: () => this.drainEvents("loop"),
    }
    return new Agent(
      this.store,
      this.executor,
      this.context,
      this.observer,
      this.promptMachine,
      (signal) => this.getRuntimeContext(signal, "iteration"),
      framework,
    )
  }

  private notifyExtensionEvent: NotifySubscribersFunction = async (event_name, event_data) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  addTurnPreparer(prepare: TurnPreparer): () => void {
    this.turnPreparers.add(prepare)
    return () => { this.turnPreparers.delete(prepare) }
  }

  async prepareTurn(signal?: AbortSignal): Promise<void> {
    for (const prepare of [...this.turnPreparers]) {
      signal?.throwIfAborted()
      await prepare(signal)
    }
  }

  notifySubscribers: NotifySubscribersFunction = (event_name, event_data) =>
    this.notifyExtensionEvent(event_name, event_data)

  async holdTurns(options: TurnHoldOptions = {}): Promise<TurnHold> {
    if (!this.built) throw new Error("Call build before holdTurns")
    let started!: () => void
    const holding = new Promise<void>((resolve) => { started = resolve })
    let release!: () => void
    const released = new Promise<void>((resolve) => { release = resolve })
    // Rejects only if the signal aborts while waiting for the turns ahead.
    const turn = this.runTurn(async () => {
      started()
      await released
    }, options.signal)
    await Promise.race([holding, turn])
    const listener = options.onEvent
    if (listener) this.turnHolds.add(listener)
    let held = true
    return {
      takeEvents: async (phase = "loop") => {
        if (!held) return null
        const [message] = await this.drainEvents(phase)
        return message ?? null
      },
      historyContext: async (signal) => this.resolveHistoryContext(await this.context.getMessages(), signal),
      release: () => {
        if (held) {
          held = false
          if (listener) this.turnHolds.delete(listener)
          release()
        }
        return turn
      },
    }
  }

  addContextProvider(provider: RuntimeContextProvider, options?: RuntimeContextOptions): () => void {
    const delivery = options?.delivery ?? "iteration"
    if (!CONTEXT_DELIVERIES.has(delivery)) {
      throw new Error(`Unknown context delivery "${delivery}". Use "iteration", "request" or "history".`)
    }
    const key = options?.key
    if (key !== undefined && (typeof key !== "string" || !key.trim())) {
      throw new Error("Context provider key must be a non-empty string.")
    }
    if (delivery === "history") {
      if (!key) throw new Error(`History-delivered context needs a stable key so its saved value can be found again.`)
      for (const [other, registered] of this.contextProviders) {
        if (other !== provider && registered.delivery === "history" && registered.key === key) {
          throw new Error(`A history-delivered context provider with key "${key}" is already registered.`)
        }
      }
    }
    this.contextProviders.set(provider, { delivery, ...(key ? { key } : {}) })
    return () => { this.contextProviders.delete(provider) }
  }

  async getRuntimeContext(signal?: AbortSignal, delivery?: RuntimeContextDelivery): Promise<Array<Message>> {
    const messages: Array<Message> = []
    let read = 0
    for (const [provider, registered] of this.contextProviders) {
      if (delivery && registered.delivery !== delivery) continue
      read++
      signal?.throwIfAborted()
      const value = await provider(signal)
      signal?.throwIfAborted()
      const keyed = registered.key ? { context_key: registered.key } : {}
      if (typeof value === "string" && value) {
        messages.push({ sender: "user", text: value, framework_context: "runtime", transient: true, ...keyed })
      } else if (Array.isArray(value) && value.length) {
        const content = structuredClone(value)
        const text = content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n")
        messages.push({ sender: "user", text, content, framework_context: "runtime", transient: true, ...keyed })
      }
    }
    if (read) {
      // Media is transient model input, not a telemetry payload. Keep text
      // and media kinds observable without persisting bytes or signed URLs.
      const trace = messages.map(message => ({ ...message, ...(message.content ? {
        content: message.content.map(part => part.type === "text" ? part : { type: "text" as const, text: `[${part.type} observation]` }),
      } : {}) }))
      await this.notifyExtensionEvent("runtime_context", { messages: structuredClone(trace), ...(delivery ? { delivery } : {}) })
    }
    return messages
  }

  /**
   * Resolve history-delivered providers and return the messages to save: a
   * provider's value is saved only when it differs from the last one it
   * saved in the visible (post-compaction) history, and a provider that goes
   * empty after saving something saves a cleared marker once.
   */
  private async resolveHistoryContext(history: ReadonlyArray<Message>, signal?: AbortSignal): Promise<Array<Message>> {
    const saved: Array<Message> = []
    let read = 0
    for (const [provider, registered] of this.contextProviders) {
      if (registered.delivery !== "history" || !registered.key) continue
      read++
      signal?.throwIfAborted()
      const value = await provider(signal)
      signal?.throwIfAborted()
      let body: string
      if (typeof value === "string") {
        body = value
      } else if (Array.isArray(value)) {
        if (value.some((part) => part.type !== "text")) {
          throw new Error(`History-delivered context "${registered.key}" must be text; media stays transient (use "iteration" or "request").`)
        }
        body = value.map((part) => part.text ?? "").join("\n")
      } else {
        body = ""
      }
      const open = contextOpenTag(registered.key)
      const previous = lastSavedContext(history, registered.key)
      const text = body.trim()
        ? `${open}>\n${body}\n</context>`
        : previous && !previous.text.startsWith(`${open} status="cleared"`) ? `${open} status="cleared" />` : null
      if (text === null || previous?.text === text) continue
      saved.push({ sender: "user", text, framework_context: "runtime", context_key: registered.key })
    }
    if (read) {
      await this.notifyExtensionEvent("runtime_context", { messages: structuredClone(saved), delivery: "history" })
    }
    return saved
  }

  // ─── Spontaneous events ──────────────────────────────────────────────────

  async emitEvent(event: AgentEvent): Promise<EventDisposition> {
    if (!this.built) throw new Error("Call build before emitEvent")
    if (!event || typeof event.id !== "string" || !event.id.trim()) throw new Error("Event id must be a non-empty string.")
    if (typeof event.source !== "string" || !event.source.trim()) throw new Error("Event source must be a non-empty string.")
    const empty = typeof event.content === "string" ? !event.content.trim() : !Array.isArray(event.content) || event.content.length === 0
    if (empty) throw new Error("Event content must not be empty.")

    const received: AgentEvent = { ...structuredClone(event), receivedAt: event.receivedAt ?? new Date().toISOString() }
    const report = async (disposition: EventDisposition) => {
      await this.notifyExtensionEvent("event_received", {
        id: received.id, source: received.source, ...(received.kind ? { kind: received.kind } : {}), disposition,
      })
      return disposition
    }

    if (this.consumedEventIds.has(received.id)) return report("duplicate")
    if (isExpired(received)) {
      await this.notifyExtensionEvent("event_dropped", { id: received.id, reason: "expired" })
      return report("dropped")
    }

    // A turn is running or waiting: the event joins it at the next boundary.
    if (this.pendingTurns > 0) {
      const pushed = await this.eventQueue.push(received)
      // The turn may have finished while the push was in flight; make sure
      // the idle path sees the event rather than leaving it stranded.
      if (pushed && this.pendingTurns === 0) this.dispatchIdleQuietly()
      if (pushed) {
        for (const listener of [...this.turnHolds]) {
          try { listener(received) } catch { /* a holder's listener can't fail the emit */ }
        }
      }
      return report(pushed ? "queued" : "duplicate")
    }

    const queued = (await this.eventQueue.peek()).length
    const decision = this.eventPolicy(received, this.policyState(queued))
    if (decision === "drop") {
      this.rememberConsumed([received.id])
      await this.notifyExtensionEvent("event_dropped", { id: received.id, reason: "policy" })
      return report("dropped")
    }
    if (!await this.eventQueue.push(received)) return report("duplicate")
    if (decision === "wake") {
      this.startWake()
      return report("woke")
    }
    this.armDeferTimer()
    return report("deferred")
  }

  notifyUserActivity(): void {
    this.lastUserActivity = Date.now()
  }

  private policyState(queued: number): EventPolicyState {
    return {
      looping: this.pendingTurns > 0,
      userActive: Date.now() - this.lastUserActivity < this.userActivityWindowMs,
      queued,
    }
  }

  private rememberConsumed(ids: ReadonlyArray<string>) {
    for (const id of ids) {
      this.consumedEventIds.delete(id)
      this.consumedEventIds.add(id)
    }
    while (this.consumedEventIds.size > CONSUMED_EVENT_MEMORY) {
      this.consumedEventIds.delete(this.consumedEventIds.values().next().value!)
    }
  }

  /** Take everything queued, reporting and discarding what expired while it waited. */
  private async takeLiveEvents(): Promise<Array<AgentEvent>> {
    const taken = await this.eventQueue.take()
    this.clearDeferTimer()
    const now = Date.now()
    const live: Array<AgentEvent> = []
    for (const event of taken) {
      if (isExpired(event, now)) {
        this.rememberConsumed([event.id])
        await this.notifyExtensionEvent("event_dropped", { id: event.id, reason: "expired" })
      } else {
        live.push(event)
      }
    }
    return live
  }

  private async drainEvents(phase: "loop" | "request"): Promise<Array<Message>> {
    const events = await this.takeLiveEvents()
    if (!events.length) return []
    const ids = events.map((event) => event.id)
    this.rememberConsumed(ids)
    const message = this.eventFormatter(events, phase)
    await this.notifyExtensionEvent("event_injected", { ids, phase })
    return [message]
  }

  /**
   * Background dispatch has no caller to report to. If a custom queue or
   * policy throws here, the events stay queued and the next request drains them.
   */
  private dispatchIdleQuietly() {
    this.dispatchIdle().catch(() => {})
  }

  /** Decide what to do with events waiting while no turn runs. */
  private async dispatchIdle(): Promise<void> {
    if (this.pendingTurns > 0 || this.dispatching || !this.built) return
    this.dispatching = true
    try {
      const now = Date.now()
      const waiting = await this.eventQueue.peek()
      const expired = waiting.filter((event) => isExpired(event, now))
      const live = waiting.filter((event) => !isExpired(event, now))
      const state = this.policyState(waiting.length)
      const decisions = live.map((event) => this.eventPolicy(event, state))
      const dropped = live.filter((_, i) => decisions[i] === "drop")
      const wake = decisions.includes("wake")
      if (expired.length || dropped.length) {
        await this.eventQueue.remove([...expired, ...dropped].map((event) => event.id))
        this.rememberConsumed([...expired, ...dropped].map((event) => event.id))
        for (const event of expired) await this.notifyExtensionEvent("event_dropped", { id: event.id, reason: "expired" })
        for (const event of dropped) await this.notifyExtensionEvent("event_dropped", { id: event.id, reason: "policy" })
      }
      if (live.length === dropped.length) {
        this.clearDeferTimer()
        return
      }
      if (wake) this.startWake()
      else this.armDeferTimer()
    } finally {
      this.dispatching = false
    }
  }

  /** Start a turn whose message is the queued events. */
  private startWake() {
    this.clearDeferTimer()
    void this.processEvents().catch(() => {})
  }

  async processEvents(signal?: AbortSignal): Promise<ModelPromptResult | Message | undefined> {
    if (!this.built) throw new Error("Call build before processEvents")
    return this.runTurn(async () => {
      const events = await this.takeLiveEvents()
      if (!events.length) return
      const ids = events.map((event) => event.id)
      this.rememberConsumed(ids)
      try {
        await this.prepareTurn(signal)
        const message = this.eventFormatter(events, "wake")
        await this.notifyExtensionEvent("event_injected", { ids, phase: "wake" })
        return await this.agent.ask(message, this.handOver, signal)
      } catch (error) {
        await this.notifyExtensionEvent("event_wake_failed", {
          ids, message: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }, signal)
  }

  private armDeferTimer() {
    if (this.deferTimer || !Number.isFinite(this.deferTimeoutMs) || this.deferTimeoutMs < 0) return
    this.deferTimer = setTimeout(() => {
      this.deferTimer = undefined
      if (this.pendingTurns > 0) return
      this.eventQueue.peek().then((waiting) => {
        if (waiting.length && this.pendingTurns === 0) this.startWake()
      }).catch(() => {})
    }, this.deferTimeoutMs)
    // Never keep a process alive just to deliver a deferred event.
    ;(this.deferTimer as { unref?: () => void }).unref?.()
  }

  private clearDeferTimer() {
    if (this.deferTimer) clearTimeout(this.deferTimer)
    this.deferTimer = undefined
  }

  /**
   * Run one turn at a time. A turn that arrives while another runs waits for
   * it (and can be aborted while waiting); events left over when the last
   * turn ends go to the idle path. Calling `processRequest` on the same
   * Glove from inside one of its own tools would wait on itself.
   */
  private runTurn<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const contended = this.pendingTurns > 0
    this.pendingTurns++
    const previous = this.turnTail
    let release!: () => void
    this.turnTail = new Promise<void>((resolve) => { release = resolve })
    return (async () => {
      try {
        if (contended) await waitForTurn(previous, signal)
        return await fn()
      } finally {
        this.pendingTurns--
        // The next turn starts only after every turn ahead of it finished,
        // even when this one gave up waiting.
        void previous.then(() => {
          release()
          if (this.pendingTurns === 0) this.dispatchIdleQuietly()
        })
      }
    })()
  }

  // Like the task tool: a store that implements the inbox gets
  // glove_post_to_inbox, bound to this Glove's Context.
  private registerInboxTool() {
    this.inboxTool = null
    if (
      typeof this.store.getInboxItems === "function" &&
      typeof this.store.addInboxItem === "function" &&
      typeof this.store.updateInboxItem === "function" &&
      typeof this.store.getResolvedInboxItems === "function"
    ) {
      this.inboxTool = createInboxTool(this.context) as Tool<unknown>
      this.executor.registerTool(this.inboxTool)
    }
  }

  private registerTaskTool() {
    this.taskTool = null
    if (typeof this.store.getTasks === "function" && typeof this.store.addTasks === "function") {
      this.taskTool = createTaskTool(this.context) as Tool<unknown>
      this.executor.registerTool(this.taskTool)
    }
  }

  private buildTool<I>(args: GloveFoldArgs<I>): Tool<I> {
    if (!args.inputSchema && !args.jsonSchema) {
      throw new Error(`Tool "${args.name}" must provide inputSchema or jsonSchema`);
    }

    const displayManager = this.displayManager;
    const self = this;

    return {
      name: args.name,
      description: args.description,
      input_schema: args.inputSchema,
      jsonSchema: args.jsonSchema,
      requiresPermission: args.requiresPermission,
      unAbortable: args.unAbortable,
      async run(input: I, _handOver, signal?: AbortSignal) {
        const result = await args.do(input, displayManager, self, signal)

        return result
      },
      generateSummary: args.generateToolSummary
    }
  }

  fold<I>(args: GloveFoldArgs<I>) {
    this.executor.registerTool(this.buildTool(args))
    return this
  }

  replaceTools(
    previousNames: Iterable<string>,
    nextTools: ReadonlyArray<GloveFoldArgs<unknown>>,
  ) {
    // Build and validate the entire next set before touching the live
    // registry. A wrapper/schema failure therefore leaves the old surface in
    // place rather than exposing a partially refreshed agent.
    const built = nextTools.map((tool) => this.buildTool(tool))
    this.executor.replaceTools(previousNames, built)
    return this
  }

  defineHook(name: string, handler: HookHandler) {
    this.hooks.set(name, handler)
    return this
  }

  defineSkill(args: DefineSkillArgs) {
    const entry: RegisteredSkill = {
      handler: args.handler,
      description: args.description,
      exposeToAgent: args.exposeToAgent ?? false,
    }
    this.skills.set(args.name, entry)

    // If any exposed skill exists, ensure the dispatcher tool is registered
    // and its description reflects the current set of exposed skills.
    const hasExposed = [...this.skills.values()].some((s) => s.exposeToAgent)
    if (hasExposed) {
      if (!this.skillInvokeTool) {
        this.skillInvokeTool = createSkillInvokeTool(
          this.skills,
          () => this.buildAgentControls(),
          this.notifyExtensionEvent,
        ) as Tool<unknown>
        this.executor.registerTool(this.skillInvokeTool)
      } else {
        this.skillInvokeTool.description = renderSkillToolDescription(this.skills)
      }
    }

    return this
  }

  defineSubAgent(args: DefineSubAgentArgs) {
    const entry: RegisteredSubAgent = {
      factory: args.factory,
      description: args.description,
    }
    this.subAgents.set(args.name, entry)

    // Auto-register the dispatch tool the first time a subagent is defined,
    // and refresh its description on subsequent registrations so the model
    // sees the live subagent list.
    if (!this.subAgentInvokeTool) {
      this.subAgentInvokeTool = createSubAgentInvokeTool(
        this.subAgents,
        () => this.buildAgentControls(),
        () => this.subscribers,
      ) as Tool<unknown>
      this.executor.registerTool(this.subAgentInvokeTool)
    } else {
      this.subAgentInvokeTool.description = renderSubAgentToolDescription(this.subAgents)
    }

    return this
  }

  private buildAgentControls(): AgentControls {
    return {
      context: this.context,
      observer: this.observer,
      promptMachine: this.promptMachine,
      executor: this.executor,
      glove: this,
      store: this.store,
      displayManager: this._displayManager,
      forceCompaction: () => this.observer.runCompactionNow(),
    }
  }

  get model(): ModelAdapter {
    return this.promptMachine.model
  }

  get systemPrompt(): string {
    return this.promptMachine.systemPrompt
  }

  get displayManager(): DisplayManagerAdapter {
    return this._displayManager
  }

  get store(): StoreAdapter {
    return this._store
  }

  get tools(): ReadonlyArray<Tool<unknown>> {
    return this.executor.tools
  }

  /**
   * Swap the display manager. Subagents typically call this to share the
   * parent agent's display stack (passed in via `controls.displayManager`)
   * if they decide mid-flight that they need to render UI in the parent's
   * surface. Builder-form too — chainable from `new Glove(...).setDisplayManager(...)`.
   */
  setDisplayManager(displayManager: DisplayManagerAdapter) {
    this._displayManager = displayManager
    return this
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber)
    this.promptMachine.addSubscriber(subscriber)
    this.executor.addSubscriber(subscriber)
    this.observer.addSubscriber(subscriber)

    return this
  }

  removeSubscriber(subscriber: SubscriberAdapter) {
    const idx = this.subscribers.indexOf(subscriber)
    if (idx !== -1) this.subscribers.splice(idx, 1)
    this.promptMachine.removeSubscriber(subscriber)
    this.executor.removeSubscriber(subscriber)
    this.observer.removeSubscriber(subscriber)
  }


  build(store?: StoreAdapter): IGloveRunnable {
    this.built = true;

    if (store && !this.store_defined) {
      // Preserve tools registered before build — recreating Executor would
      // otherwise drop them silently (including the auto-registered
      // skill/subagent dispatch tools).
      // The built-in task and inbox tools close over Context, so recreate
      // them for the new store instead of retaining the constructor's
      // temporary store.
      const previousTools = this.executor.tools.filter((tool) => tool !== this.taskTool && tool !== this.inboxTool);
      const maxRetries = this.executor.MAX_RETRIES;
      const model = this.promptMachine.model;
      const systemPrompt = this.promptMachine.systemPrompt;
      const enableToolResultSummary = this.promptMachine.enableToolResultSummary;

      this._store = store;
      this.context = new Context(this.store)
      this.promptMachine = new PromptMachine(model, this.context, systemPrompt, enableToolResultSummary)
      this.executor = new Executor(maxRetries, this.store)
      this.registerTaskTool()
      this.registerInboxTool()

      this.observer = new Observer(
        this.store,
        this.context,
        this.promptMachine,
        this.compactionConfig?.compaction_instructions,
        this.compactionConfig?.max_turns,
        this.compactionConfig?.compaction_context_limit,
      )

      this.agent = this.createAgent()

      for (const tool of previousTools) this.executor.registerTool(tool)

      // Re-attach existing subscribers to the freshly-built components so
      // event subscriptions made before build keep firing.
      for (const sub of this.subscribers) {
        this.promptMachine.addSubscriber(sub)
        this.executor.addSubscriber(sub)
        this.observer.addSubscriber(sub)
      }

      this.store_defined = true
    }


    return this
  }

  rebuild(store?: StoreAdapter) {
    this.build(store)
    return this
  }


  /**
   * Hot-swap the model adapter for this session.
   * Only safe to call when no request is in progress.
   */
  setModel(model: ModelAdapter) {
    model.setSystemPrompt(this.promptMachine.systemPrompt);
    this.promptMachine.model = model;
  }

  /**
   * Update the system prompt for this session.
   * Only safe to call when no request is in progress.
   */
  setSystemPrompt(prompt: string) {
    this.promptMachine.systemPrompt = prompt;
    this.promptMachine.model.setSystemPrompt(prompt);
  }

  getSystemPrompt(): string {
    return this.promptMachine.systemPrompt;
  }

  private handOver: HandOverFunction = async (input: unknown) => {
    const obj = input as Record<string, unknown>;
    const renderer = (typeof obj?.renderer === 'string') ? obj.renderer : 'generic';
    return this.displayManager.pushAndWait({
      renderer,
      input,
    })
  }

  async processRequest(request: string | ContentPart[], signal?: AbortSignal) {
    if (!this.built) throw new Error("Call build before processRequest");
    return this.runTurn(async () => {
      await this.prepareTurn(signal)
      return this.runRequest(request, signal)
    }, signal)
  }

  private async runRequest(request: string | ContentPart[], signal?: AbortSignal): Promise<ModelPromptResult | Message> {
    const handOver = this.handOver

    // Pull raw text out of the incoming request so we can scan for tokens.
    let rawText: string;
    let mediaParts: ContentPart[] | undefined;
    if (typeof request === "string") {
      rawText = request;
    } else {
      rawText = request
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("\n");
      mediaParts = request.filter((p) => p.type !== "text");
    }

    // `/hook` and `/skill` directives are parsed and dispatched here.
    // `@mention` tokens are intentionally NOT parsed — they reach the model
    // verbatim and route through the auto-registered `glove_invoke_subagent`
    // tool, mirroring Claude Code's subagent convention.
    const hasDirectives = this.hooks.size > 0 || this.skills.size > 0;

    const parsed = hasDirectives
      ? parseTokens(rawText, {
          hooks: new Set(this.hooks.keys()),
          skills: new Set(this.skills.keys()),
        })
      : { replaced: rawText, hooks: [], skills: [] };

    let workingText = parsed.replaced;
    const controls = this.buildAgentControls();

    // 1. Run hooks in document order.
    for (const name of parsed.hooks) {
      const handler = this.hooks.get(name);
      if (!handler) continue;
      await this.notifyExtensionEvent("hook_invoked", { name });
      const result = await handler({
        name,
        rawText,
        parsedText: workingText,
        controls,
        signal,
      });
      if (!result) continue;
      if (typeof result.rewriteText === "string") {
        workingText = result.rewriteText;
      }
      if (result.shortCircuit) {
        const userMessage = this.buildUserMessage(workingText, mediaParts, request);
        await this.context.appendMessages([userMessage]);
        if ("message" in result.shortCircuit) {
          const m = result.shortCircuit.message;
          await this.context.appendMessages([m]);
          return m;
        }
        // result form
        await this.context.appendMessages(result.shortCircuit.result.messages);
        return result.shortCircuit.result;
      }
    }

    // 2. Materialise skills as synthetic user messages persisted before the
    //    real user message. They show up like any other turn in history.
    for (const name of parsed.skills) {
      const entry = this.skills.get(name);
      if (!entry) continue;
      await this.notifyExtensionEvent("skill_invoked", { name, source: "user" });
      const injection = await entry.handler({
        name,
        parsedText: workingText,
        source: "user",
        controls,
      });
      const skillMessage = formatSkillMessage(name, injection);
      await this.context.appendMessages([skillMessage]);
    }

    // 3. Build the real user message from the placeholder-substituted text
    //    + any original media, then hand off to the agent loop. Any
    //    `@subagent` mentions in the text are visible to the model and
    //    routed through `glove_invoke_subagent`.
    const userMessage = this.buildUserMessage(workingText, mediaParts, request);
    return this.agent.ask(userMessage, handOver, signal)
  }

  private buildUserMessage(
    text: string,
    mediaParts: ContentPart[] | undefined,
    original: string | ContentPart[],
  ): Message {
    if (typeof original === "string") {
      return { sender: "user", text };
    }
    if (!mediaParts || mediaParts.length === 0) {
      return { sender: "user", text };
    }
    const content: ContentPart[] = [];
    if (text.length > 0) content.push({ type: "text", text });
    content.push(...mediaParts);
    return {
      sender: "user",
      text: text.length > 0 ? text : "[multimodal message]",
      content,
    };
  }

  
  
}



