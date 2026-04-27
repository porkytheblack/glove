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
  readonly displayManager: DisplayManagerAdapter
  readonly model: ModelAdapter
  readonly serverMode: boolean
}


interface IGloveBuilder {
  fold: <I>(args: GloveFoldArgs<I>) => IGloveBuilder,
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

    let message: Message;
    if (typeof request === "string") {
      message = { sender: "user", text: request };
    } else {
      // Extract text from content parts for the text field (fallback/summary)
      const textParts = request
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!);
      message = {
        sender: "user",
        text: textParts.join("\n") || "[multimodal message]",
        content: request,
      };
    }

    return this.agent.ask(message, handOver, signal)
  }

  
  
}






