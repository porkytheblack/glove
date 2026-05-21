// glove
// closed - tool registering
// open - tools that need to collect information from the user
// allow for resumption - e.g if it's a social login and the user's done logging in
// how do you achieve undos? include something in the do, that can be undone

import z from "zod";
import { Agent, ContentPart, Context, Executor, HandOverFunction, Message, ModelAdapter, ModelPromptResult, NotifySubscribersFunction, Observer, PromptMachine, StoreAdapter, SubscriberAdapter, Tool, ToolResultData } from "./core";
import { MemoryStore } from "./utils";
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
  requiresPermission?: boolean,
  unAbortable?: boolean,
  /**
   * Tool implementation.
   *
   * Arguments:
   * - `input` — validated input matching `inputSchema` / `jsonSchema`.
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

export interface IGloveRunnable {
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
}


interface IGloveBuilder {
  fold: <I>(args: GloveFoldArgs<I>) => IGloveBuilder,
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
  enableToolResultSummary?: boolean
}


export class Glove implements IGloveBuilder, IGloveRunnable {

  private _displayManager: DisplayManagerAdapter
  readonly serverMode: boolean
  private store: StoreAdapter
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

  private subscribers: Array<SubscriberAdapter> = []
  private compactionConfig: CompactionConfig

  private store_defined = false
  private built = false


  constructor(config: GloveConfig) {
    if (config.store) {
      this.store = config.store
      this.store_defined = true
    } else {
      this.store = new MemoryStore(`glove_${Date.now()}`)
    }
    this._displayManager = config.displayManager
    this.serverMode = config.serverMode ?? false
    this.compactionConfig = config.compaction_config

    this.context = new Context(this.store)
    this.promptMachine = new PromptMachine(config.model, this.context,config.systemPrompt, config.enableToolResultSummary)
    this.executor = new Executor(config.maxRetries, this.store)

    this.observer = new Observer(this.store, this.context, this.promptMachine, this.compactionConfig?.compaction_instructions, this.compactionConfig?.max_turns, this.compactionConfig?.compaction_context_limit)

    this.agent = new Agent(
      this.store,
      this.executor,
      this.context,
      this.observer,
      this.promptMachine
    )

  }

  private notifyExtensionEvent: NotifySubscribersFunction = async (event_name, event_data) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  fold<I>(args: GloveFoldArgs<I>) {
    if (!args.inputSchema && !args.jsonSchema) {
      throw new Error(`Tool "${args.name}" must provide inputSchema or jsonSchema`);
    }

    const displayManager = this.displayManager;
    const self = this;

    const tool: Tool<I> = {
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

    this.executor.registerTool(tool)
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
      const previousTools = this.executor.tools;
      const maxRetries = this.executor.MAX_RETRIES;
      const model = this.promptMachine.model;
      const systemPrompt = this.promptMachine.systemPrompt;
      const enableToolResultSummary = this.promptMachine.enableToolResultSummary;

      this.store = store;
      this.context = new Context(this.store)
      this.promptMachine = new PromptMachine(model, this.context, systemPrompt, enableToolResultSummary)
      this.executor = new Executor(maxRetries, this.store)

      this.observer = new Observer(
        this.store,
        this.context,
        this.promptMachine,
        this.compactionConfig?.compaction_instructions,
        this.compactionConfig?.max_turns,
        this.compactionConfig?.compaction_context_limit,
      )

      this.agent = new Agent(
        this.store,
        this.executor,
        this.context,
        this.observer,
        this.promptMachine
      )

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

  async processRequest(request: string | ContentPart[], signal?: AbortSignal) {
    if (!this.built) throw new Error("Call build before processRequest");

    const handOver: HandOverFunction = async (input: unknown)=> {
      const obj = input as Record<string, unknown>;
      const renderer = (typeof obj?.renderer === 'string') ? obj.renderer : 'generic';
      return this.displayManager.pushAndWait({
        renderer,
        input,
      })
    }

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






