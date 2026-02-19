# Glove API Reference

## glove-core

### Glove Class (Builder)

```typescript
import { Glove } from "glove-core";

const agent = new Glove({
  store: StoreAdapter,                    // Required — persistence
  model: ModelAdapter,                    // Required — LLM provider
  displayManager: DisplayManagerAdapter,  // Required — UI slot management
  systemPrompt: string,                   // Required — system instructions
  maxRetries?: number,                    // Tool retry limit (default: 3)
  compaction_config: {                    // Required
    compaction_instructions: string,      // Summarization prompt
    max_turns?: number,                   // Turn limit (default: 120)
    compaction_context_limit?: number,    // Token threshold (default: 100k)
  },
})
  .fold<I>(toolArgs)          // Register tool (chainable)
  .addSubscriber(subscriber)  // Add event subscriber (chainable)
  .build();                   // Returns IGloveRunnable

await agent.processRequest("Hello", abortSignal?);  // Also accepts ContentPart[]
agent.setModel(newModelAdapter);  // Hot-swap model at runtime
```

### GloveFoldArgs<I>

```typescript
{
  name: string,
  description: string,
  inputSchema: z.ZodType<I>,
  requiresPermission?: boolean,
  do: (input: I, display: DisplayManagerAdapter) => Promise<ToolResultData>,
}
```

### DisplayManager

```typescript
import { Displaymanager } from "glove-core";

const dm = new Displaymanager();
dm.subscribe((stack) => { /* stack changed */ });  // Returns unsubscribe fn

// Non-blocking — returns slot ID
const slotId = await dm.pushAndForget({ renderer?: string, input: data });

// Blocking — returns resolved value
const result = await dm.pushAndWait({ renderer?: string, input: data });

dm.resolve(slotId, value);     // Unblock pushAndWait
dm.reject(slotId, error);      // Reject pushAndWait
dm.removeSlot(slotId);         // Remove from stack
await dm.clearStack();         // Clear all slots
```

### StoreAdapter Interface

```typescript
interface StoreAdapter {
  identifier: string;
  getMessages(): Promise<Message[]>;
  appendMessages(msgs: Message[]): Promise<void>;
  getTokenCount(): Promise<number>;
  addTokens(count: number): Promise<void>;
  getTurnCount(): Promise<number>;
  incrementTurn(): Promise<void>;
  resetCounters(): Promise<void>;  // Reset token/turn counts without deleting messages
  // Optional — enables built-in task tool when present:
  getTasks?(): Promise<Task[]>;
  addTasks?(tasks: Task[]): Promise<void>;
  updateTask?(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>): Promise<void>;
  // Optional — enables permission system:
  getPermission?(toolName: string): Promise<PermissionStatus>;
  setPermission?(toolName: string, status: PermissionStatus): Promise<void>;
}
```

**Implementations**: `SqliteStore` (glove-core), `MemoryStore` (glove-react), `createRemoteStore` (glove-react)

### SqliteStore

```typescript
import { SqliteStore } from "glove-core";

const store = new SqliteStore({ dbPath: ":memory:", sessionId: "abc123" });
// Additional methods: getName(), setName(), getWorkingDir(), setWorkingDir(), close()
// Static: SqliteStore.listSessions(dbPath)
```

### ModelAdapter Interface

```typescript
interface ModelAdapter {
  name: string;
  prompt(request: PromptRequest, notify: NotifySubscribersFunction, signal?: AbortSignal): Promise<ModelPromptResult>;
  setSystemPrompt(systemPrompt: string): void;
}
```

**Built-in adapters**: `AnthropicAdapter`, `OpenAICompatAdapter`, `OpenRouterAdapter`

### createAdapter (Provider Factory)

```typescript
import { createAdapter, getAvailableProviders } from "glove-core/models/providers";

const model = createAdapter({
  provider: "anthropic",         // openai | anthropic | openrouter | gemini | minimax | kimi | glm
  model?: "claude-sonnet-4-20250514",
  apiKey?: string,               // Defaults to env var
  maxTokens?: number,
  stream?: boolean,              // Default: true
});

const available = getAvailableProviders();
// [{ id, name, available, models, defaultModel }]
```

### SubscriberAdapter

```typescript
interface SubscriberAdapter {
  record(event_type: string, data: any): Promise<void>;
}
```

**Events emitted:**

| Event | Data | When |
|-------|------|------|
| `text_delta` | `{ text: string }` | Streaming text chunk |
| `tool_use` | `{ id, name, input }` | Tool call started |
| `tool_use_result` | `{ tool_name, call_id?, result }` | Tool finished |
| `model_response` | `{ text, tool_calls }` | Non-streaming turn complete |
| `model_response_complete` | `{ text, tool_calls }` | Streaming turn complete |

### Message

```typescript
interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  content?: ContentPart[];
  tool_results?: ToolResult[];
  tool_calls?: ToolCall[];
  is_compaction?: boolean;  // true for compaction summary messages
}
```

### Core Types

```typescript
interface ToolCall { tool_name: string; input_args: unknown; id?: string; }
interface ToolResult { tool_name: string; call_id?: string; result: ToolResultData; }
interface Task { id: string; content: string; activeForm: string; status: "pending" | "in_progress" | "completed"; }
type PermissionStatus = "granted" | "denied" | "unset";
```

### ToolResultData

```typescript
interface ToolResultData {
  status: "success" | "error";
  data: unknown;          // Sent to the AI model
  message?: string;       // Error message (for status: "error")
  renderData?: unknown;   // Client-only — NOT sent to model, used by renderResult
}
```

**Note:** Model adapters (Anthropic, OpenAI-compat) explicitly destructure and only send `data`, `status`, and `message` to the API. `renderData` is preserved in the store for client-side rendering but never reaches the AI.

### Built-in Task Tool

Auto-registered when store has `getTasks` and `addTasks`:

```typescript
import { createTaskTool } from "glove-core";
const taskTool = createTaskTool(context); // name: "glove_update_tasks"
```

### AbortError

```typescript
import { AbortError } from "glove-core";
try { await agent.processRequest("Hello", signal); }
catch (err) { if (err instanceof AbortError) { /* cancelled */ } }
```

---

## glove-react

### GloveClient

```typescript
import { GloveClient } from "glove-react";

const client = new GloveClient({
  endpoint?: string,                       // Chat endpoint URL
  createModel?: () => ModelAdapter,        // Custom model factory (overrides endpoint)
  createStore?: (sessionId: string) => StoreAdapter,  // Custom store factory
  systemPrompt?: string,
  tools?: ToolConfig[],
  compaction?: CompactionConfig,
  subscribers?: SubscriberAdapter[],
});
```

### GloveProvider

```tsx
import { GloveProvider } from "glove-react";
<GloveProvider client={gloveClient}>{children}</GloveProvider>
```

### useGlove

```typescript
const {
  busy, timeline, streamingText, tasks, slots, stats,
  sendMessage, abort, renderSlot, renderToolResult, resolveSlot, rejectSlot,
} = useGlove(config?: UseGloveConfig);
```

`UseGloveConfig` fields (all optional overrides): `endpoint`, `sessionId`, `store`, `model`, `systemPrompt`, `tools`, `compaction`, `subscribers`

### GloveHandle

The interface consumed by `<Render>`, returned by `useGlove()`:

```typescript
interface GloveHandle {
  timeline: TimelineEntry[];
  streamingText: string;
  busy: boolean;
  slots: EnhancedSlot[];
  sendMessage: (text: string, images?: { data: string; media_type: string }[]) => void;
  abort: () => void;
  renderSlot: (slot: EnhancedSlot) => ReactNode;
  renderToolResult: (entry: ToolEntry) => ReactNode;
  resolveSlot: (slotId: string, value: unknown) => void;
  rejectSlot: (slotId: string, reason?: string) => void;
}
```

### ToolConfig

```typescript
interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  do: (input: I, display: ToolDisplay) => Promise<ToolResultData>;
  render?: (props: SlotRenderProps) => ReactNode;
  renderResult?: (props: ToolResultRenderProps) => ReactNode;
  displayStrategy?: SlotDisplayStrategy;
  requiresPermission?: boolean;
}
```

### defineTool

Type-safe tool definition helper with colocated renderers. Preferred over raw `ToolConfig` for tools with display UI.

```typescript
import { defineTool } from "glove-react";

const tool = defineTool<I, D, R>({
  name: string,
  description: string,
  inputSchema: I,                          // z.ZodType — tool input schema
  displayPropsSchema?: D,                  // z.ZodType — display props schema (recommended for tools with UI)
  resolveSchema?: R,                       // z.ZodType — resolve value schema (default: z.ZodVoid)
  displayStrategy?: SlotDisplayStrategy,
  requiresPermission?: boolean,
  do(input: z.infer<I>, display: TypedDisplay<z.infer<D>, z.infer<R>>): Promise<ToolResultData>,
  render?({ props, resolve, reject }): ReactNode,
  renderResult?({ data, output, status }): ReactNode,
});
```

**Notes:**
- Returns a `ToolConfig` — compatible with `GloveClient.tools` and `useGlove` config
- `do()` receives a `TypedDisplay` with typed `pushAndWait`/`pushAndForget`
- `render()` receives typed `props` (from displayPropsSchema) and typed `resolve` (from resolveSchema)
- `renderResult()` receives `renderData` from the tool result for history rendering
- Raw return values from `do()` are auto-wrapped into `{ status: "success", data: value }`
- `displayPropsSchema` is optional but recommended — use raw `ToolConfig` for tools without display

### TypedDisplay

Typed display adapter provided to `defineTool`'s `do()` function:

```typescript
interface TypedDisplay<D, R = void> {
  pushAndWait: (input: D) => Promise<R>;
  pushAndForget: (input: D) => Promise<string>;
}
```

### ToolDisplay

Untyped display adapter provided to raw `ToolConfig`'s `do()` function:

```typescript
interface ToolDisplay {
  pushAndWait: <I, O = unknown>(slot: { renderer?: string; input: I }) => Promise<O>;
  pushAndForget: <I>(slot: { renderer?: string; input: I }) => Promise<string>;
}
```

### SlotRenderProps

```typescript
interface SlotRenderProps<T = any> {
  data: T;
  resolve: (value: unknown) => void;
  reject: (reason?: string) => void;
}
```

### ToolResultRenderProps

```typescript
interface ToolResultRenderProps<T = any> {
  data: T;            // The renderData from ToolResultData
  output?: string;    // The string output of the tool
  status: "success" | "error";
}
```

### SlotDisplayStrategy

```typescript
type SlotDisplayStrategy = "stay" | "hide-on-complete" | "hide-on-new";
```

| Strategy | Behavior |
|----------|----------|
| `"stay"` | Slot always visible (default) |
| `"hide-on-complete"` | Hidden when slot is resolved/rejected |
| `"hide-on-new"` | Hidden when a newer slot from the same tool appears |

### EnhancedSlot

```typescript
interface EnhancedSlot extends Slot<unknown> {
  toolName: string;
  toolCallId: string;
  createdAt: number;
  displayStrategy: SlotDisplayStrategy;
  status: "pending" | "resolved" | "rejected";
}
```

### TimelineEntry / ToolEntry

```typescript
type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "success" | "error"; output?: string; renderData?: unknown };

type ToolEntry = Extract<TimelineEntry, { kind: "tool" }>;
```

### Render Component

Headless render component for chat UIs:

```tsx
import { Render } from "glove-react";

interface RenderProps {
  glove: GloveHandle;                                              // Required
  strategy?: RenderStrategy;                                       // Default: "interleaved"
  renderMessage?: (props: MessageRenderProps) => ReactNode;
  renderToolStatus?: (props: ToolStatusRenderProps) => ReactNode;  // Default: hidden
  renderStreaming?: (props: StreamingRenderProps) => ReactNode;
  renderInput?: (props: InputRenderProps) => ReactNode;
  renderSlotContainer?: (props: SlotContainerRenderProps) => ReactNode;
  as?: keyof JSX.IntrinsicElements;                                // Default: "div"
  className?: string;
  style?: CSSProperties;
}
```

**Render prop interfaces:**

```typescript
interface MessageRenderProps {
  entry: Extract<TimelineEntry, { kind: "user" | "agent_text" }>;
  index: number;
  isLast: boolean;
}

interface ToolStatusRenderProps {
  entry: ToolEntry;
  index: number;
  hasSlot: boolean;   // true if this tool has an active or result slot
}

interface StreamingRenderProps { text: string; }

interface InputRenderProps {
  send: (text: string, images?: { data: string; media_type: string }[]) => void;
  busy: boolean;
  abort: () => void;
}

interface SlotContainerRenderProps {
  slots: EnhancedSlot[];
  renderSlot: (slot: EnhancedSlot) => ReactNode;
}

type RenderStrategy = "interleaved" | "slots-before" | "slots-after" | "slots-only";
```

**Features:**
- Automatic slot visibility filtering based on `displayStrategy`
- Automatic `renderResult` rendering for completed tools with `renderData`
- Interleaving: slots appear inline next to their tool call entry
- Sensible defaults for all render props (messages as divs, hidden tool status, basic input form)

### MemoryStore

```typescript
import { MemoryStore } from "glove-react";
const store = new MemoryStore("session-id");
```

### createRemoteStore

```typescript
import { createRemoteStore } from "glove-react";
const store = createRemoteStore("session-id", {
  getMessages: async (sid) => fetch(`/api/${sid}/messages`).then(r => r.json()),
  appendMessages: async (sid, msgs) => fetch(`/api/${sid}/messages`, { method: "POST", body: JSON.stringify(msgs) }),
  // Optional: getTokenCount, addTokens, getTurnCount, incrementTurn, resetCounters, getTasks, addTasks, updateTask, getPermission, setPermission
});
```

### createRemoteModel

```typescript
import { createRemoteModel } from "glove-react";
const model = createRemoteModel("custom", {
  prompt: async (request, signal?) => { /* return { message, tokens_in, tokens_out } */ },
  promptStream?: async function*(request, signal?) { /* yield RemoteStreamEvent */ },
});
```

### createEndpointModel

```typescript
import { createEndpointModel } from "glove-react";
const model = createEndpointModel("/api/chat"); // SSE-based, compatible with glove-next
```

### parseSSEStream

```typescript
import { parseSSEStream } from "glove-react";
for await (const event of parseSSEStream(response)) { /* RemoteStreamEvent */ }
```

---

## glove-next

### createChatHandler

```typescript
import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: string,    // "openai" | "anthropic" | "openrouter" | "gemini" | "minimax" | "kimi" | "glm"
  model?: string,      // Defaults to provider default
  apiKey?: string,     // Defaults to env var
  maxTokens?: number,
});
```

Returns `(req: Request) => Promise<Response>` — compatible with Next.js App Router route handlers.

**SSE Protocol**: Streams `RemoteStreamEvent` objects as `data:` lines:

```typescript
type RemoteStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "done"; message: Message; tokens_in: number; tokens_out: number };
```

---

## Browser-Safe Import Paths

The main `glove-core` barrel includes native deps (better-sqlite3). For browser code, use subpath imports:

| Import | Content | Browser-safe |
|--------|---------|-------------|
| `glove-core` | Everything (barrel) | No |
| `glove-core/core` | Core types, Agent, PromptMachine, Executor, Observer | Yes |
| `glove-core/glove` | Glove builder class | Yes |
| `glove-core/display-manager` | Displaymanager | Yes |
| `glove-core/tools/task-tool` | Task tool factory | Yes |
| `glove-core/models/anthropic` | AnthropicAdapter | No |
| `glove-core/models/openai-compat` | OpenAICompatAdapter | No |
| `glove-core/models/providers` | Provider factory | No |
