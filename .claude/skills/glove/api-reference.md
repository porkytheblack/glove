# Glove API Reference

## glove-core

### Glove Class (Builder)

```typescript
import { Glove } from "glove-core";

const agent = new Glove({
  store?: StoreAdapter,                   // Optional — defaults to a fresh MemoryStore. Can also be supplied later to .build(store).
  model: ModelAdapter,                    // Required — LLM provider
  displayManager: DisplayManagerAdapter,  // Required — UI slot management
  systemPrompt: string,                   // Required — system instructions
  serverMode?: boolean,                   // Canonical "I am headless" flag — drives default permission gating + MCP discovery policy. Default: false.
  maxRetries?: number,                    // Tool retry limit (default: 3)
  maxConsecutiveErrors?: number,          // Reserved
  compaction_config: {                    // Required
    compaction_instructions: string,      // Summarization prompt
    max_turns?: number,                   // Turn limit (default: 120)
    compaction_context_limit?: number,    // Token threshold (default: 100k)
  },
})
  .fold<I>(toolArgs)            // Register tool (chainable; ALSO callable post-build on the IGloveRunnable)
  .defineHook(name, handler)    // Register `/name` hook
  .defineSkill(args)            // Register `/name` skill
  .defineSubAgent(args)         // Register a subagent the model routes to via glove_invoke_subagent
  .setDisplayManager(dm)        // Swap the display manager (chainable, also callable post-build)
  .addSubscriber(subscriber)    // Add event subscriber (chainable)
  .build(store?);               // Returns IGloveRunnable. Optional store argument supersedes the constructor's store
                                // (used by subagent factories that derive a store via parentStore.createSubAgentStore).

await agent.processRequest("Hello", abortSignal?);  // Also accepts ContentPart[]
agent.setModel(newModelAdapter);  // Hot-swap model at runtime
agent.fold({ ... });              // Legal post-build — adds tools mid-session (used by the MCP discovery subagent)
agent.rebuild(store?);            // Alias for build(store?) when re-binding to a new store post-construction
```

The runnable returned by `build()` exposes `model`, `displayManager`, and `serverMode` as read-only fields so subagents and dynamically-folded tools (e.g. MCP discovery) can inherit them.

### GloveFoldArgs<I>

```typescript
{
  name: string,
  description: string,
  inputSchema?: z.ZodType<I>,             // Optional. Provide either inputSchema (Zod, validated locally) or jsonSchema (raw, passthrough).
  jsonSchema?: Record<string, unknown>,   // Raw JSON Schema. When set, executor skips local Zod validation. Used by bridgeMcpTool.
  requiresPermission?: boolean | ((input: I) => boolean),  // boolean gates every call; function form gates per-input (return true to require check, false to skip)
  unAbortable?: boolean,                  // When true, tool runs to completion even if abort signal fires (e.g. voice barge-in)
  do: (
    input: I,
    display: DisplayManagerAdapter,
    glove: IGloveRunnable,
    signal?: AbortSignal,
  ) => Promise<ToolResultData>,
  generateToolSummary?: (summaryArgs?: unknown) => Promise<string>,
  // ^ `glove` is the running Glove instance — used by subagent-folded tools (e.g. discovermcp's `activate`)
  //   to fold bridged tools onto the main agent and inherit its model/displayManager.
  // ^ `signal` is the active request's AbortSignal. Forward it into long-running internal work so abort
  //   propagates. Tools that ignore it still get the executor's abortable-promise unwind for free; tools
  //   marked `unAbortable: true` should ignore signal entirely.
  // ^ `generateToolSummary` is called by the Executor when `do()` returns `generateSummaryArgs`. Returned
  //   string lands on `result.summary` and replaces `result.data` in older context when the Glove was
  //   constructed with `enableToolResultSummary: true`. See "Tool result summaries" further down.
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
interface TokenConsumptionCounter {
  tokens_in: number;
  tokens_out: number;
}

interface StoreAdapter {
  identifier: string;
  getMessages(): Promise<Message[]>;
  appendMessages(msgs: Message[]): Promise<void>;
  getTokenCount(): Promise<number>;                 // Returns a single sum of in + out
  addTokens(args: TokenConsumptionCounter): Promise<void>;  // Takes the split counter
  getTurnCount(): Promise<number>;
  incrementTurn(): Promise<void>;
  resetCounters(): Promise<void>;  // Reset token/turn counts without deleting messages
  // Optional — enables built-in task tool when present:
  getTasks?(): Promise<Task[]>;
  addTasks?(tasks: Task[]): Promise<void>;
  updateTask?(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>): Promise<void>;
  // Optional — enables permission system (input-aware):
  // The Executor passes the model-supplied tool input on every gated call.
  // Stores can scope decisions per-(name, input) or ignore input and treat
  // all calls to a tool uniformly. The default MemoryStore exact-matches via
  // permissionKey(name, input).
  getPermission?(toolName: string, input?: unknown): Promise<PermissionStatus>;
  setPermission?(toolName: string, status: PermissionStatus, input?: unknown): Promise<void>;
  // Optional — enables built-in inbox tool when present:
  getInboxItems?(): Promise<InboxItem[]>;
  addInboxItem?(item: InboxItem): Promise<void>;
  updateInboxItem?(itemId: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>): Promise<void>;
  getResolvedInboxItems?(): Promise<InboxItem[]>;
  // Optional — enables subagent factories to derive isolated child stores:
  // durable: false (default) → fresh per call. durable: true → cached for the namespace.
  createSubAgentStore?(namespace: string, durable?: boolean): Promise<StoreAdapter>;
}
```

**Implementations**:
- `MemoryStore` (glove-core) — default; implements every optional surface including `createSubAgentStore`. `Glove` constructs one automatically when no `store` is passed.
- `MemoryStore` (glove-react) — separate, simpler React-side implementation; lacks `createSubAgentStore`.
- `createRemoteStore` (glove-react) — delegates messages/tokens/etc. to user-provided async actions.
- `SqliteStore` (glove-sqlite) — **deprecated**.

### MemoryStore (glove-core)

```typescript
import { MemoryStore } from "glove-core";

const store = new MemoryStore("session-id");

// Sub-store: durable false → fresh per call; durable true → cached for namespace.
const childStore = await store.createSubAgentStore("researcher", false);
```

Used as the default `StoreAdapter` when `Glove` is constructed without a `store`. Implements messages, tokens (`tokens_in` + `tokens_out`), turns, tasks, permissions, inbox, and `createSubAgentStore`. Process-local — data is lost on restart.

Permission decisions are keyed on `(toolName, input)` via the exported `permissionKey(name, input)` helper — distinct inputs prompt independently and identical inputs hit the cached decision.

```typescript
import { permissionKey } from "glove-core";

permissionKey("bash", { cmd: "ls" });        // "bash::{\"cmd\":\"ls\"}"
permissionKey("bash", { cmd: "rm -rf /" });  // different key → independent prompt
permissionKey("read_file");                  // "read_file::null" (omitted input is its own bucket)
```

Custom stores that want fuzzier matching (regex on a command, prefix on a path) should canonicalise `input` themselves rather than reusing this helper.

### SqliteStore (deprecated)

```typescript
import { SqliteStore } from "glove-sqlite";

const store = new SqliteStore({ dbPath: ":memory:", sessionId: "abc123" });
// Additional methods: getName(), setName(), getWorkingDir(), setWorkingDir(), close()
// Static: SqliteStore.listSessions(dbPath)
// Static: SqliteStore.resolveInboxItem(dbPath, itemId, response) — resolve inbox item from external process
```

`@deprecated` — use `MemoryStore` from `glove-core` for prototyping or implement `StoreAdapter` against your own backend for production.

### ModelAdapter Interface

```typescript
interface ModelAdapter {
  name: string;
  prompt(request: PromptRequest, notify: NotifySubscribersFunction, signal?: AbortSignal): Promise<ModelPromptResult>;
  setSystemPrompt(systemPrompt: string): void;
}
```

**Built-in adapters**: `AnthropicAdapter`, `OpenAICompatAdapter`, `OpenRouterAdapter`, `MimoAdapter`, `BedrockAdapter`

### createAdapter (Provider Factory)

```typescript
import { createAdapter, getAvailableProviders } from "glove-core/models/providers";

const model = createAdapter({
  provider: "anthropic",         // openai | anthropic | openrouter | gemini | minimax | kimi | glm | mimo | ollama | lmstudio | bedrock
  model?: "claude-sonnet-4-20250514",
  apiKey?: string,               // Defaults to env var
  maxTokens?: number,
  stream?: boolean,              // Default: true
  baseURL?: string,              // Override provider's default base URL
  timeout?: number,              // Request timeout in ms (default 600_000 — 10m)
  // ─── Reasoning (OpenAI-compat path) ────────────────────────────────────
  reasoning?: boolean | OpenAICompatReasoningOptions,
  reasoningEffort?: "minimal" | "low" | "medium" | "high",  // legacy; folded into reasoning
  includeReasoningInText?: boolean,                          // legacy; folded into reasoning
  // ─── Bedrock-only ──────────────────────────────────────────────────────
  region?: string, accessKeyId?: string, secretAccessKey?: string, sessionToken?: string,
});

const available = getAvailableProviders();
// [{ id, name, available, models, defaultModel }]
```

### OpenAICompatAdapter Reasoning

OpenAI-compat reasoning models (DeepSeek-R1 / V4, Qwen3-Thinking,
GLM-4.5 / 4.6, Kimi K2, MiniMax M2.5, OpenRouter, GPT-5 / o-series)
emit a reasoning trace under `reasoning_content` (DeepSeek convention,
most upstreams) or `reasoning` (OpenRouter's normalized field). The
adapter captures either onto `Message.reasoning_content` and echoes it
back on tool-calling turns (required by DeepSeek V4 and MiMo).

```typescript
import {
  OpenAICompatAdapter,
  type OpenAICompatReasoningOptions,
  type ReasoningEffort,
} from "glove-core/models/openai-compat";

interface OpenAICompatReasoningOptions {
  /** Wrap reasoning in <think>…</think> and prepend to visible text. Default false. */
  includeInText?: boolean;
  /**
   * Echo Message.reasoning_content back on subsequent assistant turns that
   * produced tool_calls. Required by DeepSeek V4 and MiMo. Default true when
   * reasoning is enabled. Set false for DeepSeek-R1 specifically.
   */
  echo?: boolean;
  /** Sent as top-level `reasoning_effort` field. */
  effort?: ReasoningEffort;  // "minimal" | "low" | "medium" | "high"
  /** OpenRouter-style `reasoning` object. Sent verbatim. */
  reasoningObject?: {
    effort?: "low" | "medium" | "high";
    max_tokens?: number;
    exclude?: boolean;
    enabled?: boolean;
  };
  /** Anthropic-style `thinking` object. For OpenAI shims that forward thinking. */
  thinking?: { type: "enabled" | "disabled"; budget_tokens?: number };
  /** Escape hatch — merged into request body. For Qwen3 dashscope's `enable_thinking`, etc. */
  extraBody?: Record<string, unknown>;
}

// Sensible defaults: capture + echo on tool turns.
new OpenAICompatAdapter({ baseURL, apiKey, model, reasoning: true });

// Hint thinking depth.
new OpenAICompatAdapter({ baseURL, apiKey, model, reasoning: { effort: "high" } });

// OpenRouter unified shape.
new OpenAICompatAdapter({
  baseURL: "https://openrouter.ai/api/v1", apiKey, model,
  reasoning: { reasoningObject: { effort: "high", max_tokens: 2000 } },
});

// Qwen3 dashscope.
new OpenAICompatAdapter({
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey, model,
  reasoning: { extraBody: { enable_thinking: true, thinking_budget: 1024 } },
});
```

The MiMo provider has its own `MimoAdapter` with the round-trip
baked-in — use `createAdapter({ provider: "mimo", ... })` for it.

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
  | { type: "compaction_end"; current_token_consumption: number; summary_message: Message }
  | { type: "token_consumption"; consumption: TokenConsumptionCounter }
  | { type: "hook_invoked"; name: string }
  | { type: "skill_invoked"; name: string; source: "user" | "agent"; args?: string }
  | { type: "subagent_invoked"; name: string; prompt: string }
  | { type: "subagent_completed"; name: string; status: "success" | "error"; message?: string };

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
| `tool_use_result` | Core (Executor) | `{ tool_name, call_id?, result }` | Tool execution finished |
| `compaction_start` | Core (Observer) | `{ current_token_consumption }` | Compaction begun |
| `compaction_end` | Core (Observer) | `{ current_token_consumption, summary_message }` | Compaction finished |
| `token_consumption` | Core (Observer) | `{ consumption: { tokens_in, tokens_out } }` | Token counter update — fires after each model turn alongside `store.addTokens` |
| `hook_invoked` | Core (Glove) | `{ name }` | A `/name` hook handler is about to run |
| `skill_invoked` | Core (Glove or skill dispatch tool) | `{ name, source: "user" | "agent", args? }` | A skill handler is about to run. `source: "user"` fires from `Glove.processRequest`; `source: "agent"` fires from inside `glove_invoke_skill` |
| `subagent_invoked` | Core (Executor, not the dispatcher) | `{ name, prompt }` | Open bracket — fires before a `glove_invoke_subagent` call runs |
| `subagent_completed` | Core (Executor, not the dispatcher) | `{ name, status: "success" | "error", message? }` | Close bracket — fires after the dispatcher resolves OR on abort/error. **Guaranteed 1:1 with `subagent_invoked`** |

**Custom adapter event contract:**
- Non-streaming: emit `model_response` once per prompt call
- Streaming: emit `text_delta` per chunk, `tool_use` per tool call, `model_response_complete` once at end
- Use `?? undefined` to coerce null `stop_reason` from provider SDKs
- Never emit `tool_use_result`, `compaction_start`, `compaction_end`, `token_consumption`, `hook_invoked`, `skill_invoked`, `subagent_invoked`, or `subagent_completed` — those are framework-only

#### Subagent bracket symmetry

The `Executor` (not the dispatcher) brackets every `glove_invoke_subagent` call. Even if the parent agent is aborted mid-run and the dispatcher's promise short-circuits, the executor's abort handler still fires `subagent_completed` with `status: "error"` and `message: "Subagent run aborted by the user."`. Subscribers can rely on every `subagent_invoked` having a matching `subagent_completed`. Events the child Glove emits between them belong to that subagent — parent subscribers are attached to the child for the duration of the run.

### Message

```typescript
interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  /** Set when a hook rewrites a user message via `rewriteText` — preserves the user's raw input. */
  pre_modified_text?: string;
  content?: ContentPart[];
  tool_results?: ToolResult[];
  tool_calls?: ToolCall[];
  is_compaction?: boolean;          // true for compaction summary messages
  is_compaction_request?: boolean;  // internal marker on the synthetic compaction prompt
  is_skill_injection?: boolean;     // true for synthetic user messages from /skill invocations
  /**
   * Provider-emitted reasoning trace, captured by the OpenAI-compat adapter
   * (`reasoning: true | {...}`) and the MiMo adapter. DeepSeek V4 and MiMo
   * require this to be echoed back on subsequent tool-calling turns; the
   * OpenAI-compat formatter handles the round-trip when echo is on.
   */
  reasoning_content?: string;
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

### Extensions: Hooks, Skills & Subagents

Three builder methods on `Glove` (and on the `IGloveBuilder` / `IGloveRunnable` interfaces):

```typescript
glove.defineHook(name: string, handler: HookHandler): this;
glove.defineSkill(args: DefineSkillArgs): this;
glove.defineSubAgent(args: DefineSubAgentArgs): this;
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
  parsedText: string;        // text with bound directives replaced by [invoked_extension__<type>_<name>] placeholders
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
  parsedText: string;        // when source = "user": user text with bound directives replaced by their placeholders. when source = "agent": same as args ?? "".
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

interface SubAgentFactoryContext {
  name: string;
  prompt: string;
  parentStore: StoreAdapter;
  parentControls: AgentControls;
}

type SubAgentFactory = (
  ctx: SubAgentFactoryContext,
) => Promise<IGloveRunnable> | IGloveRunnable;

interface SubAgentOptions {
  description?: string;       // shown to the agent in the invoke-subagent tool listing
}

interface DefineSubAgentArgs extends SubAgentOptions {
  name: string;
  factory: SubAgentFactory;
}

interface RegisteredSubAgent {
  factory: SubAgentFactory;
  description?: string;
}

interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
  store: StoreAdapter;                  // direct access to the agent's StoreAdapter
  displayManager: DisplayManagerAdapter; // direct access to the agent's display stack
  forceCompaction: () => Promise<void>;  // calls Observer.runCompactionNow()
}
```

#### Token parsing

```typescript
import { parseTokens, formatSkillMessage } from "glove-core";

interface ParsedTokens {
  /**
   * The original text with each bound `/name` directive replaced by a
   * non-triggerable placeholder of the form `[invoked_extension__<type>_<name>]`
   * (where `<type>` is `hook` or `skill`). Unbound `/name` tokens — including
   * filesystem-like paths such as `/usr/local` — are left untouched.
   */
  replaced: string;
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

The regex is `(^|\s)\/([A-Za-z][\w-]*)(?=\s|$)`. Only `/name` directives are parsed. A token only binds when its name appears in the hook or skill registry; unbound tokens are left in `replaced`. Bound directives are **substituted with placeholders** (`[invoked_extension__hook_<name>]` / `[invoked_extension__skill_<name>]`) — the placeholder is non-triggerable, so a future re-parse of the same text doesn't re-fire the extension. `@mention` tokens are intentionally NOT parsed — they reach the model verbatim and route through the `glove_invoke_subagent` tool. `formatSkillMessage` produces the synthetic user message used by `processRequest` and sets `is_skill_injection: true`.

#### Subagent dispatch tool name

```typescript
import { SUBAGENT_DISPATCH_TOOL_NAME } from "glove-core";
// "glove_invoke_subagent" — the tool name the Executor recognises so it can fire
// the subagent_invoked / subagent_completed bracket events around each call.
```

#### Built-in agent tools

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

When any subagent is registered, `glove_invoke_subagent` is auto-registered on the executor (mirrors Claude Code's subagent dispatch):

```typescript
import { createSubAgentInvokeTool, renderSubAgentToolDescription } from "glove-core";

// Tool input
{ name: string, prompt: string }

// Tool result on success
{ status: "success", data: { subagent: string, content: string } }

// Unknown name
{ status: "error", message: 'Subagent "..." is not registered. Use one of: ...', data: null }

// Factory threw
{ status: "error", message: 'Subagent "..." factory threw: ...', data: null }

// Child run threw
{ status: "error", message: 'Subagent "..." failed: ...', data: null }
```

The dispatcher invokes the registered factory with `{ name, prompt, parentStore, parentControls }`, attaches the parent's subscribers to the returned child Glove, calls `child.processRequest(prompt, signal)` (forwarding the parent's abort signal), and detaches the subscribers afterward. The child's final agent text becomes `data.content`. The `subagent_invoked` / `subagent_completed` bracket events are NOT fired by the dispatcher — they fire from the `Executor`, which guarantees 1:1 symmetry even when an abort short-circuits the dispatcher's promise.

#### Observer additions

- `Observer.runCompactionNow()` — same body as `tryCompaction()` minus the token-threshold guard. Called by `AgentControls.forceCompaction`.
- `Observer.ESCAPE_COMPACTION_THRESHOLD` (default `90`, percent) — controls when `Agent.ask` runs an early compaction to keep `tool_use` / `tool_result` pairs from being split across the boundary. Configurable via the `Observer` constructor's 7th argument.
- `Observer.isCompactionImminent()` — `true` when current token consumption is at or above `(CONTEXT_COMPACTION_LIMIT * ESCAPE_COMPACTION_THRESHOLD) / 100`. `Agent.ask` checks this before each turn and pre-emptively compacts when the model produced tool calls so pairs stay together.
- `Observer.addTokensConsumed(args: TokenConsumptionCounter)` — called per turn; persists via `store.addTokens(args)` and emits `token_consumption` to subscribers.

#### Message fields added

- `Message.is_skill_injection?: boolean` — set on the synthetic user message produced by a `/skill` invocation so transcript renderers can distinguish injected context from real user turns.
- `Message.pre_modified_text?: string` — populated when a hook rewrites the user message via `rewriteText`; preserves the user's raw input so frontends can render it alongside the rewritten version.

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
  requiresPermission?: boolean | ((input: I) => boolean);  // function form gates per-input
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
  requiresPermission?: boolean | ((input: z.infer<I>) => boolean),  // function form gates per-input
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

### MemoryStore (glove-react)

```typescript
import { MemoryStore } from "glove-react";
const store = new MemoryStore("session-id");
```

The React-side `MemoryStore` is a separate, simpler implementation than the one in `glove-core`. It stores messages, tokens, turns, tasks, inbox, and permissions in memory but does NOT implement `createSubAgentStore`. For server-side or subagent-aware usage, prefer `MemoryStore` from `glove-core`.

### createRemoteStore

```typescript
import { createRemoteStore, type RemoteStoreActions } from "glove-react";

const store = createRemoteStore("session-id", {
  getMessages: async (sid) => fetch(`/api/${sid}/messages`).then(r => r.json()),
  appendMessages: async (sid, msgs) =>
    fetch(`/api/${sid}/messages`, { method: "POST", body: JSON.stringify(msgs) }),
  // Optional async actions, all curried with sessionId:
  // getTokenCount?(sid)
  // addTokens?(sid, args: TokenConsumptionCounter)   // TAKES THE SPLIT COUNTER, NOT A SINGLE NUMBER
  // getTurnCount?(sid), incrementTurn?(sid), resetCounters?(sid)
  // getTasks?(sid), addTasks?(sid, tasks), updateTask?(sid, taskId, updates)
  // getPermission?(sid, toolName, input?), setPermission?(sid, toolName, status, input?)
  //   ↑ input is the model-supplied tool input — use it to scope decisions per-input.
  //     In-memory fallback keys on (toolName, JSON.stringify(input ?? null)) via permissionKey().
  // getInboxItems?(sid), addInboxItem?(sid, item),
  // updateInboxItem?(sid, itemId, updates), getResolvedInboxItems?(sid)
});
```

`RemoteStoreActions.addTokens` receives `(sessionId, args: TokenConsumptionCounter)`. The fallback in-memory accumulator sums `args.tokens_in + args.tokens_out`. `createRemoteStore` does NOT implement `createSubAgentStore` — subagents folded onto an agent backed by this store will use the `MemoryStore` fallback inside their factories.

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

Per-conversation, mirrors `StoreAdapter`. Auth seams are `getAccessToken` (the framework wraps the returned string as `Authorization: Bearer …`) and `getAuthHeaders` (full header map for non-bearer servers, e.g. `x-api-key`; wins when both are defined). With neither, connections carry no auth headers.

```ts
interface McpAdapter {
  identifier: string;
  getActive(): Promise<string[]>;
  activate(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;          // v1: doesn't unfold tools — refresh session for that
  getAccessToken?(id: string): Promise<string>;
  getAuthHeaders?(id: string): Promise<Record<string, string>>;
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

Behavior: reload all `adapter.getActive()` ids, then call `glove.defineSubAgent(discoverySubAgent({...}))` so the model can route discovery tasks via `glove_invoke_subagent({ name: "discovermcp", prompt: "..." })`. Fails open — a single bad reload logs and continues.

### Discovery

```ts
type DiscoveryAmbiguityPolicy =
  | { type: "interactive" }       // pushAndWait via mcp_picker renderer
  | { type: "auto-pick-best" }    // deterministic; default in serverMode
  | { type: "defer-to-main" };    // returns candidates as text, main agent decides

function discoverySubAgent(config: DiscoverySubAgentConfig): DefineSubAgentArgs;

interface DiscoverySubAgentConfig {
  adapter: McpAdapter;
  entries: McpCatalogueEntry[];
  ambiguityPolicy: DiscoveryAmbiguityPolicy;
  /** Default: inherited from the parent glove at invocation time. */
  subagentModel?: ModelAdapter;
  /** Default: built-in per-policy prompt. */
  subagentSystemPrompt?: string;
  /** Forwarded to connectMcp during activation. */
  clientInfo?: { name: string; version: string };
}
```

`discoverySubAgent` returns a `DefineSubAgentArgs` with `name: "discovermcp"`. Pass it directly to `glove.defineSubAgent(...)`. `mountMcp` does this for you.

The factory builds a child Glove on each invocation, asking the parent store for a non-durable sub-store via `parentStore.createSubAgentStore?.("discovermcp", false)` (falling back to a private `DiscoveryMemoryStore` when sub-stores aren't supported), inheriting the main agent's model / displayManager / serverMode, and folding `list_capabilities`, `activate`, `deactivate`, and (under `interactive`) `ask_user`. The `activate` tool reaches back to the parent glove (via the `glove` argument on its `do`) to fold bridged tools onto the main agent.

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

### bearer / headers / adapterAuth

```ts
type BearerToken = string | (() => Promise<string> | string);
function bearer(token: BearerToken): ConnectMcpAuth;

type CustomHeaders =
  | Record<string, string>
  | (() => Promise<Record<string, string>> | Record<string, string>);
function headers(custom: CustomHeaders): ConnectMcpAuth;

function adapterAuth(adapter: McpAdapter, id: string): ConnectMcpAuth | undefined;
```

`bearer` wraps a token (or thunk) as a `ConnectMcpAuth` returning `Authorization: Bearer …` headers. `headers` wraps a header map (or thunk) verbatim — for non-bearer servers (e.g. `{ "x-api-key": … }`). `adapterAuth` resolves an entry's auth from the adapter's seams: `getAuthHeaders` first, then `getAccessToken` via `bearer`, else `undefined` (no auth). Most consumers don't call these — `mountMcp` and discovery use `adapterAuth(adapter, id)` internally.

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
  input_schema?: z.ZodType<I>;
  jsonSchema?: Record<string, unknown>;
  /**
   * Permission gate. boolean applies to every call; (input) => boolean runs
   * per-call to decide whether THIS input needs a check. When the gate is
   * on, the Executor consults the store via getPermission(name, input).
   */
  requiresPermission?: boolean | ((input: I) => boolean);
  unAbortable?: boolean;
  run(
    input: I,
    handOver?: (request: unknown) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResultData>;
  generateSummary?: (args: unknown) => Promise<string>;
}

interface GloveFoldArgs<I> {
  name: string;
  description: string;
  inputSchema?: z.ZodType<I>;
  jsonSchema?: Record<string, unknown>;
  requiresPermission?: boolean | ((input: I) => boolean);  // see Tool<I> for semantics
  unAbortable?: boolean;
  do: (
    input: I,
    display: DisplayManagerAdapter,
    glove: IGloveRunnable,
    signal?: AbortSignal,
  ) => Promise<ToolResultData>;
  generateToolSummary?: (summaryArgs?: unknown) => Promise<string>;
  // `glove` is the running instance (used by tools that fold further tools at runtime, e.g. discovermcp's `activate`).
  // `signal` is the active request's AbortSignal — forward it into long-running internal work.
  // `generateToolSummary` produces a compact string from the `generateSummaryArgs` returned by `do()`.
  //   Lands on result.summary; swapped in for result.data in older context when the Glove was constructed
  //   with `enableToolResultSummary: true`. See "Tool result summaries" further down.
}
```

Pass exactly one of `inputSchema` / `jsonSchema`. The executor only runs Zod `safeParse` when `input_schema` is set; `jsonSchema`-only tools forward `call.input_args` straight to `run`. The subagent dispatcher (`glove_invoke_subagent`) explicitly forwards `signal` into the child's `processRequest` so a parent-side abort propagates into the child's `Agent.ask` loop.

`getToolJsonSchema(tool)` — adapter helper that returns whichever schema the tool provided as JSON Schema.

### Glove.fold — legal post-build

```ts
class Glove implements IGloveBuilder, IGloveRunnable {
  fold<I>(args: GloveFoldArgs<I>): this;   // legal at any time, including after build()
  // ...
}

interface IGloveRunnable {
  processRequest(request: string | ContentPart[], signal?: AbortSignal): Promise<ModelPromptResult | Message>;
  setModel(model: ModelAdapter): void;
  setSystemPrompt(prompt: string): void;
  getSystemPrompt(): string;
  /** Swap the display manager for this Glove. Useful for subagents that want to share the parent's display stack mid-run. */
  setDisplayManager(displayManager: DisplayManagerAdapter): void;
  addSubscriber(subscriber: SubscriberAdapter): void;
  removeSubscriber(subscriber: SubscriberAdapter): void;
  fold<I>(args: GloveFoldArgs<I>): IGloveRunnable;
  defineHook(name: string, handler: HookHandler): IGloveRunnable;
  defineSkill(args: DefineSkillArgs): IGloveRunnable;
  defineSubAgent(args: DefineSubAgentArgs): IGloveRunnable;
  /** Re-bind to a new store post-construction. Equivalent to .build(store). */
  rebuild(store?: StoreAdapter): IGloveRunnable;
  readonly displayManager: DisplayManagerAdapter;
  readonly model: ModelAdapter;
  readonly serverMode: boolean;
}
```

The `built` throw was removed. Tools that need to register more tools at runtime (e.g. the `discovermcp` subagent's `activate`) read `glove` from `do(input, display, glove, signal?)` and call `glove.fold(...)`.

### Tool result summaries

Per-tool compression of older tool results. Off by default — opt in by passing `enableToolResultSummary: true` to `new Glove({...})` and supplying `generateToolSummary` on the tools you want to shrink. The fields involved:

```ts
interface ToolResultData {
  status: "success" | "error" | "aborted";
  data: unknown;                 // sent to the model
  message?: string;
  renderData?: unknown;          // client-only, stripped by model adapters
  summary?: string;              // populated by the Executor from generateSummary(args)
  generateSummaryArgs?: unknown; // opaque payload the tool's do() hands to its summary handler
}

interface GloveFoldArgs<I> {
  // ...all existing fields...
  generateToolSummary?: (summaryArgs?: unknown) => Promise<string>;
}

interface Tool<I> {
  // ...all existing fields...
  generateSummary?: (args: unknown) => Promise<string>;
}
```

Flow:

1. The tool's `do()` returns a `ToolResultData` with `generateSummaryArgs` set to whatever its summary handler needs.
2. After `do()` resolves, `Executor` checks `tool.generateSummary && result.generateSummaryArgs` — if both, it awaits `tool.generateSummary(result.generateSummaryArgs)` and assigns the returned string to `result.summary`. Both `data` and `summary` are stored on the result.
3. On every call to `PromptMachine.run`, when the `Glove` was constructed with `enableToolResultSummary: true`, the messages array is passed through `summarizeOlderToolResults` before being sent to the model. That method finds the index of the latest non-tool user message (i.e. a `Message` with `sender: "user"` and no `tool_results`). For every message with `tool_results` at or before that index, it returns a shallow copy where each result's `data` is replaced with its `summary` (when `summary` is a non-empty string). Tool results from the current turn are untouched.

Concrete example — a `read_file` tool:

```ts
const readFile: GloveFoldArgs<{ path: string; from?: number; to?: number }> = {
  name: "read_file",
  description: "Read a slice of a file.",
  inputSchema: z.object({ path: z.string(), from: z.number().optional(), to: z.number().optional() }),
  async do(input) {
    const slice = await fs.readFile(input.path, "utf8");
    return {
      status: "success",
      data: slice,
      generateSummaryArgs: { path: input.path, from: input.from, to: input.to, lineCount: slice.split("\n").length },
    };
  },
  async generateToolSummary(args) {
    const { path, from, to, lineCount } = args as { path: string; from?: number; to?: number; lineCount: number };
    const range = from != null || to != null ? ` lines ${from ?? 1}-${to ?? "EOF"}` : "";
    return `Read ${path}${range} (${lineCount} lines).`;
  },
};
```

Older `read_file` results in context arrive at the model as `"Read src/lib/auth.ts lines 40-120 (81 lines)."` while the current turn keeps the full slice.

Behavioural details:

- Off by default — set `enableToolResultSummary: true` on `GloveConfig` to enable.
- Tools that omit `generateToolSummary`, or omit `generateSummaryArgs` on a particular call, leave `summary` unset. The pruner only substitutes when `summary` is truthy, so partially-instrumented tool catalogues still work.
- The store keeps full `data` and `summary` on every result — only the messages handed to the model adapter are rewritten. Transcript renderers, history snapshots, and analytics all see the full record.
- Carried through `Glove.rebuild(store?)` — the new `PromptMachine` is constructed with the same `enableToolResultSummary` flag.
- Composes with compaction: tool summaries shrink the per-turn payload going to the model, delaying the point at which the Observer needs to compact. Compaction still fires when the instrumented context eventually grows past `CONTEXT_COMPACTION_LIMIT`.

`PromptMachine` constructor signature picks up an optional fourth arg: `new PromptMachine(model, ctx, systemPrompt, enableToolResultSummary?: boolean)`. Default is `false`.

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
  enableToolResultSummary?: boolean;     // opt-in older-tool-result compression. See "Tool result summaries".
}
```

Drives default permission-gating on bridged MCP tools (always-off in serverMode) and default discovery ambiguity policy (`auto-pick-best` in serverMode, `interactive` otherwise). Treat as the canonical headless flag for any future server-vs-UI behavioral splits.

---

## glove-memory

Storage-agnostic memory layer. Four sibling subsystems (entity / episodic / resources / context) with reader / curator tool surfaces and BYO storage adapters. Reference `InMemory*` adapters for dev/test. Draft v0.1 — companion storage backends (`glove-memory-sqlite`, `glove-memory-postgres`) not yet released.

### Subpath exports

| Import | Contents |
|--------|----------|
| `glove-memory` | Barrel — re-exports core / entity / episodic / resources / context plus tool helpers and in-memory adapters |
| `glove-memory/core` | Shared types — `Provenance`, `Link`, `EmbeddingAdapter`, `MemorySchema`, errors |
| `glove-memory/entity` | `EntityMemoryAdapter`, `MemoryNode`, `MemoryEdge`, query DSL |
| `glove-memory/episodic` | `EpisodicMemoryAdapter`, `Episode`, semantic-search opts |
| `glove-memory/resources` | `ResourceFsAdapter`, `ResourceFile`, POSIX path helpers |
| `glove-memory/context` | `ContextAdapter`, `ContextEntry`, default markdown rendering |
| `glove-memory/tools` | Auto-registered read/write tool factories and `useMemory*` / `useEpisodic*` / `useResources*` / `useContext` helpers |
| `glove-memory/in-memory` | Reference in-process adapters |

### MemorySchema

Shared ontology object passed to every adapter. Schema lives in code only — package does not persist or migrate it.

```ts
import { MemorySchema } from "glove-memory/core";

class MemorySchema {
  defineNodeClass<P>(def: NodeClassDef<P>): this;
  defineRelationship<P>(def: RelationshipDef<P>): this;
  defineEpisodeKind<P>(def: EpisodeKindDef<P>): this;
  defineResourceRoot(def: ResourceRootDef): this;

  // Lookups
  getNodeClass(name: string): NodeClassDef<any> | undefined;
  requireNodeClass(name: string): NodeClassDef<any>;
  getRelationship(type: string): RelationshipDef<any> | undefined;
  requireRelationship(type: string): RelationshipDef<any>;
  getEpisodeKind(name: string): EpisodeKindDef<any> | undefined;
  getResourceRoot(path: string): ResourceRootDef | undefined;

  // Listings (used by tool descriptions)
  listNodeClasses(): NodeClassDef<any>[];
  listRelationships(): RelationshipDef<any>[];
  listEpisodeKinds(): EpisodeKindDef<any>[];
  listResourceRoots(): ResourceRootDef[];
}

interface NodeClassDef<P = unknown> {
  name: string;
  schema: z.ZodType<P>;
  /** Multi-set: any matching set folds the write into the same node. */
  identityKeys?: Array<Array<keyof P & string>>;
  /** Indexed for fuzzy / contains search. */
  searchableProperties?: Array<keyof P & string>;
}

interface RelationshipDef<P = unknown> {
  type: string;
  from: string;                     // node class name
  to: string;                       // node class name
  propertiesSchema?: z.ZodType<P>;
  /** When true, multiple edges of this type can exist between the same pair. Default false. */
  multi?: boolean;
}

interface EpisodeKindDef<P = unknown> {
  name: string;
  description?: string;
  propertiesSchema?: z.ZodType<P>;
}

interface ResourceRootDef {
  path: string;                     // absolute POSIX path
  description?: string;
  /** Default true. False skips embedding lifecycle for files under this root. */
  semanticSearch?: boolean;
}
```

### Provenance + Link

```ts
import type { Provenance, Link } from "glove-memory/core";
import { ProvenanceSchema, LinkSchema } from "glove-memory/core";

interface Provenance {
  source: string;     // "conversation:<id>/turn:<n>", "manual", "import:<kind>:<id>"
  actor: string;      // "curator-run-xyz", "user:don", "system"
  timestamp: string;  // ISO 8601
  note?: string;
}

interface Link {
  kind: "entity" | "episode" | "resource";
  id: string;
  relation?: string;
}
```

Provenance is required on every write and append-only per record. Link targets are not validated by adapters — that's the orchestrator's job.

### EmbeddingAdapter

```ts
interface EmbeddingAdapter {
  /** Adapters must reject `setEmbedding` with mismatched-dimension vectors. */
  dimensions: number;
  /** Returned vectors match input order. */
  embed(texts: string[]): Promise<number[][]>;
}
```

Out-of-band lifecycle: writes mark records `embeddingStatus: "missing" | "stale"` and return immediately; an external loop calls `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding` → `embed` → `setEmbedding`.

### Error hierarchy

All extend `MemoryError extends Error` with a `code: string`.

```ts
class MemoryError extends Error { code: string }
class MemoryNotFoundError extends MemoryError {}              // code: "not_found"

class MemorySchemaError extends MemoryError {}                // codes:
type MemorySchemaErrorCode =
  | "unknown_class" | "unknown_relationship" | "unknown_kind"
  | "unknown_resource_root" | "schema_mismatch";

class MemoryQueryError extends MemoryError { operator?: string }   // codes:
type MemoryQueryErrorCode = "invalid_query" | "operator_not_supported";

class MemoryWriteError extends MemoryError { matchedIds?: string[] }   // codes:
type MemoryWriteErrorCode =
  | "validation_failed" | "provenance_required" | "identity_ambiguous";
// matchedIds set on identity_ambiguous — orchestrator merges those then retries.

class EpisodicMemoryError extends MemoryError {}              // codes:
type EpisodicMemoryErrorCode =
  | "embedding_unavailable" | "semantic_search_unsupported" | "invalid_time_range";

class ResourceFsError extends MemoryError {}                  // codes:
type ResourceFsErrorCode =
  | "path_not_found" | "path_already_exists" | "not_a_directory" | "not_a_file"
  | "directory_not_empty" | "edit_string_not_unique" | "edit_string_not_found"
  | "body_not_editable" | "binary_not_supported" | "semantic_search_unsupported"
  | "invalid_path" | "invalid_range";

class ContextError extends MemoryError {}                     // codes:
type ContextErrorCode =
  | "entry_not_found" | "invalid_section" | "expired" | "render_failed";
```

### EntityMemoryAdapter

```ts
import type { EntityMemoryAdapter } from "glove-memory/entity";

interface EntityMemoryAdapter {
  identifier: string;
  schema: MemorySchema;

  // Nodes
  addNode(className: string, props: unknown, provenance: Provenance): Promise<NodeWriteResult>;
  getNode(id: string): Promise<MemoryNode | null>;
  updateNode(id: string, props: Record<string, unknown>, provenance: Provenance): Promise<void>;
  mergeNodes(keepId: string, mergeId: string, provenance: Provenance): Promise<void>;

  // Edges
  connect(
    fromId: string, toId: string, relType: string,
    props: unknown | undefined, provenance: Provenance,
  ): Promise<EdgeWriteResult>;
  disconnect(edgeId: string, provenance: Provenance): Promise<void>;

  // Query
  findNodes(className: string, where: NodeFilter, opts?: FindNodesOpts): Promise<MemoryNode[]>;
  getNodeWithNeighbours(id: string): Promise<NodeWithNeighbours | null>;
  query(spec: QuerySpec): Promise<QueryResult>;
}

interface FindNodesOpts {
  /** When true, string `eq` filters opportunistically run as fuzzy on `searchableProperties`. */
  fuzzy?: boolean;
  limit?: number;
  offset?: number;
}

interface MemoryNode {
  id: string;
  className: string;
  props: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  props?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

interface NodeWriteResult {
  id: string;
  /** False when the write matched an existing node via identity keys. */
  created: boolean;
  /** Present if dedup folded this write into an existing node. */
  mergedInto?: string;
}

interface EdgeWriteResult {
  id: string;
  /** False when an existing (fromId, toId, type) edge was updated rather than created. */
  created: boolean;
}

interface NodeWithNeighbours {
  node: MemoryNode;
  neighbours: NodeNeighbour[];
}

interface NodeNeighbour {
  edgeId: string;
  edgeType: string;
  direction: "out" | "in";
  nodeId: string;
  className: string;
  edgeProps?: Record<string, unknown>;
}
```

Identity behaviour: `addNode` matches against `identityKeys` deterministically — no fuzzy on the write path. If any identity key set matches an existing node, returns `created: false`. If two distinct existing nodes match different identity sets in the same write, throws `MemoryWriteError("identity_ambiguous", ..., matchedIds)` — the orchestrator merges first then retries.

### Query DSL

```ts
import type { QuerySpec, NodeFilter, FilterOp, ExpandSpec, QueryResult } from "glove-memory/entity";
import { FilterOpSchema, NodeFilterSchema, ExpandSpecSchema, QuerySpecSchema, FILTER_OP_KEYS } from "glove-memory/entity";

type FilterOp =
  | { eq: unknown } | { neq: unknown } | { in: unknown[] } | { not_in: unknown[] }
  | { exists: boolean } | { fuzzy: string } | { contains: string }
  | { starts_with: string } | { ends_with: string }
  | { gt: number | string } | { gte: number | string }
  | { lt: number | string } | { lte: number | string }
  | { between: [unknown, unknown] };

type NodeFilter = { [propertyName: string]: FilterOp | FilterOp[] };

interface ExpandSpec {
  [relationshipType: string]: {
    select?: string[];
    where?: NodeFilter;
    expand?: ExpandSpec;
    limit?: number;
    orderBy?: string;
  };
}

interface QuerySpec {
  from: string;                // root node class
  where?: NodeFilter;
  expand?: ExpandSpec;
  select?: string[];           // root property allowlist
  orderBy?: string;            // "propertyName:asc" | "propertyName:desc"
  limit?: number;
  offset?: number;
}

interface QueryResult { rows: QueryRow[] }
interface QueryRow {
  id: string;
  className: string;
  props: Record<string, unknown>;
  expanded?: Record<string, QueryRow[]>;
}
```

The operator set is closed. Adapters that can't implement an operator throw `MemoryQueryError("operator_not_supported", message, op)` rather than degrading silently.

### EpisodicMemoryAdapter

```ts
import type { EpisodicMemoryAdapter } from "glove-memory/episodic";

interface EpisodicMemoryAdapter {
  identifier: string;
  schema: MemorySchema;
  /** Drives whether `glove_episodic_search` is registered by `useEpisodicReader`. */
  supportsSemanticSearch: boolean;

  recordEpisode(ep: EpisodeInput, provenance: Provenance): Promise<{ id: string }>;
  getEpisode(id: string): Promise<Episode | null>;
  updateEpisode(id: string, patch: EpisodePatch, provenance: Provenance): Promise<void>;
  deleteEpisode(id: string, provenance: Provenance): Promise<void>;

  findEpisodes(spec: EpisodeQuerySpec): Promise<Episode[]>;
  episodesForEntity(entityId: string, opts?: EpisodeListOpts): Promise<Episode[]>;
  episodesBetween(start: string, end: string, opts?: EpisodeListOpts): Promise<Episode[]>;

  /** Bulk participant rewrite — used by orchestrators to reconcile after entity merge. */
  replaceParticipantId(oldId: string, newId: string, provenance: Provenance): Promise<{ updated: number }>;

  // Embedding lifecycle
  findEpisodesNeedingEmbedding(opts?: { limit?: number }): Promise<Array<{ id: string; content: string }>>;
  setEmbedding(id: string, vector: number[]): Promise<void>;

  // Only callable when supportsSemanticSearch === true
  searchEpisodes?(query: string, opts?: SemanticSearchOpts): Promise<EpisodeSearchResult[]>;
}

interface Episode {
  id: string;
  occurredAt: string | { start: string; end: string };
  content: string;
  kind: string;                       // registered episode kind
  participants: Array<{ entityId: string; role?: string }>;
  properties?: Record<string, unknown>;
  embeddingStatus: "missing" | "fresh" | "stale";
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

type EpisodeInput = Omit<Episode,
  "id" | "createdAt" | "updatedAt" | "provenance" | "embeddingStatus">;

type EpisodePatch = Partial<
  Pick<Episode, "content" | "kind" | "participants" | "properties" | "occurredAt">
>;

interface EpisodeQuerySpec {
  where?: {
    kind?: string | string[];
    participantIds?: string[];        // matches if any participant ID is in the set
    properties?: NodeFilter;          // reuses entity-side closed operator set
  };
  timeRange?: { start?: string; end?: string };
  orderBy?:
    | "occurredAt:asc" | "occurredAt:desc"
    | "createdAt:asc"  | "createdAt:desc";
  limit?: number;
  offset?: number;
}

interface EpisodeListOpts {
  limit?: number;
  offset?: number;
  orderBy?: "occurredAt:asc" | "occurredAt:desc";
  kind?: string | string[];
}

interface SemanticSearchOpts {
  limit?: number;
  filter?: {
    participantIds?: string[];
    kind?: string | string[];
    timeRange?: { start?: string; end?: string };
  };
  /** 0 = pure semantic, 1 = pure recency. Default 0.2. */
  recencyWeight?: number;
}

interface EpisodeSearchResult {
  episode: Episode;
  /** Blended semantic + recency score (higher is better). */
  score: number;
  /** Raw embedding distance, for debugging. */
  distance: number;
}

// helpers
function occurredAtStart(occurredAt: Episode["occurredAt"]): Date;
function occurredAtEnd(occurredAt: Episode["occurredAt"]): Date;
```

In-memory adapter detail: `updateEpisode` flips `embeddingStatus: "stale"` only when `content` changes — kind / participant / property / occurredAt patches don't re-embed. The recency blend uses `recencyScore = exp(-ln(2) * ageMs / halfLifeMs)` with `halfLifeMs = 30 days`.

### ResourceFsAdapter

```ts
import type { ResourceFsAdapter } from "glove-memory/resources";

interface ResourceFsAdapter {
  identifier: string;
  schema: MemorySchema;
  supportsSemanticSearch: boolean;

  // Read
  list(path: string, opts?: { recursive?: boolean; limit?: number }): Promise<DirectoryEntry[]>;
  /** Default range [1, 50]; pass [start, -1] for start-to-EOF. */
  read(path: string, opts?: { range?: [number, number] }): Promise<ResourceFile>;
  stat(path: string): Promise<ResourceStat | null>;
  exists(path: string): Promise<boolean>;

  // Search
  grep(spec: GrepSpec): Promise<GrepMatch[]>;
  glob(pattern: string, opts?: { path?: string; limit?: number }): Promise<string[]>;
  searchSemantic?(query: string, opts?: ResourceSemanticSearchOpts): Promise<SemanticMatch[]>;

  // Write
  write(path: string, body: ResourceBody, metadata: ResourceMetadata, provenance: Provenance): Promise<void>;
  /** Throws if `oldStr` matches zero or more than once. */
  edit(path: string, oldStr: string, newStr: string, provenance: Provenance): Promise<void>;
  mkdir(path: string, provenance: Provenance): Promise<void>;
  move(fromPath: string, toPath: string, provenance: Provenance): Promise<void>;
  remove(path: string, recursive: boolean, provenance: Provenance): Promise<void>;
  setMetadata(path: string, patch: Partial<ResourceMetadata>, provenance: Provenance): Promise<void>;

  // Reverse linking + bulk rewrite
  linksFor(targetKind: "entity" | "episode" | "resource", targetId: string): Promise<string[]>;
  replaceLinkTarget(
    fromKind: "entity" | "episode" | "resource",
    fromId: string, toId: string, provenance: Provenance,
  ): Promise<{ updated: number }>;

  // Embedding lifecycle (only when supportsSemanticSearch === true)
  findFilesNeedingEmbedding?(opts?: { limit?: number }): Promise<Array<{ path: string; content: string }>>;
  setEmbedding?(path: string, vector: number[]): Promise<void>;
}

type ResourceBody =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
  | { type: "url"; url: string; cachedText?: string };

interface ResourceMetadata {
  summary?: string;
  tags: string[];
  links: Link[];
  [key: string]: unknown;             // free-form consumer fields
}

interface ResourceFile {
  path: string;
  body: ResourceBody;
  metadata: ResourceMetadata;
  embeddingStatus: "missing" | "fresh" | "stale";
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

interface DirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  // file-only
  contentType?: "text" | "markdown" | "url";
  size?: number;
  summary?: string;
  tags?: string[];
  updatedAt?: string;
}

interface ResourceStat {
  path: string;
  kind: "file" | "directory";
  size?: number;
  contentType?: "text" | "markdown" | "url";
  metadata?: ResourceMetadata;
  createdAt: string;
  updatedAt: string;
}

interface GrepSpec {
  query: string;
  regex?: boolean;                    // default false (literal substring)
  caseSensitive?: boolean;            // default false
  path?: string;                      // restrict to subtree, default "/"
  contentTypes?: Array<"text" | "markdown" | "url">;
  contextLines?: number;              // default 2
  limit?: number;
}

interface GrepMatch {
  path: string;
  line: number;
  text: string;
  context?: { before: string[]; after: string[] };
}

interface SemanticMatch {
  path: string;
  summary?: string;
  score: number;
  distance: number;
}

interface ResourceSemanticSearchOpts {
  limit?: number;
  path?: string;                      // restrict to subtree
  contentTypes?: Array<"text" | "markdown" | "url">;
  /** 0 = pure semantic, 1 = pure recency. Default 0 (no recency bias for resources). */
  recencyWeight?: number;
}

// path helpers
function normalisePath(input: string): string;
function parentDir(path: string): string;
function basename(path: string): string;
function isWithin(parent: string, child: string): boolean;
function matchGlob(pattern: string, path: string): boolean;

// content helpers
function searchableText(body: ResourceBody): string | null;
function bodySize(body: ResourceBody): number | undefined;
```

Both curator and user can write directly via this adapter — provenance disambiguates them.

### ContextAdapter

```ts
import type { ContextAdapter } from "glove-memory/context";

interface ContextAdapter {
  identifier: string;
  schema: MemorySchema;

  // Read
  list(section?: string): Promise<ContextEntry[]>;
  get(id: string): Promise<ContextEntry | null>;
  /** Markdown block to inject into the system prompt. Pinned entries by default; expired entries silently filtered. */
  render(opts?: ContextRenderOpts): Promise<string>;

  // Write
  set(entry: ContextEntryInput, provenance: Provenance): Promise<{ id: string }>;
  update(id: string, patch: ContextEntryPatch, provenance: Provenance): Promise<void>;
  unset(id: string, provenance: Provenance): Promise<void>;
  /** Bulk replace all entries in a section — common "user updated their preferences pane" flow. */
  setSection(
    section: string,
    entries: Array<Omit<ContextEntryInput, "section">>,
    provenance: Provenance,
  ): Promise<void>;
  unsetSection(section: string, provenance: Provenance): Promise<void>;
}

interface ContextEntry {
  id: string;
  section: string;          // free-form: "identity", "preferences", "glossary", "current_task", ...
  title?: string;
  content: string;          // markdown body
  pinned: boolean;          // true = always injected at turn start; false = read on demand
  expiresAt?: string;       // optional ISO 8601; expired entries filtered from render/list
  links?: Link[];
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

type ContextEntryInput = Omit<ContextEntry, "id" | "createdAt" | "updatedAt" | "provenance">;
type ContextEntryPatch = Partial<Omit<ContextEntry, "id" | "createdAt" | "updatedAt" | "provenance">>;

interface ContextRenderOpts {
  /** Default false. */
  includeUnpinned?: boolean;
  /** Default: all sections. */
  sections?: string[];
}

// Zod schemas
const ContextEntryInputSchema: z.ZodType<ContextEntryInput>;
const ContextEntryPatchSchema: z.ZodType<ContextEntryPatch>;
```

### `use*` helpers

All seven take `(glove, adapter)` and return the same `glove` for chaining. The first six use the bare `FoldTarget` signature; `useContext` requires the richer `ContextEnableTarget` because it also wraps `processRequest`.

```ts
import {
  useMemoryReader, useMemoryCurator,
  useEpisodicReader, useEpisodicCurator,
  useResourcesReader, useResourcesCurator,
  useContext,
  type FoldTarget, type ContextEnableTarget,
} from "glove-memory";

type FoldTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
};

interface ContextEnableTarget {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string): void;
  processRequest(
    request: string | ContentPart[],
    signal?: AbortSignal,
  ): Promise<ModelPromptResult | Message>;
}

function useMemoryReader<G extends FoldTarget>(glove: G, adapter: EntityMemoryAdapter): G;
function useMemoryCurator<G extends FoldTarget>(glove: G, adapter: EntityMemoryAdapter): G;
function useEpisodicReader<G extends FoldTarget>(glove: G, adapter: EpisodicMemoryAdapter): G;
function useEpisodicCurator<G extends FoldTarget>(glove: G, adapter: EpisodicMemoryAdapter): G;
function useResourcesReader<G extends FoldTarget>(glove: G, adapter: ResourceFsAdapter): G;
function useResourcesCurator<G extends FoldTarget>(glove: G, adapter: ResourceFsAdapter): G;
function useContext<G extends ContextEnableTarget>(glove: G, adapter: ContextAdapter): G;
```

`useContext` snapshots the developer-supplied system prompt at registration time, then on every subsequent `processRequest` it calls `adapter.render()` and composes `<base>\n\n<rendered>` (rendered context goes **after** developer guardrails). Multiple `useContext` calls stack — each captures the then-current base prompt.

### Lower-level tool factories

For consumers who want to build their own tool surface composition. Each factory returns one `GloveFoldArgs<T>`; the `useXxxReader` / `useXxxCurator` helpers just call all of these in turn and `fold` them.

```ts
// Entity
function buildFindNodesTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildGetNodeTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildQueryTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildAddNodeTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildUpdateNodeTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildConnectTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildDisconnectTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildMergeNodesTool(adapter: EntityMemoryAdapter): GloveFoldArgs<...>;
function buildEntityReaderTools(adapter: EntityMemoryAdapter): GloveFoldArgs<any>[];
function buildEntityCuratorTools(adapter: EntityMemoryAdapter): GloveFoldArgs<any>[];
function renderEntitySchemaSection(schema: MemorySchema): string;

// Episodic
function buildEpisodicFindTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<...>;
function buildEpisodicTimelineTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<...>;
function buildEpisodicSearchTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<...>;     // skipped when !supportsSemanticSearch
function buildEpisodicRecordTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<...>;
function buildEpisodicUpdateTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<...>;
function buildEpisodicDeleteTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<...>;
function buildEpisodicReaderTools(adapter: EpisodicMemoryAdapter): GloveFoldArgs<any>[];
function buildEpisodicCuratorTools(adapter: EpisodicMemoryAdapter): GloveFoldArgs<any>[];
function renderEpisodeKindsSection(schema: MemorySchema): string;

// Resources
function buildResourcesLsTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesReadTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesStatTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesGrepTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesGlobTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesSearchTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;        // skipped when !supportsSemanticSearch
function buildResourcesLinksForTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesWriteTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesEditTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesMkdirTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesMoveTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesRemoveTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesSetMetadataTool(adapter: ResourceFsAdapter): GloveFoldArgs<...>;
function buildResourcesReaderTools(adapter: ResourceFsAdapter): GloveFoldArgs<any>[];
function buildResourcesCuratorTools(adapter: ResourceFsAdapter): GloveFoldArgs<any>[];
function renderResourceRootsSection(schema: MemorySchema): string;

// Context
function buildContextGetTool(adapter: ContextAdapter): GloveFoldArgs<...>;
function buildContextSetTool(adapter: ContextAdapter): GloveFoldArgs<...>;
function buildContextUpdateTool(adapter: ContextAdapter): GloveFoldArgs<...>;
function buildContextUnsetTool(adapter: ContextAdapter): GloveFoldArgs<...>;
function buildContextTools(adapter: ContextAdapter): GloveFoldArgs<any>[];
```

### Reference in-memory adapter constructors

```ts
import {
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
} from "glove-memory";

new InMemoryEntityAdapter({
  schema: MemorySchema;
  identifier?: string;          // default: `in-memory-entity-${Date.now()}`
});

new InMemoryEpisodicAdapter({
  schema: MemorySchema;
  identifier?: string;
  /** When provided, supportsSemanticSearch becomes true and naive cosine similarity is used. */
  embedder?: EmbeddingAdapter;
  /** No embedder? Set true for in-process fuzzy/lexical content search (exact-phrase + substring + bigram-Dice typo tolerance). supportsSemanticSearch becomes true; no external service or vectors. Ignored when `embedder` is set. */
  fuzzySearch?: boolean;
});

new InMemoryResourcesAdapter({
  schema: MemorySchema;
  identifier?: string;
  embedder?: EmbeddingAdapter;
});

new InMemoryContextAdapter({
  schema: MemorySchema;
  identifier?: string;
});
```

Process-local — data is lost on restart. Companion adapters (`glove-memory-sqlite`, `glove-memory-postgres`) ship production-shaped implementations.

---

## glove-mesh

Inter-agent messaging on top of the inbox primitive. Behaviorally additive to `glove-core` (agent loop, executor, store contracts unchanged) with one minimal runtime API addition: a `readonly store: StoreAdapter` accessor on `IGloveRunnable`. `mountMesh` reads `glove.store` through that accessor to write resolved inbox items directly, without going through the model's tool path. Ships from `glove-mesh` (barrel), with subpath exports `glove-mesh/core`, `glove-mesh/tools`, `glove-mesh/in-memory`.

### mountMesh

```ts
import { mountMesh } from "glove-mesh";
import type { MeshMountTarget, MountMeshConfig } from "glove-mesh";

interface MountMeshConfig {
  /** Per-agent adapter. Implements registration, transport, and inbound subscription. */
  adapter: MeshAdapter;
  /** This agent's identity, announced to the network on mount. */
  identity: AgentIdentity;
}

type MeshMountTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  readonly store: StoreAdapter;
};

function mountMesh(
  glove: MeshMountTarget,
  config: MountMeshConfig,
): Promise<void>;
```

`IGloveRunnable` satisfies `MeshMountTarget` (the `store` accessor was added on the runnable for this purpose). Throws `MeshStoreUnsupportedError` if `glove.store` does not implement all four inbox methods.

### MeshAdapter

```ts
interface MeshAdapter {
  identifier: string;

  // Identity / registration
  register(identity: AgentIdentity): Promise<void>;
  unregister(): Promise<void>;
  listAgents(): Promise<AgentIdentity[]>;
  getAgent(id: string): Promise<AgentIdentity | null>;

  // Outbound
  send(message: MeshMessage): Promise<void>;
  broadcast(message: Omit<MeshMessage, "to">): Promise<void>;
  acknowledge(messageId: string, note?: string): Promise<void>;

  // Inbound — framework registers ONE handler per agent
  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void;
}
```

### Identity, message, and incoming types

```ts
interface AgentIdentity {
  id: string;
  name: string;
  description: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

interface MeshMessage {
  id: string;                    // sender-generated
  from: string;                  // sender-claimed; unverified in v1
  to?: string;                   // omitted on broadcast
  in_reply_to?: string;
  content: string;
  created_at: string;            // ISO-8601
  blocking?: boolean;
  metadata?: Record<string, unknown>;
}

interface IncomingMeshMessage extends MeshMessage {
  kind: "direct" | "broadcast" | "ack";
  ack_of?: string;               // when kind === "ack"
  ack_note?: string;
}
```

### The four tools

| Tool | Input schema | Output `data` |
|------|--------------|---------------|
| `glove_mesh_send_message` | `{ to: string, content: string, in_reply_to?: string, blocking?: boolean }` | `{ message_id, to, blocking }` |
| `glove_mesh_broadcast` | `{ content: string, blocking?: boolean }` | `{ message_id, blocking }` |
| `glove_mesh_list_agents` | `{ filter?: { capability?, name_contains? } }` | `{ agents: AgentSummary[], count }` |
| `glove_mesh_acknowledge` | `{ message_id: string, note?: string }` | `{ acknowledged: string }` |

`AgentSummary` is `{ id, name, description, capabilities }`. All tools return `{ status: "success" \| "error", data, message? }`.

### MeshNetwork + InMemoryMeshAdapter

In-process reference implementation under `glove-mesh/in-memory`.

```ts
class MeshNetwork {
  constructor(opts?: { senderTableCapacity?: number }); // default 1024

  registerAgent(id: string, identity: AgentIdentity): void;
  unregisterAgent(id: string): void;
  listAgents(): AgentIdentity[];
  getAgent(id: string): AgentIdentity | null;

  attachHandler(agentId: string, h: Handler): () => void;

  deliverDirect(msg: MeshMessage): Promise<void>;
  deliverBroadcast(msg: MeshMessage): Promise<void>;
  deliverAck(originalSenderId: string, ackOf: string, fromId: string, note?: string): Promise<void>;

  resolveSenderFor(messageId: string): string | null;
}

class InMemoryMeshAdapter implements MeshAdapter {
  constructor(network: MeshNetwork, agentId: string);
}
```

### Inbox tag convention

Mesh-originated inbox items use namespaced tags:

| Tag prefix | Direction | Meaning |
|------------|-----------|---------|
| `mesh:from:<sender>` | inbound | direct message |
| `mesh:broadcast:from:<sender>` | inbound | broadcast |
| `mesh:waiting:<msg_id>` | local | pending blocking item for an outbound send |

### Error classes

```ts
class MeshError extends Error { code: string }
class MeshNotRegisteredError extends MeshError {}
class MeshUnknownAgentError extends MeshError {}
class MeshUnknownMessageError extends MeshError {}
class MeshStoreUnsupportedError extends MeshError {}
```

### Individual tool builders

For consumers who want to fold tools manually without going through `mountMesh`:

```ts
import {
  buildMeshSendTool,
  buildMeshBroadcastTool,
  buildMeshListAgentsTool,
  buildMeshAcknowledgeTool,
} from "glove-mesh";

// Each takes a ToolContext { adapter, identity, store, pending: PendingMap }
// and returns a GloveFoldArgs<I> ready to pass to glove.fold(...).
```

Most consumers should use `mountMesh` instead — it wires the inbound subscriber, the closure-captured pending map, and the identity registration in one call.

---

## glove-continuum-signal

Subprocess-based runtime substrate for agent collaboration across time. Modeled on station-signal; agent-shaped (Glove instances as the unit of execution, persistent stores as the unit of continuity across wakeups). Ships from `glove-continuum-signal` (single entry, no subpaths in v1).

### agent() builder

```ts
import { agent, z } from "glove-continuum-signal";
import type {
  Agent,
  AnyAgent,
  TriggeredAgent,
  ConcurrentAgent,
  AgentBuilder,
  TriggeredAgentBuilder,
  ConcurrentAgentBuilder,
  AgentFactoryContext,
  AgentRuntimeControls,
} from "glove-continuum-signal";

function agent(name: string): AgentBuilder;
```

`AgentBuilder<TInput, TOutput>` setters (all return a fresh clone — immutable builder):

| Method | Purpose |
|--------|---------|
| `.input(zod)` | Zod schema for trigger/notify input. Carries `TInput` forward. |
| `.output(zod)` | Zod schema for processRequest's extracted output. Carries `TOutput` forward. |
| `.timeout(ms)` | Per-run timeout. Parent enforces via SIGTERM for triggered; per-notify for concurrent. Default 5min. |
| `.concurrency(n)` | Per-agent run budget (triggered only — concurrent agents are 1-per-name). |
| `.env({...})` | Extra env vars forwarded to spawned subprocesses. Loader-critical vars (`NODE_OPTIONS`, `LD_PRELOAD`, …) are stripped. |
| `.store(name => StoreAdapter)` | Persistent store factory. Runtime invokes per wakeup; passes the result to the factory via `ctx.store`. |
| `.triggered()` | Forks into `TriggeredAgentBuilder<TInput, TOutput>`. |
| `.concurrent()` | Forks into `ConcurrentAgentBuilder<TInput, TOutput>`. |

`TriggeredAgentBuilder<TInput, TOutput>` adds triggered-only setters:

| Method | Purpose |
|--------|---------|
| `.retries(n)` | Total attempts = n + 1 (matches station-signal). Default no retry. |
| `.every("5m")` | Recurring schedule. Interval grammar: `100ms`, `30s`, `5m`, `1h`, `2d`, `1w`. |
| `.withInput(default)` | Default input for the recurring schedule. |
| `.onComplete((output, input) => …)` | Post-run hook. Errors here emit `onCompleteError` but don't fail the run. |
| `.factory(async ctx => Glove)` | Terminal. Returns `TriggeredAgent<TInput, TOutput>` (branded). |

`ConcurrentAgentBuilder<TInput, TOutput>` mirrors the common setters and exposes `.onComplete(…)` and `.factory(…)`. The built `ConcurrentAgent<TInput, TOutput>` has `.notify(input)` in addition to `.trigger(input)` (both enqueue `kind: "notify"`).

```ts
interface AgentFactoryContext {
  name: string;
  runId: string;                // per-wakeup for triggered; "warmup" for concurrent factory setup
  mode: "triggered" | "concurrent";
  store: StoreAdapter | null;   // built from `.store(factory)` or null
  subscriber: SubscriberAdapter; // IPC-forwarding; bootstrap re-attaches defensively
  controls: AgentRuntimeControls;
}

interface AgentRuntimeControls {
  emit(event: { type: string; data?: Record<string, unknown> }): void;
  signal: AbortSignal;          // fires on graceful stop / restart / terminal fail
}

interface Agent<TInput, TOutput> {
  readonly name: string;
  readonly mode: "triggered" | "concurrent";
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;
  readonly factory: (ctx: AgentFactoryContext) => Promise<IGloveRunnable>;
  // ... + storeFactory, onCompleteHandler, timeout, maxAttempts, maxConcurrency, env, interval?, recurringInput?
  trigger(input: TInput): Promise<string>;
  notify?(input: TInput): Promise<string>;   // ConcurrentAgent only
}

const AGENT_BRAND = Symbol.for("glove-continuum-agent");
function isAgent(value: unknown): value is AnyAgent;
```

### ContinuumRunner

```ts
import { ContinuumRunner } from "glove-continuum-signal";
import type { ContinuumRunnerOptions } from "glove-continuum-signal";

interface ContinuumRunnerOptions {
  agentsDir?: string;
  adapter?: ContinuumAdapter;                                    // default: MemoryAdapter
  pollIntervalMs?: number;                                       // default 1000
  maxAttempts?: number;                                          // fallback for agents w/o their own
  subscribers?: ContinuumSubscriber[];
  maxConcurrent?: number;                                        // triggered-run budget, default 5
  retryBackoffMs?: number;                                       // base for exp. backoff, default 1000
  warmRestartPolicy?: { maxRestarts: number; backoffMs: number }; // default { 5, 1000 }
}

class ContinuumRunner {
  static create(agentsDir: string, options?: Omit<ContinuumRunnerOptions, "agentsDir">): ContinuumRunner;

  start(): Promise<void>;
  stop(options?: { graceful?: boolean; timeoutMs?: number }): Promise<void>;
  notify(name: string, input: unknown): Promise<string>;
  cancel(runId: string): Promise<boolean>;
  waitForRun(runId: string, opts?: { pollMs?: number; timeoutMs?: number; waitForExistence?: boolean }): Promise<Run | null>;
  getRun(id: string): Promise<Run | null>;
  listRuns(agentName: string): Promise<Run[]>;
  listAgents(): Array<{ name: string; mode: AgentMode; filePath: string }>;
  hasAgent(name: string): boolean;
  subscribe(s: ContinuumSubscriber): this;
  registerAgent(a: AnyAgent, filePath: string): this;
  getAdapter(): ContinuumAdapter;
}
```

`start()`: discovers branded agents from `agentsDir` (recursive readdir, `await import`, scan `Object.values` for `isAgent`), pre-warms concurrent ones, installs SIGINT/SIGTERM, enters the tick loop. `stop({ graceful: true })` sends `stop` IPC to warm agents, awaits children, kills any stragglers after `timeoutMs`.

### ContinuumAdapter

```ts
import type { ContinuumAdapter, Run, RunPatch, RunStatus, RunKind } from "glove-continuum-signal";

type RunKind = "trigger" | "recurring" | "notify";
type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface Run {
  id: string;
  agentName: string;
  kind: RunKind;
  input: string;           // JSON
  output?: string;         // JSON
  error?: string;
  status: RunStatus;
  attempts: number;
  maxAttempts: number;
  timeout: number;
  interval?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

interface ContinuumAdapter {
  addRun(run: Run): Promise<void>;
  removeRun(id: string): Promise<void>;
  getRunsDue(): Promise<Run[]>;
  getRunsRunning(): Promise<Run[]>;
  getRun(id: string): Promise<Run | null>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  listRuns(agentName: string): Promise<Run[]>;
  hasRunWithStatus(agentName: string, statuses: RunStatus[]): Promise<boolean>;
  purgeRuns(olderThan: Date, statuses: RunStatus[]): Promise<number>;
  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

`MemoryAdapter` (default) — in-process Map, ~10% eviction of terminal runs at the 10k cap. Does NOT implement `SerializableAdapter`. Steps are deliberately dropped from the station-signal contract — the Glove turn IS the unit of work, and fine-grained observability lives on the forwarded subscriber event stream.

### ContinuumSubscriber

```ts
import type { ContinuumSubscriber, AgentEventEnvelope } from "glove-continuum-signal";

interface ContinuumSubscriber {
  // Discovery / supervisor lifecycle
  onAgentDiscovered?(e: { agentName: string; mode: AgentMode; filePath: string }): void;
  onAgentSpawned?(e: { agentName: string; mode: AgentMode; pid: number; startedAt: Date }): void;
  onAgentReady?(e: { agentName: string }): void;     // concurrent only
  onAgentTerminated?(e: { agentName: string; reason: string; restartScheduled: boolean }): void;
  onAgentRestarted?(e: { agentName: string; restartCount: number }): void;

  // Per-run lifecycle (covers both kind: "trigger" and kind: "notify" — distinguish via run.kind)
  onRunDispatched?(e: { run: Run }): void;
  onRunStarted?(e: { run: Run }): void;
  onRunCompleted?(e: { run: Run; output?: string }): void;
  onRunFailed?(e: { run: Run; error?: string }): void;
  onRunTimeout?(e: { run: Run }): void;
  onRunRetry?(e: { run: Run; attempt: number; maxAttempts: number }): void;
  onRunCancelled?(e: { run: Run }): void;
  onRunSkipped?(e: { run: Run; reason: string }): void;
  onRunRescheduled?(e: { run: Run; nextRunAt: Date }): void;
  onNotifyDelivered?(e: { run: Run }): void;
  onCompleteError?(e: { run: Run; error: string }): void;
  onLogOutput?(e: { run: Run | null; agentName: string; level: "stdout" | "stderr"; message: string }): void;

  // Forwarded Glove events from any child subprocess
  onAgentEvent?(envelope: AgentEventEnvelope): void;
}

interface AgentEventEnvelope<T extends SubscriberEvent["type"] = SubscriberEvent["type"]> {
  agentName: string;
  runId: string | null;           // null for ambient warm-agent events
  mode: AgentMode;
  event_type: T;
  data: SubscriberEventDataMap[T];
  timestamp: string;
}
```

`ConsoleSubscriber` ships as a default implementation — useful out of the box. Custom subscribers narrow on `envelope.event_type` to handle specific Glove events.

### IPC wire shape

```ts
import type {
  ParentToChildMessage,
  ChildToParentMessage,
  IPCMessage,
} from "glove-continuum-signal";

type ParentToChildMessage =
  | { type: "notify"; runId: string; input: unknown }
  | { type: "stop"; reason?: string };

type ChildToParentMessage =
  | { type: "ready"; agentName: string }                                                   // concurrent only
  | { type: "run:started"; runId; agentName; timestamp }
  | { type: "run:completed"; runId; agentName; output?; timestamp }
  | { type: "run:failed"; runId; agentName; error; retryable; timestamp }
  | { type: "notify:started"; runId; agentName; timestamp }
  | { type: "notify:completed"; runId; agentName; output?; timestamp }
  | { type: "notify:failed"; runId; agentName; error; timestamp }
  | { type: "onComplete:error"; runId; agentName; error }
  | { type: "agent:event"; agentName; runId: string | null; event_type; data; timestamp };

type IPCMessage = ChildToParentMessage; // station-signal naming compatibility
```

Split `run:*` vs `notify:*` so subscribers can distinguish without inspecting `Run.kind`. No mesh-specific envelope slots — mesh runs entirely inside the subprocess against the consumer's `MeshAdapter`.

### Remote trigger

```ts
import { configure, HttpTriggerAdapter } from "glove-continuum-signal";

configure({ endpoint: "https://continuum.example.com", apiKey: "..." });
// or directly:
configure({ triggerAdapter: new HttpTriggerAdapter({ endpoint, apiKey }) });
```

When a `TriggerAdapter` is configured, `agent.trigger(input)` POSTs to `${endpoint}/api/v1/trigger` with `{ agentName, input }` instead of writing locally. Env-var auto-config: `CONTINUUM_ENDPOINT` + `CONTINUUM_API_KEY`.

### Error classes

`AgentValidationError`, `AgentNotFoundError`, `AgentTimeoutError`, `AgentTerminatedError`, `ContinuumRemoteError` — all carry a `.code` discriminator.

### Quick reference

| Need | Symbol |
|------|--------|
| Define an agent | `agent("name").input(zod).triggered()\|.concurrent().factory(ctx => glove)` |
| Run agents | `new ContinuumRunner({ agentsDir, adapter, subscribers, ... })` |
| Push to a warm agent | `runner.notify(name, input)` or `concurrentAgent.notify(input)` |
| Wait for a run | `runner.waitForRun(runId, { timeoutMs })` |
| Persistence contract | `ContinuumAdapter` |
| Default adapter | `MemoryAdapter` |
| Remote trigger | `configure({ endpoint, apiKey })` + `HttpTriggerAdapter` |
| Observability | `ContinuumSubscriber`, `ConsoleSubscriber`, `AgentEventEnvelope` |
| Brand | `AGENT_BRAND`, `isAgent(v)` |
| Interval parsing | `parseInterval("5m")` from `glove-continuum-signal` |
| Re-exported from glove-core | `IGloveRunnable`, `StoreAdapter`, `SubscriberAdapter`, `SubscriberEvent`, `SubscriberEventDataMap` |
| Re-exported from zod | `z` |

---

## glovebox

Authoring entry point and `glovebox build` CLI. Wraps a built Glove agent into a deployable Glovebox artifact.

### glovebox.wrap

```ts
import { glovebox } from "glovebox-core";

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
import { rule, composite } from "glovebox-core";

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
