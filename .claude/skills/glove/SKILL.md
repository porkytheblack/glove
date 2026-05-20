---
name: glove
description: Expert guide for building AI-powered applications with the Glove framework. Use when working with glove-core, glove-react, glove-next, tools, display stack, model adapters, stores, any Glove example project, or deploying agents as sandboxed runtime services with Glovebox (glovebox / glovebox-kit / glovebox-client).
---

# Glove Framework — Development Guide

You are an expert on the Glove framework. Use this knowledge when writing, debugging, or reviewing Glove code.

## What Glove Is

Glove is an open-source TypeScript framework for building AI-powered applications. Users describe what they want in conversation, and an AI decides which capabilities (tools) to invoke. Developers define tools and renderers; Glove handles the agent loop.

**Repository**: https://github.com/porkytheblack/glove
**Docs site**: https://glove.dterminal.net
**License**: MIT (dterminal)

## Package Overview

| Package | Purpose | Install |
|---------|---------|---------|
| `glove-core` | Runtime engine: agent loop, tool execution, display manager, model adapters, `MemoryStore` default in-memory `StoreAdapter` (browser-safe — no native deps) | `pnpm add glove-core` |
| `glove-sqlite` | **Deprecated.** `SqliteStore` — persistent SQLite-backed store. Prefer `MemoryStore` from `glove-core` for prototyping or BYO `StoreAdapter` for production. | `pnpm add glove-sqlite` |
| `glove-react` | React hooks (`useGlove`), `GloveClient`, `GloveProvider`, `defineTool`, `<Render>`, `MemoryStore`, `ToolConfig` with colocated renderers | `pnpm add glove-react` |
| `glove-next` | One-line Next.js API route handler (`createChatHandler`) for streaming SSE | `pnpm add glove-next` |
| `glove-mcp` | Bridge MCP servers into a Glove agent: `mountMcp`, `connectMcp`, `bridgeMcpTool`, `McpAdapter`, `discovermcp` discovery subagent. Opt-in OAuth helpers at `glove-mcp/oauth`. | `pnpm add glove-mcp` |
| `glove-memory` | Schema-first memory layer with four sibling subsystems: entity graph, episodic timeline, resource filesystem, and ambient context. BYO storage via the adapter contracts; reference in-memory adapters ship for dev/test. Storage backends (`glove-memory-sqlite`, `glove-memory-postgres`) are companion packages — not yet released. Draft v0.1. | `pnpm add glove-memory` |
| `glovebox-core` | Authoring + `glovebox` build CLI. `glovebox.wrap(runnable, config)` packages a built Glove agent into a deployable artifact (Dockerfile + nixpacks.toml + bundled server + manifest + auth key). Storage DSL (`rule.*`, `composite`) and wire protocol types live here too. The unscoped `glovebox` name is taken on npm — install as `glovebox-core`; the CLI binary is still `glovebox`. | `pnpm add glovebox-core` |
| `glovebox-kit` | In-container runtime. `startGlovebox({ app, port, key, manifestPath, ... })` boots the WS server, auto-injects glovebox skills/hooks, and bridges Glove's display stack onto the wire. Storage adapters: `InlineStorage`, `UrlStorage`, `LocalServerStorage`, `S3Storage`. | (transitive — bundled by `glovebox build`) |
| `glovebox-client` | Client SDK. `GloveboxClient.make({ endpoints })`, `client.box(name).prompt(text, { files })`, `result.read(name)`, `box.environment()`. Symmetric `ClientStorage` interface with a default inline+url implementation. | `pnpm add glovebox-client` |

**Most projects need just `glove-react` + `glove-next`.** `glove-core` is included as a dependency of `glove-react`. For server-side or non-React agents, use `glove-core` directly — see [Server-Side Agents](#server-side-agents) below. For agents that need third-party tools via the Model Context Protocol, see [MCP Integration](#mcp-integration-glove-mcp).

### What's in the framework

- **`glove-core`** — agent loop, tools, display stack, store/model/subscriber adapters, context compaction, inbox, hooks/skills/subagents, `MemoryStore` default in-memory `StoreAdapter`.
- **`glove-react`** — colocated renderers via `defineTool`, `<Render>`, `useGlove`, `MemoryStore`, `createRemoteStore`, `createEndpointModel`, `createRemoteModel`.
- **`glove-next`** — `createChatHandler` (one-line SSE route), voice token handler.
- **`glove-sqlite`** — deprecated; `SqliteStore` for persistence (server-side only).
- **`glove-voice`** — full-duplex voice pipeline: STT/TTS/VAD adapters, `GloveVoice`, `useGloveVoice`, `useGlovePTT`, `<VoicePTTButton>`.
- **`glove-mcp`** — MCP servers as first-class tools: `mountMcp`, `connectMcp`, `bridgeMcpTool`, `McpAdapter` (consumer-supplied per-conversation seam). `discovermcp` discovery subagent (registered via `glove.defineSubAgent(discoverySubAgent({...}))`). Opt-in OAuth helpers at `glove-mcp/oauth` (`runMcpOAuth`, `FsOAuthStore`, `MemoryOAuthStore`, `McpOAuthProvider`).
- **`glove-memory`** — Memory layer with four sibling subsystems (entity graph / episodic timeline / resource filesystem / ambient context) and matching `useMemoryReader` / `useMemoryCurator`, `useEpisodicReader` / `useEpisodicCurator`, `useResourcesReader` / `useResourcesCurator`, and `useContext` helper families. Storage-agnostic adapter contracts plus reference `InMemory*` adapters for dev/test.

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

## Quick Start (Next.js)

### 1. Install

```bash
pnpm add glove-core glove-react glove-next zod
```

### 2. Server route

```typescript
// app/api/chat/route.ts
import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",     // or "openai", "openrouter", "gemini", etc.
  model: "claude-sonnet-4-20250514",
});
```

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, etc.) in `.env.local`.

### 3. Define tools with `defineTool`

```tsx
// lib/glove.tsx
import { GloveClient, defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";

const inputSchema = z.object({
  question: z.string().describe("The question to display"),
  options: z.array(z.object({
    label: z.string().describe("Display text"),
    value: z.string().describe("Value returned when selected"),
  })),
});

const askPreferenceTool = defineTool({
  name: "ask_preference",
  description: "Present options for the user to choose from.",
  inputSchema,
  displayPropsSchema: inputSchema,       // Zod schema for display props
  resolveSchema: z.string(),             // Zod schema for resolve value
  displayStrategy: "hide-on-complete",   // Hide slot after user responds
  async do(input, display) {
    const selected = await display.pushAndWait(input);  // typed!
    return {
      status: "success" as const,
      data: `User selected: ${selected}`,         // sent to AI
      renderData: { question: input.question, selected },  // client-only
    };
  },
  render({ props, resolve }) {           // typed props, typed resolve
    return (
      <div>
        <p>{props.question}</p>
        {props.options.map(opt => (
          <button key={opt.value} onClick={() => resolve(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>
    );
  },
  renderResult({ data }) {               // renders from history
    const { question, selected } = data as { question: string; selected: string };
    return <div><p>{question}</p><span>Selected: {selected}</span></div>;
  },
});

// Tools without display stay as raw ToolConfig
const getDateTool: ToolConfig = {
  name: "get_date",
  description: "Get today's date",
  inputSchema: z.object({}),
  async do() { return { status: "success", data: new Date().toLocaleDateString() }; },
};

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant.",
  tools: [askPreferenceTool, getDateTool],
  // getSessionId: () => fetch("/api/session").then(r => r.json()).then(d => d.id),
});
```

### 4. Provider + Render

```tsx
// app/providers.tsx
"use client";
import { GloveProvider } from "glove-react";
import { gloveClient } from "@/lib/glove";

export function Providers({ children }: { children: React.ReactNode }) {
  return <GloveProvider client={gloveClient}>{children}</GloveProvider>;
}
```

```tsx
// app/page.tsx — using <Render> component
"use client";
import { useGlove, Render } from "glove-react";

export default function Chat() {
  const glove = useGlove();

  return (
    <Render
      glove={glove}
      strategy="interleaved"
      renderMessage={({ entry }) => (
        <div><strong>{entry.kind === "user" ? "You" : "AI"}:</strong> {entry.text}</div>
      )}
      renderStreaming={({ text }) => <div style={{ opacity: 0.7 }}>{text}</div>}
    />
  );
}
```

Or use `useGlove()` directly for full manual control:

```tsx
// app/page.tsx — manual rendering
"use client";
import { useState } from "react";
import { useGlove } from "glove-react";

export default function Chat() {
  const { timeline, streamingText, busy, slots, sendMessage, renderSlot, renderToolResult } = useGlove();
  const [input, setInput] = useState("");

  return (
    <div>
      {timeline.map((entry, i) => (
        <div key={i}>
          {entry.kind === "user" && <p><strong>You:</strong> {entry.text}</p>}
          {entry.kind === "agent_text" && <p><strong>AI:</strong> {entry.text}</p>}
          {entry.kind === "tool" && (
            <>
              <p>Tool: {entry.name} — {entry.status}</p>
              {entry.renderData !== undefined && renderToolResult(entry)}
            </>
          )}
        </div>
      ))}
      {streamingText && <p style={{ opacity: 0.7 }}>{streamingText}</p>}
      {slots.map(renderSlot)}
      <form onSubmit={(e) => { e.preventDefault(); sendMessage(input.trim()); setInput(""); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
```

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
- **MCP-backed agent**: Set `serverMode: true`, call `mountMcp(glove, { adapter, entries })` before `build()`. See [MCP Integration](#mcp-integration-glove-mcp).

### Optional Store Features

- **Tasks** (`getTasks`, `addTasks`, `updateTask`): Auto-registers `glove_update_tasks` tool
- **Permissions** (`getPermission`, `setPermission`): Tools with `requiresPermission: true` check consent
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

## Extensions: Hooks, Skills & Subagents

`processRequest` parses two kinds of inline directive out of the user text and dispatches them before the model is called. Subagents are a third extension surface, but they are NOT parsed from user text — they are routed by the model through a dispatch tool. Builders register handlers via three builder methods (chainable, callable post-`build()` like `fold`):

| Token / mechanism | Purpose | Builder method |
|-------|---------|----------------|
| `/hookname` | Mutate agent state, force compaction, swap model, short-circuit a turn | `defineHook(name, handler)` |
| `/skillname` | Inject context as a synthetic user message marked `is_skill_injection: true` | `defineSkill({ name, handler, description?, exposeToAgent? })` |
| `glove_invoke_subagent({ name, prompt })` (model-side tool) | Register a child Glove the main agent can route a self-contained task to. The user's `@name` text reaches the model verbatim — it's a routing signal, not a parsed directive. Mirrors Claude Code's subagent convention. | `defineSubAgent({ name, factory, description? })` |

`/` tokens only bind when the name matches a registered hook or skill — `/usr/local/bin` survives untouched. Bound `/` tokens are **replaced**, not stripped, with a non-triggerable placeholder of the form `[invoked_extension__hook_<name>]` or `[invoked_extension__skill_<name>]`. The placeholder doesn't re-bind on a future parse, but it keeps the persisted user message structurally honest — the model can see that an extension fired. `@` tokens are never parsed by glove at all, so emails like `a@b.com` reach the model unchanged.

### Quick example

```typescript
import { Glove, MemoryStore } from "glove-core";

const agent = new Glove({ /* ... */ })
  .defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  })
  .defineHook("stop", async () => ({
    shortCircuit: { message: { sender: "agent", text: "Cancelled." } },
  }))
  .defineSkill({
    name: "concise",
    description: "Tighter, snappier responses",
    exposeToAgent: true,
    handler: async ({ source, args }) =>
      `Be terse. (source=${source}, hint=${args ?? "none"})`,
  })
  .defineSubAgent({
    name: "weather",
    description: "Run the weather subagent. Use for weather questions.",
    factory: async ({ parentStore, parentControls, prompt }) => {
      const subStore = await parentStore.createSubAgentStore?.("weather", false)
        ?? new MemoryStore(`weather_${Date.now()}`);
      return new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        systemPrompt: "You are a weather assistant. Answer the prompt and return.",
        compaction_config: { compaction_instructions: "Summarise weather lookups." },
      })
        .fold(weatherTool)
        .build();
    },
  })
  .build();

await agent.processRequest("/concise tell me about Rust");      // user-invoked skill
await agent.processRequest("/compact what's next?");           // hook → forceCompaction
// "@weather" reaches the model verbatim. The agent calls
// glove_invoke_subagent({ name: "weather", prompt: "NYC" }).
await agent.processRequest("@weather NYC");
```

### Hooks

```typescript
type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

interface HookContext {
  name: string;
  rawText: string;
  parsedText: string;        // text with bound tokens replaced by [invoked_extension__<type>_<name>] placeholders
  controls: AgentControls;
  signal?: AbortSignal;
}

interface HookResult {
  rewriteText?: string;      // override parsedText for downstream skills + the user message
  shortCircuit?:
    | { message: Message }
    | { result: ModelPromptResult };
}

interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
  store: StoreAdapter;             // direct access to the agent's StoreAdapter
  displayManager: DisplayManagerAdapter;  // direct access to the agent's display stack
  forceCompaction: () => Promise<void>;
}
```

`forceCompaction` calls `Observer.runCompactionNow()` — same body as `tryCompaction` minus the token-threshold guard. Subscribers still see `compaction_start` / `compaction_end`.

Hooks run in document order. `rewriteText` overrides the working text passed to subsequent hooks, skills, and the final user message. `shortCircuit` persists the user message and returns immediately — the model is not called. Glove emits `hook_invoked` (`{ name }`) on subscribers just before each hook handler runs.

### Skills

```typescript
type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

interface SkillContext {
  name: string;
  parsedText: string;        // when source = "user": user text with bound directives replaced by their placeholders. when source = "agent": same as args ?? "".
  args?: string;             // model-supplied free-form args (only when source = "agent")
  source: "user" | "agent";
  controls: AgentControls;
}

interface SkillOptions {
  description?: string;       // shown to the agent in the invoke-skill tool listing
  exposeToAgent?: boolean;    // default false
}

interface DefineSkillArgs extends SkillOptions {
  name: string;
  handler: SkillHandler;
}

interface RegisteredSkill {
  handler: SkillHandler;
  description?: string;
  exposeToAgent: boolean;
}
```

Skill-injected messages set `is_skill_injection: true` on `Message`, alongside the existing `is_compaction` and `is_compaction_request` flags. Use it in transcript renderers to render injected context differently from real user turns. Glove emits `skill_invoked` (`{ name, source: "user" | "agent", args? }`) on subscribers — for user-side directives, the dispatch fires from `Glove.processRequest`; for agent-side calls, it fires from inside the `glove_invoke_skill` tool.

#### Exposing skills to the agent

Set `exposeToAgent: true` and Glove auto-registers a single `glove_invoke_skill` tool on the executor. Its description lists every exposed skill (`- name — description`) and is rebuilt in place each time a new exposed skill is defined, so post-`build()` registrations are picked up immediately.

```typescript
agent.defineSkill({
  name: "research-mode",
  description: "Switch to long-form research mode with citations",
  exposeToAgent: true,
  handler: async ({ source, args, parsedText }) => {
    if (source === "agent") {
      // Agent invoked via glove_invoke_skill — `args` is the model-supplied string.
      return `Switch into research mode. Focus: ${args ?? "general"}.`;
    }
    // source === "user" — `parsedText` is the user message after directive substitution
    // (e.g. "[invoked_extension__skill_research-mode] tell me about ribosomes").
    return `Switch into research mode. User said: ${parsedText}`;
  },
});

// User: "/research-mode tell me about ribosomes"
//   → source = "user", parsedText = "[invoked_extension__skill_research-mode] tell me about ribosomes"
// Agent: glove_invoke_skill({ name: "research-mode", args: "ribosome assembly" })
//   → source = "agent", args = "ribosome assembly"
```

The tool returns `{ status: "success", data: { skill, content } }` on success and `{ status: "error", message: 'Skill "..." is not available', data: null }` for unknown or unexposed names. When the skill returns `ContentPart[]`, text parts are joined into `data.content` (visible to the model) and the full part list is preserved on `renderData` (visible to client renderers, mirroring the MCP-bridge convention).

| Aspect | User `/skill` | Agent `glove_invoke_skill` |
|--------|--------------|----------------------------|
| Where it lands | Synthetic user message before the real turn (`is_skill_injection: true`) | Tool result on the agent's tool_use |
| `SkillContext.source` | `"user"` | `"agent"` |
| `SkillContext.args` | undefined | free-form string the model supplied |
| Gated by `exposeToAgent` | No — user-invoked always works | Yes — only exposed skills are callable |

### Subagents

Modelled on Claude Code's subagent convention. Defining one auto-registers a `glove_invoke_subagent` tool (constant `SUBAGENT_DISPATCH_TOOL_NAME` exported from core) the main agent calls with `{ name, prompt }`. The user's `@name` text in the original message is **not** parsed by glove — it reaches the model verbatim and acts as a routing signal. The factory builds a fresh child `Glove` for each invocation and the dispatcher runs it.

```typescript
interface SubAgentFactoryContext {
  /** Subagent name as registered with `defineSubAgent`. */
  name: string;
  /** The task prompt the parent agent supplied when calling `glove_invoke_subagent`. */
  prompt: string;
  /** The parent agent's store. Use `createSubAgentStore(name, durable)` to derive a child store. */
  parentStore: StoreAdapter;
  /** Full parent agent controls (context, observer, promptMachine, executor, glove, store, displayManager, forceCompaction). */
  parentControls: AgentControls;
}

type SubAgentFactory = (
  ctx: SubAgentFactoryContext,
) => Promise<IGloveRunnable> | IGloveRunnable;

interface SubAgentOptions {
  /** Short description shown to the agent in the invoke-subagent tool listing. */
  description?: string;
}

interface DefineSubAgentArgs extends SubAgentOptions {
  name: string;
  factory: SubAgentFactory;
}

interface RegisteredSubAgent {
  factory: SubAgentFactory;
  description?: string;
}
```

#### Canonical factory

```typescript
import { Glove, MemoryStore } from "glove-core";

glove.defineSubAgent({
  name: "researcher",
  description: "Deep research subagent",
  factory: async ({ parentStore, parentControls }) => {
    // Sub-store: durable false → fresh per-call; durable true → cached for the namespace.
    const subStore = await parentStore.createSubAgentStore?.("researcher", false)
      ?? new MemoryStore(`researcher_${Date.now()}`);

    return new Glove({
      store: subStore,
      model: parentControls.glove.model,           // inherit the parent's model
      displayManager: parentControls.displayManager, // share the parent's display stack
      systemPrompt: "You are a researcher.",
      compaction_config: { compaction_instructions: "Summarize research progress." },
    })
      .fold(searchTool)
      .fold(fetchTool)
      .build();   // build() can take a store too; passing it here is equivalent to constructor `store`
  },
});
```

The dispatcher attaches the parent's subscribers to the child for the run, calls `child.processRequest(prompt, signal)` (forwarding the parent's abort signal), then detaches them. The child's final agent text is returned as the tool result.

#### Tool result shape

Symmetric with `glove_invoke_skill`:

```typescript
// Tool input
{ name: string, prompt: string }

// Success
{ status: "success", data: { subagent: string, content: string } }

// Unknown name
{ status: "error", message: 'Subagent "..." is not registered. Use one of: ...', data: null }

// Factory threw
{ status: "error", message: 'Subagent "..." factory threw: ...', data: null }

// Child run threw
{ status: "error", message: 'Subagent "..." failed: ...', data: null }
```

#### Bracket events — guaranteed 1:1 symmetry

The `Executor` (not the dispatcher) brackets every `glove_invoke_subagent` call with `subagent_invoked` (`{ name, prompt }`) before the run and `subagent_completed` (`{ name, status: "success" | "error", message? }`) after. The bracket is symmetric even when a parent abort short-circuits the dispatcher's promise chain: the executor's abort handler still fires the close bracket. Events emitted by the child Glove between them belong to that subagent — parent subscribers are attached to the child for the duration of the run.

#### Common patterns

- **Fresh child per call**: factory builds a new `Glove` each invocation, with its own `MemoryStore` (or a non-durable sub-store). Default and recommended.
- **Durable child**: `parentStore.createSubAgentStore("name", true)` returns the same store for the namespace, so the subagent carries message history across invocations. The factory still builds a fresh `Glove`; only the store is reused.
- **Multiple in one message** (`"@reviewer @architect please discuss this design"`): both names reach the model, which can call `glove_invoke_subagent` once per subagent (sequentially or in parallel via separate tool calls — its choice).

### Sub-stores: `createSubAgentStore`

`StoreAdapter` exposes an optional `createSubAgentStore(namespace: string, durable?: boolean): Promise<StoreAdapter>` factory:

- `durable: false` (default) → a fresh, isolated store per call. The subagent starts from zero context every invocation.
- `durable: true` → the same instance is returned for the same namespace, so the subagent retains messages, tasks, tokens, and counters across invocations within the parent's lifetime.

`MemoryStore` from `glove-core` implements both modes. If your store doesn't implement `createSubAgentStore`, fall back to `new MemoryStore(...)` inside the factory — that preserves the "fresh per call" behavior.

### `setDisplayManager` (chainable)

`Glove` (both builder and runnable forms) exposes `setDisplayManager(displayManager)`. Subagent factories typically pass `parentControls.displayManager` into the child's constructor, but they can also opt in mid-flight by calling `child.setDisplayManager(parentControls.displayManager)` after build. Returns `this` for chaining.

### Dispatch order in `processRequest`

1. Parse `/` directives from the raw text (regex `(^|\s)\/([A-Za-z][\w-]*)(?=\s|$)`). Bound tokens are **replaced** with `[invoked_extension__<type>_<name>]` placeholders; unbound tokens stay in place. `@` tokens are not parsed at all.
2. Run hooks in document order. Glove emits `hook_invoked` per hook. Apply any `rewriteText`; honour the first `shortCircuit` and return.
3. Materialise skills (`source: "user"`) — each becomes a synthetic user message persisted via `context.appendMessages` before the real one. Glove emits `skill_invoked` per skill.
4. Build the real user `Message` from the placeholder-substituted text (still contains any `@mention`s untouched) + any non-text `ContentPart`s the caller passed.
5. Hand off to `Agent.ask`. Subagent invocations happen inside the agent loop via `glove_invoke_subagent` tool calls; the executor brackets each one with `subagent_invoked` / `subagent_completed`.

### `is_skill_injection` flag

Skill-materialised user messages set `is_skill_injection: true` on `Message`. Pair it with `is_compaction` for transcript rendering — collapse, mute, or filter injected messages so they're visually distinct from real user turns.

### `pre_modified_text` on Message

When a hook rewrites the user message via `rewriteText`, the original raw text is preserved on `Message.pre_modified_text` so frontends can render what the user actually typed alongside the rewritten version the model received.

### Public API surface

```typescript
import {
  // Builder
  Glove, // .defineHook(), .defineSkill(), .defineSubAgent()
  // Types
  HookHandler, HookContext, HookResult,
  SkillHandler, SkillContext, SkillOptions, DefineSkillArgs, RegisteredSkill,
  SubAgentFactory, SubAgentFactoryContext, SubAgentOptions, DefineSubAgentArgs, RegisteredSubAgent,
  AgentControls,
  // Constants
  SUBAGENT_DISPATCH_TOOL_NAME, // "glove_invoke_subagent"
  // Helpers
  parseTokens, formatSkillMessage,
  createSkillInvokeTool, renderSkillToolDescription,
  createSubAgentInvokeTool, renderSubAgentToolDescription,
} from "glove-core";
```

Available at the main entry and the `glove-core/extensions` subpath.

## MCP Integration (`glove-mcp`)

`glove-mcp` bridges Model Context Protocol servers (Notion, Gmail, Linear, Slack, an internal MCP wrapper around your own APIs, …) into a Glove agent so their tools appear in the model's tool list as ordinary Glove tools. Streamable HTTP transport only in v1.

### When to use it

- You need third-party capabilities a vendor already exposes via MCP — Notion, Gmail, Linear, Slack, Zapier-MCP, etc.
- You have multiple internal services and want a single integration shape across them.
- You want the agent to discover and activate capabilities mid-conversation rather than wiring all tools at startup.

If you control both ends and just need a few first-party tools, hand-rolled `glove.fold(...)` is still simpler. MCP earns its keep when the catalogue is large or the servers are not yours.

### Mental model: catalogue + adapter

Two pieces, deliberately split:

- **`McpCatalogueEntry[]`** — a static list authored at the application level. One entry per MCP server the app supports: `id`, `name`, `description`, `url`, `tags?`, `metadata?`. Identical across users. The `id` doubles as the tool namespace prefix and the activation key.

- **`McpAdapter`** — a per-conversation interface the consumer implements (analogous to `StoreAdapter`). Holds the conversation's active server ids and resolves access tokens.

  ```typescript
  interface McpAdapter {
    identifier: string;                          // for log correlation
    getActive(): Promise<string[]>;              // ids active in this conversation
    activate(id: string): Promise<void>;         // called by the discovery subagent
    deactivate(id: string): Promise<void>;       // for the consumer's UI; v1 limitation: doesn't unload tools
    getAccessToken(id: string): Promise<string>; // SOLE auth seam — return a bearer string
  }
  ```

`getAccessToken` is the only auth seam. The framework wraps the returned string in `Authorization: Bearer ...`. Token acquisition, refresh, and persistence are entirely the consumer's responsibility — env vars, vault, your own OAuth flow, the opt-in `runMcpOAuth` helper, all valid.

### `mountMcp` — the canonical entry point

After `new Glove(...)` and before `glove.build()`:

```typescript
import { mountMcp } from "glove-mcp";

const glove = new Glove({ /* ... */ , serverMode: true });

await mountMcp(glove, {
  adapter,                                  // McpAdapter
  entries,                                  // McpCatalogueEntry[]
  ambiguityPolicy: { type: "auto-pick-best" },  // optional
  subagentModel: undefined,                 // optional — defaults to glove.model
  subagentSystemPrompt: undefined,          // optional — defaults to per-policy prompt
  clientInfo: { name: "My App", version: "1.0.0" },  // optional
});

glove.build();
```

What it does, in order:

1. Reads `adapter.getActive()`, opens an MCP connection per active id (using `getAccessToken`), lists tools, and folds each one onto the main agent via `bridgeMcpTool`. Per-server reload failures are logged and skipped — a transient outage doesn't kill the agent.
2. Registers the `discovermcp` discovery **subagent** via `glove.defineSubAgent(discoverySubAgent({...}))` so the model can ask it to activate more servers mid-conversation. The model invokes it via `glove_invoke_subagent({ name: "discovermcp", prompt: "..." })`.

`mountMcp` returns when reload + subagent registration are complete. Call it before `build()` for the cleanest init order, but `fold()` / `defineSubAgent()` after `build()` work too.

### Bridged tool shape

`bridgeMcpTool(connection, tool, serverMode)` produces a `GloveFoldArgs` with these conventions:

- **Name**: `${entry.id}__${tool.name}` (e.g. `notion__search`). The `__` separator (exported as `MCP_NAMESPACE_SEP`) is regex-safe across all model providers.
- **Schema**: raw JSON Schema from the MCP server, passed via `jsonSchema` (no Zod). The MCP server is the source of truth.
- **`requiresPermission`**: in `serverMode` always `false`; otherwise `true` unless the MCP tool annotates `readOnlyHint: true`.
- **Result**: server `content[]` text is joined into `data` (what the model sees); the full `content[]` is also passed through as `renderData` so React renderers can use it.
- **Auth-expired contract**: any 401-shaped error during `callTool` is mapped to `{ status: "error", message: "auth_expired", data: null }`. Detect this from the conversation log, refresh your token, and the next call picks up the new value via `getAccessToken`.

### Discovery (`discovermcp`) and ambiguity policies

`mountMcp` registers a single subagent the model can route to: **`discovermcp`**. The model invokes it via `glove_invoke_subagent({ name: "discovermcp", prompt: "send an email" })`. The factory builds a child `Glove` (with its own sub-store from `parentStore.createSubAgentStore("discovermcp", false)`, falling back to a private `DiscoveryMemoryStore` when sub-stores aren't supported, inheriting the main agent's model, displayManager, and `serverMode`), and folds these tools onto the child:

- `list_capabilities(query?, tags?)` — substring search the catalogue.
- `activate(id)` — connect, bridge tools onto the *main* agent, persist active state. Tools become available to the main model on its next turn.
- `deactivate(id)` — flip persisted state. v1 limitation: tools stay loaded until session refresh.
- `ask_user(question, options)` — only registered under the `interactive` policy. Renders via the `mcp_picker` renderer on the main displayManager.

The **ambiguity policy** controls what happens when the subagent finds multiple plausible matches:

| Policy | Behavior | When to use |
|--------|----------|-------------|
| `{ type: "interactive" }` | Subagent calls `ask_user` via `pushAndWait`. Requires an `mcp_picker` renderer on your displayManager. | Browser UIs / chat apps with a renderer wired up. Default when `serverMode: false`. |
| `{ type: "auto-pick-best" }` | Subagent always picks the highest-ranked match. No human in the loop. | Headless / server-side / CLI. Default when `serverMode: true`. |
| `{ type: "defer-to-main" }` | Subagent returns the candidate list as text and lets the main agent decide what to activate. | Multi-MCP discovery flows where the main model has more conversation context than the subagent. |

`serverMode: true` on the `Glove` config is the canonical "I am headless" flag — drives both the default ambiguity policy and the default `requiresPermission` on bridged tools (never gate).

### Auth model — bearer-only

The framework only knows about static bearer tokens. `connectMcp` ships an `auth: bearer(token | () => token)` helper; pass either a string or a thunk that resolves a fresh token per connection. `mountMcp` and the discovery `activate` tool both use the thunk form so every connection re-reads `getAccessToken`.

```typescript
import { bearer, connectMcp } from "glove-mcp";

const conn = await connectMcp({
  namespace: "notion",
  url: "https://mcp.notion.com/mcp",
  auth: bearer(() => adapter.getAccessToken("notion")),
  clientInfo: { name: "My App", version: "1.0.0" },
});
```

### `auth_expired` contract

Mid-call, an expired token surfaces as `{ status: "error", message: "auth_expired" }` on the bridged tool result. The framework does **not** refresh tokens. Your app must:

1. Detect `auth_expired` on the conversation log (subscriber `tool_use_result` event, or post-hoc).
2. Refresh / re-auth via whatever mechanism owns the credential.
3. Update your store; the next bridged call pulls a fresh token from `getAccessToken`.

For UI consumers this is usually a "Reconnect Notion" toast. For CLIs, instructing the user to re-run the auth command is normal.

### `glove-mcp/oauth` — opt-in OAuth tooling

If you don't already have an OAuth flow, the `glove-mcp/oauth` subpath ships a small reference implementation built on the MCP authorization spec:

- **`runMcpOAuth(opts)`** — one call, end-to-end flow. Spins up a local listener on `http://localhost:53683/callback` (configurable), drives the SDK through DCR (or skips it via `preRegisteredClient`), opens the user's browser, exchanges the code for tokens, and verifies via `listTools` (or a `callTool` of your choice). Used by the `examples/mcp-cli/*-mcp-auth.ts` scripts.
- **`FsOAuthStore` / `MemoryOAuthStore`** — `OAuthStore` implementations. `FsOAuthStore` writes a single JSON file with mode `0600` and atomic temp+rename. Replace with your DB for production.
- **`McpOAuthProvider`** — lower-level `OAuthClientProvider` for advanced consumers driving `auth()` from the SDK directly.
- **`buildClientMetadata`**, **`MCP_DEFAULT_CLIENT_INFO`**, **`emptyOAuthState`** — small helpers.

Consumers who already have tokens (env vars, internal integrations, vault, an existing OAuth setup) can ignore this subpath entirely — `getAccessToken` returns the bearer, full stop.

See [api-reference.md — `glove-mcp/oauth`](api-reference.md) for full type signatures, and [examples.md — Pattern: MCP OAuth flow](examples.md) for a worked example.

### Production lift-and-shift

The reference `examples/mcp-cli` setup is a single-user Node CLI; production typically wants:

- **Multi-user store** — replace `FsOAuthStore` with a per-user `OAuthStore` backed by your DB. The interface is three methods (`get`, `set`, `delete`).
- **OAuth flow in route handlers** — `GET /oauth/<id>/start` calls `runMcpOAuth` (or the lower-level SDK `auth()` directly), `GET /oauth/<id>/callback` finishes it. Same machinery, different invocation. The local-listener flavour of `runMcpOAuth` is convenient for CLIs but not what you want behind a load balancer.
- **Background refresh** — refresh expired tokens however your stack does it; `getAccessToken` just reads the latest bearer string.
- **Persistent active state** — the `McpAdapter` shown in examples uses an in-memory `Set` for active ids. In production, persist active ids per conversation (alongside messages) so reload after restart actually does something.

The agent code itself doesn't change — `McpAdapter.getAccessToken` is the only seam.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Mount MCP onto an agent | `mountMcp(glove, { adapter, entries, ... })` |
| Implement consumer adapter | `McpAdapter` interface |
| Author catalogue entries | `McpCatalogueEntry` |
| One-off connect (preflight, custom flow) | `connectMcp({ namespace, url, auth })` |
| Bridge a tool by hand | `bridgeMcpTool(connection, tool, serverMode)` |
| Bearer header helper | `bearer(token | () => token)` |
| Discovery subagent factory | `discoverySubAgent({ adapter, entries, ambiguityPolicy })` (returns `DefineSubAgentArgs`; pass to `glove.defineSubAgent(...)`) |
| Tool namespace separator | `MCP_NAMESPACE_SEP` (`"__"`) |
| 401 detection on raw connect | `UnauthorizedError` |
| Run the OAuth flow | `runMcpOAuth(opts)` from `glove-mcp/oauth` |
| Persist OAuth state | `FsOAuthStore`, `MemoryOAuthStore` from `glove-mcp/oauth` |
| Build client metadata | `buildClientMetadata(opts)` from `glove-mcp/oauth` |

## Memory (`glove-memory`)

Schema-first memory layer with four sibling subsystems. Storage-agnostic adapter contracts; reference in-memory adapters ship for dev/test. Status: draft v0.1; companion storage backends (`glove-memory-sqlite`, `glove-memory-postgres`) are not yet released.

### The four subsystems

| Subsystem | Adapter | What it's for |
|-----------|---------|---------------|
| Entity | `EntityMemoryAdapter` | Graph-shaped, schema-first, deterministic identity resolution. Nodes (people, organizations, projects) and typed edges between them. Curator-written, agent-read. |
| Episodic | `EpisodicMemoryAdapter` | Timeline-bound, append-only events. Meetings, decisions, observations. Time is a first-class field; semantic search is opt-in (advertised by `supportsSemanticSearch`). |
| Resources | `ResourceFsAdapter` | POSIX-style virtual filesystem the agent navigates with `ls` / `read` / `grep` / `glob` / `edit`. Holds research notes, transcripts, link collections. Text-only; absolute paths only (no `.` / `..`). |
| Context | `ContextAdapter` | User-configured ambient context, auto-injected into the system prompt every turn. Different shape: not curator-extracted, no reader/curator split — one registration gives the agent both read and write tools. |

### Architectural recommendation: don't dump memory tools on the main Glove

If you're building an agent that needs memory access, **do not attach the entity / episodic / resources tools directly to your main Glove**. Build subagents — one per retrieval task — and register them on the main agent. Each subagent attaches only the adapter slice it needs.

Why:

- **Bounded prompt surface.** Tool descriptions render the schema slice for that role only — token cost scales with role, not with total ontology size.
- **Sharper routing.** `lookup` / `recall` / `find-notes` subagent names are themselves a reasoning surface. Tighter signal than "you have eight memory tools, decide which".
- **Mutation scope is structural.** A subagent attached with `useMemoryReader` *cannot* write; the affordance isn't there.
- **Adapters stay shared.** All subagents read and write to the same underlying graph / timeline / filesystem. Splitting tools does not split the data.

Same advice on the curator side: a parent curator that routes to specialised write-side subagents (entity-linker, episode-recorder, resource-filer) beats a single curator with every write tool attached.

The exception is `useContext`. Context is small (4 tools), user-driven ("remember that…"), and ships with the system-prompt-injection wrapper that has to live on the agent the user actually talks to. **Keep `useContext` on the main agent.**

See [examples.md — Memory: subagent-delegated reader / curator composition / context flow](examples.md) for worked-out patterns.

### Helper families

Each helper folds the relevant tool surface onto a Glove. All return the same `G` for chaining; all operate on either an `IGloveBuilder` or an `IGloveRunnable` (anything that exposes `fold`).

| Helper | Folds | Notes |
|--------|-------|-------|
| `useMemoryReader(glove, adapter)` | `glove_memory_find`, `_get`, `_query` | Read-only entity graph access. |
| `useMemoryCurator(glove, adapter)` | reader tools + `_add_node`, `_update_node`, `_connect`, `_disconnect`, `_merge_nodes` | Full entity write access. |
| `useEpisodicReader(glove, adapter)` | `glove_episodic_find`, `_timeline`, `_search` | `_search` only registered when `adapter.supportsSemanticSearch === true`. |
| `useEpisodicCurator(glove, adapter)` | reader tools + `_record`, `_update`, `_delete` | |
| `useResourcesReader(glove, adapter)` | `glove_resources_ls`, `_read`, `_stat`, `_grep`, `_glob`, `_search`, `_links_for` | `_search` only when `supportsSemanticSearch`. |
| `useResourcesCurator(glove, adapter)` | reader tools + `_write`, `_edit`, `_mkdir`, `_move`, `_remove`, `_set_metadata` | |
| `useContext(glove, adapter)` | `glove_context_get`, `_set`, `_update`, `_unset` | **Also wraps `processRequest`** to call `adapter.render()` and prepend the rendered markdown block to the system prompt every turn. |

### Tool inventory

#### Entity (`useMemoryReader` / `useMemoryCurator`)

| Tool | Purpose |
|------|---------|
| `glove_memory_find` | Find nodes by class + filter, optional fuzzy |
| `glove_memory_get` | Fetch a node by id + one-hop neighbourhood |
| `glove_memory_query` | Full structured query via the query DSL |
| `glove_memory_add_node` | Create or upsert a node by identity keys *(curator)* |
| `glove_memory_update_node` | Patch a node's properties *(curator)* |
| `glove_memory_connect` | Create or update an edge *(curator)* |
| `glove_memory_disconnect` | Remove an edge *(curator)* |
| `glove_memory_merge_nodes` | Fold one node into another *(curator)* |

#### Episodic (`useEpisodicReader` / `useEpisodicCurator`)

| Tool | Purpose |
|------|---------|
| `glove_episodic_search` | Semantic search over episode content *(only when `supportsSemanticSearch`)* |
| `glove_episodic_find` | Structured filter — by kind, participant, time range, properties |
| `glove_episodic_timeline` | Chronological listing for an entity or time window |
| `glove_episodic_record` | Append a new episode *(curator)* |
| `glove_episodic_update` | Patch an existing episode *(curator)* |
| `glove_episodic_delete` | Remove an episode *(curator)* |

#### Resources (`useResourcesReader` / `useResourcesCurator`)

| Tool | Purpose |
|------|---------|
| `glove_resources_ls` | List directory contents |
| `glove_resources_read` | Read a file body, with optional line range |
| `glove_resources_stat` | Get metadata about a single path |
| `glove_resources_grep` | Text/regex search across the tree |
| `glove_resources_glob` | Find paths by name pattern |
| `glove_resources_search` | Semantic search *(only when `supportsSemanticSearch`)* |
| `glove_resources_links_for` | Reverse-lookup: find resources linking to a target |
| `glove_resources_write` | Create or overwrite a file *(curator)* |
| `glove_resources_edit` | Replace a unique substring *(curator)* |
| `glove_resources_mkdir` | Create an empty directory *(curator)* |
| `glove_resources_move` | Rename or relocate *(curator)* |
| `glove_resources_remove` | Delete a file or directory *(curator)* |
| `glove_resources_set_metadata` | Patch metadata without rewriting body *(curator)* |

#### Context (`useContext`)

| Tool | Purpose |
|------|---------|
| `glove_context_get` | Read entries by section or list all |
| `glove_context_set` | Add a new entry |
| `glove_context_update` | Patch an existing entry in place |
| `glove_context_unset` | Remove an entry or wipe an entire section |

### `MemorySchema` — the shared ontology

One schema object is passed to every adapter. Lives in code; the package does not persist it, validate it across deployments, or expose migration primitives — that's the consumer's concern.

```ts
import { MemorySchema } from "glove-memory/core";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],          // multi-set: any matching set folds the write
    searchableProperties: ["name", "email"],      // indexed for fuzzy / contains
  })
  .defineRelationship({
    type: "worksAt",
    from: "Person",
    to: "Organization",
    propertiesSchema: z.object({ since: z.string().optional() }).optional(),
    multi: false,                                  // default — re-connect updates rather than duplicating
  })
  .defineEpisodeKind({
    name: "meeting",
    description: "A scheduled gathering.",
    propertiesSchema: z.object({ duration_min: z.number() }).optional(),
  })
  .defineResourceRoot({
    path: "/research",
    description: "External research artifacts.",
    semanticSearch: true,                          // default true; false skips embedding lifecycle for this root
  });
```

What's safe at runtime:

- Adding a new node class, relationship, or episode kind is always safe.
- Adding an *optional* property is always safe.
- Adding a *required* property won't break reads; new writes that don't supply it fail validation.
- Removing or renaming properties needs a consumer-managed rewrite — the adapter won't notice.
- Changing identity keys may silently collapse or split nodes on subsequent writes.

### Provenance — required, append-only, every write

Every adapter write takes a `Provenance`. It's append-only per node, edge, episode, resource, and context entry. Reader-facing tools filter `provenance` out of results; only direct adapter calls return it.

```ts
interface Provenance {
  source: string;     // "conversation:<id>/turn:<n>", "manual", "import:<kind>:<id>"
  actor: string;      // "curator-run-xyz", "user:don", "system"
  timestamp: string;  // ISO 8601
  note?: string;      // free-form rationale (identity-merge decisions, conflict notes)
}
```

`Link` is the shared cross-reference vocabulary — episodes pointing at people, resources pointing at episodes, context entries pointing at projects.

```ts
interface Link {
  kind: "entity" | "episode" | "resource";
  id: string;             // entity / episode id, or resource path
  relation?: string;      // free-form, e.g. "primary-contact", "source-transcript"
}
```

The package does **not** validate that link targets exist — adapters stay decoupled. Cross-validation is the curator / orchestrator's job.

### Embedding lifecycle — out-of-band, BYO adapter

Episodic and resources use the same lifecycle. Writes mark records `embeddingStatus: "missing"` (initial) or `"stale"` (content change) and return immediately. A separate process — typically a [Station](https://station.dterminal.net) signal — does the embed pass:

```ts
interface EmbeddingAdapter {
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

The refresh loop:

```ts
const pending = await episodic.findEpisodesNeedingEmbedding({ limit: 50 });
const vectors = await embedder.embed(pending.map((p) => p.content));
for (let i = 0; i < pending.length; i++) {
  await episodic.setEmbedding(pending[i].id, vectors[i]);
}
```

Resources use `findFilesNeedingEmbedding` / `setEmbedding` (both optional on `ResourceFsAdapter`, present only when `supportsSemanticSearch === true`). Stale marking on episodes is **content-only** in the in-memory adapter — `kind` / `participants` / `properties` / `occurredAt` patches don't re-embed; consumers wanting different behaviour can delete + re-record. The recency blend in `searchEpisodes` defaults to `recencyWeight = 0.2` with a 30-day half-life.

### Reconciliation primitives

The package's contract is deliberately narrow: store, query, write, search. It does **not** cascade across adapters. When an entity is merged or deleted, episodes that reference its old ID don't auto-update. Orchestrators reach for these primitives:

| Action | Primitive |
|--------|-----------|
| Entity merged | `episodic.replaceParticipantId(oldId, newId, prov)`, `resources.replaceLinkTarget("entity", oldId, newId, prov)` |
| Entity deleted | `episodic.findEpisodes({ where: { participantIds: [id] } })`, `resources.linksFor("entity", id)` then orchestrator decides |
| Resource moved | `resources.replaceLinkTarget("resource", fromPath, toPath, prov)` |
| Episode deleted | `resources.linksFor("episode", id)` then orchestrator decides |
| Stale embeddings | `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding` → `embed` → `setEmbedding` |

### Reference in-memory adapters

For dev / tests / quick prototypes. All exported from `glove-memory/in-memory` (and re-exported from the barrel).

```ts
import {
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
} from "glove-memory";

const entity = new InMemoryEntityAdapter({ schema });
const episodic = new InMemoryEpisodicAdapter({ schema, embedder });   // omit embedder → supportsSemanticSearch = false
const resources = new InMemoryResourcesAdapter({ schema, embedder }); // ditto
const context = new InMemoryContextAdapter({ schema });
```

Process-local — they lose data on restart. Production projects swap in a companion package or BYO adapter.

### Out of scope

- Triggering, scheduling, or pipeline orchestration ([Station](https://station.dterminal.net)'s territory).
- Curation logic itself (configured by the consumer).
- Embedding *generation* — consumers plug in their own `EmbeddingAdapter`.
- Schema persistence or migration — schema lives in code only.
- Cross-adapter cascade on entity merge, episode delete, or resource rename — that's reconciliation, an orchestrator responsibility.
- The user-side write path for context — the adapter exposes `set` / `update` / `unset`; the UI / API / form / wherever users edit their preferences calls those directly.
- Binary resources. Resources is text-only.
- `.` and `..` path resolution. All resource paths are absolute.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Define the ontology | `MemorySchema` from `glove-memory/core` |
| Required write metadata | `Provenance` from `glove-memory/core` |
| Cross-reference between subsystems | `Link` from `glove-memory/core` |
| Embedding contract | `EmbeddingAdapter` from `glove-memory/core` |
| Entity contract | `EntityMemoryAdapter` from `glove-memory/entity` |
| Episodic contract | `EpisodicMemoryAdapter` from `glove-memory/episodic` |
| Resources contract | `ResourceFsAdapter` from `glove-memory/resources` |
| Context contract | `ContextAdapter` from `glove-memory/context` |
| Reader / curator helpers | `useMemoryReader` / `useMemoryCurator`, `useEpisodicReader` / `useEpisodicCurator`, `useResourcesReader` / `useResourcesCurator`, `useContext` from `glove-memory/tools` |
| Reference in-process adapters | `InMemoryEntityAdapter`, `InMemoryEpisodicAdapter`, `InMemoryResourcesAdapter`, `InMemoryContextAdapter` from `glove-memory/in-memory` |
| Error classes | `MemoryError`, `MemoryNotFoundError`, `MemorySchemaError`, `MemoryQueryError`, `MemoryWriteError`, `EpisodicMemoryError`, `ResourceFsError`, `ContextError` from `glove-memory/core` |

See [api-reference.md — `glove-memory`](api-reference.md) for full type signatures, and [examples.md — Memory](examples.md) for worked examples (schema definition, subagent-delegated reader, curator composition, context flow).

## Glovebox — Sandboxed Runtime

Glovebox packages a built Glove agent as an isolated, network-addressable service. Developer writes a Glove agent normally, calls `glovebox.wrap(runnable, config)`, runs `glovebox build`, and gets a deployable artifact (Dockerfile + nixpacks.toml + esbuild server bundle + manifest + auth key). The deployed server exposes one authenticated WebSocket endpoint per session, with prompts multiplexed by `id` over that single socket.

### When to use it

- You have a Glove agent that needs system tools the host process can't safely (or portably) provide — ffmpeg, pandoc, headless Chromium, ImageMagick, qpdf, libreoffice — and you want them sandboxed inside a container instead of installed on every deployment target.
- You want a network-callable surface around a Glove agent that consumers can hit from React frontends, Node services, or other agents without re-implementing the agent loop.
- You need stable input/output contracts: clients send a prompt + files, get back a final message + output files, and don't care which adapters or tools fired in between.

If you only need a chat endpoint, `glove-next`'s `createChatHandler` is still simpler. Glovebox earns its keep when the agent's environment matters (system binaries, isolated FS) or when several clients share one specialized agent.

### The three packages

- **`glovebox`** — authoring + `glovebox build` CLI. Public API in `packages/glovebox/src/index.ts` (`glovebox.wrap`, re-exports of `config`, `protocol`, `storage`). Storage DSL (`rule.inline`, `rule.url`, `rule.localServer`, `rule.s3`, `composite`). Wire protocol types (`FileRef`, `ClientMessage`, `ServerMessage`, `Manifest`, `StoragePolicyEncoded`).
- **`glovebox-kit`** — in-container runtime. `startGlovebox(opts)` from `packages/glovebox-kit/src/server.ts`. Auto-injects two skills (`environment`, `workspace`), two hooks (`/output`, `/clear-workspace`), and prepends a static env block (built by `buildEnvironmentBlock`) to the agent's existing system prompt at boot. Hosts `/health` (public), `/environment` (Bearer-auth'd), `/files/:id` (Bearer-auth'd) HTTP routes alongside the WS upgrade endpoint.
- **`glovebox-client`** — client SDK. `GloveboxClient.make({ endpoints })` registers named endpoints; `client.box(name)` returns a lazily-constructed `Box`. `box.prompt(text, { files })` returns a `PromptResult` with async-iterable `events` / `display` plus `message` / `outputs` promises and a `read(name)` helper.

### Base images

Five prebuilt bases live under `docker/`, published to `ghcr.io/porkytheblack/glovebox/<name>:<tag>` (override the registry with the `GLOVEBOX_REGISTRY` env var). Tags are pinned in `packages/glovebox/src/build/dockerfile.ts`'s `KNOWN_BASE_TAGS`:

| Base | Tag | What's in it |
|------|-----|--------------|
| `glovebox/base` | `1.0` | Node 20, `glovebox` user (uid 10001), /work + /input + /output + prebuilt better-sqlite3 at `/opt/glovebox-prebuilt/node_modules` |
| `glovebox/media` | `1.4` | base + ffmpeg, imagemagick, sox, yt-dlp |
| `glovebox/docs` | `1.2` | base + pandoc, qpdf, pdftk-java, ghostscript, libreoffice headless |
| `glovebox/python` | `1.3` | base + uv, numpy, pandas, pillow, scipy, matplotlib |
| `glovebox/browser` | `1.1` | base + Playwright with Chromium |

Standard bases skip the user/layout setup in the generated Dockerfile and `ln -sfn` the prebuilt better-sqlite3 into the server bundle's `node_modules`. Custom bases run a normal `npm install --omit=dev` against the emitted `package.json`.

### Authoring: `glovebox.wrap`

Build the Glove agent like always, then export a `GloveboxApp` as the default export:

```typescript
// glovebox.ts
import { glovebox, rule, composite } from "glovebox-core"
import { agent } from "./my-agent"   // your built IGloveRunnable

export default glovebox.wrap(agent, {
  name: "pdf-extractor",
  base: "glovebox/docs",
  packages: { apt: ["poppler-utils"] },
  storage: {
    inputs: composite([rule.url(), rule.inline()]),
    outputs: composite([
      rule.inline({ below: "1MB" }),
      rule.localServer({ ttl: "1h" }),
    ]),
  },
  env: {
    ANTHROPIC_API_KEY: { required: true, secret: true },
  },
  limits: { memory: "2GB", timeout: "10m" },
})
```

Defaults (from `packages/glovebox/src/config.ts`):
- `base`: `"glovebox/base"`.
- `fs`: `{ work: "/work" (rw), input: "/input" (ro), output: "/output" (rw) }` — `DEFAULT_FS`.
- `storage.inputs`: `DEFAULT_INPUTS_POLICY` — try `url` always, fall back to `inline`.
- `storage.outputs`: `DEFAULT_OUTPUTS_POLICY` — `inline` below 1MB, else `localServer` with 1h TTL.

Storage rule order matters: `composite([...])` keeps caller order, and `pickAdapter` walks rules first-match-wins. `always: true` is terminal-anywhere; `default: true` is the fallback used when no other rule matched. `validateOutputsPolicy` rejects an outputs policy that targets the read-only `url` adapter or omits a terminal rule — the container fails fast on boot.

### Build: `glovebox build`

```bash
pnpm add -D glovebox
npx glovebox build ./glovebox.ts --out ./dist --name pdf-extractor
```

Emits, under `dist/`:

```
Dockerfile           # FROM <resolved base>, optional apt/pip/npm, COPY server, CMD ["node", "index.js"]
nixpacks.toml        # Same recipe for Railway / Render / nixpacks-aware platforms
glovebox.json        # The Manifest (name, version, base, fs, env, limits, key_fingerprint, storage_policy, packages, protocol_version: 1)
glovebox.key         # 32-byte hex random — the bearer token. KEEP SECRET. Re-runs reuse if present.
.env.example         # Generated from `env` config — required vars first
server/
├── index.js         # esbuild ESM bundle: glovebox-kit + glovebox + glove-core + your wrap module
├── package.json     # only declares "better-sqlite3" — the one native dep
└── glovebox.json    # Manifest copy (the runtime resolves it via `new URL("./glovebox.json", import.meta.url)`)
```

The synthetic ESM entry the build emits reads `GLOVEBOX_KEY` (required), `GLOVEBOX_PORT` (default 8080), and `GLOVEBOX_PUBLIC_URL` (optional) from the environment, picks up the wrap module's default export, and calls `startGlovebox(...)`. `better-sqlite3` is the only `external:` in the esbuild call (`NATIVE_EXTERNALS` in `server-bundle.ts`).

### Runtime injection

Inside the container, `startGlovebox` runs `applyInjections(runnable, config, getExfilState)` once at boot (see `packages/glovebox-kit/src/injection.ts`). This adds:

- **`environment` skill** — agent-callable; returns the resolved config (`name`, `version`, `base`, `fs`, `packages`, `limits`) as JSON. Useful for the agent itself to introspect.
- **`workspace` skill** — agent-callable; lists the live contents of every fs mount (`work`, `input`, `output`).
- **`/output` hook** — `parseTokens` directives: when the agent writes `/output /tmp/some/extra/file.png`, the absolute path is added to a per-request `extraOutputs: Set<string>`. After the turn completes, anything in that set gets uploaded alongside whatever the agent wrote to `/output`.
- **`/clear-workspace` hook** — `rm -rf` on the `/work` mount. No-op if `work` isn't configured.

`buildEnvironmentBlock(config)` is also prepended to the existing system prompt once at boot, so the agent learns about `/work`, `/input`, `/output`, available apt packages, and limits without you wiring it manually. Per-request input listings are NOT in the env block — the agent calls the `workspace` skill to read `/input` on demand.

### Wire protocol shape

One WebSocket per session, authenticated on upgrade with `Authorization: Bearer <key>`. Prompts multiplexed by `id`. **In v1 the server serializes prompts within a session** (`promptChain.then(...)` in `server.ts`) — Glove's `PromptMachine` + `Context` aren't safe to call concurrently. The protocol is multiplex-shaped because v2 will lift this restriction.

Message types live in `packages/glovebox/src/protocol.ts`:
- Client → server: `prompt`, `abort`, `display_resolve`, `display_reject`, `ping`.
- Server → client: `event` (mirrors `SubscriberEvent` 1:1), `display_push` / `display_clear` (Glove's display stack bridged onto the wire by `attachDisplayBridge`), `complete` (final assistant message + outputs map), `error`, `pong`.

`FileRef` is the wire shape for files crossing the boundary in either direction:

```typescript
type FileRef =
  | { kind: "inline"; name; mime; data }              // base64
  | { kind: "url"; name; mime?; url; headers? }
  | { kind: "server"; name; mime; size; id; url }     // /files/:id on the same server
  | { kind: "s3"; name; mime?; bucket; key; region? }
  | { kind: "gcs"; name; mime?; bucket; object }      // v2-deferred adapter
```

The server picks the adapter for each output via `pickAdapter(policy, { size }, registry)`. Inputs are read by `pickAdapterForRef(ref, registry)` based on the ref's `kind` — server defaults always include `inline`, `url`, and `localServer`; `s3` only resolves if you registered an adapter via `adapters` (see below).

### Auth model

Bearer-only, single key per deployment. The build CLI writes a 32-byte hex key to `dist/glovebox.key` and stores its SHA-256 fingerprint in the manifest. At boot, `verifyAgainstManifest` checks both the configured `GLOVEBOX_KEY` matches the manifest fingerprint AND the presented bearer matches the configured key — `verifyBearer` does the constant-time compare via `timingSafeEqual`. Fingerprints in the manifest leak nothing; verification still requires the raw key.

The same key gates the WS upgrade, `/environment`, and `/files/:id`. JWTs and per-session tokens are V2-deferred.

### Custom storage adapters via `adapters` export

The wrap module may export an `adapters` function (or value) alongside its default export. The synthetic build entry awaits it and forwards the result into `startGlovebox({ adapters })`. Adapters are merged by name into the registry on top of the defaults, so `s3` becomes a real adapter the policy can target:

```typescript
// glovebox.ts
import { glovebox, rule, composite } from "glovebox-core"
import { S3Storage } from "glovebox-kit"
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { agent } from "./my-agent"

const s3 = new S3Client({ region: process.env.AWS_REGION })

export const adapters = () => ({
  s3: new S3Storage({
    bucket: process.env.OUTPUTS_BUCKET!,
    region: process.env.AWS_REGION,
    uploadObject: async ({ bucket, key, body, contentType }) => {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
    },
    downloadObject: async ({ bucket, key }) => {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return new Uint8Array(await out.Body!.transformToByteArray())
    },
  }),
})

export default glovebox.wrap(agent, {
  base: "glovebox/media",
  storage: {
    outputs: composite([
      rule.inline({ below: "1MB" }),
      rule.s3({ bucket: process.env.OUTPUTS_BUCKET! }),
    ]),
  },
})
```

The kit ships `S3Storage` as a "deferred" adapter — no concrete SDK dependency in the runtime image. You pass `uploadObject` / `downloadObject` thunks from your own codebase. The kit will throw on boot if the outputs policy targets `s3` and no adapter is registered (`validateOutputsPolicy` is run on every effective policy, including per-request overrides).

### Deploying

The artifact is platform-agnostic. Two common paths:

- **Docker** — `docker build -t my-app dist/` then run with `-p 8080:8080 -e GLOVEBOX_KEY=$(cat dist/glovebox.key) -e GLOVEBOX_PUBLIC_URL=https://my-app.example.com my-app`. Set any required env vars from `.env.example`.
- **Railway / Render / nixpacks** — push `dist/` to a repo; the platform picks up `nixpacks.toml`. Set `GLOVEBOX_KEY` and any required env vars in the platform UI; `GLOVEBOX_PUBLIC_URL` should be the deployment's public URL so `server`-kind FileRefs are reachable from clients.

`GLOVEBOX_PORT` defaults to 8080; the Dockerfile `EXPOSE`s and `ENV`s it. `GLOVEBOX_PUBLIC_URL` defaults to `http://localhost:<port>` — fine for local, broken for any client outside the container.

### Calling from the client

```typescript
import { GloveboxClient } from "glovebox-client"

const client = GloveboxClient.make({
  endpoints: {
    pdf: { url: "wss://pdf.example.com/", key: process.env.GLOVEBOX_PDF_KEY! },
  },
})

const box = client.box("pdf")
const env = await box.environment()        // Bearer-auth'd GET /environment, cached after first call
console.log(env.base, env.packages.apt)

const result = box.prompt("extract tables from invoice.pdf", {
  files: { "invoice.pdf": { mime: "application/pdf", bytes: pdfBytes } },
})

for await (const event of result.events) {
  if (event.event_type === "text_delta") {
    process.stdout.write((event.data as { text: string }).text)
  }
}

const message = await result.message
const outputs = await result.outputs       // Record<string, FileRef>
const csvBytes = await result.read("tables.csv")  // routes via ClientStorage based on FileRef.kind
```

`PromptResult` exposes both `events` and `display` as async iterables. Display events are session-scoped (not request-scoped) so they fan out to every active prompt's display stream. `result.resolve(slot_id, value)` / `result.reject(slot_id, error)` send display answers back; `result.abort()` sends `{ type: "abort", id }` upstream.

`DefaultClientStorage` only handles `inline` and `url` (plus `server` over Bearer-auth'd HTTP) — pass a custom `ClientStorage` to `GloveboxClient.make({ storage })` if your inputs need to land in S3 first.

### Debugging

- **`GET /health`** is unauthenticated and returns `{ ok: true, name, version }`. Useful for liveness probes.
- **`GET /environment`** with `Authorization: Bearer <key>` returns the manifest's `name`, `version`, `base`, `fs`, `packages`, `limits`, `protocol_version`. The client SDK caches this after first call. If `box.environment()` 401s, the key is wrong; if it returns a `base` you didn't expect, the deployment is built from a stale manifest.
- **Manifest fingerprint mismatch** — boot fails with `Configured GLOVEBOX_KEY does not match the manifest fingerprint`. Either the key was rotated without rebuilding, or you're pointing at the wrong key file.
- **`Outputs policy references unregistered adapter: s3`** — `validateOutputsPolicy` rejected the policy because the wrap module's `adapters` export didn't supply an `s3` entry. Either add the adapter or remove the `rule.s3(...)` from outputs.
- **Empty completion message** — `processRequest` returned a result whose final message had no `text`. Check the agent's normal completion path — the kit only reads `result.messages[last].text` (or `result.text`) verbatim.
- **Stuck prompts** — v1 serializes prompts per session via `promptChain.then(...)`. If a prompt hangs (e.g. waiting on a `pushAndWait` resolver), every subsequent prompt on the same session waits with it. Ensure the client either sends `display_resolve` or closes the WS to clear the chain.

### V2-deferred caveats

The v1 kit and protocol are deliberately narrow. Plan around these limitations:

- **Multiplex execution** — wire is multiplex-shaped, server is not. Don't pipeline more than one prompt per session expecting parallelism.
- **JWT auth** — single shared bearer key per deployment. Per-user JWTs / scoped tokens are deferred.
- **Hot reload** — none. Rebuild + redeploy after every wrap-config change.
- **GCS / Azure adapters** — only `inline`, `url`, `localServer`, and (via your `adapters` export) `s3` are supported. `gcs` exists in `FileRef` but throws at runtime without a registered adapter.
- **Per-base preregistered subagents** — the `@transcoder` (media), `@pdfwright` (docs), `@analyst` (python), `@scraper` (browser) mentions land in v2; in v1 you wire those yourself if you want them.

See [api-reference.md — glovebox / glovebox-kit / glovebox-client](api-reference.md) for full type signatures, and [examples.md — Pattern: Glovebox PDF Extractor](examples.md) for a worked example.

## Display Stack Patterns

### pushAndForget — Show results (non-blocking)

```tsx
async do(input, display) {
  const data = await fetchData(input);
  await display.pushAndForget({ input: data }); // Shows UI, tool continues
  return { status: "success", data: "Displayed results", renderData: data };
},
render({ data }) {
  return <Card>{data.title}</Card>;
},
renderResult({ data }) {
  return <Card>{(data as any).title}</Card>;  // Same card from history
},
```

### pushAndWait — Collect user input (blocking)

```tsx
async do(input, display) {
  const confirmed = await display.pushAndWait({ input }); // Pauses until user responds
  return {
    status: "success",
    data: confirmed ? "Confirmed" : "Cancelled",
    renderData: { confirmed },
  };
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
renderResult({ data }) {
  const { confirmed } = data as { confirmed: boolean };
  return <div>{confirmed ? "Confirmed" : "Cancelled"}</div>;
},
```

### Display Strategies

| Strategy | Behavior | Use for |
|----------|----------|---------|
| `"stay"` (default) | Slot always visible | Info cards, results |
| `"hide-on-complete"` | Hidden when slot is resolved | Forms, confirmations, pickers |
| `"hide-on-new"` | Hidden when newer slot from same tool appears | Cart summaries, status panels |

### SlotRenderProps

| Prop | Type | Description |
|------|------|-------------|
| `data` | `T` | Input passed to pushAndWait/pushAndForget |
| `resolve` | `(value: unknown) => void` | Resolves the slot. For pushAndWait, the value returns to `do`. For pushAndForget, use `resolve()` or `removeSlot(id)` to dismiss. |
| `reject` | `(reason?: string) => void` | Rejects the slot. For pushAndWait, this causes the promise to reject. Use for cancellation flows. |

## Tool Definition

### `defineTool` (recommended for tools with UI)

```typescript
import { defineTool } from "glove-react";

const tool = defineTool({
  name: string,
  description: string,
  inputSchema: z.ZodType,              // Zod schema for tool input
  displayPropsSchema?: z.ZodType,      // Zod schema for display props (recommended for tools with UI)
  resolveSchema?: z.ZodType,           // Zod schema for resolve value (omit for pushAndForget-only)
  displayStrategy?: SlotDisplayStrategy,
  requiresPermission?: boolean,
  unAbortable?: boolean,                 // Tool runs to completion even if abort signal fires (e.g. voice barge-in)
  do(input, display): Promise<ToolResultData>,  // display is TypedDisplay<D, R>
  render?({ props, resolve, reject }): ReactNode,
  renderResult?({ data, output, status }): ReactNode,
});
```

**Key points:**
- `do()` should return `{ status, data, renderData }` — `data` goes to model, `renderData` stays client-only
- `render()` gets typed `props` (matching displayPropsSchema) and typed `resolve` (matching resolveSchema)
- `renderResult()` receives `renderData` for showing read-only views from history
- `displayPropsSchema` is optional but recommended — tools without display should use raw `ToolConfig`

### `ToolConfig` (for tools without UI or manual control)

```typescript
interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema?: z.ZodType<I>;          // Optional now — tools may use jsonSchema instead
  jsonSchema?: Record<string, unknown>; // Raw JSON Schema alternative (used by MCP-bridged tools)
  do: (input: I, display: ToolDisplay) => Promise<ToolResultData>;
  render?: (props: SlotRenderProps) => ReactNode;
  renderResult?: (props: ToolResultRenderProps) => ReactNode;
  displayStrategy?: SlotDisplayStrategy;
  requiresPermission?: boolean;
  unAbortable?: boolean;
}
```

**`jsonSchema` vs `inputSchema`:** Pass exactly one. `inputSchema` (Zod) gets local validation before `do()` runs. `jsonSchema` (raw JSON Schema) is forwarded verbatim to the model and the executor skips Zod validation — the source of truth lives elsewhere. Used by `bridgeMcpTool` where the MCP server defines the schema, but you can use it directly when wrapping any external tool catalogue.

### `glove.fold` after `build()`

`fold()` is legal at any time on an `IGloveRunnable`, including after `build()`. The discovery subagent's `activate` tool relies on this — it folds in newly bridged MCP tools mid-conversation so they're available on the next turn. Useful for any "register tools dynamically" pattern.

```typescript
const agent = new Glove({...}).build();
// ...later, mid-conversation:
agent.fold({ name: "new_tool", description: "...", inputSchema: z.object({}), async do() { ... } });
```

### `do(input, display, glove, signal?)` — third and fourth arguments

A tool's `do` function receives the running `IGloveRunnable` as a third argument and the active request's `AbortSignal` as an optional fourth. The `glove` argument is how the `discovermcp` subagent's `activate` tool reaches back to fold bridged MCP tools onto the main agent and inherit its model/displayManager. The `signal` argument should be forwarded into long-running internal work (nested agent runs, fetches) so abort propagates; tools that ignore it still get the executor's abortable-promise unwind for free, and tools marked `unAbortable: true` should ignore `signal` entirely. Most tools ignore both.

### ToolResultData

```typescript
interface ToolResultData {
  status: "success" | "error";
  data: unknown;          // Sent to the AI model
  message?: string;       // Error message (for status: "error")
  renderData?: unknown;   // Client-only — NOT sent to model, used by renderResult
}
```

**Important:** Model adapters explicitly strip `renderData` before sending to the AI. This makes it safe to store sensitive client-only data (e.g., email addresses, UI state) in `renderData`.

## `<Render>` Component

Headless render component that replaces manual timeline rendering:

```tsx
import { Render } from "glove-react";

<Render
  glove={gloveHandle}           // return value of useGlove()
  strategy="interleaved"        // "interleaved" | "slots-before" | "slots-after" | "slots-only"
  renderMessage={({ entry, index, isLast }) => ...}
  renderToolStatus={({ entry, index, hasSlot }) => ...}
  renderStreaming={({ text }) => ...}
  renderInput={({ send, busy, abort }) => ...}
  renderSlotContainer={({ slots, renderSlot }) => ...}
  as="div"                      // wrapper element
  className="chat"
/>
```

**Features:**
- Automatic slot visibility based on `displayStrategy`
- Automatic `renderResult` rendering for completed tools with `renderData`
- Interleaving: slots appear inline next to their tool call
- Sensible defaults for all render props

## `GloveHandle` Interface

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

## useGlove Hook Return

| Property | Type | Description |
|----------|------|-------------|
| `timeline` | `TimelineEntry[]` | Messages + tool calls |
| `streamingText` | `string` | Current streaming buffer |
| `busy` | `boolean` | Agent is processing |
| `sessionReady` | `boolean` | `false` while async `getSessionId` resolves; always `true` if not configured |
| `sessionId` | `string` | The resolved session ID |
| `isCompacting` | `boolean` | Context compaction in progress (driven by `compaction_start`/`compaction_end` events) |
| `slots` | `EnhancedSlot[]` | Active display stack with metadata |
| `tasks` | `Task[]` | Agent task list |
| `inbox` | `InboxItem[]` | Inbox items (pending, resolved, consumed) |
| `stats` | `GloveStats` | `{ turns, tokens_in, tokens_out }` |
| `sendMessage(text, images?)` | `void` | Send user message |
| `abort()` | `void` | Cancel current request |
| `renderSlot(slot)` | `ReactNode` | Render a display slot |
| `renderToolResult(entry)` | `ReactNode` | Render a tool result from history |
| `resolveSlot(id, value)` | `void` | Resolve a pushAndWait slot |
| `rejectSlot(id, reason?)` | `void` | Reject a pushAndWait slot |

## TimelineEntry

```typescript
type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "success" | "error"; output?: string; renderData?: unknown };

type ToolEntry = Extract<TimelineEntry, { kind: "tool" }>;
```

## Supported Providers

| Provider | Env Variable | Default Model | SDK Format |
|----------|-------------|---------------|------------|
| `openai` | `OPENAI_API_KEY` | `gpt-4.1` | openai |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | anthropic |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` | openai |
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

Available at https://glove.dterminal.net/tools — copy-paste into your project:

- `confirm_action` — Yes/No confirmation dialog
- `collect_form` — Multi-field form
- `ask_preference` — Single-select preference picker
- `text_input` — Free-text input
- `show_info_card` — Info/success/warning card (pushAndForget)
- `suggest_options` — Multiple-choice suggestions
- `approve_plan` — Step-by-step plan approval

## Voice Integration (`glove-voice`)

### Package Overview

| Package | Purpose | Install |
|---------|---------|---------|
| `glove-voice` | Voice pipeline: `GloveVoice`, adapters (STT/TTS/VAD), `AudioCapture`, `AudioPlayer` | `pnpm add glove-voice` |
| `glove-react/voice` | React hooks: `useGloveVoice`, `useGlovePTT`, `VoicePTTButton` | Included in `glove-react` |
| `glove-next` | Token handlers: `createVoiceTokenHandler` (already in `glove-next`, no separate import) | Included in `glove-next` |

### Architecture

```
Mic → VAD → STTAdapter → glove.processRequest() → TTSAdapter → Speaker
```

`GloveVoice` wraps a Glove instance with a full-duplex voice pipeline. Glove remains the intelligence layer — all tools, display stack, and context management work normally. STT and TTS are swappable adapters. Text tokens stream through a `SentenceBuffer` into TTS in real-time.

### Quick Start (Next.js + ElevenLabs)

**Step 1: Token routes** — server-side handlers that exchange your API key for short-lived tokens

```typescript
// app/api/voice/stt-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
```

```typescript
// app/api/voice/tts-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });
```

Set `ELEVENLABS_API_KEY` in `.env.local`.

**Step 2: Client voice config**

```typescript
// app/lib/voice.ts
import { createElevenLabsAdapters } from "glove-voice";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = await res.json();
  return data.token;
}

export const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("/api/voice/stt-token"),
  getTTSToken: () => fetchToken("/api/voice/tts-token"),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});
```

**Step 3: SileroVAD** — dynamic import for SSR safety

```typescript
export async function createSileroVAD() {
  const { SileroVADAdapter } = await import("glove-voice/silero-vad");
  const vad = new SileroVADAdapter({
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    wasm: { type: "cdn" },
  });
  await vad.init();
  return vad;
}
```

**Step 4: React hook**

```tsx
const { runnable } = useGlove({ tools, sessionId });
const voice = useGloveVoice({ runnable, voice: { stt, createTTS, vad } });
// voice.mode, voice.isActive, voice.isMuted, voice.error, voice.transcript
// voice.start(), voice.stop(), voice.interrupt(), voice.commitTurn()
// voice.mute(), voice.unmute()              — gate mic audio to STT/VAD
// voice.narrate("text")                     — speak text via TTS without model (returns Promise)
```

### `startMuted` Config Option

In manual (push-to-talk) mode, the pipeline now starts muted by default — no need to call `mute()` immediately after `start()`. This eliminates the race condition where audio leaks in the gap.

```typescript
// Manual mode auto-mutes — just works
await voice.start(); // already muted in manual mode

// Explicit override
const voice = useGloveVoice({
  runnable,
  voice: { stt, createTTS, turnMode: "manual", startMuted: false }, // opt out
});
```

### `enabled` State on `useGloveVoice`

The hook now exposes `voice.enabled` — tracks user intent (true after `start()`, false after `stop()` or pipeline death). Replaces the manual `useState` + sync `useEffect` pattern:

```tsx
// Before — consumer tracks + syncs
const [voiceEnabled, setVoiceEnabled] = useState(false);
useEffect(() => {
  if (voiceEnabled && !voice.isActive) setVoiceEnabled(false);
}, [voiceEnabled, voice.isActive]);

// After — hook tracks it
voice.enabled  // auto-resets on pipeline death
```

### `useGlovePTT` Hook (Push-to-Talk)

High-level hook that encapsulates the entire PTT lifecycle. Reduces ~80 lines of boilerplate to ~5 lines:

```tsx
import { useGlovePTT } from "glove-react/voice";

const glove = useGlove({ endpoint: "/api/chat", tools });
const ptt = useGlovePTT({
  runnable: glove.runnable,
  voice: { stt, createTTS },    // turnMode forced to "manual"
  hotkey: "Space",               // default, auto-guards INPUT/TEXTAREA
  holdThreshold: 300,            // click-vs-hold discrimination (ms)
  minRecordingMs: 350,           // min audio before committing
});

// ptt.enabled      — is the pipeline active
// ptt.recording    — is the user currently holding
// ptt.processing   — is STT finalizing
// ptt.mode         — voice mode (idle/listening/thinking/speaking)
// ptt.transcript   — partial transcript while recording
// ptt.error        — last error
// ptt.toggle()     — enable/disable the pipeline
// ptt.interrupt()  — barge-in
// ptt.bind         — { onPointerDown, onPointerUp, onPointerLeave }

<button {...ptt.bind}><MicIcon /></button>
```

### `<VoicePTTButton>` Component

Headless (unstyled) component with render prop for the mic button:

```tsx
import { VoicePTTButton } from "glove-react/voice";

<VoicePTTButton ptt={ptt}>
  {({ enabled, recording, mode }) => (
    <button className={recording ? "active" : ""}>
      <MicIcon />
      {enabled && <StatusDot />}
    </button>
  )}
</VoicePTTButton>
```

Includes click-vs-hold discrimination, pointer leave safety, and aria attributes.

### `<Render>` Voice Support

`<Render>` accepts an optional `voice` prop to auto-render transcript and voice status:

```tsx
<Render
  glove={glove}
  voice={ptt}                    // or useGloveVoice() return
  renderTranscript={...}         // optional custom renderer
  renderVoiceStatus={...}        // optional custom renderer
  renderInput={() => null}
/>
```

### Turn Modes

| Mode | Behavior | Use for |
|------|----------|---------|
| `"vad"` (default) | Auto speech detection + barge-in | Hands-free, voice-first apps |
| `"manual"` | Push-to-talk, explicit `commitTurn()` | Noisy environments, precise control |

### Narration + Mic Control

- **`voice.narrate(text)`** — Speak arbitrary text through TTS without the model. Resolves when audio finishes. Auto-mutes mic during narration. Abortable via `interrupt()`. Safe to call from `pushAndWait` tool handlers.
- **`voice.mute()` / `voice.unmute()`** — Gate mic audio forwarding to STT/VAD. `audio_chunk` events still fire when muted (for visualization).
- **`audio_chunk` event** — Raw `Int16Array` PCM from the mic, emitted even when muted. Use for waveform/level visualization.
- **Compaction silence** — Voice automatically ignores `text_delta` during context compaction so the summary is never narrated.

### Voice-First Tool Design

- **Use `pushAndForget` instead of `pushAndWait`** — blocking tools that wait for clicks are unusable in voice mode
- **Return descriptive text in `data`** — the LLM reads it to formulate spoken responses
- **Add a voice-specific system prompt** — instruct the agent to narrate results concisely
- **Use `narrate()` for slot narration** — read display content aloud from within tool handlers

### Supported Voice Providers

| Provider | Token Handler Config | Env Variable |
|----------|---------------------|--------------|
| ElevenLabs | `{ provider: "elevenlabs", type: "stt" \| "tts" }` | `ELEVENLABS_API_KEY` |
| Deepgram | `{ provider: "deepgram" }` | `DEEPGRAM_API_KEY` |
| Cartesia | `{ provider: "cartesia" }` | `CARTESIA_API_KEY` |

## Supporting Files

For detailed API reference, see [api-reference.md](api-reference.md).
For example patterns from real implementations, see [examples.md](examples.md).

## Common Gotchas

1. **model_response_complete vs model_response**: Streaming adapters emit `model_response_complete`, not `model_response`. Subscribers must handle both.
2. **Closure capture in React hooks**: When re-keying sessions, use mutable `let currentKey = key` to avoid stale closures.
3. **React useEffect timing**: State updates don't take effect in the same render cycle — guard with early returns.
4. **Browser-safe imports**: `glove-core` is now browser-safe (no native deps). `SqliteStore` (with its native `better-sqlite3` dependency) lives in the separate `glove-sqlite` package for server-side use only. Subpath imports (`glove-core/core`, `glove-core/glove`, etc.) still work but are no longer required for browser safety.
5. **`Displaymanager` casing**: The concrete class is `Displaymanager` (lowercase 'm'), not `DisplayManager`. Import it as: `import { Displaymanager } from "glove-core/display-manager"`.
6. **`createAdapter` stream default**: `stream` defaults to `true`, not `false`. Pass `stream: false` explicitly if you want synchronous responses.
7. **Tool return values**: The `do` function should return `ToolResultData` with `{ status, data, renderData? }`. `data` goes to the AI; `renderData` stays client-only.
8. **Zod .describe()**: Always add `.describe()` to schema fields — the AI reads these descriptions to understand what to provide.
9. **displayPropsSchema is optional but recommended**: `defineTool`'s `displayPropsSchema` is optional, but recommended for tools with display UI — tools without display should use raw `ToolConfig` instead.
10. **renderData is stripped by model adapters**: Model adapters explicitly exclude `renderData` when formatting tool results for the AI, so it's safe for client-only data.
11. **SileroVAD must use dynamic import**: Never import `glove-voice/silero-vad` at module level in Next.js/SSR. Use `await import("glove-voice/silero-vad")` to avoid pulling WASM into the server bundle.
12. **Next.js transpilePackages**: Add `"glove-voice"` to `transpilePackages` in `next.config.ts` so Next.js processes the ES module.
13. **createTTS must be a factory**: `GloveVoice` calls it once per turn to get a fresh TTS adapter. Pass `() => new ElevenLabsTTSAdapter(...)`, not a single instance.
14. **Barge-in protection requires `unAbortable`**: A `pushAndWait` resolver suppresses voice barge-in at the trigger level (GloveVoice skips `interrupt()` when `resolverStore.size > 0`). But that alone doesn't protect the tool — if `interrupt()` is called by other means, only `unAbortable: true` on the tool guarantees it runs to completion despite the abort signal. Use both together for mutation-critical tools like checkout. Use `pushAndForget` for voice-first tools.
15. **Empty committed transcripts**: ElevenLabs Scribe may return empty committed transcripts for short utterances. The adapter auto-falls back to the last partial transcript.
16. **TTS idle timeout**: ElevenLabs TTS WebSocket disconnects after ~20s idle. GloveVoice handles this by closing TTS after each model_response_complete and opening a fresh session on next text_delta.
17. **onnxruntime-web build warnings**: `Critical dependency: require function is used in a way...` warnings from onnxruntime-web are expected and harmless.
18. **Audio sample rate**: All adapters must agree on 16kHz mono PCM (the default). Don't change unless your provider explicitly requires something different.
19. **`narrate()` auto-mutes mic**: `voice.narrate()` automatically mutes the mic during playback to prevent TTS audio from feeding back into STT/VAD. It restores the previous mute state when done.
20. **`narrate()` needs a started pipeline**: Calling `narrate()` before `voice.start()` throws. The TTS factory and AudioPlayer must be initialized.
21. **Voice auto-silences during compaction**: When context compaction is triggered, the voice pipeline ignores all `text_delta` events between `compaction_start` and `compaction_end`. The compaction summary is never narrated.
22. **`isCompacting` for React UI feedback**: `GloveState.isCompacting` is `true` while compaction is in progress. Use it to show a loading indicator or disable input during compaction.
23. **`<Render>` ships a default input**: If you have a custom input form, always pass `renderInput={() => null}` to suppress the built-in one — otherwise you get duplicate inputs.
24. **Tools execute outside React**: Tool `do()` functions run outside the component tree. To access React context (e.g. `useWallet()`), use a mutable singleton ref synced from a React component (bridge pattern).
25. **SileroVAD not needed for manual mode**: When using `turnMode: "manual"` (push-to-talk), skip the SileroVAD import and its WASM overhead. VAD is only needed for `turnMode: "vad"`.
26. **System prompt: document tools explicitly**: Even though tools have descriptions and schemas, listing every tool with its parameters in the system prompt dramatically improves tool selection accuracy.
27. **Inbox items need remote store wiring**: When using `createRemoteStore`, inbox falls back to in-memory if you don't provide `getInboxItems`/`addInboxItem`/`updateInboxItem`/`getResolvedInboxItems` actions. Items will vanish on reload.
28. **Inbox resolved items are plain text messages**: Resolved inbox items are injected as user text messages, not tool results. This avoids Anthropic API validation errors from unmatched tool_use/tool_result pairs.
29. **Blocking inbox reminders are transient**: Pending blocking item reminders are included in the prompt but NOT persisted to the store, preventing context bloat across turns.
30. **MCP tool names use `__`**: Bridged MCP tool names are `${entry.id}__${tool.name}` — the `__` separator (`MCP_NAMESPACE_SEP`) is regex-safe across all model providers. A Notion `search` tool surfaces as `notion__search`.
31. **`auth_expired` is a contract, not an exception**: 401-shaped errors during MCP `callTool` become `{ status: "error", message: "auth_expired" }`. The framework never refreshes — your app refreshes the token, writes it back to your store, and the next call picks it up via `getAccessToken`.
32. **`McpAdapter.deactivate` doesn't unload tools (v1)**: It flips persisted state, but bridged tools stay loaded on the running agent until the session is refreshed. Plan accordingly.
33. **`mountMcp` fails open**: If an active server fails to reload (transient outage, expired token), the failure is logged via `console.warn` and the agent continues with the rest of the catalogue. Don't rely on `mountMcp` throwing.
34. **`serverMode` defaults the discovery policy**: `serverMode: true` → `auto-pick-best` and bridged tools never gate on permission. `serverMode: false` (default) → `interactive` policy and read-write MCP tools require permission. Pass `ambiguityPolicy` explicitly to override.
35. **Interactive discovery needs an `mcp_picker` renderer**: The `interactive` ambiguity policy renders via the `mcp_picker` renderer on the displayManager. If you're in a browser and using that policy, register a renderer for it; otherwise the `pushAndWait` will hang.
36. **Only `/` directives are parsed**: `parseTokens` looks for `/name` only. `@name` tokens reach the model verbatim. Paths like `/usr/local` survive (the name `usr` won't be in any registry); emails like `a@b.com` are never touched at all. If a legitimate user message includes `/compact` and you have a hook by that name, it WILL fire — pick hook/skill names that won't collide with normal prose.
37. **Bound `/` directives are replaced with placeholders, not stripped**: `/compact` becomes `[invoked_extension__hook_compact]` in the parsed text the model sees. The placeholder is non-triggerable (it doesn't match the directive regex), so a future re-parse of the same text doesn't re-fire the extension. Hook and skill handlers receive `parsedText` containing the placeholder, not the bare directive — keep that in mind when matching against it.
38. **Skill-injected messages are `is_skill_injection: true`**: Synthetic user messages produced by `/skill` invocations have this flag set. Use it in transcript renderers to distinguish them from real user turns. They are persisted in the store like any other message and survive compaction (subject to `splitAtLastCompaction` like everything else).
39. **`glove_invoke_skill` reads the live registry per call**: The auto-registered tool checks `this.skills` at run time, so skills defined after `build()` with `exposeToAgent: true` are immediately callable. The tool's description is also rebuilt in place when a new exposed skill is registered, so the listing the model sees stays current. The same applies to `glove_invoke_subagent` and the subagent registry.
40. **`@mention` is a model-side routing signal, not a parsed directive**: Following Claude Code's subagent convention, glove never parses `@name` tokens. The full user message reaches the model and the model decides whether to call `glove_invoke_subagent` based on that tool's description. This means: invocation is not guaranteed (the model could ignore an `@mention`), but multiple `@mentions` in one message Just Work — the model can call the dispatch tool once per subagent.
41. **Subagents do not see parent context**: A subagent runs in isolation — the only input it gets is the `prompt` string the agent supplied. If your subagent needs context, the parent agent must put it in the prompt (Claude Code-style). The factory builds a fresh child `Glove` with its own store; pass `parentControls.glove.model` and `parentControls.displayManager` if you want to inherit them.
42. **`subagent_invoked` / `subagent_completed` are guaranteed symmetric**: The Executor — not the dispatcher — fires both bracket events around every `glove_invoke_subagent` tool call. Even when a parent abort short-circuits the dispatcher's promise chain, the executor's abort branch still fires `subagent_completed` with `status: "error"` and `message: "Subagent run aborted by the user."`. Subscribers can rely on 1:1 symmetry.
43. **Hook `shortCircuit` still persists the user message**: Even when a hook short-circuits the turn, the user's (post-rewrite) message is appended to context first so transcripts stay consistent. The model just isn't called for that turn.
44. **Token consumption events**: The Observer fires `token_consumption` (`{ consumption: { tokens_in, tokens_out } }`) on subscribers after each model turn. `StoreAdapter.addTokens` takes the same `TokenConsumptionCounter` shape; `getTokenCount()` still returns a single sum.
45. **Reasoning capture is opt-in**: `OpenAICompatAdapter` ignores `reasoning_content` by default. Pass `reasoning: true` (or an object) on `createAdapter` / `new OpenAICompatAdapter` to capture the trace into `Message.reasoning_content`. The MiMo adapter is opinionated and captures unconditionally.
46. **`reasoning_content` vs `reasoning` field**: The adapter reads either field from the response. DeepSeek / Qwen3 / GLM / Kimi / MiniMax / MiMo emit `reasoning_content`; OpenRouter emits `reasoning` (with `reasoning_content` as a documented alias). The captured string always lands on `Message.reasoning_content` — that's the canonical Glove field.
47. **Echo is required on tool turns for DeepSeek V4 / MiMo**: When `reasoning` is enabled, the adapter echoes `Message.reasoning_content` back on assistant turns that produced `tool_calls` — DeepSeek V4 and MiMo reject the request otherwise. DeepSeek-R1 (the older model) rejects the field entirely; set `reasoning: { echo: false }` if you're specifically targeting R1.
48. **`reasoning_effort` "minimal" is GPT-5-only**: The full effort enum is `"minimal" | "low" | "medium" | "high"`, but `"minimal"` only works on GPT-5 / o-series. The MiMo branch silently drops it. Other providers may reject it — check provider docs before using.
49. **Adaptive reasoning models can suppress thinking on "low"**: On `mimo-v2.5-pro` and similar adaptive models, passing `effort: "low"` or `"medium"` can suppress reasoning rather than bound it. Pass `"high"` for consistently deep reasoning, or leave unset to let the model decide.
50. **Provider-specific reasoning extras via `extraBody`**: For Qwen3 dashscope's `enable_thinking` / `thinking_budget`, or any other non-standard request field, use `reasoning: { extraBody: { ... } }` — fields are merged straight into the request body. Structured options (`effort`, `reasoningObject`, `thinking`) are exposed for the common cases.
