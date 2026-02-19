import { CodeBlock } from "@/components/code-block";

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  minWidth: "540px",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontFamily: "var(--mono)",
  whiteSpace: "nowrap",
};
const thDescStyle: React.CSSProperties = {
  ...thStyle,
  fontFamily: undefined,
  whiteSpace: "normal",
};
const headRowStyle: React.CSSProperties = { borderBottom: "1px solid var(--border)" };
const bodyRowStyle: React.CSSProperties = { borderBottom: "1px solid var(--border-subtle)" };
const propCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const typeCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const descCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  whiteSpace: "normal",
  minWidth: "200px",
};

function PropTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: [string, string, string][];
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headRowStyle}>
            {headers.map((h, i) => (
              <th key={h} style={i < 2 ? thStyle : thDescStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, desc]) => (
            <tr key={prop + type} style={bodyRowStyle}>
              <td style={propCell}>{prop}</td>
              <td style={typeCell}>{type}</td>
              <td style={descCell}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CorePage() {
  return (
    <div className="docs-content">
      <h1>glove-core</h1>

      <p>
        Complete API reference for the core runtime package. Contains the agent
        loop, tool execution engine, display manager, context management,
        model adapters, and all foundational types.
      </p>

      {/* ================================================================== */}
      {/* GLOVE CLASS                                                        */}
      {/* ================================================================== */}
      <h2 id="glove">Glove</h2>

      <p>
        The top-level builder and runtime entry point. Use the builder pattern
        to register tools and subscribers, then call <code>build()</code> to
        produce a runnable agent.
      </p>

      <CodeBlock
        code={`import { Glove } from "glove-core";
import { z } from "zod";

const agent = new Glove({
  store,
  model,
  displayManager,
  systemPrompt: "You are a helpful assistant.",
  compaction_config: {
    compaction_instructions: "Summarize the conversation.",
    max_turns: 30,
  },
})
  .fold({
    name: "get_weather",
    description: "Get weather for a city.",
    inputSchema: z.object({ city: z.string() }),
    async do(input) {
      const res = await fetch(\`https://api.weather.example/v1?city=\${input.city}\`);
      return res.json();
    },
  })
  .build();

const result = await agent.processRequest("What is the weather in Tokyo?");`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>new Glove(config: GloveConfig)</code>
      </p>

      <h3>GloveConfig</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "store",
            "StoreAdapter",
            "The store adapter for conversation persistence. Required.",
          ],
          [
            "model",
            "ModelAdapter",
            "The model adapter for language model communication. Required.",
          ],
          [
            "displayManager",
            "DisplayManagerAdapter",
            "The display manager adapter for UI slot management. Required.",
          ],
          [
            "systemPrompt",
            "string",
            "The system prompt sent with every model request. Required.",
          ],
          [
            "maxRetries?",
            "number",
            "Maximum number of retries for failed tool executions. Passed to the Executor.",
          ],
          [
            "compaction_config",
            "CompactionConfig",
            "Configuration for automatic context window compaction. Required.",
          ],
        ]}
      />

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "fold<I>(args: GloveFoldArgs<I>)",
            "IGloveBuilder",
            "Register a tool with the agent. Returns the builder for chaining.",
          ],
          [
            "addSubscriber(subscriber: SubscriberAdapter)",
            "IGloveBuilder",
            "Add a subscriber that receives streaming events. Returns the builder for chaining.",
          ],
          [
            "build()",
            "IGloveRunnable",
            "Finalize configuration and return a runnable agent instance.",
          ],
          [
            "processRequest(request, signal?)",
            "Promise<ModelPromptResult | Message>",
            "Send a request string or ContentPart[] to the agent and receive the result. Available after build().",
          ],
          [
            "setModel(model: ModelAdapter)",
            "void",
            "Replace the model adapter at runtime. Useful for model switching mid-session.",
          ],
        ]}
      />

      <h3>Properties</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "displayManager",
            "DisplayManagerAdapter",
            "Read-only access to the display manager instance.",
          ],
        ]}
      />

      <h3>GloveFoldArgs</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["name", "string", "Unique name for the tool."],
          [
            "description",
            "string",
            "Description of what the tool does. The model reads this to decide when to invoke it.",
          ],
          [
            "inputSchema",
            "z.ZodType<I>",
            "Zod schema defining the tool's input shape.",
          ],
          [
            "requiresPermission?",
            "boolean",
            "When true, checks the store for permission before execution. Defaults to false.",
          ],
          [
            "do",
            "(input: I, display: DisplayManagerAdapter) => Promise<ToolResultData>",
            "The tool's implementation. Receives validated input and the display manager. Return value becomes the tool result.",
          ],
        ]}
      />

      <h3>IGloveRunnable</h3>

      <p>
        The interface returned by <code>build()</code>. Represents a fully
        configured, ready-to-run agent.
      </p>

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          [
            "processRequest(request, signal?)",
            "(request: string | ContentPart[], signal?: AbortSignal) => Promise<ModelPromptResult | Message>",
            "Send a user request to the agent and get the response.",
          ],
          [
            "setModel(model)",
            "(model: ModelAdapter) => void",
            "Swap the model adapter at runtime.",
          ],
          [
            "displayManager",
            "DisplayManagerAdapter",
            "Read-only reference to the display manager.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* DISPLAY MANAGER                                                    */}
      {/* ================================================================== */}
      <h2 id="display-manager">DisplayManager</h2>

      <p>
        Manages the display stack: a ordered collection of UI slots that tools
        push and users resolve. Implements <code>DisplayManagerAdapter</code>.
      </p>

      <CodeBlock
        code={`import { Displaymanager } from "glove-core/display-manager";

const dm = new Displaymanager();

dm.subscribe((stack) => {
  console.log("Display stack changed:", stack);
});`}
        language="typescript"
      />

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "registerRenderer<I,O>(renderer: Renderer<I,O>)",
            "void",
            "Register a named renderer with input/output schemas.",
          ],
          [
            "pushAndForget<I>(slot: { renderer?: string; input: I })",
            "Promise<string>",
            "Push a slot onto the stack without blocking. Returns the slot ID.",
          ],
          [
            "pushAndWait<I,O>(slot: { renderer?: string; input: I })",
            "Promise<O>",
            "Push a slot and block until resolved or rejected. Returns the resolved value.",
          ],
          [
            "subscribe(listener: ListenerFn)",
            "UnsubscribeFn",
            "Subscribe to stack changes. The listener is called with the current stack whenever it changes. Returns an unsubscribe function.",
          ],
          [
            "notify()",
            "Promise<void>",
            "Manually trigger all subscribed listeners with the current stack state.",
          ],
          [
            "resolve<O>(slot_id: string, value: O)",
            "void",
            "Resolve a pushAndWait slot by ID, unblocking the waiting tool.",
          ],
          [
            "reject(slot_id: string, error: string)",
            "void",
            "Reject a pushAndWait slot by ID, causing the pushAndWait promise to throw.",
          ],
          [
            "removeSlot(id: string)",
            "void",
            "Remove a slot from the stack by ID.",
          ],
          [
            "clearStack()",
            "Promise<void>",
            "Remove all slots from the display stack and notify listeners.",
          ],
        ]}
      />

      <h3>DisplayManagerAdapter Interface</h3>

      <p>
        The interface that <code>DisplayManager</code> implements. Any custom
        display manager must conform to this shape.
      </p>

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          [
            "renderers",
            "Array<Renderer<unknown, unknown>>",
            "Registry of named renderers.",
          ],
          [
            "stack",
            "Slot<unknown>[]",
            "The current display stack, ordered from bottom to top.",
          ],
          [
            "listeners",
            "Set<ListenerFn>",
            "Set of subscribed listener functions.",
          ],
          [
            "resolverStore",
            "Map<string, { resolve: ResolverFn<unknown>; reject: RejectFn }>",
            "Internal map of pending pushAndWait resolvers keyed by slot ID.",
          ],
          [
            "registerRenderer(renderer)",
            "void",
            "Register a renderer.",
          ],
          [
            "pushAndForget(slot)",
            "Promise<string>",
            "Push without blocking.",
          ],
          [
            "pushAndWait(slot)",
            "Promise<unknown>",
            "Push and block until resolved.",
          ],
          [
            "notify()",
            "Promise<void>",
            "Trigger listeners.",
          ],
          [
            "subscribe(listener)",
            "UnsubscribeFn",
            "Subscribe to changes.",
          ],
          [
            "resolve(slot_id, value)",
            "void",
            "Resolve a pending slot.",
          ],
          [
            "reject(slot_id, error: any)",
            "void",
            "Reject a pending slot.",
          ],
          [
            "removeSlot(id)",
            "void",
            "Remove a slot by ID.",
          ],
          [
            "clearStack()",
            "Promise<void>",
            "Clear all slots.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* SLOT & RENDERER                                                    */}
      {/* ================================================================== */}
      <h2 id="slot">Slot</h2>

      <p>
        Represents a single entry on the display stack. Pushed by tools,
        rendered by the UI layer.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["id", "string", "Unique identifier for this slot instance."],
          [
            "renderer",
            "string",
            "Name of the renderer to use for displaying this slot.",
          ],
          [
            "input",
            "I",
            "Input data passed to the renderer. Shape depends on the tool that created the slot.",
          ],
        ]}
      />

      <h2 id="renderer">Renderer</h2>

      <p>
        A named renderer definition registered with the display manager.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["name", "string", "Unique name identifying this renderer."],
          [
            "inputSchema",
            "z.ZodType<I>",
            "Zod schema for validating the input data.",
          ],
          [
            "outputSchema?",
            "z.ZodType<O>",
            "Optional Zod schema for validating the resolved output.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* CONTEXT                                                            */}
      {/* ================================================================== */}
      <h2 id="context">Context</h2>

      <p>
        Wraps a <code>StoreAdapter</code> and provides a simplified interface
        for reading and writing conversation data, messages, and tasks.
      </p>

      <CodeBlock
        code={`import { Context } from "glove-core";

const ctx = new Context(store);
const messages = await ctx.getMessages();
await ctx.appendMessages([{ sender: "user", text: "Hello" }]);`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>new Context(store: StoreAdapter)</code>
      </p>

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "getMessages()",
            "Promise<Message[]>",
            "Retrieve all messages from the store.",
          ],
          [
            "appendMessages(msgs: Message[])",
            "Promise<void>",
            "Append messages to the conversation history.",
          ],
          [
            "getTasks()",
            "Promise<Task[]>",
            "Retrieve all tasks from the store. Requires store to implement getTasks.",
          ],
          [
            "addTasks(tasks: Task[])",
            "Promise<void>",
            "Add tasks to the store. Requires store to implement addTasks.",
          ],
          [
            "updateTask(taskId: string, updates: Partial<Task>)",
            "Promise<void>",
            "Update a task by ID. Requires store to implement updateTask.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* PROMPT MACHINE                                                     */}
      {/* ================================================================== */}
      <h2 id="prompt-machine">PromptMachine</h2>

      <p>
        Manages model prompting: sends messages and tool definitions to the
        model adapter and collects the response. Notifies subscribers of
        streaming events.
      </p>

      <CodeBlock
        code={`import { PromptMachine } from "glove-core";

const pm = new PromptMachine(model, ctx, "You are a helpful assistant.");
pm.addSubscriber(subscriber);
const result = await pm.run(messages, tools);`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>
          new PromptMachine(model: ModelAdapter, ctx: Context, systemPrompt:
          string)
        </code>
      </p>

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "addSubscriber(subscriber: SubscriberAdapter)",
            "void",
            "Add a subscriber to receive model events (text_delta, tool_use, model_response_complete).",
          ],
          [
            "run(messages: Message[], tools?: Tool<unknown>[], signal?: AbortSignal)",
            "Promise<ModelPromptResult>",
            "Prompt the model with messages and optional tools. Returns the model's response including token counts.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* EXECUTOR                                                           */}
      {/* ================================================================== */}
      <h2 id="executor">Executor</h2>

      <p>
        The tool execution engine. Maintains a registry of tools and a call
        stack. Executes tool calls from the model, validates inputs, handles
        errors, and returns results.
      </p>

      <CodeBlock
        code={`import { Executor } from "glove-core";

const executor = new Executor(3, store);
executor.registerTool(myTool);
executor.addSubscriber(subscriber);

executor.addToolCallToStack({ tool_name: "get_weather", input_args: { city: "Tokyo" } });
const results = await executor.executeToolStack();`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>new Executor(MAX_RETRIES?: number, store?: StoreAdapter)</code>
      </p>

      <h3>Properties</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "tools",
            "Tool[]",
            "Array of registered tools.",
          ],
          [
            "MAX_RETRIES",
            "number",
            "Maximum retry attempts for failed tool calls.",
          ],
        ]}
      />

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "registerTool(tool: Tool<unknown>)",
            "void",
            "Add a tool to the executor's registry.",
          ],
          [
            "addSubscriber(subscriber: SubscriberAdapter)",
            "void",
            "Add a subscriber to receive tool execution events (tool_use, tool_use_result).",
          ],
          [
            "addToolCallToStack(call: ToolCall)",
            "void",
            "Queue a tool call for execution.",
          ],
          [
            "executeToolStack(handOver?: HandOverFunction, signal?: AbortSignal)",
            "Promise<ToolResult[]>",
            "Execute all queued tool calls and return their results. Clears the stack after execution.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* OBSERVER                                                           */}
      {/* ================================================================== */}
      <h2 id="observer">Observer</h2>

      <p>
        Monitors the context window size and triggers compaction when limits
        are exceeded. Tracks turn counts and token consumption.
      </p>

      <CodeBlock
        code={`import { Observer } from "glove-core";

const observer = new Observer(
  store,
  ctx,
  promptMachine,
  "Summarize the conversation so far.",
  30,   // max turns
  100000 // context compaction token limit
);

await observer.turnComplete();
await observer.tryCompaction();`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>
          new Observer(store: StoreAdapter, ctx: Context, prompt: PromptMachine,
          compaction_instructions: string, max_turns?: number,
          context_compaction_limit?: number)
        </code>
      </p>

      <h3>Properties</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "MAX_TURNS",
            "number",
            "Maximum turns before compaction is considered.",
          ],
          [
            "CONTEXT_COMPACTION_LIMIT",
            "number",
            "Maximum token count before compaction is triggered.",
          ],
        ]}
      />

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "setCompactionInstructions(instruction: string)",
            "void",
            "Update the compaction instructions at runtime.",
          ],
          [
            "setMaxTurns(new_max: number)",
            "void",
            "Update the maximum turn threshold.",
          ],
          [
            "setContextCompactionLimit(new_limit: number)",
            "void",
            "Update the token consumption threshold.",
          ],
          [
            "turnComplete()",
            "Promise<void>",
            "Notify the observer that a turn has completed. Increments the turn counter in the store.",
          ],
          [
            "getCurrentTurns()",
            "Promise<number>",
            "Get the current turn count from the store.",
          ],
          [
            "addTokensConsumed(count: number)",
            "Promise<void>",
            "Add to the cumulative token count in the store.",
          ],
          [
            "getCurrentTokenConsumption()",
            "Promise<number>",
            "Get the current total token consumption from the store.",
          ],
          [
            "tryCompaction()",
            "Promise<void>",
            "Check if compaction is needed (turns or tokens exceeded) and perform it if so. Summarizes the conversation, resets the history, and replaces it with the summary.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* AGENT                                                              */}
      {/* ================================================================== */}
      <h2 id="agent">Agent</h2>

      <p>
        Orchestrates the core agent loop: prompt the model, check for tool
        calls, execute tools, feed results back, repeat until the model
        responds with text only.
      </p>

      <CodeBlock
        code={`import { Agent } from "glove-core";

const agent = new Agent(store, executor, context, observer, promptMachine);
const result = await agent.ask(userMessage);`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>
          new Agent(store: StoreAdapter, executor: Executor, context: Context,
          observer: Observer, prompt_machine: PromptMachine)
        </code>
      </p>

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "ask(message: Message, handOver?: HandOverFunction, signal?: AbortSignal)",
            "Promise<ModelPromptResult>",
            "Run the full agent loop for a user message. Prompts the model, executes any tool calls, loops until the model produces a final text response. Returns the final result with token counts.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* ABORT ERROR                                                        */}
      {/* ================================================================== */}
      <h2 id="abort-error">AbortError</h2>

      <p>
        Custom error class thrown when an agent request is aborted via an{" "}
        <code>AbortSignal</code>. Has <code>name</code> set to{" "}
        <code>&quot;AbortError&quot;</code>.
      </p>

      <CodeBlock
        code={`import { AbortError } from "glove-core";

try {
  await agent.processRequest("Hello", signal);
} catch (err) {
  if (err instanceof AbortError) {
    console.log("Request was aborted.");
  }
}`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>new AbortError(message?: string)</code>
      </p>

      {/* ================================================================== */}
      {/* MODEL ADAPTER                                                      */}
      {/* ================================================================== */}
      <h2 id="model-adapter">ModelAdapter</h2>

      <p>
        Interface for language model providers. Implement this to connect any
        LLM to Glove.
      </p>

      <CodeBlock
        code={`interface ModelAdapter {
  name: string;
  prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal
  ): Promise<ModelPromptResult>;
  setSystemPrompt(systemPrompt: string): void;
}`}
        language="typescript"
      />

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          ["name", "string", "Display name of the model or provider."],
          [
            "prompt(request, notify, signal?)",
            "Promise<ModelPromptResult>",
            "Send messages and tools to the model. Call notify() to emit streaming events. Returns the complete response with token counts.",
          ],
          [
            "setSystemPrompt(systemPrompt)",
            "void",
            "Update the system prompt used for subsequent requests.",
          ],
        ]}
      />

      <h3>PromptRequest</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "messages",
            "Message[]",
            "The conversation messages to send to the model.",
          ],
          [
            "tools?",
            "Tool<unknown>[]",
            "Optional array of tools the model can invoke.",
          ],
        ]}
      />

      <h3>ModelPromptResult</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "messages",
            "Message[]",
            "Response messages from the model (typically one agent message).",
          ],
          [
            "tokens_in",
            "number",
            "Input tokens consumed by this prompt.",
          ],
          [
            "tokens_out",
            "number",
            "Output tokens generated by this prompt.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* STORE ADAPTER                                                      */}
      {/* ================================================================== */}
      <h2 id="store-adapter">StoreAdapter</h2>

      <p>
        Interface for conversation persistence. Implement this to store
        messages, token counts, tasks, and permissions in any backend.
      </p>

      <CodeBlock
        code={`interface StoreAdapter {
  identifier: string;
  getMessages(): Promise<Message[]>;
  appendMessages(msgs: Message[]): Promise<void>;
  getTokenCount(): Promise<number>;
  addTokens(count: number): Promise<void>;
  getTurnCount(): Promise<number>;
  incrementTurn(): Promise<void>;
  resetHistory(): Promise<void>;
  // Optional:
  getTasks?(): Promise<Task[]>;
  addTasks?(tasks: Task[]): Promise<void>;
  updateTask?(taskId: string, updates: Partial<Task>): Promise<void>;
  getPermission?(toolName: string): Promise<PermissionStatus>;
  setPermission?(toolName: string, status: PermissionStatus): Promise<void>;
}`}
        language="typescript"
      />

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          [
            "identifier",
            "string",
            "Unique identifier for the store instance (typically a session ID).",
          ],
          [
            "getMessages()",
            "Promise<Message[]>",
            "Retrieve all conversation messages.",
          ],
          [
            "appendMessages(msgs)",
            "Promise<void>",
            "Append messages to the history.",
          ],
          [
            "getTokenCount()",
            "Promise<number>",
            "Get the cumulative token count.",
          ],
          [
            "addTokens(count)",
            "Promise<void>",
            "Add to the cumulative token count.",
          ],
          [
            "getTurnCount()",
            "Promise<number>",
            "Get the current turn count.",
          ],
          [
            "incrementTurn()",
            "Promise<void>",
            "Increment the turn counter.",
          ],
          [
            "resetHistory()",
            "Promise<void>",
            "Clear the conversation history. Used during compaction.",
          ],
          [
            "getTasks?()",
            "Promise<Task[]>",
            "Retrieve all tasks. Optional. Enables the built-in task tool when present.",
          ],
          [
            "addTasks?(tasks)",
            "Promise<void>",
            "Add tasks. Optional.",
          ],
          [
            "updateTask?(taskId, updates)",
            "Promise<void>",
            "Update a task by ID. Optional.",
          ],
          [
            "getPermission?(toolName)",
            "Promise<PermissionStatus>",
            "Check permission status for a tool. Optional.",
          ],
          [
            "setPermission?(toolName, status)",
            "Promise<void>",
            "Set permission status for a tool. Optional.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* SUBSCRIBER ADAPTER                                                 */}
      {/* ================================================================== */}
      <h2 id="subscriber-adapter">SubscriberAdapter</h2>

      <p>
        Interface for observing agent events. Subscribers receive streaming
        text deltas, tool invocations, tool results, and model response
        completions.
      </p>

      <CodeBlock
        code={`interface SubscriberAdapter {
  record(event_type: string, data: any): Promise<void>;
}`}
        language="typescript"
      />

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          [
            "record(event_type, data)",
            "Promise<void>",
            "Called whenever an event occurs. The event_type string identifies the event, and data carries the payload.",
          ],
        ]}
      />

      <h3 id="subscriber-events">Subscriber Events</h3>

      <p>
        The following events are emitted by the system and received by
        subscribers via the <code>record</code> method.
      </p>

      <PropTable
        headers={["Event", "Data Shape", "Description"]}
        rows={[
          [
            "text_delta",
            "{ text: string }",
            "A chunk of streaming text from the model. Emitted as the model generates tokens.",
          ],
          [
            "tool_use",
            "{ id: string; name: string; input: unknown }",
            "A tool invocation has started. Contains the tool call ID, name, and input arguments.",
          ],
          [
            "tool_use_result",
            "{ tool_name: string; call_id?: string; result: ToolResult['result'] }",
            "A tool has finished executing. Contains the tool name, call ID, and execution result.",
          ],
          [
            "model_response",
            "{ text: string; tool_calls: ToolCall[] }",
            "A model turn is complete (non-streaming adapters).",
          ],
          [
            "model_response_complete",
            "{ text: string; tool_calls: ToolCall[] }",
            "A model turn is complete (streaming adapters). Contains the full response text and any tool calls.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* MESSAGE                                                            */}
      {/* ================================================================== */}
      <h2 id="message">Message</h2>

      <p>
        Represents a single message in the conversation history.
      </p>

      <CodeBlock
        code={`interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  content?: ContentPart[];
  tool_results?: ToolResult[];
  tool_calls?: ToolCall[];
}`}
        language="typescript"
      />

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "sender",
            '"user" | "agent"',
            "Who sent the message.",
          ],
          [
            "id?",
            "string",
            "Optional unique identifier for the message.",
          ],
          [
            "text",
            "string",
            "The text content of the message.",
          ],
          [
            "content?",
            "ContentPart[]",
            "Optional multimodal content parts (images, documents, etc.).",
          ],
          [
            "tool_results?",
            "ToolResult[]",
            "Tool execution results attached to this message (agent messages responding to tool calls).",
          ],
          [
            "tool_calls?",
            "ToolCall[]",
            "Tool calls the model wants to execute (present in agent messages).",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* CONTENT PART                                                       */}
      {/* ================================================================== */}
      <h2 id="content-part">ContentPart</h2>

      <p>
        Represents a multimodal content element within a message.
      </p>

      <CodeBlock
        code={`interface ContentPart {
  type: "text" | "image" | "video" | "document";
  text?: string;
  source?: {
    type: string;
    media_type: string;
    data?: string;
    url?: string;
  };
}`}
        language="typescript"
      />

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "type",
            '"text" | "image" | "video" | "document"',
            "The type of content.",
          ],
          [
            "text?",
            "string",
            'Text content. Used when type is "text".',
          ],
          [
            "source?",
            "object",
            "Source information for binary content. Contains type, media_type, and either data (base64) or url.",
          ],
          [
            "source.type",
            "string",
            'Source type (e.g., "base64", "url").',
          ],
          [
            "source.media_type",
            "string",
            'MIME type (e.g., "image/png", "application/pdf").',
          ],
          [
            "source.data?",
            "string",
            "Base64-encoded content data.",
          ],
          [
            "source.url?",
            "string",
            "URL pointing to the content.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* TOOL TYPES                                                         */}
      {/* ================================================================== */}
      <h2 id="tool">Tool</h2>

      <p>
        The core tool interface used by the <code>Executor</code>. This is the
        runtime representation, distinct from <code>ToolConfig</code> in{" "}
        <code>glove-react</code> which adds the <code>render</code> property.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["name", "string", "Unique tool name."],
          ["description", "string", "Description for the model."],
          [
            "input_schema",
            "z.ZodType<I>",
            "Zod schema for input validation and JSON Schema generation.",
          ],
          [
            "requiresPermission?",
            "boolean",
            "Whether the tool requires explicit permission before execution.",
          ],
          [
            "run(input: I, handOver?: HandOverFunction)",
            "Promise<ToolResultData>",
            "Execute the tool with validated input. Optional handOver function for delegation patterns.",
          ],
        ]}
      />

      <h2 id="tool-call">ToolCall</h2>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["tool_name", "string", "Name of the tool to invoke."],
          [
            "input_args",
            "unknown",
            "Arguments to pass to the tool (validated against the tool's input schema at runtime).",
          ],
          [
            "id?",
            "string",
            "Optional call identifier for correlating calls with results.",
          ],
        ]}
      />

      <h2 id="tool-result">ToolResult</h2>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "tool_name",
            "string",
            "Name of the tool that produced this result.",
          ],
          [
            "call_id?",
            "string",
            "Identifier correlating this result with its ToolCall.",
          ],
          [
            "result",
            "ToolResultData",
            "The execution result. See ToolResultData below.",
          ],
        ]}
      />

      <h2 id="tool-result-data">ToolResultData</h2>

      <p>
        The shape of the <code>result</code> field on a{" "}
        <code>ToolResult</code>. Contains the data returned by the tool,
        a status indicator, an optional error message, and an optional
        client-only rendering payload.
      </p>

      <CodeBlock
        code={`interface ToolResultData {
  status: "success" | "error";
  data: unknown;          // Sent to the AI model
  message?: string;       // Error message (for status: "error")
  renderData?: unknown;   // Client-only — NOT sent to model, used by renderResult
}`}
        language="typescript"
      />

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "status",
            '"success" | "error"',
            "Whether the tool executed successfully or encountered an error.",
          ],
          [
            "data",
            "unknown",
            "The tool's return value. This is the data sent to the AI model as the tool result.",
          ],
          [
            "message?",
            "string",
            "Error message describing what went wrong. Typically present when status is \"error\".",
          ],
          [
            "renderData?",
            "unknown",
            "Client-only data for rendering tool results from history. Model adapters explicitly strip this field before sending to the AI — safe for sensitive client-only data like email addresses or UI state. Used by the renderResult function in glove-react tools.",
          ],
        ]}
      />

      <p>
        Model adapters (Anthropic, OpenAI-compat) explicitly destructure and
        only send <code>data</code>, <code>status</code>, and{" "}
        <code>message</code> to the API. The <code>renderData</code> field
        is preserved in the message store for client-side rendering via{" "}
        <code>renderResult</code> but is never sent to the AI model.
      </p>

      {/* ================================================================== */}
      {/* TASK TYPES                                                         */}
      {/* ================================================================== */}
      <h2 id="task">Task</h2>

      <p>
        Represents a tracked task in the agent&apos;s task list.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["id", "string", "Unique identifier for the task."],
          [
            "content",
            "string",
            "Description of the task in imperative form (e.g., \"Fix the login bug\").",
          ],
          [
            "activeForm",
            "string",
            "Present-continuous form shown during execution (e.g., \"Fixing the login bug\").",
          ],
          [
            "status",
            "TaskStatus",
            'Current status: "pending", "in_progress", or "completed".',
          ],
        ]}
      />

      <h2 id="task-status">TaskStatus</h2>

      <CodeBlock
        code={`type TaskStatus = "pending" | "in_progress" | "completed";`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* PERMISSION STATUS                                                  */}
      {/* ================================================================== */}
      <h2 id="permission-status">PermissionStatus</h2>

      <CodeBlock
        code={`type PermissionStatus = "granted" | "denied" | "unset";`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* FUNCTION TYPES                                                     */}
      {/* ================================================================== */}
      <h2 id="function-types">Function Types</h2>

      <PropTable
        headers={["Type", "Signature", "Description"]}
        rows={[
          [
            "NotifySubscribersFunction",
            "(event_name: string, event_data: unknown) => Promise<void>",
            "Callback passed to ModelAdapter.prompt for emitting events to subscribers.",
          ],
          [
            "HandOverFunction",
            "(input: unknown) => Promise<unknown>",
            "Delegation callback passed to tool execution for handing control to another tool or system.",
          ],
          [
            "ListenerFn",
            "(stack: Slot<unknown>[]) => Promise<void>",
            "Display stack change listener. Called whenever the stack is modified.",
          ],
          [
            "UnsubscribeFn",
            "() => void",
            "Returned by subscribe() to remove a listener.",
          ],
          [
            "ResolverFn<RI>",
            "(value: RI) => void",
            "Internal resolver for pushAndWait promises.",
          ],
          [
            "RejectFn",
            "(reason?: any) => void",
            "Internal rejector for pushAndWait promises.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* COMPACTION CONFIG                                                   */}
      {/* ================================================================== */}
      <h2 id="compaction-config">CompactionConfig</h2>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "compaction_instructions",
            "string",
            "Instructions given to the model when summarizing the conversation. Required.",
          ],
          [
            "max_turns?",
            "number",
            "Maximum turns before compaction is triggered.",
          ],
          [
            "compaction_context_limit?",
            "number",
            "Maximum token count before compaction is triggered.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* TASK TOOL                                                          */}
      {/* ================================================================== */}
      <h2 id="task-tool">Built-in Task Tool</h2>

      <p>
        The framework provides a built-in tool for task management. It is
        automatically registered when the store supports tasks (implements{" "}
        <code>getTasks</code>, <code>addTasks</code>, <code>updateTask</code>).
      </p>

      <CodeBlock
        code={`import { createTaskTool } from "glove-core";

const taskTool = createTaskTool(context);
// taskTool.name === "glove_update_tasks"`}
        language="typescript"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function createTaskTool(context: Context): Tool<TaskToolInput>`}
        language="typescript"
      />

      <h3>TaskToolInput</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "todos",
            "Array<{ content: string; activeForm: string; status: TaskStatus }>",
            "The complete task list. Each call replaces the entire list.",
          ],
        ]}
      />

      <p>
        The tool name is <code>glove_update_tasks</code>. The model calls it to
        create, update, or complete tasks. Each invocation sends the full
        current task list, enabling additions, status changes, and removals in
        a single call.
      </p>

      {/* ================================================================== */}
      {/* PROVIDERS                                                          */}
      {/* ================================================================== */}
      <h2 id="providers">Providers</h2>

      <p>
        The <code>glove-core/models/providers</code> module exports factory
        functions for creating model adapters from supported providers.
      </p>

      <CodeBlock
        code={`import { createAdapter, getAvailableProviders } from "glove-core/models/providers";

const model = createAdapter({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  stream: true,
});

const available = getAvailableProviders();
// [{ id: "openai", name: "OpenAI", ... }, ...]`}
        language="typescript"
      />

      <h3>createAdapter</h3>

      <CodeBlock
        code={`function createAdapter(opts: CreateAdapterOptions): ModelAdapter`}
        language="typescript"
      />

      <h3>CreateAdapterOptions</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "provider",
            "string",
            "Provider ID. One of: openai, anthropic, openrouter, gemini, minimax, kimi, glm.",
          ],
          [
            "model?",
            "string",
            "Model name to use. Defaults to the provider's default model.",
          ],
          [
            "apiKey?",
            "string",
            "API key. Defaults to the provider's environment variable.",
          ],
          [
            "maxTokens?",
            "number",
            "Maximum output tokens. Defaults to the provider's default.",
          ],
          [
            "stream?",
            "boolean",
            "Whether to use streaming. Defaults to true.",
          ],
        ]}
      />

      <h3>getAvailableProviders</h3>

      <p>
        Returns an array of provider configurations that have API keys
        available in the current environment.
      </p>

      <CodeBlock
        code={`function getAvailableProviders(): Array<{ id: string; name: string; available: boolean; models: string[]; defaultModel: string }>`}
        language="typescript"
      />

      <h3>Supported Providers</h3>

      <PropTable
        headers={["ID", "Env Variable", "Default Model"]}
        rows={[
          ["openai", "OPENAI_API_KEY", "gpt-4.1"],
          ["anthropic", "ANTHROPIC_API_KEY", "claude-sonnet-4-20250514"],
          ["openrouter", "OPENROUTER_API_KEY", "anthropic/claude-sonnet-4"],
          ["gemini", "GEMINI_API_KEY", "gemini-2.5-flash"],
          ["minimax", "MINIMAX_API_KEY", "MiniMax-M2.5"],
          ["kimi", "MOONSHOT_API_KEY", "kimi-k2.5"],
          ["glm", "ZHIPUAI_API_KEY", "glm-4-plus"],
        ]}
      />

      <p>
        Each provider has properties: <code>id</code>, <code>name</code>,{" "}
        <code>baseURL</code>, <code>envVar</code>, <code>defaultModel</code>,{" "}
        <code>models[]</code>, <code>format</code> (either{" "}
        <code>&quot;openai&quot;</code> or <code>&quot;anthropic&quot;</code>),
        and <code>defaultMaxTokens</code>.
      </p>
    </div>
  );
}
