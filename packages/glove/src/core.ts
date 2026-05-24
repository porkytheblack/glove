import { Effect, Either } from "effect";
import z from "zod";
import { splitAtLastCompaction, abortablePromise } from "./utils";

// call model
// model may return tool call requests or text
// if toolcalls finish calls then make request a second time
// if no tool calls then end the flow

// what we need to keep track, - messages, tooks, tool responses.
//

// ─── Subscriber Events ───────────────────────────────────────────────────────

/**
 * Discriminated union of all events that flow through the subscriber system.
 *
 * **Model events** (emitted by ModelAdapter during prompt execution):
 * - `text_delta` — Streaming text chunk from the model
 * - `tool_use` — Model is invoking a tool
 * - `model_response` — Complete model response (sync/non-streaming adapters)
 * - `model_response_complete` — Final model response after streaming completes
 *
 * **Executor events** (emitted during tool execution):
 * - `tool_use_result` — Result of a tool execution (success, error, or aborted)
 *
 * **Observer events** (emitted during context compaction):
 * - `compaction_start` — Context compaction has begun
 * - `compaction_end` — Context compaction has finished
 *
 * **Extension events** (emitted by Glove when hooks, skills, and subagents fire):
 * - `hook_invoked` — A `/name` hook handler is about to run (emitted by Glove)
 * - `skill_invoked` — A skill handler is about to run, user-side `/name` or agent-side `glove_invoke_skill` (emitted by Glove and the skill dispatch tool respectively)
 * - `subagent_invoked` — A subagent's child Glove run is about to start (emitted by Executor — see `SUBAGENT_DISPATCH_TOOL_NAME`)
 * - `subagent_completed` — A subagent's child Glove run has finished (emitted by Executor)
 *
 * The `subagent_invoked` / `subagent_completed` pair brackets every
 * subagent run with **guaranteed 1:1 symmetry** — the Executor fires both
 * events around `glove_invoke_subagent` calls, so a parent abort that
 * cuts the dispatcher's promise chain still produces a matching close
 * bracket. Events emitted by the child Glove between them belong to that
 * subagent (parent subscribers are attached to the child for the duration
 * of the run).
 */
export type SubscriberEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "model_response"; text: string; tool_calls?: ToolCall[]; stop_reason?: string; tokens_in?: number; tokens_out?: number }
  | { type: "model_response_complete"; text: string; tool_calls?: ToolCall[]; stop_reason?: string; tokens_in?: number; tokens_out?: number }
  | { type: "tool_use_result"; tool_name: string; call_id?: string; result: ToolResultData }
  | { type: "compaction_start"; current_token_consumption: number }
  | { type: "compaction_end"; current_token_consumption: number; summary_message: Message }
  | { type: "token_consumption"; consumption: TokenConsumptionCounter }
  | { type: "hook_invoked"; name: string }
  | { type: "skill_invoked"; name: string; source: "user" | "agent"; args?: string }
  | { type: "subagent_invoked"; name: string; prompt: string }
  | { type: "subagent_completed"; name: string; status: "success" | "error"; message?: string };

/** Extract a single event by its type field. */
export type SubscriberEventOf<T extends SubscriberEvent["type"]> =
  Extract<SubscriberEvent, { type: T }>;

/** Map from event type to its data shape (without the `type` field). */
export type SubscriberEventDataMap = {
  [E in SubscriberEvent as E["type"]]: Omit<E, "type">;
};

/**
 * Function signature for notifying subscribers of events.
 *
 * Model adapters receive this as the `notify` parameter in `prompt()`.
 * Call it to emit streaming events (text_delta, tool_use, model_response_complete).
 *
 * @example
 * ```typescript
 * // Inside a custom ModelAdapter.prompt():
 * await notify("text_delta", { text: chunk });
 * await notify("tool_use", { id: "call_1", name: "get_weather", input: { city: "NYC" } });
 * await notify("model_response_complete", { text: fullText, tool_calls, stop_reason: "end_turn" });
 * ```
 */
export type NotifySubscribersFunction = <T extends SubscriberEvent["type"]>(
  event_name: T,
  event_data: SubscriberEventDataMap[T],
) => Promise<void>;

/**
 * Interface for receiving subscriber events from the Glove pipeline.
 *
 * Implement this to build custom event handlers for logging, analytics,
 * streaming UI updates, or any side effect driven by pipeline events.
 *
 * @example
 * ```typescript
 * const logger: SubscriberAdapter = {
 *   async record(event_type, data) {
 *     switch (event_type) {
 *       case "text_delta":
 *         console.log("Text:", data.text);
 *         break;
 *       case "tool_use":
 *         console.log(`Tool: ${data.name}(${JSON.stringify(data.input)})`);
 *         break;
 *       case "model_response_complete":
 *         console.log("Response complete:", data.text);
 *         break;
 *       case "tool_use_result":
 *         console.log(`Result [${data.result.status}]:`, data.result.data);
 *         break;
 *     }
 *   },
 * };
 * ```
 */
export interface SubscriberAdapter {
  record: <T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ) => Promise<void>;
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
  // for eager compaction generated summaries
  summary?: string
  // 
  generateSummaryArgs?: unknown
}

export interface ToolResult {
  tool_name: string;
  call_id?: string;
  result: ToolResultData
}

export interface Tool<I> {
  name: string;
  description: string;
  /** Zod schema — preferred for tools you author. Validated locally on input. */
  input_schema?: z.ZodType<I>;
  /** Raw JSON Schema — for bridged tools (MCP, OpenAPI). Skips local validation. */
  jsonSchema?: Record<string, unknown>;
  /**
   * Gate the tool behind a permission check.
   *
   * - `boolean` — applies to every invocation regardless of input.
   * - `(input) => boolean` — called with the model-supplied input on every
   *   call; return `true` to require a permission check for THIS call,
   *   `false` to skip the check entirely (e.g. read-only bash commands).
   *
   * When the gate is on, the store is consulted via `getPermission(name, input)`
   * and a permission prompt is rendered via `handOver({ renderer: "permission_request", toolName, toolInput })`.
   */
  requiresPermission?: boolean | ((input: I) => boolean);
  unAbortable?: boolean;
  /**
   * Tool implementation.
   *
   * `signal` is the active request's `AbortSignal` (the same one passed to
   * `Glove.processRequest`). Tools that perform long-running internal work
   * — most notably the subagent dispatcher, which runs a nested agent loop
   * — should forward it into that work so abort propagates all the way
   * down. The executor already wraps `run()` with an abortable race so
   * tools that ignore `signal` still don't block the executor on abort.
   * Tools marked `unAbortable: true` should ignore `signal`.
   */
  run(
    input: I,
    handOver?: (request: unknown) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResultData>;
  /**
   * 
   * @param args customly defined args that may be used to generate the summary, e.g read 20 lines from x to y, or fetched data from google.com, something short, this will get passed into the run function to generate one and update the toolresult
   * @returns 
   */
  generateSummary?: (args: unknown) => Promise<string>
}

/**
 * Adapter helper — returns whichever schema the tool provided, as JSON Schema.
 * Used by model adapters' `formatTools` to serialize tool input schemas.
 */
export function getToolJsonSchema(tool: Tool<any>): Record<string, unknown> {
  if (tool.jsonSchema) return tool.jsonSchema;
  if (tool.input_schema) return z.toJSONSchema(tool.input_schema) as Record<string, unknown>;
  return { type: "object", properties: {} };
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

export type InboxItemStatus = "pending" | "resolved" | "consumed";

export interface InboxItem {
  id: string;
  tag: string;
  request: string;
  response: string | null;
  status: InboxItemStatus;
  blocking: boolean;
  created_at: string;
  resolved_at: string | null;
}

export interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  // in cases where a user is using a hook that will rewrite the existing text, we wanna be able to still know the original message, especially in instances where we need to display it to the user
  pre_modified_text?: string;
  content?: Array<ContentPart>;
  tool_results?: Array<ToolResult>;
  tool_calls?: Array<ToolCall>;
  is_compaction?: boolean;
  is_compaction_request?: boolean
  /** True when this user message was synthesised by a skill injection rather than authored by a real user. */
  is_skill_injection?: boolean
  /**
   * Provider-emitted reasoning trace, captured separately from `text` so the
   * visible message stays clean. Some reasoning-model APIs (e.g. Xiaomi MiMo)
   * require this to be echoed back on subsequent turns when the assistant turn
   * made tool calls. Adapters that don't recognise the field ignore it.
   */
  reasoning_content?: string
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

  addTokens(args: TokenConsumptionCounter): Promise<void>

  getTurnCount(): Promise<number>

  incrementTurn(): Promise<void>

  resetCounters(): Promise<void> // reset token and turn counts without deleting messages

  // Tasks (optional)
  getTasks?(): Promise<Array<Task>>
  addTasks?(tasks: Array<Task>): Promise<void>
  updateTask?(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>): Promise<void>

  // Permissions (optional)
  //
  // `input` is the model-supplied tool input for this specific call. Stores
  // can decide whether to scope decisions per-input (e.g. exact-match on a
  // canonical form) or treat all calls to a tool uniformly (ignore `input`).
  // The default `MemoryStore` keys decisions on `(toolName, JSON.stringify(input ?? null))`,
  // so distinct inputs prompt independently.
  getPermission?(toolName: string, input?: unknown): Promise<PermissionStatus>
  setPermission?(toolName: string, status: PermissionStatus, input?: unknown): Promise<void>

  // Inbox (optional)
  getInboxItems?(): Promise<Array<InboxItem>>
  addInboxItem?(item: InboxItem): Promise<void>
  updateInboxItem?(itemId: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>): Promise<void>
  getResolvedInboxItems?(): Promise<Array<InboxItem>>

  // subagent store
  // durable means the subagent can continue to get the same store with full message history from past interactions
  createSubAgentStore?(namespace: string, durable?: boolean): Promise<StoreAdapter>
}

export interface TokenConsumptionCounter {
  tokens_in: number
  tokens_out: number
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

  async getInboxItems(): Promise<Array<InboxItem>> {
    if (!this.store.getInboxItems) return [];
    return await this.store.getInboxItems();
  }

  async addInboxItem(item: InboxItem): Promise<void> {
    if (!this.store.addInboxItem) return;
    await this.store.addInboxItem(item);
  }

  async updateInboxItem(itemId: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>): Promise<void> {
    if (!this.store.updateInboxItem) return;
    await this.store.updateInboxItem(itemId, updates);
  }

  async getResolvedInboxItems(): Promise<Array<InboxItem>> {
    if (!this.store.getResolvedInboxItems) return [];
    return await this.store.getResolvedInboxItems();
  }
}

export class PromptMachine {
  context: Context;
  systemPrompt: string;
  model: ModelAdapter;
  subscribers: Array<SubscriberAdapter> = [];
  enableToolResultSummary: boolean = false

  constructor(model: ModelAdapter, ctx: Context, systemPrompt: string, enableToolResultSummary?: boolean) {
    this.context = ctx;
    this.systemPrompt = systemPrompt;
    model.setSystemPrompt(systemPrompt);
    this.model = model;
    this.enableToolResultSummary = enableToolResultSummary ?? false
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  removeSubscriber(subscriber: SubscriberAdapter) {
    const idx = this.subscribers.indexOf(subscriber);
    if (idx !== -1) this.subscribers.splice(idx, 1);
  }

  notifySubscribers: NotifySubscribersFunction = async (event_name, event_data) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  summarizeOlderToolResults(messages: Array<Message>): Array<Message> {
    let lastUserMessageIdx = -1;

    for (let i = messages.length - 1; i >= 0; i--){
      const message = messages[i]
      if (message.sender == "user" && !message.tool_results) {
        lastUserMessageIdx = i
        break;
      }
    }

    return messages.map((message, i) => {
      if (i > lastUserMessageIdx) return message;
  
      if (message.sender !== "user" || !message.tool_results?.length) return message;

      return {
        ...message,
        tool_results: message.tool_results.map((result) => {
          if (result.result.summary) {
            return {
              ...result,
              result: {
                ...result.result,
                data: result.result.summary
              }
            }
          }
          return result
        })
      }
      
    })
    
  }

  async run(messages: Array<Message>, tools?: Array<Tool<unknown>>, signal?: AbortSignal) {
    const prunedMessages = this.enableToolResultSummary ? this.summarizeOlderToolResults(messages) : messages
    const result = await this.model.prompt(
      {
        messages: prunedMessages,
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

/**
 * Tool name of the auto-registered subagent dispatch tool. The Executor
 * recognises calls to this tool name and brackets them with
 * `subagent_invoked` / `subagent_completed` events so subscribers see
 * symmetric brackets even when a subagent run is aborted or errors out.
 */
export const SUBAGENT_DISPATCH_TOOL_NAME = "glove_invoke_subagent";

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
    // Resolve `requiresPermission` against this specific input. Function form
    // lets a single tool gate writes but not reads (e.g. bash) without
    // store-side rules.
    const gate = typeof tool.requiresPermission === "function"
      ? Boolean(tool.requiresPermission(input))
      : Boolean(tool.requiresPermission);
    if (!gate) return true;
    if (!this.store?.getPermission || !this.store?.setPermission) return true;

    const status = await this.store.getPermission(tool.name, input);
    if (status === "granted") return true;
    if (status === "denied") return false;

    // status is "unset" — ask the user via handOver
    if (!handOver) return true;

    const result = await handOver({ renderer: 'permission_request', toolName: tool.name, toolInput: input });
    const allowed = Boolean(result);
    await this.store.setPermission(tool.name, allowed ? "granted" : "denied", input);
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

  notifySubscribers: NotifySubscribersFunction = async (event_name, event_data) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

  /**
   * Fire `subagent_completed` for a finished subagent dispatch call. No-op
   * for non-dispatch tools or for malformed inputs (the call without a
   * `name` would never have produced an open-bracket either).
   */
  private maybeCloseSubagentBracket(
    call: ToolCall,
    status: "success" | "error",
    message?: string,
  ) {
    if (call.tool_name !== SUBAGENT_DISPATCH_TOOL_NAME) return;
    const args = call.input_args as { name?: string } | undefined;
    if (!args?.name) return;
    this.notifySubscribers("subagent_completed", {
      name: args.name,
      status,
      message,
    });
  }

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
        await this.notifySubscribers("tool_use_result", toolResults.at(-1)!);
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
        await this.notifySubscribers("tool_use_result", toolResults.at(-1)!);

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
        await this.notifySubscribers("tool_use_result", toolResults.at(-1)!);
        continue;
      }

      let validatedInput: unknown = call.input_args;

      if (tool.input_schema) {
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

          await this.notifySubscribers("tool_use_result", toolResults.at(-1)!);

          continue;
        }
        validatedInput = parsed_input.data;
      }

      // Fire the open-bracket for subagent invocations here — once we've
      // passed all skip conditions and are about to actually run the
      // dispatcher. The matching close-bracket fires below in the result
      // handlers (success, error, and abort), guaranteeing 1:1 symmetry
      // even when the executor's abortablePromise wrapper short-circuits
      // the dispatcher's own promise.
      if (call.tool_name === SUBAGENT_DISPATCH_TOOL_NAME) {
        const args = call.input_args as { name?: string; prompt?: string } | undefined;
        if (args?.name) {
          this.notifySubscribers("subagent_invoked", {
            name: args.name,
            prompt: args.prompt ?? "",
          });
        }
      }

      let toolRunEffect = Effect.tryPromise({
        try: async () => {
          // Only check abort signal for abortable tools
          if (signal?.aborted && !tool.unAbortable) throw new AbortError();
          const result = tool.unAbortable ?
            await tool.run(validatedInput, handOver, signal) :
            await abortablePromise(signal, tool.run(validatedInput, handOver, signal));

          // add tool result summary to make future tool calls more efficient and less token consuming
          if (tool.generateSummary && result.generateSummaryArgs) {
            result.summary = await tool.generateSummary(result.generateSummaryArgs)
          }
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
            this.notifySubscribers("tool_use_result", toolResults.at(-1)!);
            this.maybeCloseSubagentBracket(call, "error", "Subagent run aborted by the user.");
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

          this.notifySubscribers("tool_use_result", toolResults.at(-1)!);
          this.maybeCloseSubagentBracket(call, "error", `Subagent dispatcher errored: ${error}`);
        },
        onRight: (value: ToolResultData) => {
          toolResults.push({
            tool_name: call.tool_name,
            call_id: call.id,
            result: value,
          });

          this.notifySubscribers("tool_use_result", toolResults.at(-1)!);
          this.maybeCloseSubagentBracket(
            call,
            value.status === "success" ? "success" : "error",
            value.message,
          );
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
  ESCAPE_COMPACTION_THRESHOLD = 90 // for model tool calls and results to escape being compacted
  COMPACTION_INSTRUCTIONS: string;
  store: StoreAdapter;
  context: Context;
  prompt: PromptMachine;
  subscribers: Array<SubscriberAdapter> = []

  constructor(
    store: StoreAdapter,
    ctx: Context,
    prmpt: PromptMachine,
    compaction_instructions: string,
    max_turns?: number,
    context_compaction_limit?: number,
    escape_compaction_threshold?:number
  ) {
    this.store = store;
    this.MAX_TURNS = max_turns ?? this.MAX_TURNS;
    this.context = ctx;
    this.prompt = prmpt;
    this.COMPACTION_INSTRUCTIONS = compaction_instructions;
    this.CONTEXT_COMPACTION_LIMIT = context_compaction_limit ?? this.CONTEXT_COMPACTION_LIMIT;
    this.ESCAPE_COMPACTION_THRESHOLD = escape_compaction_threshold ?? this.ESCAPE_COMPACTION_THRESHOLD
  }

  addSubscriber(subscriber: SubscriberAdapter) {
    this.subscribers.push(subscriber);
  }

  removeSubscriber(subscriber: SubscriberAdapter) {
    const idx = this.subscribers.indexOf(subscriber);
    if (idx !== -1) this.subscribers.splice(idx, 1);
  }

  notifySubscribers: NotifySubscribersFunction = async (event_name, event_data) => {
    await Promise.all(
      this.subscribers.map((s) => s.record(event_name, event_data)),
    );
  };

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

  async addTokensConsumed(args: TokenConsumptionCounter) {
    await this.store.addTokens(args)
    await this.notifySubscribers("token_consumption", {
      consumption: args
    })
  }

  async getCurrentTokenConsumption() {
    const res = await this.store.getTokenCount() 
    return res
  }

  async isCompactionImminent() {
    const current_token_consumption = await this.getCurrentTokenConsumption()

    if (current_token_consumption >= (this.CONTEXT_COMPACTION_LIMIT * this.ESCAPE_COMPACTION_THRESHOLD)/100) return true;

    return false;
  }

  async tryCompaction() {
    const current_token_consumption = await this.getCurrentTokenConsumption();

    if (current_token_consumption < this.CONTEXT_COMPACTION_LIMIT) return;

    return this.runCompactionNow();
  }

  async runCompactionNow() {
    const current_token_consumption = await this.getCurrentTokenConsumption();

    await this.notifySubscribers("compaction_start", {
      current_token_consumption
    })

    const history = await this.context.getMessages()

    const compactionRequest: Message = {
      sender: 'user',
      text: this.COMPACTION_INSTRUCTIONS,
      is_compaction_request: true
    }

    const combinedMessages = [...history, compactionRequest]

    await this.store.resetCounters()

    const result = await this.prompt.run(combinedMessages);


    const summaryText = result.messages.filter((m)=> m.sender == "agent").map(m => m.text)?.join("\n") || "No summary was generated"

    // Preserve pending inbox items across compaction
    const pendingInbox = (await this.context.getInboxItems()).filter(
      (item) => item.status === "pending"
    );
    let inboxBlock = "";
    if (pendingInbox.length > 0) {
      const lines = pendingInbox.map(
        (item) => `- [${item.tag}] ${item.blocking ? "BLOCKING" : "non-blocking"}: ${item.request}`
      );
      inboxBlock =
        `\n\n[Pending inbox items — being monitored by external services]\n` +
        lines.join("\n") + "\n";
    }

    const summaryMessage: Message = {
      sender: "user",
      text: `[Conversation summary from compaction]\n\n${summaryText}${inboxBlock}\n\n` +
        `[End of summary - the conversation continues from here]`,
      is_compaction: true
    }

    await this.context.appendMessages([summaryMessage])
    await this.store.addTokens({
      tokens_in: 0,
      tokens_out: result.tokens_out
    })
    
    await this.notifySubscribers("compaction_end", {
      current_token_consumption: result.tokens_out,
      summary_message: summaryMessage
    })
    
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

    // Inbox: inject resolved items (persisted) and build transient blocking reminder
    await this.injectResolvedInboxItems();
    const pendingBlockingMessage = await this.buildPendingBlockingMessage();
    
    await this.context.appendMessages([message]);

    // Per-request turn counter to prevent runaway loops.
    // The observer's session-level counter is still incremented for stats.
    let requestTurns = 0;

    while (true) {
      if (signal?.aborted) throw new AbortError();

      let messages = await this.context.getMessages();
      messages = [...messages]

      // Append transient blocking reminder (not persisted) so the model
      // is aware of pending items without bloating conversation history.
      if (pendingBlockingMessage) {
        messages.splice(messages.length - 1, 0, pendingBlockingMessage)
      }

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

      let should_compact = await this.observer.isCompactionImminent()

      const messages_with_tool_calls = results.messages.filter(
        (m) => (m.tool_calls?.length ?? 0) > 0,
      );

      const has_tool_calls = messages_with_tool_calls.length != 0 

      if (should_compact && has_tool_calls) {
        // so that model results with tool calls are fully resolved, and the model has the full information to make decisions
        await this.observer.runCompactionNow()
      }
      await this.context.appendMessages(results.messages);
      await this.observer.addTokensConsumed({
        tokens_in: results.tokens_in ?? 0,
        tokens_out: results.tokens_out ?? 0
      });
      await this.observer.turnComplete();
      requestTurns++;

      

      if (messages_with_tool_calls.length == 0) {
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

  private async injectResolvedInboxItems() {
    const resolved = await this.context.getResolvedInboxItems();
    if (resolved.length === 0) return;

    const inboxMessage: Message = {
      sender: "user",
      text: `[Inbox: ${resolved.length} item(s) resolved]\n` +
        resolved.map((item) =>
          `- [${item.tag}] Request: "${item.request}" -> Response: "${item.response}" (resolved ${item.resolved_at})`
        ).join("\n"),
    };

    await this.context.appendMessages([inboxMessage]);

    for (const item of resolved) {
      await this.context.updateInboxItem(item.id, { status: "consumed" });
    }
  }

  private async buildPendingBlockingMessage(): Promise<Message | null> {
    const allItems = await this.context.getInboxItems();
    const pendingBlocking = allItems.filter(
      (item) => item.status === "pending" && item.blocking
    );

    if (pendingBlocking.length === 0) return null;

    return {
      sender: "user",
      text: `[Inbox: ${pendingBlocking.length} blocking item(s) still pending — ` +
        `you cannot proceed with actions that depend on these results]\n` +
        pendingBlocking.map((item) =>
          `- [${item.tag}] ${item.request} (posted ${item.created_at})`
        ).join("\n"),
    };
  }
}
