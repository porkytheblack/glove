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
  do: (input: I, display: DisplayManagerAdapter) => Promise<unknown>,
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
  resetHistory(): Promise<void>;
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
}
```

### Core Types

```typescript
interface ToolCall { tool_name: string; input_args: unknown; id?: string; }
interface ToolResult { tool_name: string; call_id?: string; result: { data: unknown; status: "error" | "success"; message?: string }; }
interface Task { id: string; content: string; activeForm: string; status: "pending" | "in_progress" | "completed"; }
type PermissionStatus = "granted" | "denied" | "unset";
```

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
  sendMessage, abort, renderSlot, resolveSlot, rejectSlot,
} = useGlove(config?: UseGloveConfig);
```

`UseGloveConfig` fields (all optional overrides): `endpoint`, `sessionId`, `store`, `model`, `systemPrompt`, `tools`, `compaction`, `subscribers`

### ToolConfig

```typescript
interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  do: (input: I, display: ToolDisplay) => Promise<unknown>;
  render?: (props: SlotRenderProps) => ReactNode;
  requiresPermission?: boolean;
}
```

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
  // Optional: getTokenCount, addTokens, getTurnCount, incrementTurn, resetHistory, getTasks, addTasks, updateTask, getPermission, setPermission
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
