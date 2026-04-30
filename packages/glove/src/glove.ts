// glove
// closed - tool registering
// open - tools that need to collect information from the user
// allow for resumption - e.g if it's a social login and the user's done logging in
// how do you achieve undos? include something in the do, that can be undone

import z from "zod";
import { Agent, ContentPart, Context, Executor, HandOverFunction, Message, ModelAdapter, ModelPromptResult, Observer, PromptMachine, StoreAdapter, SubscriberAdapter, Tool, ToolResultData } from "./core";
import { DisplayManagerAdapter } from "./display-manager";
import { createTaskTool } from "./tools/task-tool";
import { createInboxTool } from "./tools/inbox-tool";
import {
  AgentControls,
  createSkillInvokeTool,
  DefineSkillArgs,
  formatSkillMessage,
  HookHandler,
  MentionHandler,
  parseTokens,
  RegisteredSkill,
  renderSkillToolDescription,
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
   * The third argument is the running `Glove` instance. Use it from tools that
   * need to fold additional tools at runtime (e.g. the discovery subagent's
   * activate tool). Existing tools can ignore it.
   */
  do: (
    input: I,
    display: DisplayManagerAdapter,
    glove: IGloveRunnable,
  ) => Promise<ToolResultData>,
}

export interface IGloveRunnable {
  processRequest: (request: string | ContentPart[], signal?: AbortSignal) => Promise<ModelPromptResult | Message>
  setModel: (model: ModelAdapter) => void
  setSystemPrompt: (prompt: string) => void
  addSubscriber: (subscriber: SubscriberAdapter) => void
  removeSubscriber: (subscriber: SubscriberAdapter) => void
  /** Fold a tool. Legal at any time, including after build. */
  fold: <I>(args: GloveFoldArgs<I>) => IGloveRunnable
  /** Register a `/name` hook that can mutate agent state or short-circuit a turn. */
  defineHook: (name: string, handler: HookHandler) => IGloveRunnable
  /** Register a `/name` skill that injects context as a synthetic user message. */
  defineSkill: (args: DefineSkillArgs) => IGloveRunnable
  /** Register an `@name` mention that routes the request to a custom handler. */
  defineMention: (name: string, handler: MentionHandler) => IGloveRunnable
  readonly displayManager: DisplayManagerAdapter
  readonly model: ModelAdapter
  readonly serverMode: boolean
}


interface IGloveBuilder {
  fold: <I>(args: GloveFoldArgs<I>) => IGloveBuilder,
  defineHook: (name: string, handler: HookHandler) => IGloveBuilder,
  defineSkill: (args: DefineSkillArgs) => IGloveBuilder,
  defineMention: (name: string, handler: MentionHandler) => IGloveBuilder,
  addSubscriber: (subscriber: SubscriberAdapter) => IGloveBuilder,
  build: ()=> IGloveRunnable
}

interface CompactionConfig {
  max_turns?: number,
  compaction_instructions: string,
  compaction_context_limit?: number
}


interface GloveConfig {
  store: StoreAdapter,
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
}


export class Glove implements IGloveBuilder, IGloveRunnable {

  readonly displayManager: DisplayManagerAdapter
  readonly serverMode: boolean
  private store: StoreAdapter
  private context: Context
  private promptMachine: PromptMachine
  private observer: Observer
  private executor: Executor
  private agent: Agent

  private hooks = new Map<string, HookHandler>()
  private skills = new Map<string, RegisteredSkill>()
  private mentions = new Map<string, MentionHandler>()
  private skillInvokeTool: Tool<unknown> | null = null

  private built = false


  constructor(config: GloveConfig) {
    this.store = config.store
    this.displayManager = config.displayManager
    this.serverMode = config.serverMode ?? false

    this.context = new Context(this.store)
    this.promptMachine = new PromptMachine(config.model, this.context,config.systemPrompt)
    this.executor = new Executor(config.maxRetries, this.store)

    this.observer = new Observer(this.store, this.context, this.promptMachine, config.compaction_config?.compaction_instructions, config.compaction_config?.max_turns, config.compaction_config?.compaction_context_limit)

    this.agent = new Agent(
      this.store,
      this.executor,
      this.context,
      this.observer,
      this.promptMachine
    )

    // Auto-register task tool when the store supports tasks
    if (this.store.getTasks && this.store.addTasks) {
      this.executor.registerTool(createTaskTool(this.context));
    }

    // Auto-register inbox tool when the store supports inbox
    if (this.store.getInboxItems && this.store.addInboxItem && this.store.updateInboxItem && this.store.getResolvedInboxItems) {
      this.executor.registerTool(createInboxTool(this.context));
    }
  }

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
      async run(input: I) {
        const result = await args.do(input, displayManager, self)

        return result
      }

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
        ) as Tool<unknown>
        this.executor.registerTool(this.skillInvokeTool)
      } else {
        this.skillInvokeTool.description = renderSkillToolDescription(this.skills)
      }
    }

    return this
  }

  defineMention(name: string, handler: MentionHandler) {
    this.mentions.set(name, handler)
    return this
  }

  private buildAgentControls(): AgentControls {
    return {
      context: this.context,
      observer: this.observer,
      promptMachine: this.promptMachine,
      executor: this.executor,
      glove: this,
      forceCompaction: () => this.observer.runCompactionNow(),
    }
  }

  get model(): ModelAdapter {
    return this.promptMachine.model
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.promptMachine.addSubscriber(subscriber)
    this.executor.addSubscriber(subscriber)
    this.observer.addSubscriber(subscriber)

    return this
  }

  removeSubscriber(subscriber: SubscriberAdapter) {
    this.promptMachine.removeSubscriber(subscriber)
    this.executor.removeSubscriber(subscriber)
    this.observer.removeSubscriber(subscriber)
  }


  build(): IGloveRunnable {
    this.built = true;

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

    const hasExtensions =
      this.hooks.size > 0 || this.skills.size > 0 || this.mentions.size > 0;

    const parsed = hasExtensions
      ? parseTokens(rawText, {
          hooks: new Set(this.hooks.keys()),
          skills: new Set(this.skills.keys()),
          mentions: new Set(this.mentions.keys()),
        })
      : { stripped: rawText, hooks: [], skills: [], mention: null as string | null };

    let workingText = parsed.stripped;
    const controls = this.buildAgentControls();

    // 1. Run hooks in document order.
    for (const name of parsed.hooks) {
      const handler = this.hooks.get(name);
      if (!handler) continue;
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
      const injection = await entry.handler({
        name,
        parsedText: workingText,
        source: "user",
        controls,
      });
      const skillMessage = formatSkillMessage(name, injection);
      await this.context.appendMessages([skillMessage]);
    }

    // 3. Build the real user message from stripped text + any original media.
    const userMessage = this.buildUserMessage(workingText, mediaParts, request);

    // 4. Mentions short-circuit the local agent loop.
    if (parsed.mention) {
      const handler = this.mentions.get(parsed.mention);
      if (handler) {
        // Persist the user message so transcripts include it before handing off.
        await this.context.appendMessages([userMessage]);
        return handler({
          name: parsed.mention,
          message: userMessage,
          controls,
          handOver,
          signal,
        });
      }
    }

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
    // No media: degenerate to a plain-text user message with stripped text.
    // Never fall back to `original` — that would re-introduce stripped tokens.
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






