import z from "zod";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Events & Subscribers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type NotifySubscribersFunction = (
  event_name: string,
  event_data: unknown,
) => Promise<void>;

export interface SubscriberAdapter {
  record: (event_type: string, data: any) => Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tool system
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ToolResult {
  tool_name: string;
  call_id?: string;
  result: {
    data: unknown;
    status: "error" | "success";
    message?: string;
  };
}

export interface Tool<I> {
  name: string;
  description: string;
  input_schema: z.ZodType<I>;
  run(
    input: I,
    handOver?: (request: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

export interface ToolCall {
  tool_name: string;
  input_args: unknown;
  id?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  tool_results?: Array<ToolResult>;
  tool_calls?: Array<ToolCall>;
}

export interface PromptRequest {
  messages: Array<Message>;
  tools?: Array<Tool<unknown>>;
}

export interface ModelPromptResult {
  messages: Array<Message>;
  tokens_in: number;
  tokens_out: number;
}

export interface ModelAdapter {
  name: string;
  prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Store — typed interface, no more generic get/set
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Typed store contract. Implementations (memory, sqlite, redis, etc.)
 * provide these specific operations instead of generic key-value access.
 *
 * This prevents mistyped keys, wrong value types, and split-ownership bugs.
 */
export interface StoreAdapter {
  identifier: string;

  // ── Messages ─────────────────────────────────────────────────
  /** Get the full message history */
  getMessages(): Promise<Array<Message>>;

  /** Append messages to the end of the history */
  appendMessages(msgs: Array<Message>): Promise<void>;

  /** Replace the entire message history (used by compaction) */
  replaceMessages(msgs: Array<Message>): Promise<void>;

  // ── Counters ─────────────────────────────────────────────────
  /** Get total tokens consumed across all turns */
  getTokenCount(): Promise<number>;

  /** Add to the running token total */
  addTokens(count: number): Promise<void>;

  /** Get number of completed turns */
  getTurnCount(): Promise<number>;

  /** Increment the turn counter by 1 */
  incrementTurn(): Promise<void>;

  // ── Lifecycle ────────────────────────────────────────────────
  /** Reset counters after compaction (preserves messages) */
  resetCounters(): Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MemoryStore — reference in-memory implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Array<Message> = [];
  private tokenCount: number = 0;
  private turnCount: number = 0;

  constructor(id: string) {
    this.identifier = id;
  }

  async getMessages() {
    return [...this.messages];
  }

  async appendMessages(msgs: Array<Message>) {
    this.messages.push(...msgs);
  }

  async replaceMessages(msgs: Array<Message>) {
    this.messages = [...msgs];
  }

  async getTokenCount() {
    return this.tokenCount;
  }

  async addTokens(count: number) {
    this.tokenCount += count;
  }

  async getTurnCount() {
    return this.turnCount;
  }

  async incrementTurn() {
    this.turnCount += 1;
  }

  async resetCounters() {
    this.tokenCount = 0;
    this.turnCount = 0;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Context — single owner of message history, append-only with guarantees
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class Context {
  private store: StoreAdapter;

  constructor(store: StoreAdapter) {
    this.store = store;
  }

  /**
   * Append messages to the history.
   *
   * Enforces: no consecutive same-role messages at the boundary.
   * If the last stored message and the first new message share a role,
   * we merge them rather than creating an invalid sequence.
   */
  async append(msgs: Array<Message>): Promise<void> {
    if (msgs.length === 0) return;

    const existing = await this.store.getMessages();
    const last = existing[existing.length - 1];
    const first = msgs[0];

    // If roles collide at the boundary, merge the first new message
    // into the last existing one
    if (last && first && last.sender === first.sender) {
      const merged = this.mergeMessages(last, first);
      const updated = [...existing.slice(0, -1), merged, ...msgs.slice(1)];
      await this.store.replaceMessages(updated);
    } else {
      await this.store.appendMessages(msgs);
    }
  }

  /** Get the full message history (read-only snapshot) */
  async getMessages(): Promise<Array<Message>> {
    return this.store.getMessages();
  }

  /**
   * Replace the entire history. Used only by compaction.
   * Accepts a summary message that becomes the new starting point.
   */
  async replaceWithSummary(summaryMessages: Array<Message>): Promise<void> {
    await this.store.replaceMessages(summaryMessages);
  }

  /** Merge two same-role messages into one */
  private mergeMessages(a: Message, b: Message): Message {
    return {
      sender: a.sender,
      text: [a.text, b.text].filter(Boolean).join("\n"),
      ...(a.tool_calls || b.tool_calls
        ? { tool_calls: [...(a.tool_calls ?? []), ...(b.tool_calls ?? [])] }
        : {}),
      ...(a.tool_results || b.tool_results
        ? {
            tool_results: [
              ...(a.tool_results ?? []),
              ...(b.tool_results ?? []),
            ],
          }
        : {}),
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PromptMachine — thin wrapper around model calls
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class PromptMachine {
  systemPrompt: string;
  model: ModelAdapter;
  subscribers: Array<SubscriberAdapter> = [];

  constructor(model: ModelAdapter, systemPrompt: string) {
    this.systemPrompt = systemPrompt;
    this.model = model;
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  notifySubscribers = async (event_name: string, event_data: unknown) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  async run(messages: Array<Message>, tools?: Array<Tool<unknown>>) {
    return this.model.prompt({ messages, tools }, this.notifySubscribers);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Executor — tool registry + execution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type HandOverToAddContext = (input: unknown) => Promise<unknown>;

export class Executor {
  tools: Array<Tool<any>> = [];
  private toolCallStack: Array<ToolCall> = [];
  subscribers: Array<SubscriberAdapter> = [];

  registerTool(tool: Tool<any>) {
    // Prevent duplicate tool names
    if (this.tools.some((t) => t.name === tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.push(tool);
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  notifySubscribers = async (event_name: string, event_data: unknown) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  addToolCallToStack(call: ToolCall) {
    this.toolCallStack.push(call);
  }

  async executeToolStack(askHuman?: HandOverToAddContext) {
    const toolResults: Array<ToolResult> = [];

    for (const call of this.toolCallStack) {
      const tool = this.tools.find(
        (t) => t.name.toLowerCase() === call.tool_name.toLowerCase(),
      );

      if (!tool) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "error",
            data: null,
            message: `No tool called ${call.tool_name} exists. Available tools: ${this.tools.map((t) => t.name).join(", ")}`,
          },
        });
        await this.notifySubscribers("tool_use_result", toolResults.at(-1));
        continue;
      }

      const parsed_input = tool.input_schema.safeParse(call.input_args);

      if (!parsed_input.success) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "error",
            message: "TOOL_INPUT_INVALID",
            data: `Failed to validate input: ${JSON.stringify(z.treeifyError(parsed_input.error))}`,
          },
        });
        await this.notifySubscribers("tool_use_result", toolResults.at(-1));
        continue;
      }

      try {
        const result = await tool.run(parsed_input.data, askHuman);
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: { status: "success", data: result },
        });
        await this.notifySubscribers("tool_use_result", toolResults.at(-1));
      } catch (e) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "error",
            message: `Tool errored: ${e instanceof Error ? e.message : String(e)}`,
            data: null,
          },
        });
        await this.notifySubscribers("tool_use_result", toolResults.at(-1));
      }
    }

    this.toolCallStack = [];
    return toolResults;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Observer — owns ONLY the compaction decision and execution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CompactionConfig {
  /** Token threshold that triggers compaction */
  tokenLimit: number;

  /** Instructions sent to the model for summarizing the conversation */
  instructions: string;
}

export class Observer {
  private config: CompactionConfig;
  private store: StoreAdapter;
  private context: Context;
  private prompt: PromptMachine;

  constructor(
    store: StoreAdapter,
    context: Context,
    prompt: PromptMachine,
    config: CompactionConfig,
  ) {
    this.store = store;
    this.context = context;
    this.prompt = prompt;
    this.config = config;
  }

  /** Update compaction config at runtime */
  setConfig(update: Partial<CompactionConfig>) {
    this.config = { ...this.config, ...update };
  }

  /**
   * Check if compaction is needed and execute it.
   *
   * Compaction:
   * 1. Sends the full history + compaction instructions to the model
   * 2. Gets a summary back
   * 3. Replaces the message history with the summary
   * 4. Resets token/turn counters
   *
   * The summary becomes a "user" message so the conversation
   * can continue naturally with alternating roles.
   */
  async tryCompaction(): Promise<boolean> {
    const tokenCount = await this.store.getTokenCount();

    if (tokenCount < this.config.tokenLimit) {
      return false;
    }

    // Get current history and append compaction request
    const history = await this.context.getMessages();

    const compactionRequest: Message = {
      sender: "user",
      text: this.config.instructions,
    };

    const allMessages = [...history, compactionRequest];

    // Ask the model to summarize
    const result = await this.prompt.run(allMessages);

    // Extract the summary text
    const summaryText =
      result.messages
        .filter((m) => m.sender === "agent")
        .map((m) => m.text)
        .join("\n") || "No summary generated.";

    // Replace history with a single user message containing the summary.
    // This preserves the "user starts" invariant for the next model call.
    const summaryMessage: Message = {
      sender: "user",
      text:
        `[Conversation summary from compaction]\n\n${summaryText}\n\n` +
        `[End of summary — the conversation continues from here]`,
    };

    await this.context.replaceWithSummary([summaryMessage]);
    await this.store.resetCounters();

    // Account for the compaction call's own token usage
    await this.store.addTokens(result.tokens_in + result.tokens_out);

    return true;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent — the while loop orchestrator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AgentConfig {
  /** Maximum turns before the agent stops. Default: 50 */
  maxTurns?: number;

  /**
   * Maximum consecutive tool errors before bailing.
   * Prevents infinite loops when the model keeps calling a broken tool.
   * Default: 3
   */
  maxConsecutiveErrors?: number;
}

export class Agent {
  private store: StoreAdapter;
  private executor: Executor;
  private context: Context;
  private observer: Observer;
  private promptMachine: PromptMachine;
  private maxTurns: number;
  private maxConsecutiveErrors: number;

  constructor(
    store: StoreAdapter,
    executor: Executor,
    context: Context,
    observer: Observer,
    promptMachine: PromptMachine,
    config?: AgentConfig,
  ) {
    this.store = store;
    this.executor = executor;
    this.context = context;
    this.observer = observer;
    this.promptMachine = promptMachine;
    this.maxTurns = config?.maxTurns ?? 50;
    this.maxConsecutiveErrors = config?.maxConsecutiveErrors ?? 3;
  }

  async ask(
    message: Message,
    delegateToCaller?: HandOverToAddContext,
  ): Promise<ModelPromptResult | Message> {
    let _message = message;
    let consecutiveErrors = 0;

    while (true) {
      // ── 1. Store the incoming message and get full history ─────
      await this.context.append([_message]);
      const history = await this.context.getMessages();

      // ── 2. Check turn limit ───────────────────────────────────
      const turnCount = await this.store.getTurnCount();
      if (turnCount >= this.maxTurns) {
        return {
          messages: [
            {
              sender: "agent",
              text: `Reached the maximum of ${this.maxTurns} turns. Stopping.`,
            },
          ],
          tokens_in: 0,
          tokens_out: 0,
        };
      }

      // ── 3. Call the model ─────────────────────────────────────
      const result = await this.promptMachine.run(
        history,
        this.executor.tools,
      );

      // ── 4. Store the model's response and update counters ─────
      await this.context.append(result.messages);
      await this.store.addTokens(result.tokens_in + result.tokens_out);
      await this.store.incrementTurn();

      // ── 5. Check for tool calls ───────────────────────────────
      const toolCallMessages = result.messages.filter(
        (m) => (m.tool_calls?.length ?? 0) > 0,
      );

      // No tool calls → we're done, return the response
      if (toolCallMessages.length === 0) {
        return result;
      }

      // ── 6. Queue and execute tool calls ───────────────────────
      for (const msg of toolCallMessages) {
        for (const tc of msg.tool_calls ?? []) {
          this.executor.addToolCallToStack(tc);
        }
      }

      const toolResults =
        await this.executor.executeToolStack(delegateToCaller);

      // ── 7. Circuit breaker — detect consecutive errors ────────
      const allErrors = toolResults.every(
        (r) => r.result.status === "error",
      );

      if (allErrors) {
        consecutiveErrors++;
        if (consecutiveErrors >= this.maxConsecutiveErrors) {
          // Inform the model it needs to stop
          _message = {
            sender: "user",
            text:
              `Tool calls have failed ${consecutiveErrors} times in a row. ` +
              `Stop calling tools and explain what went wrong to the user.`,
            tool_results: toolResults,
          };
          continue;
        }
      } else {
        consecutiveErrors = 0;
      }

      // ── 8. Attempt compaction if needed ────────────────────────
      await this.observer.tryCompaction();

      // ── 9. Feed tool results back as next user message ────────
      _message = {
        sender: "user",
        text: "tool results",
        tool_results: toolResults,
      };
    }
  }
}
