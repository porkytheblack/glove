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
  serverMode?: boolean,                   // Canonical "I am headless" flag — drives default permission gating + MCP discovery policy. Default: false.
  maxRetries?: number,                    // Tool retry limit (default: 3)
  compaction_config: {                    // Required
    compaction_instructions: string,      // Summarization prompt
    max_turns?: number,                   // Turn limit (default: 120)
    compaction_context_limit?: number,    // Token threshold (default: 100k)
  },
})
  .fold<I>(toolArgs)          // Register tool (chainable; ALSO callable post-build on the IGloveRunnable)
  .addSubscriber(subscriber)  // Add event subscriber (chainable)
  .build();                   // Returns IGloveRunnable

await agent.processRequest("Hello", abortSignal?);  // Also accepts ContentPart[]
agent.setModel(newModelAdapter);  // Hot-swap model at runtime
agent.fold({ ... });             // Legal post-build — adds tools mid-session (used by MCP discovery)
```

The runnable returned by `build()` exposes `model`, `displayManager`, and `serverMode` as read-only fields so subagents and dynamically-folded tools (e.g. MCP discovery) can inherit them.

### GloveFoldArgs<I>

```typescript
{
  name: string,
  description: string,
  inputSchema?: z.ZodType<I>,             // Optional. Provide either inputSchema (Zod, validated locally) or jsonSchema (raw, passthrough).
  jsonSchema?: Record<string, unknown>,   // Raw JSON Schema. When set, executor skips local Zod validation. Used by bridgeMcpTool.
  requiresPermission?: boolean,
  unAbortable?: boolean,                  // When true, tool runs to completion even if abort signal fires (e.g. voice barge-in)
  do: (input: I, display: DisplayManagerAdapter, glove: IGloveRunnable) => Promise<ToolResultData>,
  // ^ third arg is the running Glove instance — used by subagent-folded tools (MCP discovery's `activate`) to fold tools onto the main agent and inherit its model/displayManager.
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
  // Optional — enables built-in inbox tool when present:
  getInboxItems?(): Promise<InboxItem[]>;
  addInboxItem?(item: InboxItem): Promise<void>;
  updateInboxItem?(itemId: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>): Promise<void>;
  getResolvedInboxItems?(): Promise<InboxItem[]>;
}
```

**Implementations**: `SqliteStore` (glove-sqlite), `MemoryStore` (glove-react), `createRemoteStore` (glove-react)

### SqliteStore

```typescript
import { SqliteStore } from "glove-sqlite";

const store = new SqliteStore({ dbPath: ":memory:", sessionId: "abc123" });
// Additional methods: getName(), setName(), getWorkingDir(), setWorkingDir(), close()
// Static: SqliteStore.listSessions(dbPath)
// Static: SqliteStore.resolveInboxItem(dbPath, itemId, response) — resolve inbox item from external process
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

### SubscriberAdapter & Typed Events

```typescript
// Discriminated union of all subscriber events
type SubscriberEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "model_response"; text: string; tool_calls?: ToolCall[]; stop_reason?: string; tokens_in?: number; tokens_out?: number }
  | { type: "model_response_complete"; text: string; tool_calls?: ToolCall[]; stop_reason?: string; tokens_in?: number; tokens_out?: number }
  | { type: "tool_use_result"; tool_name: string; call_id?: string; result: ToolResultData }
  | { type: "compaction_start"; current_token_consumption: number }
  | { type: "compaction_end"; current_token_consumption: number; summary_message: Message };

// Mapped type: extracts data shape (minus "type") for each event
type SubscriberEventDataMap = { [E in SubscriberEvent as E["type"]]: Omit<E, "type"> };

// Type-safe notify callback — passed to ModelAdapter.prompt()
type NotifySubscribersFunction = <T extends SubscriberEvent["type"]>(
  event_name: T, data: SubscriberEventDataMap[T]
) => Promise<void>;

// Interface for event receivers
interface SubscriberAdapter {
  record: <T extends SubscriberEvent["type"]>(
    event_type: T, data: SubscriberEventDataMap[T]
  ) => Promise<void>;
}
```

**Events emitted:**

| Event | Emitted by | Data | Description |
|-------|-----------|------|-------------|
| `text_delta` | Adapter (streaming) | `{ text: string }` | Incremental text fragment |
| `tool_use` | Adapter (streaming) | `{ id, name, input }` | Tool call assembled |
| `model_response` | Adapter (non-streaming) | `{ text, tool_calls?, stop_reason?, tokens_in?, tokens_out? }` | Complete non-streaming response |
| `model_response_complete` | Adapter (streaming) | `{ text, tool_calls?, stop_reason?, tokens_in?, tokens_out? }` | Final aggregated streaming response |
| `tool_use_result` | Core (PromptMachine) | `{ tool_name, call_id?, result }` | Tool execution finished |
| `compaction_start` | Core (Context) | `{ current_token_consumption }` | Compaction begun |
| `compaction_end` | Core (Context) | `{ current_token_consumption, summary_message }` | Compaction finished |

**Custom adapter event contract:**
- Non-streaming: emit `model_response` once per prompt call
- Streaming: emit `text_delta` per chunk, `tool_use` per tool call, `model_response_complete` once at end
- Use `?? undefined` to coerce null `stop_reason` from provider SDKs
- Never emit `tool_use_result`, `compaction_start`, or `compaction_end` — those are framework-only

### Message

```typescript
interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  content?: ContentPart[];
  tool_results?: ToolResult[];
  tool_calls?: ToolCall[];
  is_compaction?: boolean;          // true for compaction summary messages
  is_compaction_request?: boolean;  // internal marker on the synthetic compaction prompt
  is_skill_injection?: boolean;     // true for synthetic user messages from /skill invocations
}
```

### Core Types

```typescript
interface ToolCall { tool_name: string; input_args: unknown; id?: string; }
interface ToolResult { tool_name: string; call_id?: string; result: ToolResultData; }
interface Task { id: string; content: string; activeForm: string; status: "pending" | "in_progress" | "completed"; }
type PermissionStatus = "granted" | "denied" | "unset";

type InboxItemStatus = "pending" | "resolved" | "consumed";
interface InboxItem {
  id: string;
  tag: string;
  request: string;
  response: string | null;
  status: InboxItemStatus;
  blocking: boolean;
  created_at: string;
  resolved_at: string | null;
}
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

### Built-in Inbox Tool

Auto-registered when store has `getInboxItems`, `addInboxItem`, `updateInboxItem`, and `getResolvedInboxItems`:

```typescript
import { createInboxTool } from "glove-core";
const inboxTool = createInboxTool(context); // name: "glove_post_to_inbox"
// Input: { tag: string, request: string, blocking?: boolean }
```

### AbortError

```typescript
import { AbortError } from "glove-core";
try { await agent.processRequest("Hello", signal); }
catch (err) { if (err instanceof AbortError) { /* cancelled */ } }
```

### Extensions: Hooks, Skills & Mentions

Three builder methods on `Glove` (and on the `IGloveBuilder` / `IGloveRunnable` interfaces):

```typescript
glove.defineHook(name: string, handler: HookHandler): this;
glove.defineSkill(args: DefineSkillArgs): this;
glove.defineMention(args: DefineMentionArgs): this;
```

All three are chainable and legal post-`build()`, like `fold`. `defineSkill` takes an object form mirroring `fold(GloveFoldArgs)`:

```typescript
interface DefineSkillArgs extends SkillOptions {
  name: string;
  handler: SkillHandler;
}
```

#### Handler types

```typescript
type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

interface HookContext {
  name: string;
  rawText: string;
  parsedText: string;
  controls: AgentControls;
  signal?: AbortSignal;
}

interface HookResult {
  rewriteText?: string;
  shortCircuit?: { message: Message } | { result: ModelPromptResult };
}

type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

interface SkillContext {
  name: string;
  parsedText: string;        // when source = "user": stripped user text. when source = "agent": same as args ?? "".
  args?: string;             // model-supplied when source = "agent". undefined when user-invoked.
  source: "user" | "agent";
  controls: AgentControls;
}

interface SkillOptions {
  description?: string;       // shown to the agent in glove_invoke_skill
  exposeToAgent?: boolean;    // default false
}

interface RegisteredSkill {
  handler: SkillHandler;
  description?: string;
  exposeToAgent: boolean;
}

type MentionHandler = (ctx: MentionContext) => Promise<string | ContentPart[]>;

interface MentionContext {
  name: string;
  prompt: string;            // task prompt the agent supplied via glove_invoke_subagent
  controls: AgentControls;
  signal?: AbortSignal;
}

interface MentionOptions {
  description?: string;       // shown to the agent in the invoke-subagent tool listing
}

interface DefineMentionArgs extends MentionOptions {
  name: string;
  handler: MentionHandler;
}

interface RegisteredMention {
  handler: MentionHandler;
  description?: string;
}

interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
  forceCompaction: () => Promise<void>;   // calls Observer.runCompactionNow()
}
```

#### Token parsing

```typescript
import { parseTokens, formatSkillMessage } from "glove-core";

interface ParsedTokens {
  stripped: string;
  hooks: string[];
  skills: string[];
}

interface ExtensionRegistries {
  hooks: ReadonlySet<string>;
  skills: ReadonlySet<string>;
}

function parseTokens(text: string, registries: ExtensionRegistries): ParsedTokens;
function formatSkillMessage(name: string, injection: string | ContentPart[]): Message;
```

The regex is `(^|\s)\/([A-Za-z][\w-]*)(?=\s|$)`. Only `/name` directives are parsed. A token only binds when its name appears in the hook or skill registry; unbound tokens are left in `stripped`. `@mention` tokens are intentionally NOT parsed — they reach the model verbatim and route through the `glove_invoke_subagent` tool. `formatSkillMessage` produces the synthetic user message used by `processRequest` and sets `is_skill_injection: true`.

#### Built-in agent tool

When any skill is registered with `exposeToAgent: true`, `glove_invoke_skill` is auto-registered on the executor:

```typescript
import { createSkillInvokeTool, renderSkillToolDescription } from "glove-core";

// Tool input
{ name: string, args?: string }

// Tool result on success (string handler return)
{ status: "success", data: { skill: string, content: string } }

// Tool result on success (ContentPart[] handler return) — text parts join into data,
// the full part list is preserved on renderData for client renderers (mirrors the
// MCP-bridge convention; renderData is stripped by adapters before being sent to the model).
{
  status: "success",
  data: { skill: string, content: string },         // text join, or "[non-text skill content]"
  renderData: { skill: string, parts: ContentPart[] }
}

// Tool result on unknown / unexposed name
{ status: "error", message: 'Skill "..." is not available. Use one of: ...', data: null }
```

The tool description (built by `renderSkillToolDescription`) lists every exposed skill with its `description`. Glove rebuilds the description in place each time a new exposed skill is defined, so post-`build()` registrations are immediately visible to the model.

When any mention is registered, `glove_invoke_subagent` is auto-registered on the executor (mirrors Claude Code's subagent dispatch):

```typescript
import { createMentionInvokeTool, renderMentionToolDescription } from "glove-core";

// Tool input
{ name: string, prompt: string }

// Tool result on success (string handler return)
{ status: "success", data: { subagent: string, content: string } }

// Tool result on success (ContentPart[] handler return)
{
  status: "success",
  data: { subagent: string, content: string },        // text join, or "[non-text subagent content]"
  renderData: { subagent: string, parts: ContentPart[] }
}

// Tool result on unknown name
{ status: "error", message: 'Subagent "..." is not registered. Use one of: ...', data: null }
```

The subagent runs in isolation — its only input is the `prompt` the agent supplies. The handler's return becomes the tool result and reaches the parent agent verbatim.

#### Observer additions

`Observer.runCompactionNow()` runs the same body as `tryCompaction()` minus the token-threshold guard. This is what `AgentControls.forceCompaction` calls.

#### Message field added

`Message.is_skill_injection?: boolean` — set on the synthetic user message produced by a `/skill` invocation so transcript renderers can distinguish injected context from real user turns.

---

## glove-react

### GloveClient

```typescript
import { GloveClient } from "glove-react";

const client = new GloveClient({
  endpoint?: string,                       // Chat endpoint URL
  createModel?: () => ModelAdapter,        // Custom model factory (overrides endpoint)
  createStore?: (sessionId: string) => StoreAdapter,  // Custom store factory
  getSessionId?: () => Promise<string>,    // Async function to fetch session ID from backend
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
  busy, isCompacting, sessionReady, sessionId,
  timeline, streamingText, tasks, inbox, slots, stats,
  sendMessage, abort, renderSlot, renderToolResult, resolveSlot, rejectSlot,
} = useGlove(config?: UseGloveConfig);
```

`UseGloveConfig` fields (all optional overrides): `endpoint`, `sessionId`, `getSessionId`, `store`, `model`, `systemPrompt`, `tools`, `compaction`, `subscribers`

**`getSessionId`**: Async function `() => Promise<string>` that fetches the session ID from your backend. When configured, store creation is deferred until the ID resolves. Hook-level `getSessionId` overrides client-level. No change in behavior when not used.

### GloveHandle

The interface consumed by `<Render>`, returned by `useGlove()`:

```typescript
interface GloveHandle {
  timeline: TimelineEntry[];
  streamingText: string;
  busy: boolean;
  sessionReady: boolean;
  sessionId: string;
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
  inputSchema?: z.ZodType<I>;            // Optional — provide this OR jsonSchema
  jsonSchema?: Record<string, unknown>;  // Raw JSON Schema alternative — executor skips Zod validation
  do: (input: I, display: ToolDisplay, glove?: IGloveRunnable) => Promise<ToolResultData>;
  render?: (props: SlotRenderProps) => ReactNode;
  renderResult?: (props: ToolResultRenderProps) => ReactNode;
  displayStrategy?: SlotDisplayStrategy;
  requiresPermission?: boolean;
  unAbortable?: boolean;
}
```

**`inputSchema` vs `jsonSchema`:** Pass exactly one. `inputSchema` is validated locally before `do()`. `jsonSchema` is forwarded raw and the executor skips validation — used by `bridgeMcpTool` so the MCP server's schema is the source of truth.

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
  unAbortable?: boolean,                   // Tool runs to completion even if abort signal fires
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

### unAbortable Tools

When `unAbortable: true` is set on a tool, glove-core guarantees the tool runs to completion even if the abort signal fires (e.g. from voice barge-in or manual `interrupt()`). This is essential for tools that perform mutations the user has already committed to, like checkout forms.

**How it works (two layers):**

1. **Core layer** (`Agent.executeTools`): When the abort signal fires, abortable tools are skipped with `{ status: "aborted" }`. But if `tool.unAbortable` is `true`, the tool executes normally — no `abortablePromise` wrapper, retries still allowed.

2. **Voice layer** (`GloveVoice.interrupt`): Before clearing display slots, checks `displayManager.resolverStore.size > 0`. If a `pushAndWait` resolver is pending (the form is open), barge-in is suppressed entirely — `interrupt()` is never called. This prevents the abort signal from firing in the first place.

**Important distinction:** `pushAndWait` alone does NOT make a tool survive barge-in. It only suppresses the barge-in trigger at the voice layer. If `interrupt()` is called through other means (e.g. programmatically), only `unAbortable: true` guarantees the tool runs to completion. Use both together for full protection.

```typescript
const checkout = defineTool({
  name: "checkout",
  unAbortable: true,           // Survives abort signals
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const result = await display.pushAndWait({ items });  // Resolver suppresses voice barge-in
    if (!result) return "Cancelled";
    // Mutation happens here — safe because unAbortable guarantees completion
    cartOps.clear();
    return "Order placed!";
  },
});
```

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
  voice?: VoiceRenderHandle;                                       // Optional — auto-renders transcript/status
  renderTranscript?: (props: TranscriptRenderProps) => ReactNode;  // Optional custom transcript renderer
  renderVoiceStatus?: (props: VoiceStatusRenderProps) => ReactNode; // Optional custom voice status renderer
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
  // Optional: getTokenCount, addTokens, getTurnCount, incrementTurn, resetCounters, getTasks, addTasks, updateTask, getPermission, setPermission, getInboxItems, addInboxItem, updateInboxItem, getResolvedInboxItems
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

## glove-voice

### GloveVoice Class

```typescript
import { GloveVoice } from "glove-voice";

const voice = new GloveVoice(gloveRunnable, {
  stt: STTAdapter,                    // Required — streaming STT adapter
  createTTS: () => TTSAdapter,        // Required — factory, called per turn
  turnMode?: "vad" | "manual",       // Default: "vad"
  vad?: VADAdapter,                   // Override default VAD (only used in "vad" mode)
  vadConfig?: VADConfig,              // Built-in VAD config (only used if no custom vad)
  sampleRate?: number,                // Default: 16000
  startMuted?: boolean,               // Default: false (true when turnMode="manual")
});

// Events
voice.on("mode", (mode: VoiceMode) => { });
voice.on("transcript", (text: string, partial: boolean) => { });
voice.on("response", (text: string) => { });
voice.on("error", (err: Error) => { });
voice.on("audio_chunk", (pcm: Int16Array) => { });  // Raw mic PCM — emitted even when muted

// Lifecycle
await voice.start();       // Request mic, connect STT, begin listening
await voice.stop();        // Stop everything, release resources
voice.interrupt();         // Barge-in: abort request, stop TTS, return to listening
voice.commitTurn();        // Manual turn commit: flush utterance to STT

// Narration — speak text through TTS without involving the model
await voice.narrate("Here is your order summary.");  // Resolves when audio finishes

// Mic control — gate audio forwarding to STT/VAD
voice.mute();              // Stop forwarding audio to STT/VAD (audio_chunk still emitted)
voice.unmute();            // Resume forwarding audio to STT/VAD

// Properties
voice.currentMode;         // VoiceMode
voice.isActive;            // boolean
voice.isMuted;             // boolean
```

### Types

```typescript
type VoiceMode = "idle" | "listening" | "thinking" | "speaking";
type TurnMode = "vad" | "manual";
type TTSFactory = () => TTSAdapter;
type GetTokenFn = () => Promise<string>;
```

### Adapter Contracts

```typescript
// STT — Streaming speech-to-text
interface STTAdapter extends EventEmitter<STTAdapterEvents> {
  connect(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  flushUtterance(): void;
  disconnect(): void;
  readonly isConnected: boolean;
  readonly currentPartial: string;
}
// Events: partial(text), final(text), error(Error), close()

// TTS — Streaming text-to-speech
interface TTSAdapter extends EventEmitter<TTSAdapterEvents> {
  open(): Promise<void>;
  sendText(text: string): void;
  flush(): void;
  destroy(): void;
  readonly isReady: boolean;
}
// Events: audio_chunk(Uint8Array), done(), error(Error)

// VAD — Voice activity detection
interface VADAdapter extends EventEmitter<VADAdapterEvents> {
  process(pcm: Int16Array): void;
  reset(): void;
  readonly isSpeaking: boolean;
}
// Events: speech_start(), speech_end()
```

### ElevenLabs Adapters

```typescript
import { createElevenLabsAdapters } from "glove-voice";

const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: GetTokenFn,           // Fetches token from your server
  getTTSToken: GetTokenFn,           // Fetches token from your server
  voiceId: string,                   // ElevenLabs voice ID
  stt?: {                            // Override STT options
    model?: string,                  // Default: "scribe_v2_realtime"
    language?: string,               // Default: "en"
    vadSilenceThreshold?: number,    // Default: 0 (we manage VAD ourselves)
    maxReconnects?: number,          // Default: 3
  },
  tts?: {                            // Override TTS options
    model?: string,                  // Default: "eleven_turbo_v2_5"
    outputFormat?: string,           // Default: "pcm_16000"
    voiceSettings?: { stability?: number; similarityBoost?: number; speed?: number },
  },
});
```

### SileroVADAdapter

```typescript
// MUST use dynamic import — separate entry point to avoid WASM in SSR bundle
const { SileroVADAdapter } = await import("glove-voice/silero-vad");

const vad = new SileroVADAdapter({
  positiveSpeechThreshold?: number,  // Default: 0.3 (higher = less sensitive)
  negativeSpeechThreshold?: number,  // Default: 0.25 (lower = needs more silence)
  wasm?: { type: "cdn" } | { type: "local"; path: string },
});
await vad.init();
```

### Built-in VAD (energy-based)

```typescript
import { VAD } from "glove-voice";
const vad = new VAD({ silentFrames?: number }); // Default: 15 (~600ms). GloveVoice overrides to 40 (~1600ms).
```

### createVoiceTokenHandler (glove-next)

```typescript
import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({
  provider: "elevenlabs" | "deepgram" | "cartesia",
  type?: "stt" | "tts",       // Required for elevenlabs
  apiKey?: string,             // Defaults to env var
});
```

### useGloveVoice (glove-react/voice)

```typescript
import { useGloveVoice } from "glove-react/voice";

const voice = useGloveVoice({
  runnable: IGloveRunnable | null,   // From useGlove().runnable
  voice: GloveVoiceConfig,           // STT, TTS factory, turn mode, VAD
});

// Returns:
voice.mode;          // VoiceMode
voice.transcript;    // string — partial transcript while speaking
voice.enabled;       // boolean — true after start(), false after stop() or pipeline death
voice.isActive;      // boolean
voice.isMuted;       // boolean — whether mic audio is muted (reflects startMuted on start)
voice.error;         // Error | null
voice.start();       // () => Promise<void>
voice.stop();        // () => Promise<void>
voice.interrupt();   // () => void
voice.commitTurn();  // () => void
voice.mute();        // () => void — stop forwarding mic to STT/VAD
voice.unmute();      // () => void — resume forwarding mic to STT/VAD
voice.narrate(text); // (text: string) => Promise<void> — speak without model
```

### useGlovePTT (glove-react/voice)

High-level push-to-talk hook. Encapsulates pipeline lifecycle, keyboard binding, click-vs-hold discrimination, and min-duration enforcement.

```typescript
import { useGlovePTT } from "glove-react/voice";

const ptt = useGlovePTT({
  runnable: IGloveRunnable | null,    // From useGlove().runnable
  voice: Omit<GloveVoiceConfig, "turnMode">,  // turnMode forced to "manual"
  hotkey?: string | false,            // Default: "Space" — auto-guards INPUT/TEXTAREA/SELECT
  holdThreshold?: number,             // Default: 300ms — click-vs-hold discrimination
  minRecordingMs?: number,            // Default: 350ms — min audio before committing
});

// Returns:
ptt.enabled;       // boolean — pipeline active
ptt.recording;     // boolean — user currently holding
ptt.processing;    // boolean — STT finalizing after short recording
ptt.mode;          // VoiceMode
ptt.transcript;    // string — partial transcript
ptt.error;         // Error | null
ptt.toggle();      // () => Promise<void> — enable/disable pipeline
ptt.interrupt();   // () => void — barge-in
ptt.bind;          // { onPointerDown, onPointerUp, onPointerLeave } — spread onto button
ptt.voice;         // UseGloveVoiceReturn — underlying voice hook for advanced use
```

### VoicePTTButton (glove-react/voice)

Headless push-to-talk button component with render prop:

```tsx
import { VoicePTTButton } from "glove-react/voice";

<VoicePTTButton ptt={pttReturn} className="..." style={...}>
  {({ enabled, recording, processing, mode }) => (
    <button className={recording ? "active" : ""}>
      <MicIcon />
    </button>
  )}
</VoicePTTButton>
```

Wraps `ptt.bind` with `role="button"`, `tabIndex`, `aria-label`, `aria-pressed`, and touch safety (`touchAction: "none"`).

### Render Voice Props

```typescript
// voice prop on <Render>
interface VoiceRenderHandle {
  mode: VoiceMode;
  transcript: string;
  recording?: boolean;
}

// Custom renderers
interface TranscriptRenderProps { transcript: string; mode: VoiceMode; }
interface VoiceStatusRenderProps { mode: VoiceMode; recording?: boolean; }
```

```tsx
<Render
  glove={glove}
  voice={ptt}                              // or useGloveVoice() return
  renderTranscript={({ transcript }) => ...}  // optional
  renderVoiceStatus={({ mode }) => ...}       // optional
/>
```

---

## Browser-Safe Import Paths

`glove-core` no longer includes native deps — `SqliteStore` (and its `better-sqlite3` dependency) has been extracted to the separate `glove-sqlite` package. The `glove-core` barrel is now browser-safe. Subpath imports are still available:

| Import | Content | Browser-safe |
|--------|---------|-------------|
| `glove-core` | Everything (barrel) | Yes |
| `glove-core/core` | Core types, Agent, PromptMachine, Executor, Observer | Yes |
| `glove-core/glove` | Glove builder class | Yes |
| `glove-core/display-manager` | Displaymanager | Yes |
| `glove-core/tools/task-tool` | Task tool factory | Yes |
| `glove-core/tools/inbox-tool` | Inbox tool factory | Yes |
| `glove-core/models/anthropic` | AnthropicAdapter | No |
| `glove-core/models/openai-compat` | OpenAICompatAdapter | No |
| `glove-core/models/providers` | Provider factory | No |
| `glove-sqlite` | SqliteStore (native better-sqlite3) | No |

---

## glove-mcp

Bearer-token bridge between Glove agents and MCP servers. Discovery subagent, opt-in OAuth helpers at `glove-mcp/oauth`.

### McpCatalogueEntry

```ts
interface McpCatalogueEntry {
  id: string;                              // namespace prefix + activation key
  name: string;                            // discovery match
  description: string;                     // discovery match
  url: string;                             // HTTP transport only in v1
  tags?: string[];                         // discovery match
  metadata?: Record<string, unknown>;
}
```

### McpAdapter

Per-conversation, mirrors `StoreAdapter`. Sole auth seam is `getAccessToken`; the framework wraps the returned string as `Authorization: Bearer …`.

```ts
interface McpAdapter {
  identifier: string;
  getActive(): Promise<string[]>;
  activate(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;          // v1: doesn't unfold tools — refresh session for that
  getAccessToken(id: string): Promise<string>;
}
```

### mountMcp

```ts
function mountMcp(glove: IGloveRunnable, config: MountMcpConfig): Promise<void>;

interface MountMcpConfig {
  adapter: McpAdapter;
  entries: McpCatalogueEntry[];
  ambiguityPolicy?: DiscoveryAmbiguityPolicy;  // default: serverMode → auto-pick-best, else interactive
  subagentModel?: ModelAdapter;                // default: glove.model
  subagentSystemPrompt?: string;               // default: built-in per-policy prompt
  clientInfo?: { name: string; version: string };
}
```

Behavior: reload all `adapter.getActive()` ids, fold the `find_capability` discovery tool. Fails open — a single bad reload logs and continues.

### Discovery

```ts
type DiscoveryAmbiguityPolicy =
  | { type: "interactive" }       // pushAndWait via mcp_picker renderer
  | { type: "auto-pick-best" }    // deterministic; default in serverMode
  | { type: "defer-to-main" };    // returns candidates as text, main agent decides

function discoveryTool(config: DiscoveryToolConfig): GloveFoldArgs<{ need: string }>;

interface DiscoveryToolConfig {
  adapter: McpAdapter;
  entries: McpCatalogueEntry[];
  ambiguityPolicy: DiscoveryAmbiguityPolicy;
  subagentModel?: ModelAdapter;
  subagentSystemPrompt?: string;
  clientInfo?: { name: string; version: string };
}
```

`mountMcp` constructs and folds this for you. Direct use is unusual.

### connectMcp

```ts
function connectMcp(config: ConnectMcpConfig): Promise<McpServerConnection>;

interface ConnectMcpConfig {
  namespace: string;
  url: string;
  auth?: ConnectMcpAuth;          // typically bearer(token)
  clientInfo?: { name: string; version: string };
}

interface ConnectMcpAuth {
  headers: () => Promise<Record<string, string>>;
}

interface McpServerConnection {
  readonly namespace: string;
  listTools(): Promise<McpToolDef[]>;
  callTool(name: string, args: unknown): Promise<McpCallToolResult>;
  close(): Promise<void>;
  raw: Client;                    // SDK client for resources/prompts
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

interface McpCallToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}
```

### bridgeMcpTool

```ts
function bridgeMcpTool(
  connection: McpServerConnection,
  tool: McpToolDef,
  serverMode: boolean,
): GloveFoldArgs<unknown>;

const MCP_NAMESPACE_SEP = "__";   // tool name separator
```

- Names: `${connection.namespace}__${tool.name}`.
- `jsonSchema: tool.inputSchema` (raw forwarded; executor skips Zod validation).
- `requiresPermission`: `serverMode === true` → always false; else true unless `tool.annotations.readOnlyHint === true`.
- `do`: maps `result.isError` → `{ status: "error", message: textOrFallback, data: result.content }`. 401 → `{ status: "error", message: "auth_expired", data: null }`. Otherwise success with `data` = joined text content, `renderData` = full `content[]`.

### bearer

```ts
type BearerToken = string | (() => Promise<string> | string);
function bearer(token: BearerToken): ConnectMcpAuth;
```

Wraps a token (or thunk) as a `ConnectMcpAuth` returning `Authorization: Bearer …` headers. Most consumers don't call this — `mountMcp` and discovery do internally with `bearer(() => adapter.getAccessToken(id))`.

### UnauthorizedError

Re-exported from the MCP SDK. Thrown by `connectMcp` if the SDK rejects credentials. Useful for `instanceof` branches in custom flows.

### extractText

```ts
function extractText(result: Message | ModelPromptResult): string;
```

Local helper for pulling agent text out of a Glove response. Used internally by the discovery subagent.

---

## glove-mcp/oauth

Opt-in subpath. Reference implementation of "acquire and persist OAuth tokens for an MCP server." Consumers can use any of these pieces (or none).

### OAuthStore + states

```ts
interface OAuthProviderState {
  clientInformation: OAuthClientInformationMixed | null;
  tokens: OAuthTokens | null;
  codeVerifier: string | null;
}

interface OAuthStore {
  get(key: string): Promise<OAuthProviderState>;     // missing keys → empty state, never null
  set(key: string, state: OAuthProviderState): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(): Promise<void>;
}

function emptyOAuthState(): OAuthProviderState;
```

`OAuthClientInformationMixed`, `OAuthTokens` are re-exported from `@modelcontextprotocol/sdk/shared/auth.js`.

### FsOAuthStore

```ts
class FsOAuthStore implements OAuthStore {
  constructor(path: string);                          // single JSON file, mode 0600, atomic writes
}
```

Holds state for any number of MCP servers in one file, keyed by `key` (typically `McpCatalogueEntry.id`). Swap for a DB-backed implementation in production.

### MemoryOAuthStore

```ts
class MemoryOAuthStore implements OAuthStore {}
```

In-process only. For tests and one-shot scripts.

### McpOAuthProvider

```ts
class McpOAuthProvider implements OAuthClientProvider {
  constructor(opts: McpOAuthProviderOptions);
  reset(): Promise<void>;                            // wipes this key's state
}

interface McpOAuthProviderOptions {
  store: OAuthStore;
  key: string;
  redirectUrl: string;
  clientMetadata: OAuthClientMetadata;
  onAuthorizeUrl: (url: URL) => void | Promise<void>;
}
```

The SDK calls each `OAuthClientProvider` method; this implementation round-trips through the store. Auth-flow CLIs typically open the user's browser in `onAuthorizeUrl`; agent-runtime providers throw to fail loudly.

### runMcpOAuth

```ts
function runMcpOAuth(opts: RunMcpOAuthOptions): Promise<RunMcpOAuthResult>;

interface RunMcpOAuthOptions {
  serverUrl: string;
  store: OAuthStore;
  key: string;
  clientInfo?: { name: string; version: string };    // default MCP_DEFAULT_CLIENT_INFO
  port?: number;                                     // default 53683
  redirectUrl?: string;                              // default http://localhost:${port}/callback
  preRegisteredClient?: PreRegisteredClient;         // for servers that don't support DCR (Google)
  scope?: string;
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
  onAuthorizeUrl?: (url: URL) => void | Promise<void>;   // default: open in browser
  onProgress?: (msg: string) => void;                // default: stdout
  verify?: McpOAuthVerify;                           // default: { type: "listTools" }
  timeoutMs?: number;                                // default 5min
}

interface PreRegisteredClient { client_id: string; client_secret?: string; }

type McpOAuthVerify =
  | false
  | { type: "listTools" }
  | { type: "callTool"; name: string; arguments?: Record<string, unknown> };

interface RunMcpOAuthResult {
  status: "AUTHORIZED" | "ALREADY_AUTHORIZED";
  toolCount?: number;                                // when verify.type === "listTools"
  verifyResult?: unknown;                            // when verify.type === "callTool"
  redirectUrl: string;
}
```

Drives discovery → DCR (or pre-seed) → PKCE → callback listener → token exchange → verify. Throws on failure. The verification step matters because some servers (Gmail) return 200 to unauthenticated `initialize`/`tools/list` — only an authenticated tool call confirms auth actually worked.

### buildClientMetadata

```ts
function buildClientMetadata(opts: BuildClientMetadataOptions): OAuthClientMetadata;

interface BuildClientMetadataOptions {
  redirectUrl: string;
  scope?: string;
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
  clientName?: string;                               // default MCP_CLIENT_NAME
}
```

### MCP_DEFAULT_CLIENT_INFO

```ts
const MCP_DEFAULT_CLIENT_INFO = { name: "Glove MCP", version: "0.1.0" };
```

---

## Core changes that landed alongside glove-mcp

These are framework-level changes in `glove-core` that consumers of any package should know about.

### Tool / GloveFoldArgs — `jsonSchema` alternative

```ts
interface Tool<I> {
  name: string;
  description: string;
  input_schema?: z.ZodType<I>;            // now optional
  jsonSchema?: Record<string, unknown>;   // new — raw JSON Schema alternative
  requiresPermission?: boolean;
  unAbortable?: boolean;
  run(input: I, handOver?: ...): Promise<ToolResultData>;
}

interface GloveFoldArgs<I> {
  name: string;
  description: string;
  inputSchema?: z.ZodType<I>;             // now optional
  jsonSchema?: Record<string, unknown>;   // new
  requiresPermission?: boolean;
  unAbortable?: boolean;
  do: (input: I, display: DisplayManagerAdapter, glove: IGloveRunnable) => Promise<ToolResultData>;
  // 3rd arg `glove` is new — the running instance, used by tools that fold further tools at runtime
}
```

Pass exactly one of `inputSchema` / `jsonSchema`. The executor only runs Zod `safeParse` when `input_schema` is set; `jsonSchema`-only tools forward `call.input_args` straight to `run`.

`getToolJsonSchema(tool)` — adapter helper that returns whichever schema the tool provided as JSON Schema.

### Glove.fold — legal post-build

```ts
class Glove implements IGloveBuilder, IGloveRunnable {
  fold<I>(args: GloveFoldArgs<I>): this;   // legal at any time, including after build()
  // ...
}

interface IGloveRunnable {
  fold<I>(args: GloveFoldArgs<I>): IGloveRunnable;   // exposed
  readonly model: ModelAdapter;                       // exposed read-only
  readonly serverMode: boolean;                       // exposed read-only
  // ...
}
```

The `built` throw was removed. Tools that need to register more tools at runtime (e.g. the discovery subagent's `activate`) read `glove` from `do(input, display, glove)` and call `glove.fold(...)`.

### GloveConfig — serverMode

```ts
interface GloveConfig {
  store: StoreAdapter;
  model: ModelAdapter;
  displayManager: DisplayManagerAdapter;
  systemPrompt: string;
  serverMode?: boolean;                  // new — canonical "I am headless" flag
  maxRetries?: number;
  maxConsecutiveErrors?: number;
  compaction_config: CompactionConfig;
}
```

Drives default permission-gating on bridged MCP tools (always-off in serverMode) and default discovery ambiguity policy (`auto-pick-best` in serverMode, `interactive` otherwise). Treat as the canonical headless flag for any future server-vs-UI behavioral splits.

---

## glovebox

Authoring entry point and `glovebox build` CLI. Wraps a built Glove agent into a deployable Glovebox artifact.

### glovebox.wrap

```ts
import { glovebox } from "glovebox";

function wrap<R>(runnable: R, config?: GloveboxConfig): GloveboxApp;

interface GloveboxApp {
  readonly __glovebox: 1;
  readonly runnable: unknown;          // your built IGloveRunnable
  readonly config: ResolvedGloveboxConfig;
}
```

Opaque marker; the build CLI and the kit both type-check via `__glovebox === 1`.

### GloveboxConfig

```ts
interface GloveboxConfig {
  name?: string;                       // default "glovebox-app"
  version?: string;                    // default "0.1.0"
  base?: BaseImage;                    // default "glovebox/base"
  packages?: PackageSpec;              // { apt?, pip?, npm? }
  fs?: Record<string, FsMount>;        // default DEFAULT_FS — work/input/output
  env?: Record<string, EnvVarSpec>;    // declared, validated at boot
  storage?: { inputs?: StoragePolicy; outputs?: StoragePolicy };
  limits?: Limits;                     // { cpu?, memory?, timeout? }
}

type BaseImage =
  | "glovebox/base"
  | "glovebox/media"
  | "glovebox/docs"
  | "glovebox/python"
  | "glovebox/browser"
  | (string & {});                     // custom registry/image:tag

interface FsMount     { path: string; writable: boolean }
interface EnvVarSpec  { required: boolean; secret?: boolean; default?: string; description?: string }
interface PackageSpec { apt?: string[]; pip?: string[]; npm?: string[] }
interface Limits      { cpu?: string; memory?: string; timeout?: string }
```

`DEFAULT_FS`, `DEFAULT_INPUTS_POLICY`, `DEFAULT_OUTPUTS_POLICY` are exported from `glovebox` for inspection.

### Storage DSL

```ts
import { rule, composite } from "glovebox";

const rule = {
  inline: (opts?: { below?: string; above?: string }) => Rule,
  localServer: (opts?: { ttl?: string; below?: string; above?: string }) => Rule,
  s3: (opts: { bucket: string; region?: string; prefix?: string; below?: string; above?: string }) => Rule,
  url: (opts?: { below?: string; above?: string }) => Rule,
};

function composite(rules: Rule[]): StoragePolicyEncoded;
```

Sizes accept `"B" | "KB" | "MB" | "GB"` suffixes (parsed by `parseSize` in `glovebox-kit`). Earlier rules win; the policy must end in a terminal rule (`always` or `default`) for outputs.

### StoragePolicyEncoded (wire shape)

```ts
type StoragePolicyEncoded = {
  rules: Array<{
    use: { adapter: string; options?: Record<string, unknown> };
    when: {
      sizeAbove?: string;
      sizeBelow?: string;
      always?: boolean;
      default?: boolean;
    };
  }>;
};

type StoragePolicy = StoragePolicyEncoded | { __rules: StoragePolicyEncoded["rules"] };
```

### FileRef

```ts
type FileRef =
  | { kind: "inline"; name: string; mime: string; data: string }    // base64
  | { kind: "url";    name: string; mime?: string; url: string; headers?: Record<string, string> }
  | { kind: "server"; name: string; mime: string; size: number; id: string; url: string }
  | { kind: "s3";     name: string; mime?: string; bucket: string; key: string; region?: string }
  | { kind: "gcs";    name: string; mime?: string; bucket: string; object: string };
```

### Wire messages

```ts
type ClientMessage =
  | { type: "prompt"; id: string; text: string; inputs?: Record<string, FileRef>; outputs_policy?: OutputsPolicyOverride }
  | { type: "abort"; id: string }
  | { type: "display_resolve"; slot_id: string; value: unknown }
  | { type: "display_reject"; slot_id: string; error: unknown }
  | { type: "ping"; ts: number };

type ServerMessage =
  | { type: "event"; id: string; event_type: SubscriberEventType; data: unknown }
  | { type: "display_push"; slot: WireSlot }
  | { type: "display_clear"; slot_id: string }
  | { type: "complete"; id: string; message: string; outputs: Record<string, FileRef> }
  | { type: "error"; id: string; error: { code: string; message: string } }
  | { type: "pong"; ts: number };

type OutputsPolicyOverride = {
  inline_below?: string;
  s3?: { bucket: string; region?: string; prefix?: string };
  server_ttl?: string;
};
```

`SubscriberEventType` mirrors `glove-core`'s 1:1: `text_delta | tool_use | model_response | model_response_complete | tool_use_result | compaction_start | compaction_end`.

### Manifest

```ts
interface Manifest {
  name: string;
  version: string;
  base: string;
  fs: Record<string, { path: string; writable: boolean }>;
  env: Record<string, { required: boolean; secret?: boolean; default?: string; description?: string }>;
  limits?: { cpu?: string; memory?: string; timeout?: string };
  key_fingerprint: string;             // SHA-256 prefix shaped "<8>...<4>"
  storage_policy: { inputs: StoragePolicyEncoded; outputs: StoragePolicyEncoded };
  packages: { apt?: string[]; pip?: string[]; npm?: string[] };
  protocol_version: 1;
}
```

### CLI

```
glovebox build <entry> [--out <dir>] [--name <name>]
```

`<entry>` must default-export a `GloveboxApp` (i.e., the result of `glovebox.wrap(...)`). The CLI emits `dist/Dockerfile`, `dist/nixpacks.toml`, `dist/server/{index.js,package.json,glovebox.json}`, `dist/glovebox.json`, `dist/glovebox.key`, `dist/.env.example`. Re-runs reuse the existing key file.

`resolveBaseImage(base)`:
- Pass-through for explicit refs (`quay.io/me/img:tag`, `glovebox/media:custom`).
- Otherwise `${GLOVEBOX_REGISTRY ?? "ghcr.io/porkytheblack"}/${base}:${KNOWN_BASE_TAGS[base] ?? "latest"}`.

---

## glovebox-kit

In-container runtime. Bundled by `glovebox build` — you don't install it yourself.

### startGlovebox

```ts
import { startGlovebox } from "glovebox-kit";

function startGlovebox(opts: StartOptions): Promise<RunningGlovebox>;

interface StartOptions {
  app: GloveboxApp;                                 // your wrap module's default export
  port: number;                                     // GLOVEBOX_PORT (default 8080)
  key: string;                                      // GLOVEBOX_KEY (required)
  manifestPath: string;                             // resolved from import.meta.url in the bundled entry
  publicBaseUrl?: string;                           // GLOVEBOX_PUBLIC_URL — needed for `server`-kind FileRefs
  adapters?: Record<string, StorageAdapter>;        // merged into the default registry by name
}

interface RunningGlovebox {
  http: import("node:http").Server;
  wss: import("ws").WebSocketServer;
  close(): Promise<void>;
}
```

Validates `GLOVEBOX_KEY` against `manifest.key_fingerprint`, validates declared required env vars, runs `applyInjections`, prepends `buildEnvironmentBlock(config)` to the agent's existing system prompt, and starts the HTTP+WS server.

### Storage adapters

```ts
import {
  InlineStorage,
  UrlStorage,
  LocalServerStorage,
  S3Storage,
  type StorageAdapter,
  type FileMeta,
  pickAdapter,
} from "glovebox-kit";

interface StorageAdapter {
  readonly name: string;
  put(meta: FileMeta, bytes: Uint8Array): Promise<FileRef>;
  get(ref: FileRef): Promise<Uint8Array>;
  release?(requestId: string): Promise<void>;
}

interface FileMeta { name: string; mime: string; size: number; requestId: string }

interface S3AdapterOptions {
  bucket: string;
  region?: string;
  prefix?: string;
  uploadObject:   (params: { bucket: string; key: string; body: Uint8Array; contentType: string }) => Promise<void>;
  downloadObject: (params: { bucket: string; key: string }) => Promise<Uint8Array>;
}
```

`S3Storage` is "deferred" — no `@aws-sdk/client-s3` baked into the runtime image. Pass your own thunks.

`LocalServerStorage` keeps a SQLite manifest (`/var/glovebox/files.db`) and stores files under `/var/glovebox/files/<uuid>`. Files are served by the `/files/:id` HTTP route (Bearer-auth'd, supports `?consume=1`). A sweeper deletes expired rows every 5 minutes.

### Injection helpers

```ts
import { applyInjections, buildEnvironmentBlock, type RequestExfilState } from "glovebox-kit";

interface RequestExfilState { extraOutputs: Set<string> }

function applyInjections(
  runnable: IGloveRunnable,
  config: ResolvedGloveboxConfig,
  resolveExfilState: () => RequestExfilState | undefined,
): IGloveRunnable;

function buildEnvironmentBlock(config: ResolvedGloveboxConfig): string;
```

Adds the `environment` and `workspace` skills, the `/output` and `/clear-workspace` hooks, and returns a static "[Glovebox environment]" block that the kit prepends to the existing system prompt.

### Subscriber + display bridge

```ts
import { WsSubscriber, attachDisplayBridge } from "glovebox-kit";
```

`WsSubscriber` translates Glove subscriber events to `event`-typed wire messages tagged with the current request id. `attachDisplayBridge(displayManager, subscriber)` wires `display_push` / `display_clear` to the WS and returns a detach function; `display_resolve` / `display_reject` from the client map back to `displayManager.resolve` / `.reject`.

---

## glovebox-client

Browser- and Node-compatible client SDK. Picks `globalThis.WebSocket` in browsers and falls back to `ws` in Node.

### GloveboxClient

```ts
import { GloveboxClient } from "glovebox-client";

class GloveboxClient {
  static make(opts: GloveboxClientOptions): GloveboxClient;
  box(name: string): Box;
  close(): Promise<void>;
}

interface GloveboxClientOptions {
  endpoints: Record<string, BoxEndpoint>;
  storage?: ClientStorage;             // default DefaultClientStorage
}

interface BoxEndpoint { url: string; key: string }
```

### Box

```ts
class Box {
  constructor(opts: BoxOptions);
  prompt(text: string, opts?: PromptOptions): PromptResult;
  environment(): Promise<BoxEnvironment>;        // cached after first call
  onSendError(listener: (err: unknown) => void): () => void;
  close(): Promise<void>;
  readonly bearer: string;
}

interface BoxOptions {
  endpoint: BoxEndpoint;
  storage?: ClientStorage;
  reconnectAttempts?: number;          // default 3, exponential 500/1000/2000ms
}

interface PromptOptions {
  files?: Record<string, { mime?: string; bytes: Uint8Array }>;     // wrapped via ClientStorage.put
  inputs?: Record<string, FileRef>;                                  // pre-built refs (merged in)
}

interface PromptResult {
  events: AsyncIterable<SubscriberEvent>;
  display: AsyncIterable<DisplayEvent>;
  message: Promise<string>;
  outputs: Promise<Record<string, FileRef>>;
  read(name: string): Promise<Uint8Array>;
  resolve(slot_id: string, value: unknown): void;
  reject(slot_id: string, error: unknown): void;
  abort(): void;
}

interface SubscriberEvent { request_id: string; event_type: SubscriberEventType; data: unknown }
interface DisplayEvent    { type: "push" | "clear"; slot?: WireSlot; slot_id?: string }

interface BoxEnvironment {
  name: string;
  version: string;
  base: string;
  fs: Record<string, { path: string; writable: boolean }>;
  packages: { apt?: string[]; pip?: string[]; npm?: string[] };
  limits?: { cpu?: string; memory?: string; timeout?: string };
  protocol_version: 1;
}
```

### ClientStorage

```ts
import { DefaultClientStorage, type ClientStorage } from "glovebox-client";

interface ClientStorage {
  put(name: string, mime: string, bytes: Uint8Array): Promise<FileRef>;
  get(ref: FileRef, opts?: { bearer?: string }): Promise<Uint8Array>;
}

interface DefaultClientStorageOptions { inlineMaxBytes?: number }
```

`DefaultClientStorage`:
- `put(...)` → `{ kind: "inline", data: base64(bytes) }`. Throws if `bytes.length > inlineMaxBytes`.
- `get(ref)` handles `inline` (decode), `url` (fetch + optional `headers`), and `server` (fetch with `Authorization: Bearer <opts.bearer>`). Other kinds throw — replace with a custom `ClientStorage` to support `s3` / `gcs` on the client side.
