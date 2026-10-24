# glove-core: the loop, models, stores, server-side agents and the inbox

> Read when building or debugging the agent loop itself: `new Glove(...)`, `fold`, `processRequest`, stores, subscribers, model providers and reasoning options, server-side (non-React) agents, abort handling, and the inbox for work that resolves later.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Architecture at a Glance

```
User message → Agent Loop → Model decides tool calls → Execute tools → Feed results back → Loop until done
                                                          ↓
                                                   Display Stack (pushAndWait / pushAndForget)
                                                          ↓
                                                   React renders UI slots
```

### Core Concepts

- **Agent** — AI coordinator that replaces router/navigation logic. Reads tools, decides which to call.
- **Tool** — A capability: name, description, inputSchema (Zod), `do` function, optional `render` + `renderResult`.
- **Display Stack** — Stack of UI slots tools push onto. `pushAndWait` blocks tool; `pushAndForget` doesn't.
- **Display Strategy** — Controls slot visibility lifecycle: `"stay"`, `"hide-on-complete"`, `"hide-on-new"`.
- **renderData** — Client-only data returned from `do()` that is NOT sent to the AI model. Used by `renderResult` for history rendering.
- **Adapter** — Pluggable interfaces for Model, Store, DisplayManager, and Subscriber. Swap providers without changing app code.
- **Context Compaction** — Auto-summarizes long conversations to stay within context window limits. The store preserves full message history (so frontends can display the entire chat), while `Context.getMessages()` splits at the last compaction summary so the model only sees post-compaction context. Summary messages are marked with `is_compaction: true`.
- **Inbox** — Persistent async mailbox for cross-instance communication. An agent posts a request (text) that can't be resolved now; an external service resolves it later (text response). Resolved items are automatically injected into the agent's context on the next `ask()` call. Items can be blocking (agent should wait) or non-blocking. Built-in `glove_post_to_inbox` tool auto-registered when store supports inbox methods.
- **Extensions (hooks, skills, subagents)** — `/hookname` runs a builder-defined handler with full agent controls (force compaction, swap model, short-circuit a turn). `/skillname` materialises a synthetic user message before the real one (marked `is_skill_injection: true`). `defineSubAgent({ name, factory })` registers a subagent the main agent can route to via the auto-registered `glove_invoke_subagent` tool — the user's `@name` text is NOT parsed by glove, it reaches the model verbatim and acts as a routing signal (mirrors Claude Code's subagent convention). `/` tokens are replaced with non-triggerable placeholders (`[invoked_extension__hook_<name>]` / `[invoked_extension__skill_<name>]`) so the model sees that an extension fired without the placeholder re-binding on a future parse; unbound `/` tokens stay untouched (so `/usr/local` survives). Skills can be exposed to the agent (`exposeToAgent: true`) so the agent pulls them in via the auto-registered `glove_invoke_skill` tool.
- **MCP catalogue + adapter** — `glove-mcp` introduces two pieces: a static `McpCatalogueEntry[]` describing servers the app supports, and a per-conversation `McpAdapter` holding active ids and resolving access tokens. `mountMcp` reloads previously active servers and registers a `discovermcp` discovery subagent (via `glove.defineSubAgent(discoverySubAgent({...}))`) — the model invokes it through `glove_invoke_subagent({ name: "discovermcp", prompt: "..." })` to find and activate servers mid-conversation.
- **Mesh network** — `glove-mesh` lets Glove agents send each other messages via a consumer-supplied `MeshAdapter` (transport). Each agent keeps its own `StoreAdapter`+inbox; when A sends to B, the framework drops a `status: "resolved"` `InboxItem` into B's store so the existing inbox-injection path surfaces it on B's next `ask()`. Blocking sends insert a pending `blocking: true` item that resolves on ack or `in_reply_to` reply. No auth in v1.
- **Continuum (subprocess runtime)** — `glove-continuum-signal` supervises Glove agents as Node subprocesses. **Triggered** agents are cold and spawn-per-wakeup (resume from a persistent `StoreAdapter` each time); **concurrent** agents are warm and notified inline. The `agent()` builder forks into mode-specific types after `.triggered()` / `.concurrent()` so mode-specific setters (`.retries()`, `.every()`) are type-level guarded. Persistent stores configured via `.store(name => StoreAdapter)` so the same store implementation can be injected across an agent fleet. Parent is single source of truth for run status (children only emit IPC). Mesh integration: mount in the factory — substrate stays out of inter-agent protocol.

## Server-Side Agents

For CLI tools, backend services, WebSocket servers, or any non-browser environment, use `glove-core` directly. No React, Next.js, or browser required.

### Minimal Setup

```typescript
import { Glove, Displaymanager, MemoryStore, createAdapter } from "glove-core";
import z from "zod";

// MemoryStore from glove-core is the default. Omit `store` from the
// Glove config and Glove constructs one for you with a generated identifier.
// For persistence implement your own StoreAdapter.
const store = new MemoryStore("my-session");

const agent = new Glove({
  store,
  model: createAdapter({ provider: "anthropic", stream: true }),
  displayManager: new Displaymanager(),  // required but can be empty
  systemPrompt: "You are a helpful assistant.",
  serverMode: true,  // canonical "I am headless" flag — drives default permission gating + MCP discovery policy
  compaction_config: {
    compaction_instructions: "Summarize the conversation.",
  },
})
  .fold({
    name: "search",
    description: "Search the database.",
    inputSchema: z.object({ query: z.string() }),
    async do(input) {
      const results = await db.search(input.query);
      return { status: "success", data: results };
    },
  })
  .build();

const result = await agent.processRequest("Find recent orders");
console.log(result.messages[0]?.text);
```

### `MemoryStore` from `glove-core`

`MemoryStore` is the default `StoreAdapter` used when `Glove` is constructed without a `store`. It implements every optional surface — messages, tokens, turns, tasks, permissions, inbox, and `createSubAgentStore` — so subagents work out of the box.

```typescript
import { MemoryStore } from "glove-core";

const store = new MemoryStore("my-session");

// Sub-stores: durable: false (default) returns a fresh per-call store.
// durable: true caches the same instance per namespace so a subagent can
// carry message history across invocations.
const childStore = await store.createSubAgentStore("researcher", false);
```

`MemoryStore` is process-local — it loses data on restart. For persistence, implement `StoreAdapter` against your own backend. `glove-sqlite` is deprecated; new projects should prefer `MemoryStore` for prototyping or BYO `StoreAdapter` for production.

### Key Differences from React

| React (`glove-react`) | Server-side (`glove-core`) |
|----------------------|---------------------------|
| `defineTool` with `render`/`renderResult` | `.fold()` with just `do` — no renderers needed |
| `useGlove()` hook manages state | Call `agent.processRequest()` directly |
| `GloveClient` + `GloveProvider` | `new Glove({...}).build()` |
| `createEndpointModel` (SSE client) | `createAdapter()` or direct adapter (e.g. `new AnthropicAdapter()`) |
| `MemoryStore` from glove-react | `MemoryStore` from glove-core (default) — or implement `StoreAdapter` for persistence |

### Tools Without Display

Most server-side tools ignore the display manager — just return a result:

```typescript
gloveBuilder.fold({
  name: "get_weather",
  description: "Get weather for a city.",
  inputSchema: z.object({ city: z.string() }),
  async do(input) {
    const res = await fetch(`https://wttr.in/${input.city}?format=j1`);
    return { status: "success", data: await res.json() };
  },
});
```

Returning a plain string also works — auto-wrapped to `{ status: "success", data: yourString }`.

### Interactive Tools (pushAndWait)

When a tool calls `display.pushAndWait()`, the agent loop blocks until `dm.resolve(slotId, value)` is called. Wire this to your UI layer (WebSocket, terminal, Slack, etc.):

```typescript
// Tool side
async do(input, display) {
  const confirmed = await display.pushAndWait({
    renderer: "confirm",
    input: { message: `Delete ${input.file}?` },
  });
  if (!confirmed) return { status: "error", data: null, message: "Cancelled" };
  // proceed...
}

// Server side — resolve when user responds
dm.resolve(slotId, true);
```

### Subscribers (Logging, Forwarding)

```typescript
import type { SubscriberAdapter } from "glove-core";

const logger: SubscriberAdapter = {
  async record(event_type, data) {
    if (event_type === "text_delta") process.stdout.write((data as any).text);
    if (event_type === "tool_use") console.log(`\n[tool] ${(data as any).name}`);
  },
};

gloveBuilder.addSubscriber(logger);
```

### Common Patterns

- **CLI script**: Build agent, call `processRequest()`, print result
- **Multi-turn REPL**: Loop with readline, each `processRequest()` accumulates in the store
- **WebSocket server**: Per-connection session with isolated store/dm/subscriber, forward events via `record()`
- **Background worker**: Build agent per job, process from a queue, no display needed
- **Hot-swap model**: Call `agent.setModel(newAdapter)` at runtime
- **MCP-backed agent**: Set `serverMode: true`, call `mountMcp(glove, { adapter, entries })` before `build()`. See [MCP Integration](mcp.md).

### Optional Store Features

- **Tasks** (`getTasks`, `addTasks`, `updateTask`): Auto-registers `glove_update_tasks` tool
- **Permissions** (`getPermission(name, input?)`, `setPermission(name, status, input?)`): Tools with `requiresPermission: true` (or a `(input) => boolean` gate) check consent. The Executor passes the model-supplied input on every gated call so the store can scope decisions per-input. The default `MemoryStore` uses exact-match keying via the exported `permissionKey(name, input)` helper.
- **Inbox** (`getInboxItems`, `addInboxItem`, `updateInboxItem`, `getResolvedInboxItems`): Auto-registers `glove_post_to_inbox` tool. Enables async cross-instance communication.

If your store doesn't implement these, they're silently disabled.

## Inbox (Async Mailbox)

The inbox enables agents to post requests that will be resolved later by external services — surviving across sessions and instances.

### How It Works

1. Agent calls `glove_post_to_inbox` with a tag, request text, and blocking flag
2. Item persists in the store with status `pending`
3. External service resolves the item (via `SqliteStore.resolveInboxItem()` from `glove-sqlite`, or store API)
4. Next time `agent.ask()` runs, resolved items are injected as text messages and marked `consumed`
5. Pending blocking items are surfaced as transient reminders (not persisted)
6. Compaction preserves pending inbox items in the summary block

### Built-in Tool: `glove_post_to_inbox`

Auto-registered when store implements inbox methods. Input schema:

```typescript
{
  tag: string,       // Category label, e.g. "restock_watch"
  request: string,   // Natural language description of what needs to happen
  blocking: boolean, // Default false. If true, agent should wait for resolution
}
```

### External Resolution

```typescript
// From a background job, webhook handler, or cron:
import { SqliteStore } from "glove-sqlite";

SqliteStore.resolveInboxItem(
  "path/to/db.db",
  "inbox_item_id",
  "The item you requested is now available."  // text response
);
```

Or via REST if you've set up inbox API routes (see coffee example).

### InboxItem Type

```typescript
interface InboxItem {
  id: string;
  tag: string;
  request: string;
  response: string | null;
  status: "pending" | "resolved" | "consumed";
  blocking: boolean;
  created_at: string;
  resolved_at: string | null;
}
```

### Store Methods (Optional)

```typescript
// Add to StoreAdapter to enable inbox:
getInboxItems?(): Promise<InboxItem[]>
addInboxItem?(item: InboxItem): Promise<void>
updateInboxItem?(itemId: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>): Promise<void>
getResolvedInboxItems?(): Promise<InboxItem[]>
```

All store implementations (SqliteStore from `glove-sqlite`, MemoryStore, createRemoteStore) support inbox.

### React Integration

`useGlove()` returns `inbox: InboxItem[]` alongside `tasks`:

```tsx
const { inbox, tasks, timeline, sendMessage } = useGlove({ tools, sessionId });

// Show pending watches in UI
{inbox.filter(i => i.status === "pending").map(item => (
  <div key={item.id}>{item.tag}: {item.request}</div>
))}
```

### Remote Store Actions

When using `createRemoteStore`, add inbox actions to persist to your backend:

```typescript
const storeActions: RemoteStoreActions = {
  // ...existing getMessages, appendMessages...
  getInboxItems: (sid) => fetch(`/api/sessions/${sid}/inbox`).then(r => r.json()),
  addInboxItem: (sid, item) => fetch(`/api/sessions/${sid}/inbox`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) }),
  updateInboxItem: (sid, itemId, updates) => fetch(`/api/sessions/${sid}/inbox/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, updates }) }),
  getResolvedInboxItems: (sid) => fetch(`/api/sessions/${sid}/inbox/resolved`).then(r => r.json()),
};
```

## Supported Providers

| Provider | Env Variable | Default Model | SDK Format |
|----------|-------------|---------------|------------|
| `openai` | `OPENAI_API_KEY` | `gpt-4.1` | openai |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | anthropic |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` | openai |
| `vercel` | `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN`) | `anthropic/claude-sonnet-4` | openai |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | openai |
| `minimax` | `MINIMAX_API_KEY` | `MiniMax-M2.5` | openai |
| `kimi` | `MOONSHOT_API_KEY` | `kimi-k2.5` | openai |
| `glm` | `ZHIPUAI_API_KEY` | `glm-4-plus` | openai |
| `mimo` | `MIMO_API_KEY` (+ optional `MIMO_BASE_URL`) | `mimo-v2.5` | mimo |
| `ollama` | _(none)_ | _(user-specified)_ | openai |
| `lmstudio` | _(none)_ | _(user-specified)_ | openai |
| `bedrock` | `AWS_ACCESS_KEY_ID` | `anthropic.claude-3-5-sonnet-20241022-v2:0` | bedrock |

### Reasoning Models

The OpenAI-compat adapter captures provider-emitted reasoning traces
(`reasoning_content` / `reasoning` field) from DeepSeek-R1 / V4,
Qwen3-Thinking, GLM-4.5 / 4.6, Kimi K2, MiniMax M2.5, OpenRouter,
GPT-5 / o-series, and any other OpenAI-shape endpoint that follows the
convention. Captured trace lands on `Message.reasoning_content` (a typed
string field) and is echoed back on subsequent tool-calling assistant
turns (DeepSeek V4 and MiMo reject the request otherwise).

| Use case | Config |
|----------|--------|
| Default capture + echo | `createAdapter({ provider, reasoning: true })` |
| Hint thinking depth (GPT-5 / GLM / MiniMax / Kimi / DeepSeek V4) | `createAdapter({ provider, reasoning: { effort: "high" } })` — `"minimal"`/`"low"`/`"medium"`/`"high"` |
| OpenRouter unified reasoning object | `createAdapter({ provider: "openrouter", reasoning: { reasoningObject: { effort: "high", max_tokens: 2000 } } })` |
| Anthropic-style `thinking` (for OpenAI shims) | `createAdapter({ provider, reasoning: { thinking: { type: "enabled", budget_tokens: 4000 } } })` |
| Qwen3 dashscope `enable_thinking` | `createAdapter({ provider, reasoning: { extraBody: { enable_thinking: true, thinking_budget: 1024 } } })` |
| Surface trace in visible text (wrapped in `<think>…</think>`) | `createAdapter({ provider, reasoning: { includeInText: true } })` |
| Disable echo (DeepSeek-R1 specifically) | `createAdapter({ provider, reasoning: { echo: false } })` |

`OpenAICompatReasoningOptions` is exported from
`glove-core/models/openai-compat`. Legacy `reasoningEffort` /
`includeReasoningInText` fields on `createAdapter` and
`createChatHandler` are folded into the new shape — existing MiMo
callers keep working unchanged. The MiMo provider continues to use
its dedicated adapter (`MimoAdapter` already has the field built-in).

## Pre-built Tool Registry

Common interactive tools worth copying rather than reinventing. They are documented on https://glove.dterminal.net/docs/display-stack and implemented in [`examples/nextjs-agent`](https://github.com/porkytheblack/glove/tree/main/examples/nextjs-agent) and [`examples/coffee`](https://github.com/porkytheblack/glove/tree/main/examples/coffee):

- `confirm_action` — Yes/No confirmation dialog
- `collect_form` — Multi-field form
- `ask_preference` — Single-select preference picker
- `text_input` — Free-text input
- `show_info_card` — Info/success/warning card (pushAndForget)
- `suggest_options` — Multiple-choice suggestions
- `approve_plan` — Step-by-step plan approval
