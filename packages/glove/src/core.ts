import { Effect, Either } from "effect";
import z from "zod";
import { splitAtLastCompaction, abortablePromise } from "./utils";

// call model
// model may return tool call requests or text
// if toolcalls finish calls then make request a second time
// if no tool calls then end the flow

// what we need to keep track, - messages, tooks, tool responses.
//

export type NotifySubscribersFunction = (
  event_name: string,
  event_data: unknown,
) => Promise<void>;

export interface SubscriberAdapter {
  record: (event_type: string, data: any) => Promise<void>;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: string;
  content: string;      // imperative: "Run tests"
  activeForm: string;   // continuous: "Running tests"
  status: TaskStatus;
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export type PermissionStatus = "granted" | "denied" | "unset";

// ─── Abort ────────────────────────────────────────────────────────────────────

export class AbortError extends Error {
  constructor(message?: string) {
    super(message ?? "Operation aborted");
    this.name = "AbortError";
  }
}

// ─── Core types ───────────────────────────────────────────────────────────────

export interface ToolResultData {
  data: unknown,
  status: "error" | "success" | "aborted"
  message?: string
  // contains information that won't be sent to the modal but is required for rendering this from history. e.g for a payment form. as data(viewable by the modal, we might not wanna show the address etc and share that with the model) but maybe we want the user to still view all their details on reload of the chat
  // the renderData property is where data that fits this criteria can live. will need a post renderer
  renderData?: unknown
}

export interface ToolResult {
  tool_name: string;
  call_id?: string;
  result: ToolResultData
}

export interface Tool<I> {
  name: string;
  description: string;
  input_schema: z.ZodType<I>;
  requiresPermission?: boolean;
  unAbortable?: boolean;
  run(
    input: I,
    handOver?: (request: unknown) => Promise<unknown>,
  ): Promise<ToolResultData>;
}

export interface ToolCall {
  tool_name: string;
  input_args: unknown;
  id?: string;
}

export interface ContentPart {
  type: "text" | "image" | "video" | "document";
  /** For text parts */
  text?: string;
  /** For media parts (image, video, document) */
  source?: {
    type: "base64" | "url";
    media_type: string;
    data?: string;
    url?: string;
  };
}

export interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  content?: Array<ContentPart>;
  tool_results?: Array<ToolResult>;
  tool_calls?: Array<ToolCall>;
  is_compaction?: boolean;
}

export interface PromptRequest {
  messages: Array<Message>;
  tools?: Array<Tool<unknown>>;
}

export interface ModelPromptResult {
  messages: Array<Message>;
  tokens_in: number;
  tokens_out: number;
  // TODO: other info
}

export interface ModelAdapter {
  name: string;

  prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult>;

  setSystemPrompt(systemPrompt: string): void
}

// custom store for holding all data for the context component
export interface StoreAdapter {
  identifier: string;

  getMessages(): Promise<Array<Message>>

  appendMessages(msgs: Array<Message>): Promise<void>

  getTokenCount(): Promise<number>

  addTokens(count: number): Promise<void>

  getTurnCount(): Promise<number>

  incrementTurn(): Promise<void>

  resetCounters(): Promise<void> // reset token and turn counts without deleting messages

  // Tasks (optional)
  getTasks?(): Promise<Array<Task>>
  addTasks?(tasks: Array<Task>): Promise<void>
  updateTask?(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>): Promise<void>

  // Permissions (optional)
  getPermission?(toolName: string): Promise<PermissionStatus>
  setPermission?(toolName: string, status: PermissionStatus): Promise<void>
}

export class Context {
  store: StoreAdapter;
  constructor(store: StoreAdapter) {
    this.store = store;
  }

  async getMessages() {
    const storedMessages = await this.store.getMessages()
    const afterCompaction = splitAtLastCompaction(storedMessages)
    return afterCompaction
  }

  async appendMessages(msgs: Array<Message>) {
    await this.store.appendMessages(msgs)
  }

  async getTasks(): Promise<Array<Task>> {
    if (!this.store.getTasks) return [];
    return await this.store.getTasks();
  }

  async addTasks(tasks: Array<Task>): Promise<void> {
    if (!this.store.addTasks) return;
    await this.store.addTasks(tasks);
  }

  async updateTask(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>): Promise<void> {
    if (!this.store.updateTask) return;
    await this.store.updateTask(taskId, updates);
  }
}

export class PromptMachine {
  context: Context;
  systemPrompt: string;
  model: ModelAdapter;
  subscribers: Array<SubscriberAdapter> = [];

  constructor(model: ModelAdapter, ctx: Context, systemPrompt: string) {
    this.context = ctx;
    this.systemPrompt = systemPrompt;
    model.setSystemPrompt(systemPrompt);
    this.model = model;
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  removeSubscriber(subscriber: SubscriberAdapter) {
    const idx = this.subscribers.indexOf(subscriber);
    if (idx !== -1) this.subscribers.splice(idx, 1);
  }

  notifySubscribers = async (event_name: string, event_data: unknown) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  async run(messages: Array<Message>, tools?: Array<Tool<unknown>>, signal?: AbortSignal) {
    const result = await this.model.prompt(
      {
        messages,
        tools,
      },
      this.notifySubscribers,
      signal,
    );
    return result;
  }
}

// e.g if a tool call is requesting additional info from the user, perharps will create custom tool for this, but the good thing is this does not need to  be hardcoded into the sdk
export type HandOverFunction = (input: unknown) => Promise<unknown>;

export class Executor {
  tools: Array<Tool<any>> = [];
  toolCallStack: Array<ToolCall> = [];
  subscribers: Array<SubscriberAdapter> = [];
  MAX_RETRIES: number = 3

  private store?: StoreAdapter;

  constructor(MAX_RETRIES?: number, store?: StoreAdapter) {
    this.MAX_RETRIES = MAX_RETRIES ?? 3
    this.store = store;
  }

  private async checkPermission(tool: Tool<any>, input: unknown, handOver?: HandOverFunction): Promise<boolean> {
    if (!tool.requiresPermission) return true;
    if (!this.store?.getPermission || !this.store?.setPermission) return true;

    const status = await this.store.getPermission(tool.name);
    if (status === "granted") return true;
    if (status === "denied") return false;

    // status is "unset" — ask the user via handOver
    if (!handOver) return true;

    const result = await handOver({ renderer: 'permission_request', toolName: tool.name, toolInput: input });
    const allowed = Boolean(result);
    await this.store.setPermission(tool.name, allowed ? "granted" : "denied");
    return allowed;
  }

  registerTool(tool: Tool<any>) {
    this.tools.push(tool);
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  removeSubscriber(subscriber: SubscriberAdapter) {
    const idx = this.subscribers.indexOf(subscriber);
    if (idx !== -1) this.subscribers.splice(idx, 1);
  }

  notifySubscribers = async (event_name: string, event_data: unknown) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };
  addToolCallToStack(call: ToolCall) {
    this.toolCallStack.push(call);
  }

  async executeToolStack(handOver?: HandOverFunction, signal?: AbortSignal) {
    // can send error report back to the agent when it fails

    const toolResults: Array<ToolResult> = [];

    for (const call of this.toolCallStack) {
      const tool = this.tools.find(
        (t) => t.name.toLowerCase() == call.tool_name.toLowerCase(),
      );

      // Skip abortable tools when signal is aborted, but let unAbortable
      // tools through so they run to completion (e.g. checkout form).
      if (signal?.aborted && !tool?.unAbortable) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "aborted",
            message: "Tool execution was aborted by the user.",
            data: null,
          },
        });
        await this.notifySubscribers("tool_use_result", toolResults?.at(-1));
        continue;
      }

      if (!tool) {
        toolResults.push({
          result: {
            status: "error",
            data: null,
            message: `No tool called ${call.tool_name} exists.`,
          },
          tool_name: call.tool_name,
          call_id: call.id,
        });
        await this.notifySubscribers("tool_use_result", toolResults?.at(-1));

        continue;
      }

      const permitted = await this.checkPermission(tool, call.input_args, handOver);
      if (!permitted) {
        toolResults.push({
          tool_name: call.tool_name,
          call_id: call.id,
          result: {
            status: "error",
            message: `Permission denied for tool "${call.tool_name}". The user has not granted permission to run this tool.`,
            data: null,
          },
        });
        await this.notifySubscribers("tool_use_result", toolResults?.at(-1));
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
            data: `Failed to validate the input args provided for the tool:: ${JSON.stringify(z.treeifyError(parsed_input.error))}`,
          },
        });

        await this.notifySubscribers("tool_use_result", toolResults?.at(-1));

        continue;
      }

      let toolRunEffect = Effect.tryPromise({
        try: async () => {
          // Only check abort signal for abortable tools
          if (signal?.aborted && !tool.unAbortable) throw new AbortError();
          const result = tool.unAbortable ?
            await tool.run(parsed_input.data, handOver) :
            await abortablePromise(signal, tool.run(parsed_input.data, handOver));
          return result
        },
        catch(e) {
          return e
        }
      })

      let retriedEffect = Effect.retry(toolRunEffect, {
        times: this.MAX_RETRIES,
        // Allow retries for unAbortable tools even when signal is aborted
        while: () => !signal?.aborted || !!tool.unAbortable,
      })
      let toolResult = await Effect.runPromise(Effect.either(retriedEffect))

      let wasAborted = false;

      Either.match(toolResult, {
        onLeft: (error) => {
          // Detect abort: custom AbortError, native DOMException, or signal already aborted
          const isAbort =
            error instanceof AbortError ||
            (error instanceof Error && error.name === "AbortError") ||
            signal?.aborted;

          if (isAbort) {
            wasAborted = true;
            toolResults.push({
              tool_name: call.tool_name,
              call_id: call.id,
              result: {
                status: "aborted",
                message: "Tool execution was aborted by the user.",
                data: null,
              },
            });
            this.notifySubscribers("tool_use_result", toolResults?.at(-1));
            return;
          }

          toolResults.push({
            tool_name: call.tool_name,
            call_id: call.id,
            result: {
              status: "error",
              message:
                `Failed to run tool successfully. Tool Errored out with ${error}, after ${this.MAX_RETRIES}/${this.MAX_RETRIES} retries. ABORT EXECUTION`,
              data: null,
            },
          });

          this.notifySubscribers("tool_use_result", toolResults?.at(-1));
        },
        onRight: (value: ToolResultData) => {
          toolResults.push({
            tool_name: call.tool_name,
            call_id: call.id,
            result: value,
          });

          this.notifySubscribers("tool_use_result", toolResults?.at(-1));
        },
      })

      // Exit the loop if aborted (only for abortable tools)
      if (wasAborted) break;

    }

    this.toolCallStack = [];

    return toolResults;
  }
}

export class Observer {
  MAX_TURNS: number = 120;
  CONTEXT_COMPACTION_LIMIT = 100_000; // number of tokens probably needs to be configurable per ai
  COMPACTION_INSTRUCTIONS: string;
  store: StoreAdapter;
  context: Context;
  prompt: PromptMachine;

  constructor(
    store: StoreAdapter,
    ctx: Context,
    prmpt: PromptMachine,
    compaction_instructions: string,
    max_turns?: number,
    context_compaction_limit?: number
  ) {
    this.store = store;
    this.MAX_TURNS = max_turns ?? this.MAX_TURNS;
    this.context = ctx;
    this.prompt = prmpt;
    this.COMPACTION_INSTRUCTIONS = compaction_instructions;
    this.CONTEXT_COMPACTION_LIMIT = context_compaction_limit ?? this.CONTEXT_COMPACTION_LIMIT;
  }

  setCompactionInstructions(instruction: string) {
    this.COMPACTION_INSTRUCTIONS = instruction;
  }

  setMaxTurns(new_max: number) {
    this.MAX_TURNS = new_max;
  }

  setContextCompactionLimit(new_compaction_limit: number) {
    this.CONTEXT_COMPACTION_LIMIT = new_compaction_limit;
  }
  async turnComplete() {
    await this.store.incrementTurn();
  }

  async getCurrentTurns() {
    const current_turns = await this.store.getTurnCount();
    return current_turns ?? 0;
  }

  async addTokensConsumed(token_count: number) {
    await this.store.addTokens(token_count)
  }

  async getCurrentTokenConsumption() {
    const res = await this.store.getTokenCount() 
    return res
  }

  async tryCompaction() {
    const current_token_consumption = await this.getCurrentTokenConsumption();

    if (current_token_consumption < this.CONTEXT_COMPACTION_LIMIT) return;

    const history = await this.context.getMessages()

    const compactionRequest: Message = {
      sender: 'user',
      text: this.COMPACTION_INSTRUCTIONS,
    }

    const combinedMessages = [...history, compactionRequest]

    await this.store.resetCounters()

    const result = await this.prompt.run(combinedMessages);


    const summaryText = result.messages.filter((m)=> m.sender == "agent").map(m => m.text)?.join("\n") || "No summary was generated"

    // Preserve current task state across compaction
    const currentTasks = await this.context.getTasks();
    let taskBlock = "";
    if (currentTasks.length > 0) {
      const taskLines = currentTasks.map(
        (t) => `- [${t.status}] ${t.content}`
      );
      taskBlock =
        `\n\n[Current task list — you MUST call glove_update_tasks to update these as you continue]\n` +
        taskLines.join("\n") + "\n";
    }

    const summaryMessage: Message = {
      sender: "user",
      text: `[Conversation summary from compaction]\n\n${summaryText}${taskBlock}\n\n` +
        `[End of summary - the conversation continues from here]`,
      is_compaction: true
    }

    await this.context.appendMessages([summaryMessage])
    await this.store.addTokens(result.tokens_in + result.tokens_out)

  
    
  }
}

export class Agent {
  store: StoreAdapter;
  executor: Executor;
  context: Context;
  observer: Observer;
  prompt_machine: PromptMachine;

  constructor(
    store: StoreAdapter,
    executor: Executor,
    context: Context,
    observer: Observer,
    prompt_machine: PromptMachine,
  ) {
    this.store = store;
    this.executor = executor;
    this.context = context;
    this.observer = observer;
    this.prompt_machine = prompt_machine;
  }

  async ask(message: Message, handOver?: HandOverFunction, signal?: AbortSignal) {
    await this.context.appendMessages([message]);

    // Per-request turn counter to prevent runaway loops.
    // The observer's session-level counter is still incremented for stats.
    let requestTurns = 0;

    while (true) {
      if (signal?.aborted) throw new AbortError();

      let messages = await this.context.getMessages();

      if (requestTurns >= this.observer.MAX_TURNS) {
        const errorMsg: Message = {
          sender: "agent",
          text: `Reached the maximum number of turns (${this.observer.MAX_TURNS}) for this request. Please send a new message to continue.`,
        };
        await this.context.appendMessages([errorMsg]);
        return { messages: [errorMsg], tokens_in: 0, tokens_out: 0 } as ModelPromptResult;
      }

      let results = await this.prompt_machine.run(
        messages,
        this.executor.tools,
        signal,
      );

      if (signal?.aborted) throw new AbortError();

      await this.context.appendMessages(results.messages);
      await this.observer.addTokensConsumed(results.tokens_in);
      await this.observer.turnComplete();
      requestTurns++;

      const messages_with_tool_calls = results.messages.filter(
        (m) => (m.tool_calls?.length ?? 0) > 0,
      );

      if (messages_with_tool_calls.length == 0) {
        // Auto-complete any in_progress tasks when the agent's turn ends
        await this.autoCompleteTasks();
        return results;
      }

      for (const message of messages_with_tool_calls) {
        for (const tool_call of message.tool_calls ?? []) {
          this.executor.addToolCallToStack(tool_call);
        }
      }

      let tool_results = await this.executor.executeToolStack(handOver, signal);

      if (signal?.aborted) throw new AbortError();

      // Append tool_results to context BEFORE compaction so the history
      // always contains matched tool_use / tool_result pairs.  If we
      // compacted first the agent's tool_use message could be summarised
      // away while its tool_results hadn't been stored yet, leaving
      // orphaned IDs that the Anthropic API rejects.
      const toolResultMessage: Message = {
        sender: "user",
        text: "tool results",
        tool_results,
      };
      await this.context.appendMessages([toolResultMessage]);

      await this.observer.tryCompaction();
    }
  }

  private async autoCompleteTasks() {
    const tasks = await this.context.getTasks();
    if (tasks.length === 0) return;

    const hasIncomplete = tasks.some((t) => t.status === "in_progress");
    if (!hasIncomplete) return;

    const updated = tasks.map((t) =>
      t.status === "in_progress" ? { ...t, status: "completed" as const } : t,
    );
    await this.context.addTasks(updated);
  }
}
