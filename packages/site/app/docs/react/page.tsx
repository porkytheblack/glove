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

export default function ReactPage() {
  return (
    <div className="docs-content">
      <h1>@glove/react</h1>

      <p>
        Complete API reference for the React bindings package. Provides a
        declarative, hook-based interface for building agent-powered
        applications.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="glove-client">GloveClient</h2>

      <p>
        Central configuration object. Created once and passed to{" "}
        <code>GloveProvider</code>. Holds defaults for system prompt, tools,
        model/store factories, compaction, and subscribers.
      </p>

      <CodeBlock
        code={`import { GloveClient } from "@glove/react";

const client = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant.",
  tools: [/* ... */],
  compaction: {
    compaction_instructions: "Summarize the conversation so far.",
    max_turns: 20,
  },
  subscribers: [],
});`}
        language="typescript"
      />

      <h3>Constructor</h3>

      <p>
        <code>new GloveClient(config: GloveClientConfig)</code>
      </p>

      <h3>GloveClientConfig</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "endpoint?",
            "string",
            "URL of the chat endpoint. Used by the default createEndpointModel factory. Mutually exclusive with createModel.",
          ],
          [
            "createModel?",
            "() => ModelAdapter",
            "Factory function that returns a ModelAdapter. Overrides endpoint when provided.",
          ],
          [
            "createStore?",
            "(sessionId: string) => StoreAdapter",
            "Factory function that returns a StoreAdapter for a given session. Defaults to in-memory MemoryStore.",
          ],
          [
            "systemPrompt?",
            "string",
            "Default system prompt sent with every model request.",
          ],
          [
            "tools?",
            "ToolConfig[]",
            "Array of tool definitions available to the agent.",
          ],
          [
            "compaction?",
            "CompactionConfig",
            "Configuration for context window compaction. See CompactionConfig.",
          ],
          [
            "subscribers?",
            "SubscriberAdapter[]",
            "Array of subscriber adapters that receive streaming events.",
          ],
        ]}
      />

      <h3>Instance Properties</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "systemPrompt?",
            "string",
            "The system prompt provided at construction.",
          ],
          [
            "tools?",
            "ToolConfig[]",
            "Tool definitions provided at construction.",
          ],
          [
            "compaction?",
            "CompactionConfig",
            "Compaction configuration provided at construction.",
          ],
          [
            "subscribers?",
            "SubscriberAdapter[]",
            "Subscriber adapters provided at construction.",
          ],
        ]}
      />

      <h3>Methods</h3>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "resolveModel()",
            "ModelAdapter",
            "Returns the model adapter. Uses createModel factory if provided, otherwise creates an endpoint model from endpoint. Marked @internal.",
          ],
          [
            "resolveStore(sessionId)",
            "StoreAdapter",
            "Returns a store adapter for the given session ID. Uses createStore factory if provided, otherwise creates a MemoryStore. Marked @internal.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="glove-provider">GloveProvider</h2>

      <p>
        React context provider that makes a <code>GloveClient</code> available
        to all descendant components via <code>useGloveClient()</code> and{" "}
        <code>useGlove()</code>.
      </p>

      <CodeBlock
        code={`import { GloveProvider } from "@glove/react";

function App() {
  return (
    <GloveProvider client={client}>
      <ChatInterface />
    </GloveProvider>
  );
}`}
        language="tsx"
      />

      <PropTable
        headers={["Prop", "Type", "Description"]}
        rows={[
          [
            "client",
            "GloveClient",
            "The GloveClient instance to provide to the component tree.",
          ],
          [
            "children",
            "ReactNode",
            "Child components that can access the client via hooks.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="use-glove">useGlove</h2>

      <p>
        The primary hook for interacting with a Glove agent. Returns the full
        agent state and action methods. Can be called with no arguments to
        inherit everything from the nearest <code>GloveProvider</code>, or with
        a config object to override specific fields.
      </p>

      <CodeBlock
        code={`import { useGlove } from "@glove/react";

function Chat() {
  const {
    timeline,
    streamingText,
    busy,
    slots,
    tasks,
    stats,
    sendMessage,
    abort,
    renderSlot,
    resolveSlot,
    rejectSlot,
  } = useGlove();

  return (
    <div>
      {timeline.map((entry, i) => (
        <div key={i}>
          {entry.kind === "user" && <p>{entry.text}</p>}
          {entry.kind === "agent_text" && <p>{entry.text}</p>}
          {entry.kind === "tool" && <p>Tool: {entry.name}</p>}
        </div>
      ))}
      {streamingText && <p>{streamingText}</p>}
      {slots.map(renderSlot)}
    </div>
  );
}`}
        language="tsx"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function useGlove(config?: UseGloveConfig): UseGloveReturn`}
        language="typescript"
      />

      <h3>UseGloveConfig</h3>

      <p>
        All fields are optional. When omitted, values are inherited from the
        nearest <code>GloveClient</code> via context.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "endpoint?",
            "string",
            "Override the chat endpoint URL for this hook instance.",
          ],
          [
            "sessionId?",
            "string",
            "Session identifier. Different IDs produce independent conversation histories.",
          ],
          [
            "store?",
            "StoreAdapter",
            "Override the store adapter for this hook instance.",
          ],
          [
            "model?",
            "ModelAdapter",
            "Override the model adapter for this hook instance.",
          ],
          [
            "systemPrompt?",
            "string",
            "Override the system prompt for this hook instance.",
          ],
          [
            "tools?",
            "ToolConfig[]",
            "Override the tool definitions for this hook instance.",
          ],
          [
            "compaction?",
            "CompactionConfig",
            "Override compaction configuration for this hook instance.",
          ],
          [
            "subscribers?",
            "SubscriberAdapter[]",
            "Override subscribers for this hook instance.",
          ],
        ]}
      />

      <h3>UseGloveReturn</h3>

      <p>
        Extends <code>GloveState</code> with action methods.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "busy",
            "boolean",
            "True while the agent is processing a request (prompting the model or executing tools).",
          ],
          [
            "timeline",
            "TimelineEntry[]",
            "Ordered list of conversation entries: user messages, agent text responses, and tool invocations.",
          ],
          [
            "streamingText",
            "string",
            "Accumulated text from the current streaming model response. Empty string when not streaming.",
          ],
          [
            "tasks",
            "Task[]",
            "Current task list managed by the agent via the built-in task tool.",
          ],
          [
            "slots",
            "Slot<unknown>[]",
            "Active display stack slots pushed by tools via pushAndWait or pushAndForget.",
          ],
          [
            "stats",
            "GloveStats",
            "Cumulative usage statistics for the current session.",
          ],
          [
            "sendMessage(text, images?)",
            "void",
            "Send a user message to the agent. Optionally include images as ContentPart[]. No-op if busy is true.",
          ],
          [
            "abort()",
            "void",
            "Abort the current agent request. Triggers AbortError in the agent loop.",
          ],
          [
            "resolveSlot(slotId, value)",
            "void",
            "Resolve a pushAndWait slot with a value, unblocking the tool that created it.",
          ],
          [
            "rejectSlot(slotId, reason?)",
            "void",
            "Reject a pushAndWait slot with an optional reason string, causing the tool's pushAndWait call to throw.",
          ],
          [
            "renderSlot(slot)",
            "ReactNode",
            "Render a slot using its associated renderer. Returns null if no renderer is registered for the slot's renderer key.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="use-glove-client">useGloveClient</h2>

      <p>
        Returns the nearest <code>GloveClient</code> from context, or{" "}
        <code>null</code> if no <code>GloveProvider</code> is present. This is
        an internal hook used by <code>useGlove</code>.
      </p>

      <CodeBlock
        code={`import { useGloveClient } from "@glove/react";

function DebugPanel() {
  const client = useGloveClient();
  if (!client) return <p>No GloveProvider found.</p>;
  return <pre>{client.systemPrompt}</pre>;
}`}
        language="tsx"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function useGloveClient(): GloveClient | null`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="tool-config">ToolConfig</h2>

      <p>
        Defines a tool that the agent can invoke. Combines the schema (for the
        model) with the implementation (for the runtime) and an optional React
        renderer (for the display stack).
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "name",
            "string",
            "Unique tool name. The model uses this to identify which tool to call.",
          ],
          [
            "description",
            "string",
            "Human-readable description of what the tool does. The model reads this to decide when to use the tool.",
          ],
          [
            "inputSchema",
            "z.ZodType<I>",
            "Zod schema defining the tool's input shape. Converted to JSON Schema for the model and used for runtime validation.",
          ],
          [
            "do",
            "(input: I, display: ToolDisplay) => Promise<unknown>",
            "The tool's implementation. Receives validated input and a display adapter for pushing UI slots. Return value is sent back to the model as the tool result.",
          ],
          [
            "render?",
            "(props: SlotRenderProps) => ReactNode",
            "Optional React component for rendering this tool's display slots. When provided, the framework auto-registers a renderer keyed by the tool name.",
          ],
          [
            "requiresPermission?",
            "boolean",
            "When true, the agent will check the store for permission before executing this tool. Defaults to false.",
          ],
        ]}
      />

      <CodeBlock
        code={`import { z } from "zod";
import type { ToolConfig } from "@glove/react";

const weatherTool: ToolConfig<{ city: string }> = {
  name: "get_weather",
  description: "Get current weather for a city.",
  inputSchema: z.object({ city: z.string() }),
  async do(input) {
    const res = await fetch(\`https://api.weather.example/v1?city=\${input.city}\`);
    return res.json();
  },
};`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="tool-display">ToolDisplay</h2>

      <p>
        The display adapter passed as the second argument to a tool&apos;s{" "}
        <code>do</code> function. Provides methods to push UI slots onto the
        display stack.
      </p>

      <PropTable
        headers={["Method", "Returns", "Description"]}
        rows={[
          [
            "pushAndWait<I, O>(slot)",
            "Promise<O>",
            "Push a slot onto the display stack and block until the user resolves or rejects it. The slot object has optional renderer (string) and required input (I). Returns the resolved value of type O.",
          ],
          [
            "pushAndForget<I>(slot)",
            "Promise<string>",
            "Push a slot onto the display stack without blocking. Returns the slot ID. The slot object has optional renderer (string) and required input (I).",
          ],
        ]}
      />

      <CodeBlock
        code={`const confirmTool: ToolConfig<{ message: string }> = {
  name: "confirm",
  description: "Ask the user to confirm an action.",
  inputSchema: z.object({ message: z.string() }),
  async do(input, display) {
    const confirmed = await display.pushAndWait<{ message: string }, boolean>({
      input,
    });
    return confirmed ? "User confirmed." : "User declined.";
  },
  render({ data, resolve }) {
    return (
      <div>
        <p>{data.message}</p>
        <button onClick={() => resolve(true)}>Yes</button>
        <button onClick={() => resolve(false)}>No</button>
      </div>
    );
  },
};`}
        language="tsx"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="slot-render-props">SlotRenderProps</h2>

      <p>
        Props passed to a tool&apos;s <code>render</code> function when
        rendering a display slot.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "data",
            "T",
            "The input data that was passed to pushAndWait or pushAndForget.",
          ],
          [
            "resolve",
            "(value: unknown) => void",
            "Call this to resolve the slot. For pushAndWait slots, the value is returned to the tool. For pushAndForget slots, this removes the slot from the stack.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="timeline-entry">TimelineEntry</h2>

      <p>
        A discriminated union representing one entry in the conversation
        timeline. The <code>kind</code> field determines the shape.
      </p>

      <CodeBlock
        code={`type TimelineEntry =
  | { kind: "user"; text: string; images?: ContentPart[] }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: string; output?: unknown };`}
        language="typescript"
      />

      <PropTable
        headers={["Kind", "Fields", "Description"]}
        rows={[
          [
            '"user"',
            "text, images?",
            "A user message. May include optional image content parts.",
          ],
          [
            '"agent_text"',
            "text",
            "A text response from the agent (model output).",
          ],
          [
            '"tool"',
            "id, name, input, status, output?",
            "A tool invocation. Shows the tool name, its input arguments, execution status, and optional output.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="glove-state">GloveState</h2>

      <p>
        The reactive state object that drives the UI. All properties in{" "}
        <code>UseGloveReturn</code> are inherited from this type plus the action
        methods.
      </p>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "busy",
            "boolean",
            "Whether the agent is currently processing a request.",
          ],
          [
            "timeline",
            "TimelineEntry[]",
            "Full conversation timeline for rendering.",
          ],
          [
            "streamingText",
            "string",
            "Current streaming text buffer. Empty when idle.",
          ],
          ["tasks", "Task[]", "Current task list maintained by the agent."],
          [
            "slots",
            "Slot<unknown>[]",
            "Active display stack slots awaiting render.",
          ],
          [
            "stats",
            "GloveStats",
            "Cumulative session statistics: turns, tokens in, tokens out.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="glove-stats">GloveStats</h2>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["turns", "number", "Number of completed agent turns in this session."],
          [
            "tokens_in",
            "number",
            "Total input tokens consumed across all model calls.",
          ],
          [
            "tokens_out",
            "number",
            "Total output tokens generated across all model calls.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="compaction-config">CompactionConfig</h2>

      <p>
        Controls automatic context window compaction. When the conversation
        exceeds limits, it is summarized and the history is replaced with the
        summary to free up context space.
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
            "Maximum number of turns before compaction is triggered.",
          ],
          [
            "compaction_context_limit?",
            "number",
            "Maximum token count before compaction is triggered.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="memory-store">MemoryStore</h2>

      <p>
        An in-memory implementation of <code>StoreAdapter</code>. Data is lost
        when the page is refreshed. Useful for prototyping and ephemeral
        sessions.
      </p>

      <CodeBlock
        code={`import { MemoryStore } from "@glove/react";

const store = new MemoryStore("session-1");`}
        language="typescript"
      />

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "identifier",
            "string",
            "The session identifier passed to the constructor.",
          ],
        ]}
      />

      <p>
        Implements the full <code>StoreAdapter</code> interface: messages, token
        counts, turn counts, tasks, and permissions are all stored in memory.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="create-remote-store">createRemoteStore</h2>

      <p>
        Factory function that creates a <code>StoreAdapter</code> backed by
        remote async functions. Delegates every store operation to user-provided
        action functions, enabling persistence on any backend.
      </p>

      <CodeBlock
        code={`import { createRemoteStore } from "@glove/react";

const store = createRemoteStore("session-123", {
  async getMessages(sessionId) {
    const res = await fetch(\`/api/sessions/\${sessionId}/messages\`);
    return res.json();
  },
  async appendMessages(sessionId, messages) {
    await fetch(\`/api/sessions/\${sessionId}/messages\`, {
      method: "POST",
      body: JSON.stringify(messages),
    });
  },
});`}
        language="typescript"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function createRemoteStore(
  sessionId: string,
  actions: RemoteStoreActions
): StoreAdapter`}
        language="typescript"
      />

      <h3>RemoteStoreActions</h3>

      <PropTable
        headers={["Method", "Type", "Description"]}
        rows={[
          [
            "getMessages",
            "(sessionId: string) => Promise<Message[]>",
            "Fetch all messages for the session. Required.",
          ],
          [
            "appendMessages",
            "(sessionId: string, msgs: Message[]) => Promise<void>",
            "Append new messages to the session history. Required.",
          ],
          [
            "getTokenCount?",
            "(sessionId: string) => Promise<number>",
            "Get the current token count for the session.",
          ],
          [
            "addTokens?",
            "(sessionId: string, count: number) => Promise<void>",
            "Add to the cumulative token count.",
          ],
          [
            "getTurnCount?",
            "(sessionId: string) => Promise<number>",
            "Get the current turn count.",
          ],
          [
            "incrementTurn?",
            "(sessionId: string) => Promise<void>",
            "Increment the turn counter by one.",
          ],
          [
            "resetHistory?",
            "(sessionId: string) => Promise<void>",
            "Clear the conversation history (used during compaction).",
          ],
          [
            "getTasks?",
            "(sessionId: string) => Promise<Task[]>",
            "Fetch all tasks for the session.",
          ],
          [
            "addTasks?",
            "(sessionId: string, tasks: Task[]) => Promise<void>",
            "Add new tasks to the session.",
          ],
          [
            "updateTask?",
            "(sessionId: string, taskId: string, updates: Partial<Task>) => Promise<void>",
            "Update a specific task by ID.",
          ],
          [
            "getPermission?",
            "(sessionId: string, toolName: string) => Promise<PermissionStatus>",
            "Check the permission status for a tool.",
          ],
          [
            "setPermission?",
            "(sessionId: string, toolName: string, status: PermissionStatus) => Promise<void>",
            "Set the permission status for a tool.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="create-remote-model">createRemoteModel</h2>

      <p>
        Factory function that creates a <code>ModelAdapter</code> backed by
        user-provided async functions. Enables calling any model backend,
        whether it is a custom server, a proxy, or a third-party API.
      </p>

      <CodeBlock
        code={`import { createRemoteModel } from "@glove/react";

const model = createRemoteModel("my-model", {
  async prompt(request) {
    const res = await fetch("/api/custom-llm", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.json();
  },
});`}
        language="typescript"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function createRemoteModel(
  name: string,
  actions: RemoteModelActions
): ModelAdapter`}
        language="typescript"
      />

      <h3>RemoteModelActions</h3>

      <PropTable
        headers={["Method", "Type", "Description"]}
        rows={[
          [
            "prompt",
            "(request: RemotePromptRequest, signal?: AbortSignal) => Promise<RemotePromptResponse>",
            "Send a prompt to the model and receive a complete response. Required.",
          ],
          [
            "promptStream?",
            "(request: RemotePromptRequest, signal?: AbortSignal) => AsyncIterable<RemoteStreamEvent>",
            "Send a prompt and receive a stream of events. When provided, the adapter uses streaming for real-time text output.",
          ],
        ]}
      />

      <h3>RemotePromptRequest</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "systemPrompt",
            "string",
            "The system prompt for this request.",
          ],
          [
            "messages",
            "Message[]",
            "The conversation history to send to the model.",
          ],
          [
            "tools?",
            "SerializedTool[]",
            "Tool definitions serialized as JSON Schema objects.",
          ],
        ]}
      />

      <h3>RemotePromptResponse</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "message",
            "Message",
            "The model's response message, including any tool calls.",
          ],
          [
            "tokens_in",
            "number",
            "Number of input tokens consumed by this request.",
          ],
          [
            "tokens_out",
            "number",
            "Number of output tokens generated by this request.",
          ],
        ]}
      />

      <h3>RemoteStreamEvent</h3>

      <p>
        A discriminated union of server-sent event types. The{" "}
        <code>type</code> field determines the payload shape.
      </p>

      <CodeBlock
        code={`type RemoteStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "done"; tokens_in: number; tokens_out: number };`}
        language="typescript"
      />

      <PropTable
        headers={["Type", "Fields", "Description"]}
        rows={[
          [
            '"text_delta"',
            "text",
            "A chunk of streaming text from the model.",
          ],
          [
            '"tool_use"',
            "id, name, input",
            "The model is invoking a tool with the given name and input arguments.",
          ],
          [
            '"done"',
            "tokens_in, tokens_out",
            "The stream is complete. Includes final token counts.",
          ],
        ]}
      />

      <h3>SerializedTool</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["name", "string", "The tool name."],
          ["description", "string", "The tool description."],
          [
            "parameters",
            "Record<string, unknown>",
            "JSON Schema representation of the tool's input parameters.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="create-endpoint-model">createEndpointModel</h2>

      <p>
        Creates a <code>ModelAdapter</code> that communicates with a server
        endpoint via SSE (Server-Sent Events). This is the default model
        adapter when using <code>GloveClient</code> with an{" "}
        <code>endpoint</code> URL. Compatible with endpoints created by{" "}
        <code>@glove/next</code>&apos;s <code>createChatHandler</code>.
      </p>

      <CodeBlock
        code={`import { createEndpointModel } from "@glove/react";

const model = createEndpointModel("/api/chat");`}
        language="typescript"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function createEndpointModel(endpoint: string): ModelAdapter`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="parse-sse-stream">parseSSEStream</h2>

      <p>
        Utility function that parses a <code>Response</code> object containing
        SSE data into an async iterable of <code>RemoteStreamEvent</code>{" "}
        objects. Used internally by <code>createEndpointModel</code> and
        available for custom streaming implementations.
      </p>

      <CodeBlock
        code={`import { parseSSEStream } from "@glove/react";

const response = await fetch("/api/chat", { method: "POST", body: "..." });

for await (const event of parseSSEStream(response)) {
  if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}`}
        language="typescript"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function parseSSEStream(response: Response): AsyncIterable<RemoteStreamEvent>`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="re-exported-types">Re-exported Types</h2>

      <p>
        The following types are re-exported from <code>@glove/core</code> for
        convenience. See the{" "}
        <a href="/docs/core">@glove/core reference</a> for full details.
      </p>

      <PropTable
        headers={["Type", "Source", "Description"]}
        rows={[
          [
            "Task",
            "@glove/core",
            "A tracked task with id, content, activeForm, and status.",
          ],
          [
            "ContentPart",
            "@glove/core",
            "A multimodal content part (text, image, video, document).",
          ],
          [
            "Slot",
            "display-manager",
            "A display stack slot with id, renderer key, and input data.",
          ],
          [
            "StoreAdapter",
            "@glove/core",
            "Interface for conversation persistence backends.",
          ],
          [
            "ModelAdapter",
            "@glove/core",
            "Interface for language model providers.",
          ],
          [
            "SubscriberAdapter",
            "@glove/core",
            "Interface for event observers (logging, streaming, analytics).",
          ],
        ]}
      />
    </div>
  );
}
