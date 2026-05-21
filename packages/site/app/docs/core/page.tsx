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
        code={`import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { z } from "zod";

const agent = new Glove({
  store: new MemoryStore("session-1"),
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
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
      return { status: "success", data: await res.json() };
    },
  })
  .build();

const result = await agent.processRequest("What is the weather in Tokyo?");`}
        language="typescript"
      />

      <p>
        <code>store</code> is optional — when omitted, <code>Glove</code>{" "}
        constructs a fresh <code>MemoryStore</code> internally. You can also
        defer the store decision until <code>build()</code> by passing it
        there: <code>new Glove({"{ ... }"}).build(myStore)</code>.
      </p>

      <h3>Constructor</h3>

      <p>
        <code>new Glove(config: GloveConfig)</code>
      </p>

      <h3>GloveConfig</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "store?",
            "StoreAdapter",
            "Conversation persistence. Optional — defaults to a fresh MemoryStore. May also be supplied later via build(store) / rebuild(store).",
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
            "serverMode?",
            "boolean",
            "Default false. Hint to integrations (e.g. mountMcp) that no UI is present. Drives default permission gating.",
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
          [
            "enableToolResultSummary?",
            "boolean",
            "Default false. When true, the PromptMachine swaps each older tool result's data for its summary before sending messages to the model. Pairs with the per-tool generateToolSummary handler. See Tool result summaries below.",
          ],
        ]}
      />

      <h3>Methods</h3>

      <p>
        For the in-message <code>/hook</code> and <code>/skill</code>{" "}
        directive system and the subagent factory pattern, see the dedicated{" "}
        <a href="/docs/extensions">Hooks, Skills &amp; Subagents</a> guide.
      </p>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "fold<I>(args: GloveFoldArgs<I>)",
            "IGloveBuilder",
            "Register a tool with the agent. Legal at any time, including after build(). Returns the builder for chaining.",
          ],
          [
            "defineHook(name, handler)",
            "IGloveBuilder",
            "Register a /name hook that runs before the model with full agent controls. See the Hooks, Skills & Subagents guide.",
          ],
          [
            "defineSkill(args)",
            "IGloveBuilder",
            "Register a /name skill that injects context as a synthetic user message. Object form: { name, handler, description?, exposeToAgent? }. exposeToAgent: true exposes the skill via the glove_invoke_skill tool.",
          ],
          [
            "defineSubAgent(args)",
            "IGloveBuilder",
            "Register a subagent factory the main agent can route to via the auto-registered glove_invoke_subagent tool. Object form: { name, factory, description? }. The factory builds and returns a fully-configured child IGloveRunnable for each invocation.",
          ],
          [
            "addSubscriber(subscriber: SubscriberAdapter)",
            "IGloveBuilder",
            "Add a subscriber that receives streaming events. Returns the builder for chaining.",
          ],
          [
            "removeSubscriber(subscriber: SubscriberAdapter)",
            "void",
            "Detach a previously added subscriber.",
          ],
          [
            "setDisplayManager(dm: DisplayManagerAdapter)",
            "IGloveBuilder",
            "Swap the display manager. Builder-form (chainable) and runtime-form. Subagents typically call this on the child to share the parent's display stack mid-run.",
          ],
          [
            "build(store?: StoreAdapter)",
            "IGloveRunnable",
            "Finalize configuration and return a runnable agent. If no store was supplied to the constructor and one is supplied here, the executor's already-folded tools (including auto-registered skill/subagent dispatch tools) and subscribers are transferred onto the freshly-built executor.",
          ],
          [
            "rebuild(store?: StoreAdapter)",
            "IGloveRunnable",
            "Same body as build(); chainable variant useful for swapping the store late.",
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
          [
            "setSystemPrompt(prompt: string)",
            "void",
            "Update the system prompt for this session. Only safe to call when no request is in progress.",
          ],
          [
            "getSystemPrompt()",
            "string",
            "Return the current system prompt.",
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
          [
            "model",
            "ModelAdapter",
            "Read-only access to the active model adapter.",
          ],
          [
            "serverMode",
            "boolean",
            "Whether the agent was constructed with serverMode: true.",
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
            "inputSchema?",
            "z.ZodType<I>",
            "Zod schema for the tool's input. Validated locally on each call. Provide either inputSchema or jsonSchema.",
          ],
          [
            "jsonSchema?",
            "Record<string, unknown>",
            "Raw JSON Schema — for tools bridged from MCP, OpenAPI, etc. Skips local validation. Provide either inputSchema or jsonSchema.",
          ],
          [
            "requiresPermission?",
            "boolean",
            "When true, checks the store for permission before execution. Defaults to false.",
          ],
          [
            "unAbortable?",
            "boolean",
            "When true, the tool runs to completion even if the abort signal fires (e.g. from voice barge-in). Use for mutation-critical tools. Defaults to false.",
          ],
          [
            "do",
            "(input: I, display: DisplayManagerAdapter, glove: IGloveRunnable, signal?: AbortSignal) => Promise<ToolResultData>",
            "The tool's implementation. Receives validated input, the parent's display manager, the running Glove instance (use to fold further tools at runtime), and the active request's AbortSignal. Forward the signal into long-running internal work so abort propagates.",
          ],
          [
            "generateToolSummary?",
            "(summaryArgs?: unknown) => Promise<string>",
            "Optional. When the tool's do() returns a ToolResultData with generateSummaryArgs set, the Executor calls this with those args and stores the returned string on result.summary. The summary replaces data in older context when Glove was constructed with enableToolResultSummary: true.",
          ],
        ]}
      />

      <h3>IGloveRunnable</h3>

      <p>
        The interface returned by <code>build()</code>. Represents a fully
        configured, ready-to-run agent. Most builder methods are also part of
        this interface — folding tools and registering hooks/skills/subagents
        is legal at any time, including after build.
      </p>

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          [
            "processRequest(request, signal?)",
            "(request: string | ContentPart[], signal?: AbortSignal) => Promise<ModelPromptResult | Message>",
            "Send a user request to the agent and get the response. Parses /hook and /skill directives; @mentions reach the model verbatim.",
          ],
          [
            "fold<I>(args: GloveFoldArgs<I>)",
            "IGloveRunnable",
            "Fold a tool. Legal at any time, including after build.",
          ],
          [
            "defineHook(name, handler)",
            "IGloveRunnable",
            "Register a /name hook handler.",
          ],
          [
            "defineSkill(args)",
            "IGloveRunnable",
            "Register a /name skill handler.",
          ],
          [
            "defineSubAgent(args)",
            "IGloveRunnable",
            "Register a subagent factory.",
          ],
          [
            "rebuild(store?)",
            "IGloveRunnable",
            "Rebuild the agent's internals, optionally swapping the store. Tools folded before rebuild are transferred onto the new executor.",
          ],
          [
            "setModel(model)",
            "(model: ModelAdapter) => void",
            "Swap the model adapter at runtime.",
          ],
          [
            "setSystemPrompt(prompt)",
            "(prompt: string) => void",
            "Update the system prompt.",
          ],
          [
            "getSystemPrompt()",
            "() => string",
            "Read the current system prompt.",
          ],
          [
            "setDisplayManager(dm)",
            "(dm: DisplayManagerAdapter) => void",
            "Swap the display manager. Subagents typically call this on the child Glove to share the parent's display stack mid-run.",
          ],
          [
            "addSubscriber(s)",
            "(s: SubscriberAdapter) => void",
            "Attach a SubscriberAdapter to the prompt machine, executor, and observer.",
          ],
          [
            "removeSubscriber(s)",
            "(s: SubscriberAdapter) => void",
            "Detach a previously attached SubscriberAdapter.",
          ],
          [
            "displayManager",
            "DisplayManagerAdapter",
            "Read-only reference to the active display manager.",
          ],
          [
            "model",
            "ModelAdapter",
            "Read-only reference to the active model adapter.",
          ],
          [
            "serverMode",
            "boolean",
            "Whether the agent was constructed with serverMode: true.",
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
            "Retrieve messages for the model. Applies splitAtLastCompaction internally: finds the last message with is_compaction set to true and returns only messages from that point onward. This means the model sees the compaction summary plus any subsequent messages, not the full raw history. To access the complete unfiltered history, use the store's getMessages() directly.",
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
          string, enableToolResultSummary?: boolean)
        </code>
      </p>

      <p>
        The optional <code>enableToolResultSummary</code> flag (default{" "}
        <code>false</code>) is wired through from{" "}
        <code>GloveConfig.enableToolResultSummary</code>. When set, every call
        to <code>run()</code> first passes the message list through{" "}
        <code>summarizeOlderToolResults</code>.
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
            "summarizeOlderToolResults(messages: Message[])",
            "Message[]",
            "Pure transform. Finds the index of the latest non-tool user message and, for every message with tool_results at or before that index, replaces result.data with result.summary when summary is present. Untouched messages (including the current turn's tool results) are returned by reference. Called automatically by run() when enableToolResultSummary is true.",
          ],
          [
            "run(messages: Message[], tools?: Tool<unknown>[], signal?: AbortSignal)",
            "Promise<ModelPromptResult>",
            "Prompt the model with messages and optional tools. When enableToolResultSummary is true, the message list is first passed through summarizeOlderToolResults. Returns the model's response including token counts.",
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
        are exceeded. Tracks turn counts and token consumption. Compaction
        is history-preserving: messages are never deleted from the store.
        Instead, a compaction summary is appended with{" "}
        <code>is_compaction: true</code>, and{" "}
        <code>resetCounters()</code> resets the token and turn counts.
        The model only sees post-compaction messages because{" "}
        <code>Context.getMessages()</code> applies{" "}
        <code>splitAtLastCompaction()</code> internally.
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
          context_compaction_limit?: number,
          escape_compaction_threshold?: number)
        </code>
      </p>

      <h3>Properties</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "MAX_TURNS",
            "number",
            "Maximum turns per request. Defaults to 120. Exceeding this aborts the loop with a polite error message.",
          ],
          [
            "CONTEXT_COMPACTION_LIMIT",
            "number",
            "Token count above which compaction runs. Defaults to 100,000.",
          ],
          [
            "ESCAPE_COMPACTION_THRESHOLD",
            "number",
            "Pre-emptive compaction percentage (0-100). Defaults to 90. When the current consumption is at or above this fraction of CONTEXT_COMPACTION_LIMIT, Agent.ask runs compaction immediately after a model turn that contained tool_use calls — keeps tool_use / tool_result pairs from being split across a compaction boundary.",
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
            "addTokensConsumed(args: TokenConsumptionCounter)",
            "Promise<void>",
            "Add { tokens_in, tokens_out } to the store and emit a token_consumption subscriber event.",
          ],
          [
            "isCompactionImminent()",
            "Promise<boolean>",
            "Returns true when current consumption has crossed the ESCAPE_COMPACTION_THRESHOLD fraction of CONTEXT_COMPACTION_LIMIT. Used by Agent.ask to compact pre-emptively after tool-call turns.",
          ],
          [
            "getCurrentTokenConsumption()",
            "Promise<number>",
            "Get the current total token consumption from the store.",
          ],
          [
            "tryCompaction()",
            "Promise<void>",
            "Check if compaction is needed (turns or tokens exceeded) and perform it if so. Summarizes the conversation and appends the summary as a new message with is_compaction set to true. Calls resetCounters() to reset token and turn counts without deleting messages. The full message history is preserved in the store for frontend display, while Context.getMessages() uses splitAtLastCompaction to ensure the model only sees messages from the latest compaction onward.",
          ],
          [
            "runCompactionNow()",
            "Promise<void>",
            "Same body as tryCompaction() but skips the token-threshold guard. Used by hook handlers via AgentControls.forceCompaction() to compact on demand.",
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
      {/* SUBSCRIBER EVENTS                                                  */}
      {/* ================================================================== */}
      <h2 id="subscriber-events">Subscriber Events</h2>

      <p>
        Every model adapter emits events via the <code>notify</code> callback
        during prompting. These events are fully typed using a discriminated
        union so that subscribers (and custom adapter authors) get compile-time
        safety.
      </p>

      <h3>SubscriberEvent</h3>

      <p>
        A discriminated union of all event shapes. Each variant has a{" "}
        <code>type</code> field plus event-specific data.
      </p>

      <CodeBlock
        code={`type SubscriberEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "model_response"; text: string; tool_calls?: ToolCall[];
      stop_reason?: string; tokens_in?: number; tokens_out?: number }
  | { type: "model_response_complete"; text: string; tool_calls?: ToolCall[];
      stop_reason?: string; tokens_in?: number; tokens_out?: number }
  | { type: "tool_use_result"; tool_name: string; call_id?: string;
      result: ToolResultData }
  | { type: "compaction_start"; current_token_consumption: number }
  | { type: "compaction_end"; current_token_consumption: number;
      summary_message: Message }
  | { type: "token_consumption"; consumption: TokenConsumptionCounter }
  | { type: "hook_invoked"; name: string }
  | { type: "skill_invoked"; name: string; source: "user" | "agent"; args?: string }
  | { type: "subagent_invoked"; name: string; prompt: string }
  | { type: "subagent_completed"; name: string; status: "success" | "error"; message?: string };`}
        language="typescript"
      />

      <h3>Event Reference</h3>

      <PropTable
        headers={["Event", "Emitted by", "Description"]}
        rows={[
          [
            "text_delta",
            "Model adapter (streaming)",
            "Incremental text fragment from the model. Use to render streaming text in the UI.",
          ],
          [
            "tool_use",
            "Model adapter (streaming)",
            "The model is invoking a tool. Contains the tool id, name, and parsed input.",
          ],
          [
            "model_response",
            "Model adapter (non-streaming)",
            "Complete model response in non-streaming mode. Contains text, optional tool_calls, stop_reason, and token counts.",
          ],
          [
            "model_response_complete",
            "Model adapter (streaming)",
            "Final aggregated response after streaming finishes. Same shape as model_response.",
          ],
          [
            "tool_use_result",
            "Executor",
            "Result of executing a tool. Includes tool_name, call_id, and the full ToolResultData.",
          ],
          [
            "compaction_start",
            "Observer",
            "Conversation compaction is beginning. Contains current token consumption.",
          ],
          [
            "compaction_end",
            "Observer",
            "Compaction finished. Contains the new token count and the summary message.",
          ],
          [
            "token_consumption",
            "Observer",
            "Tokens were just added to the running totals. Carries the per-turn TokenConsumptionCounter.",
          ],
          [
            "hook_invoked",
            "Glove",
            "A user-side /name hook handler is about to run.",
          ],
          [
            "skill_invoked",
            "Glove / skill dispatch tool",
            'A skill handler is about to run. source: "user" for /name directive invocations, "agent" when the model called glove_invoke_skill.',
          ],
          [
            "subagent_invoked",
            "Executor",
            "A subagent's child Glove run is about to start. Carries the subagent name and the prompt the model supplied.",
          ],
          [
            "subagent_completed",
            "Executor",
            "Closes the subagent_invoked bracket with a 1:1 guarantee — fired even on abort or factory failure.",
          ],
        ]}
      />

      <h3>SubscriberEventDataMap</h3>

      <p>
        A mapped type that extracts the data shape (everything except{" "}
        <code>type</code>) for each event. Use this when implementing a{" "}
        <code>SubscriberAdapter</code> or handling events in a switch statement.
      </p>

      <CodeBlock
        code={`type SubscriberEventDataMap = {
  [E in SubscriberEvent as E["type"]]: Omit<E, "type">;
};

// Example: SubscriberEventDataMap["text_delta"] = { text: string }`}
        language="typescript"
      />

      <h3>SubscriberAdapter</h3>

      <p>
        Interface for receiving events. Both the React hook subscriber and
        GloveVoice implement this. The <code>record</code> method is generic
        over the event type.
      </p>

      <CodeBlock
        code={`interface SubscriberAdapter {
  record: <T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ) => Promise<void>;
}`}
        language="typescript"
      />

      <h3 id="custom-adapter">Implementing a Custom Model Adapter</h3>

      <p>
        When building a custom <code>ModelAdapter</code>, you must emit the
        correct events via the <code>notify</code> callback. Here is the
        minimal contract:
      </p>

      <CodeBlock
        code={`import type { ModelAdapter, NotifySubscribersFunction, PromptRequest, ModelPromptResult } from "glove-core";

class MyAdapter implements ModelAdapter {
  name = "my-provider:model-name";
  private systemPrompt?: string;

  setSystemPrompt(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult> {
    // ... call your LLM API ...

    // Non-streaming: emit a single model_response event
    await notify("model_response", {
      text: responseText,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      stop_reason: finishReason ?? undefined,
      tokens_in: usage.promptTokens,
      tokens_out: usage.completionTokens,
    });

    return { messages: [message], tokens_in: ..., tokens_out: ... };
  }
}`}
        language="typescript"
      />

      <p>For streaming adapters, emit events incrementally:</p>

      <CodeBlock
        code={`// During streaming — emit text fragments as they arrive
notify("text_delta", { text: chunk });

// When a tool call is fully assembled
await notify("tool_use", { id: toolCallId, name: toolName, input: parsedArgs });

// After the stream completes — emit the final aggregated response
await notify("model_response_complete", {
  text: fullText,
  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  stop_reason: finishReason ?? undefined,
});`}
        language="typescript"
      />

      <p>
        <strong>Key rules:</strong>
      </p>
      <ul>
        <li>
          Non-streaming adapters emit <code>model_response</code> (one event per prompt call).
        </li>
        <li>
          Streaming adapters emit <code>text_delta</code> for each text
          chunk, <code>tool_use</code> for each completed tool call, and{" "}
          <code>model_response_complete</code> once at the end.
        </li>
        <li>
          <code>stop_reason</code> should be <code>undefined</code> (not{" "}
          <code>null</code>) when unavailable. Use <code>?? undefined</code>{" "}
          to coerce provider SDK nulls.
        </li>
        <li>
          <code>tool_use_result</code>, <code>compaction_start</code>, and{" "}
          <code>compaction_end</code> are emitted by the framework — adapters
          should not emit these.
        </li>
      </ul>

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
  addTokens(args: TokenConsumptionCounter): Promise<void>;
  getTurnCount(): Promise<number>;
  incrementTurn(): Promise<void>;
  resetCounters(): Promise<void>;
  // Optional — tasks:
  getTasks?(): Promise<Task[]>;
  addTasks?(tasks: Task[]): Promise<void>;
  updateTask?(taskId: string, updates: Partial<Task>): Promise<void>;
  // Optional — permissions:
  getPermission?(toolName: string): Promise<PermissionStatus>;
  setPermission?(toolName: string, status: PermissionStatus): Promise<void>;
  // Optional — inbox:
  getInboxItems?(): Promise<InboxItem[]>;
  addInboxItem?(item: InboxItem): Promise<void>;
  updateInboxItem?(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void>;
  getResolvedInboxItems?(): Promise<InboxItem[]>;
  // Optional — subagent stores:
  createSubAgentStore?(namespace: string, durable?: boolean): Promise<StoreAdapter>;
}

interface TokenConsumptionCounter {
  tokens_in: number;
  tokens_out: number;
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
            "addTokens(args)",
            "Promise<void>",
            "Add { tokens_in, tokens_out } to the cumulative counts. getTokenCount() still returns a single sum.",
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
            "resetCounters()",
            "Promise<void>",
            "Reset token and turn counts to zero without deleting messages. Called during compaction to reset thresholds while preserving the full message history in the store.",
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
          [
            "getInboxItems?()",
            "Promise<InboxItem[]>",
            "Retrieve all inbox items. Optional. See the Inbox guide.",
          ],
          [
            "addInboxItem?(item)",
            "Promise<void>",
            "Persist a new inbox item. Optional.",
          ],
          [
            "updateInboxItem?(itemId, updates)",
            "Promise<void>",
            "Mutate an inbox item's status / response / resolved_at. Optional.",
          ],
          [
            "getResolvedInboxItems?()",
            "Promise<InboxItem[]>",
            "Retrieve only items in the resolved status. Optional.",
          ],
          [
            "createSubAgentStore?(namespace, durable?)",
            "Promise<StoreAdapter>",
            "Derive a child store for a subagent. With durable: false (default) every invocation returns a fresh store; with durable: true the same child store is returned for the same namespace so the subagent accumulates history across calls. Optional — when absent, subagent factories must construct their own store.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* MEMORY STORE                                                       */}
      {/* ================================================================== */}
      <h2 id="memory-store">MemoryStore</h2>

      <p>
        In-process implementation of <code>StoreAdapter</code> shipped with{" "}
        <code>glove-core</code>. Used as the default store when{" "}
        <code>Glove</code> is constructed without one. All data lives in
        memory and is lost when the instance is garbage-collected — perfect
        for prototypes, scripts, tests, and short-lived sessions.
      </p>

      <p>
        <code>MemoryStore</code> implements every optional method, including{" "}
        <code>createSubAgentStore</code>, so subagents work out of the box
        without any extra setup. With <code>durable: true</code>, derived
        sub-stores are cached per namespace so a subagent can carry message
        history across invocations within the same parent process.
      </p>

      <CodeBlock
        code={`import { MemoryStore } from "glove-core";

const store = new MemoryStore("session-1");

// Sub-stores
const ephemeral = await store.createSubAgentStore("reviewer");           // fresh per call
const durable = await store.createSubAgentStore("planner", true);        // cached per namespace`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>new MemoryStore(identifier: string)</code>
      </p>

      {/* ================================================================== */}
      {/* SUBSCRIBER ADAPTER                                                 */}
      {/* ================================================================== */}
      <h2 id="subscriber-adapter">SubscriberAdapter</h2>

      <p>
        Interface for observing agent events. <code>record</code> is generic
        over the event type via <code>SubscriberEventDataMap</code>, so the
        compiler enforces that the data shape matches the event name.
      </p>

      <CodeBlock
        code={`interface SubscriberAdapter {
  record: <T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ) => Promise<void>;
}`}
        language="typescript"
      />

      <PropTable
        headers={["Member", "Type", "Description"]}
        rows={[
          [
            "record(event_type, data)",
            "Promise<void>",
            "Called whenever an event occurs. The event_type discriminates the data shape via the SubscriberEventDataMap.",
          ],
        ]}
      />

      <p>
        For the full list of events and payload shapes, see the{" "}
        <a href="#subscriber-events">SubscriberEvent reference</a> above.
      </p>

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
  pre_modified_text?: string;
  content?: ContentPart[];
  tool_results?: ToolResult[];
  tool_calls?: ToolCall[];
  is_compaction?: boolean;
  is_compaction_request?: boolean;
  is_skill_injection?: boolean;
  reasoning_content?: string;
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
            "The text content of the message. After hooks rewrite a user turn, this holds the rewritten text.",
          ],
          [
            "pre_modified_text?",
            "string",
            "Original user text before any hook rewrite. Useful for transcript renderers that want to show the user what they actually typed.",
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
          [
            "is_compaction?",
            "boolean",
            "When true, marks this message as a compaction summary. Context.getMessages() uses this flag to split the history at the last compaction point, so the model only sees messages from the most recent compaction onward.",
          ],
          [
            "is_compaction_request?",
            "boolean",
            "Internal marker on the synthetic user message that prompts the model for a compaction summary.",
          ],
          [
            "is_skill_injection?",
            "boolean",
            "When true, marks this message as a synthetic user turn produced by a /skill invocation (see Hooks, Skills & Mentions). Use it in transcript renderers to distinguish injected context from real user turns.",
          ],
          [
            "reasoning_content?",
            "string",
            "Provider-emitted reasoning trace captured by the OpenAI-compat adapter (when reasoning is enabled) or the MiMo adapter. DeepSeek V4 and MiMo require this to be echoed back on subsequent tool-calling turns — the adapters handle that round-trip automatically.",
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
            "input_schema?",
            "z.ZodType<I>",
            "Zod schema for input validation and JSON Schema generation. Provide either input_schema or jsonSchema.",
          ],
          [
            "jsonSchema?",
            "Record<string, unknown>",
            "Raw JSON Schema for tools bridged from MCP / OpenAPI / etc. Skips local validation. Provide either input_schema or jsonSchema.",
          ],
          [
            "requiresPermission?",
            "boolean",
            "Whether the tool requires explicit permission before execution.",
          ],
          [
            "unAbortable?",
            "boolean",
            "When true, the tool runs to completion despite abort signals. Essential for tools that perform mutations the user has committed to (e.g. checkout, payment).",
          ],
          [
            "run(input, handOver?, signal?)",
            "Promise<ToolResultData>",
            "Execute the tool with validated input. handOver delegates to the renderer / display stack. signal is the active request's AbortSignal — forward it into long-running internal work (e.g. a child Glove run) so abort propagates. Tools marked unAbortable should ignore signal.",
          ],
          [
            "generateSummary?(args)",
            "(args: unknown) => Promise<string>",
            "Optional. Called by the Executor after run() resolves when the result includes generateSummaryArgs. The returned string lands on result.summary and is swapped in for data in older messages when enableToolResultSummary is on.",
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
  status: "success" | "error" | "aborted";
  data: unknown;                 // Sent to the AI model
  message?: string;              // Error / abort message
  renderData?: unknown;          // Client-only — NOT sent to model, used by renderResult
  summary?: string;              // Set by the Executor from generateSummary — swapped in for data in older context when enableToolResultSummary is on
  generateSummaryArgs?: unknown; // Opaque args passed to the tool's generateSummary handler
}`}
        language="typescript"
      />

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "status",
            '"success" | "error" | "aborted"',
            'Outcome of the tool. The Executor synthesizes "aborted" results when an abort signal interrupts an abortable tool.',
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
          [
            "summary?",
            "string",
            "Compact string description of the result. Set by the Executor after run()/do() resolves, by calling the tool's generateSummary(generateSummaryArgs). When the Glove was constructed with enableToolResultSummary: true, the PromptMachine substitutes summary for data on every tool result older than the most recent user message before sending to the model. Untouched in the store and in renderers.",
          ],
          [
            "generateSummaryArgs?",
            "unknown",
            "Opaque payload the tool's do() returns to drive its generateSummary handler — e.g. the line range it just read, the URL it just fetched, the query it just executed. Omit it to skip summary generation for a given call.",
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
      {/* TOOL RESULT SUMMARIES                                              */}
      {/* ================================================================== */}
      <h2 id="tool-result-summaries">Tool result summaries</h2>

      <p>
        Long-running agents that read files, fetch URLs, or run queries blow
        through tokens fast — the model rarely needs the full payload of a
        tool call once a few turns have passed. Tool result summaries are an
        opt-in optimization: each tool produces a compact description of what
        it did, and that description is what older context carries instead of
        the raw payload.
      </p>

      <p>
        The mechanism has three coordinated pieces:
      </p>

      <ol>
        <li>
          <strong>Tool returns <code>generateSummaryArgs</code>.</strong> The
          tool&apos;s <code>do()</code> includes whatever the summary handler
          needs (line range, URL, query, row count) on the result.
        </li>
        <li>
          <strong>Executor calls <code>generateToolSummary</code>.</strong>{" "}
          After <code>do()</code> resolves, if the tool defined a{" "}
          <code>generateToolSummary</code> handler and the result has{" "}
          <code>generateSummaryArgs</code>, the Executor awaits it and
          assigns the returned string to <code>result.summary</code>.
        </li>
        <li>
          <strong>PromptMachine swaps <code>data</code> for{" "}
          <code>summary</code> in older context.</strong>{" "}
          When <code>Glove</code> is constructed with{" "}
          <code>enableToolResultSummary: true</code>,{" "}
          <code>PromptMachine.summarizeOlderToolResults</code> rewrites every
          tool result that sits at or before the most recent non-tool user
          message: <code>result.data</code> is replaced with{" "}
          <code>result.summary</code>. Tool results from the current turn are
          untouched, so the model still has full fidelity for what it just
          asked about.
        </li>
      </ol>

      <CodeBlock
        filename="file-read.tool.ts"
        language="typescript"
        code={`import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";

export const readFile: GloveFoldArgs<{ path: string; from?: number; to?: number }> = {
  name: "read_file",
  description: "Read a slice of a file.",
  inputSchema: z.object({
    path: z.string(),
    from: z.number().optional(),
    to: z.number().optional(),
  }),
  async do(input) {
    const content = await fs.readFile(input.path, "utf8");
    const slice = sliceLines(content, input.from, input.to);
    return {
      status: "success",
      data: slice,
      // What the summary handler needs to describe this call later.
      generateSummaryArgs: { path: input.path, from: input.from, to: input.to, lineCount: slice.split("\\n").length },
    };
  },
  async generateToolSummary(args) {
    const { path, from, to, lineCount } = args as { path: string; from?: number; to?: number; lineCount: number };
    const range = from != null || to != null ? \` lines \${from ?? 1}-\${to ?? "EOF"}\` : "";
    return \`Read \${path}\${range} (\${lineCount} lines).\`;
  },
};`}
      />

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`const agent = new Glove({
  store: new MemoryStore("session"),
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant.",
  compaction_config: { compaction_instructions: "Summarize so far." },
  enableToolResultSummary: true,
})
  .fold(readFile)
  .build();`}
      />

      <h3>What the model sees</h3>

      <p>
        Imagine the agent has executed <code>read_file</code> three turns ago
        and again on the current turn. With{" "}
        <code>enableToolResultSummary: true</code>:
      </p>

      <ul>
        <li>
          The <strong>older</strong> <code>read_file</code> result is sent as{" "}
          <code>Read src/lib/auth.ts lines 40-120 (81 lines).</code> — the
          summary, not the file contents.
        </li>
        <li>
          The <strong>current turn&apos;s</strong> <code>read_file</code>{" "}
          result is sent with the full file slice intact, so the model can
          reason about it.
        </li>
      </ul>

      <p>
        The store keeps both <code>data</code> and <code>summary</code>{" "}
        untouched on every result, so re-renders, transcripts, and
        post-hoc analytics still have the full record. Only the array of
        messages handed to the model adapter is rewritten.
      </p>

      <h3>Opt-in per tool</h3>

      <p>
        Tools that omit <code>generateToolSummary</code>, or omit{" "}
        <code>generateSummaryArgs</code> on a particular call, leave{" "}
        <code>summary</code> unset. The pruner only substitutes when{" "}
        <code>summary</code> is a non-empty string, so partially-instrumented
        tool catalogues still work — instrumented tools shrink in older
        context, uninstrumented tools keep their original data.
      </p>

      <h3>Compaction vs summaries</h3>

      <p>
        Compaction collapses an entire run of messages into a single summary
        message once token use crosses a threshold (see{" "}
        <a href="#observer">Observer</a>). Tool result summaries shrink
        individual tool payloads on every turn before compaction would have
        fired. The two compose: tool summaries delay the point at which the
        Observer needs to compact, and compaction still runs when the
        instrumented context eventually grows large enough.
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
            "<T extends SubscriberEvent['type']>(event_name: T, data: SubscriberEventDataMap[T]) => Promise<void>",
            "Type-safe callback passed to ModelAdapter.prompt for emitting events to subscribers.",
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
      {/* CONSTANTS                                                          */}
      {/* ================================================================== */}
      <h2 id="constants">Exported Constants</h2>

      <PropTable
        headers={["Name", "Value", "Description"]}
        rows={[
          [
            "SUBAGENT_DISPATCH_TOOL_NAME",
            '"glove_invoke_subagent"',
            "Tool name of the auto-registered subagent dispatch tool. The Executor recognises calls to this tool name and brackets them with subagent_invoked / subagent_completed events. Match against this constant rather than the literal string when filtering events or tool calls.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* COMPACTION CONFIG                                                   */}
      {/* ================================================================== */}
      <h2 id="compaction-config">CompactionConfig</h2>

      <p>
        Compaction is history-preserving. When triggered, the full conversation
        is summarized and the summary is appended as a new message with{" "}
        <code>is_compaction: true</code>. No messages are deleted from the
        store, so frontends can still display the complete history. The model
        only sees messages from the last compaction point onward, courtesy of{" "}
        <code>splitAtLastCompaction()</code> in{" "}
        <code>Context.getMessages()</code>.
      </p>

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
            "Provider ID. One of: openai, anthropic, openrouter, gemini, minimax, kimi, glm, mimo, ollama, lmstudio, bedrock.",
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
          [
            "baseURL?",
            "string",
            "Override the provider's default base URL (e.g., custom port for local LLMs).",
          ],
          [
            "timeout?",
            "number",
            "Request timeout in milliseconds. Useful for slow local LLMs. Defaults to 10 minutes (600_000).",
          ],
          [
            "reasoning?",
            "boolean | OpenAICompatReasoningOptions",
            'Reasoning / thinking support for OpenAI-compatible providers. Pass true for sensible defaults (capture provider-emitted reasoning_content / reasoning into Message.reasoning_content, echo on tool turns) or an object for fine-grained control (effort, reasoningObject, thinking, extraBody, includeInText, echo). Ignored by the Anthropic, Bedrock, and MiMo paths.',
          ],
          [
            "reasoningEffort?",
            '"minimal" | "low" | "medium" | "high"',
            'Hint how much the model should think. Sent as the top-level reasoning_effort request field on the OpenAI-compat path (GPT-5/o-series, GLM-4.5/4.6, MiniMax M2.5, Kimi K2, DeepSeek V4) and mapped onto MiMo\'s existing knob. "minimal" is GPT-5-specific. On adaptive models like mimo-v2.5-pro, "low"/"medium" can suppress thinking — use "high" for consistently deep reasoning.',
          ],
          [
            "includeReasoningInText?",
            "boolean",
            'When true, wrap reasoning in <think>…</think> and prepend to the visible message text. Defaults to false — the trace stays on Message.reasoning_content. Honoured by the OpenAI-compat and MiMo adapters.',
          ],
        ]}
      />

      <h3>OpenAICompatReasoningOptions</h3>

      <p>
        Fine-grained reasoning configuration for OpenAI-compatible providers.
        Captures provider-emitted reasoning traces (
        <code>reasoning_content</code> per the DeepSeek / Qwen / GLM / Kimi /
        MiniMax / MiMo convention, or <code>reasoning</code> per OpenRouter
        normalization) and routes thinking-related request knobs.
      </p>

      <CodeBlock
        code={`interface OpenAICompatReasoningOptions {
  /** Wrap reasoning in <think>...</think> and prepend to visible text. Default false. */
  includeInText?: boolean;
  /** Echo Message.reasoning_content back on tool-calling turns. Default true. */
  echo?: boolean;
  /** Top-level reasoning_effort request field. */
  effort?: "minimal" | "low" | "medium" | "high";
  /** OpenRouter-style reasoning object — sent verbatim. */
  reasoningObject?: {
    effort?: "low" | "medium" | "high";
    max_tokens?: number;
    exclude?: boolean;
    enabled?: boolean;
  };
  /** Anthropic-style thinking object — for OpenAI shims that forward it. */
  thinking?: { type: "enabled" | "disabled"; budget_tokens?: number };
  /** Escape hatch — merged into request body. For Qwen3 dashscope's enable_thinking etc. */
  extraBody?: Record<string, unknown>;
}`}
        language="typescript"
      />

      <p>Common patterns:</p>

      <CodeBlock
        code={`// Sensible defaults: capture + echo on tool-calling turns.
createAdapter({ provider: "openai", reasoning: true });

// Hint thinking depth — DeepSeek V4, GLM, MiniMax, Kimi, GPT-5/o-series.
createAdapter({ provider: "openai", reasoning: { effort: "high" } });

// OpenRouter's unified reasoning object.
createAdapter({
  provider: "openrouter",
  reasoning: { reasoningObject: { effort: "high", max_tokens: 2000 } },
});

// Qwen3 dashscope's enable_thinking.
createAdapter({
  provider: "openai",
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  reasoning: { extraBody: { enable_thinking: true, thinking_budget: 1024 } },
});

// Surface reasoning in the visible message text.
createAdapter({ provider: "openai", reasoning: { includeInText: true } });

// Disable echo (DeepSeek-R1 specifically — newer V4 needs echo on).
createAdapter({ provider: "openai", reasoning: { echo: false } });`}
        language="typescript"
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
          ["mimo", "MIMO_API_KEY", "mimo-v2.5"],
          ["ollama", "(none)", "(user-specified)"],
          ["lmstudio", "(none)", "(user-specified)"],
          ["bedrock", "AWS_ACCESS_KEY_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0"],
        ]}
      />

      <p>
        Each provider has properties: <code>id</code>, <code>name</code>,{" "}
        <code>baseURL</code>, <code>envVar</code>, <code>defaultModel</code>,{" "}
        <code>models[]</code>, <code>format</code> (either{" "}
        <code>&quot;openai&quot;</code>, <code>&quot;anthropic&quot;</code>, or{" "}
        <code>&quot;bedrock&quot;</code>),{" "}
        <code>defaultMaxTokens</code>, and <code>requiresApiKey</code>.
      </p>

      <p>
        Local providers (<code>ollama</code> and <code>lmstudio</code>) don&apos;t
        require an API key and have no default model — you must pass a{" "}
        <code>model</code> name. Use <code>baseURL</code> to override the default
        port if needed:
      </p>

      <CodeBlock
        code={`const model = createAdapter({
  provider: "ollama",
  model: "llama3",
  baseURL: "http://localhost:9999/v1", // optional, defaults to :11434
});`}
        language="typescript"
      />
    </div>
  );
}
