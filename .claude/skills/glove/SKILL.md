---
name: glove
description: Expert guide for building AI-powered applications with the Glove framework. Use when working with glove-core, glove-react, glove-next, tools, display stack, model adapters, stores, or any Glove example project.
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
| `glove-core` | Runtime engine: agent loop, tool execution, display manager, model adapters (browser-safe — no native deps) | `pnpm add glove-core` |
| `glove-sqlite` | `SqliteStore` — persistent SQLite-backed store (server-side only, depends on better-sqlite3) | `pnpm add glove-sqlite` |
| `glove-react` | React hooks (`useGlove`), `GloveClient`, `GloveProvider`, `defineTool`, `<Render>`, `MemoryStore`, `ToolConfig` with colocated renderers | `pnpm add glove-react` |
| `glove-next` | One-line Next.js API route handler (`createChatHandler`) for streaming SSE | `pnpm add glove-next` |
| `glove-mcp` | Bridge MCP servers into a Glove agent: `mountMcp`, `connectMcp`, `bridgeMcpTool`, `McpAdapter`, `find_capability` discovery subagent. Opt-in OAuth helpers at `glove-mcp/oauth`. | `pnpm add glove-mcp` |

**Most projects need just `glove-react` + `glove-next`.** `glove-core` is included as a dependency of `glove-react`. For server-side or non-React agents, use `glove-core` directly — see [Server-Side Agents](#server-side-agents) below. For agents that need third-party tools via the Model Context Protocol, see [MCP Integration](#mcp-integration-glove-mcp).

### What's in the framework

- **`glove-core`** — agent loop, tools, display stack, store/model/subscriber adapters, context compaction, inbox.
- **`glove-react`** — colocated renderers via `defineTool`, `<Render>`, `useGlove`, `MemoryStore`, `createRemoteStore`, `createEndpointModel`, `createRemoteModel`.
- **`glove-next`** — `createChatHandler` (one-line SSE route), voice token handler.
- **`glove-sqlite`** — `SqliteStore` for persistence (server-side only).
- **`glove-voice`** — full-duplex voice pipeline: STT/TTS/VAD adapters, `GloveVoice`, `useGloveVoice`, `useGlovePTT`, `<VoicePTTButton>`.
- **`glove-mcp`** — MCP servers as first-class tools: `mountMcp`, `connectMcp`, `bridgeMcpTool`, `McpAdapter` (consumer-supplied per-conversation seam). `find_capability` discovery subagent. Opt-in OAuth helpers at `glove-mcp/oauth` (`runMcpOAuth`, `FsOAuthStore`, `MemoryOAuthStore`, `McpOAuthProvider`).

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
- **Extensions (hooks, skills, mentions)** — In-message directives parsed out of the user text by `processRequest`. `/hookname` runs a builder-defined handler with full agent controls (force compaction, swap model, short-circuit a turn). `/skillname` materialises a synthetic user message before the real one (marked `is_skill_injection: true`). `@subagentname` reroutes the turn to a custom handler. Tokens only bind when the name is registered, so `/usr/local` and `a@b.com` pass through untouched. Skills can be exposed to the agent (`exposeToAgent: true`) so the agent itself can pull them in via the auto-registered `glove_invoke_skill` tool.
- **MCP catalogue + adapter** — `glove-mcp` introduces two pieces: a static `McpCatalogueEntry[]` describing servers the app supports, and a per-conversation `McpAdapter` holding active ids and resolving access tokens. `mountMcp` reloads previously active servers and folds in a `find_capability` discovery subagent — model finds and activates servers it needs mid-conversation.

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
import { Glove, Displaymanager, createAdapter } from "glove-core";
import z from "zod";

// In-memory store (see MemoryStore below) or SqliteStore from glove-sqlite for persistence
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

### Minimal MemoryStore

```typescript
import type { StoreAdapter, Message } from "glove-core";

class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Message[] = [];
  private tokenCount = 0;
  private turnCount = 0;

  constructor(id: string) { this.identifier = id; }

  async getMessages() { return this.messages; }
  async appendMessages(msgs: Message[]) { this.messages.push(...msgs); }
  async getTokenCount() { return this.tokenCount; }
  async addTokens(count: number) { this.tokenCount += count; }
  async getTurnCount() { return this.turnCount; }
  async incrementTurn() { this.turnCount++; }
  async resetCounters() { this.tokenCount = 0; this.turnCount = 0; }
}
```

For persistent storage: `import { SqliteStore } from "glove-sqlite"` then `new SqliteStore({ dbPath: "./agent.db", sessionId: "abc" })`.

### Key Differences from React

| React (`glove-react`) | Server-side (`glove-core`) |
|----------------------|---------------------------|
| `defineTool` with `render`/`renderResult` | `.fold()` with just `do` — no renderers needed |
| `useGlove()` hook manages state | Call `agent.processRequest()` directly |
| `GloveClient` + `GloveProvider` | `new Glove({...}).build()` |
| `createEndpointModel` (SSE client) | `createAdapter()` or direct adapter (e.g. `new AnthropicAdapter()`) |
| `MemoryStore` from glove-react | Implement `StoreAdapter` yourself or use `SqliteStore` from `glove-sqlite` |

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

## Extensions: Hooks, Skills & Mentions

`processRequest` parses three kinds of inline directive out of the user text and dispatches them before the model is called. Builders register handlers via three new builder methods (chainable, callable post-`build()` like `fold`):

| Token | Purpose | Builder method |
|-------|---------|----------------|
| `/hookname` | Mutate agent state, force compaction, swap model, short-circuit a turn | `defineHook(name, handler)` |
| `/skillname` | Inject context as a synthetic user message marked `is_skill_injection: true` | `defineSkill(name, handler, opts?)` |
| `@subagentname` | Reroute the turn to a custom handler | `defineMention(name, handler)` |

Tokens only bind when the name matches a registered handler. `/usr/local/bin` and `a@b.com` survive untouched. Multiple hooks/skills can stack in one message; only the first matching `@mention` wins.

### Quick example

```typescript
const agent = new Glove({ /* ... */ })
  .defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  })
  .defineHook("stop", async () => ({
    shortCircuit: { message: { sender: "agent", text: "Cancelled." } },
  }))
  .defineSkill(
    "concise",
    async ({ source, args }) => `Be terse. (source=${source}, hint=${args ?? "none"})`,
    { description: "Tighter, snappier responses", exposeToAgent: true },
  )
  .defineMention("weather-only", async ({ message }) => {
    return { sender: "agent", text: await fetchWeather(message.text) };
  })
  .build();

await agent.processRequest("/concise tell me about Rust");      // user-invoked skill
await agent.processRequest("/compact what's next?");           // hook → forceCompaction
await agent.processRequest("@weather-only NYC");               // mention reroutes
```

### Hooks

```typescript
type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

interface HookContext {
  name: string;
  rawText: string;
  parsedText: string;        // text with bound tokens removed
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
  forceCompaction: () => Promise<void>;
}
```

`forceCompaction` calls `Observer.runCompactionNow()` — same body as `tryCompaction` minus the token-threshold guard. Subscribers still see `compaction_start` / `compaction_end`.

Hooks run in document order. `rewriteText` overrides the working text passed to subsequent hooks, skills, and the final user message. `shortCircuit` persists the user message and returns immediately — the model is not called.

### Skills

```typescript
type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

interface SkillContext {
  name: string;
  parsedText: string;        // post-strip user text
  args?: string;             // model-supplied free-form args (only when source = "agent")
  source: "user" | "agent";
  controls: AgentControls;
}

interface SkillOptions {
  description?: string;       // shown to the agent in the invoke-skill tool listing
  exposeToAgent?: boolean;    // default false
}
```

Skill-injected messages set `is_skill_injection: true` on `Message`, alongside the existing `is_compaction` and `is_compaction_request` flags. Use it in transcript renderers to render injected context differently from real user turns.

#### Exposing skills to the agent

Set `exposeToAgent: true` and Glove auto-registers a single `glove_invoke_skill` tool on the executor. Its description lists every exposed skill (`- name — description`) and is rebuilt in place each time a new exposed skill is defined, so post-`build()` registrations are picked up immediately.

```typescript
agent.defineSkill(
  "research-mode",
  async ({ source, args }) => {
    const hint = args ? ` Focus area: ${args}.` : "";
    return `Switch into long-form research mode. Cite sources.${hint}`;
  },
  { description: "Switch to long-form research mode with citations", exposeToAgent: true },
);

// User: "/research-mode tell me about ribosomes"  (source = "user")
// Agent: glove_invoke_skill({ name: "research-mode", args: "ribosome assembly" })  (source = "agent")
```

The tool returns `{ status: "success", data: { skill, content } }` on success and `{ status: "error", message: 'Skill "..." is not available' }` for unknown or unexposed names.

| Aspect | User `/skill` | Agent `glove_invoke_skill` |
|--------|--------------|----------------------------|
| Where it lands | Synthetic user message before the real turn (`is_skill_injection: true`) | Tool result on the agent's tool_use |
| `SkillContext.source` | `"user"` | `"agent"` |
| `SkillContext.args` | undefined | free-form string the model supplied |
| Gated by `exposeToAgent` | No — user-invoked always works | Yes — only exposed skills are callable |

### Mentions

```typescript
type MentionHandler = (ctx: MentionContext) => Promise<ModelPromptResult | Message>;

interface MentionContext {
  name: string;
  message: Message;          // already-persisted user message (post-strip)
  controls: AgentControls;
  handOver?: HandOverFunction;
  signal?: AbortSignal;
}
```

Common patterns: forward to a sub-Glove (`subGlove.processRequest(message.text)`), respond deterministically without the model, or proxy to an external agent/API.

### Dispatch order in `processRequest`

1. Parse tokens from the raw text. Bound tokens are stripped (whitespace collapsed); unbound tokens stay in place.
2. Run hooks in document order. Apply any `rewriteText`; honour the first `shortCircuit` and return.
3. Materialise skills (`source: "user"`) — each becomes a synthetic user message persisted via `context.appendMessages` before the real one.
4. Build the real user `Message` from the stripped text + any non-text `ContentPart`s the caller passed.
5. If a mention bound, persist the user message and call its handler. Otherwise hand off to `Agent.ask` as before.

### `is_skill_injection` flag

Skill-materialised user messages set `is_skill_injection: true` on `Message`. Pair it with `is_compaction` for transcript rendering — collapse, mute, or filter injected messages so they're visually distinct from real user turns.

### Public API surface

```typescript
import {
  // Builder additions
  Glove, // .defineHook(), .defineSkill(), .defineMention()
  // Types
  HookHandler, HookContext, HookResult,
  SkillHandler, SkillContext, SkillOptions, RegisteredSkill,
  MentionHandler, MentionContext,
  AgentControls,
  // Helpers
  parseTokens, formatSkillMessage, createSkillInvokeTool, renderSkillToolDescription,
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
2. Folds in the `find_capability` discovery subagent so the model can activate more servers mid-conversation.

`mountMcp` returns when reload + discovery fold are complete. Call it before `build()` for the cleanest init order, but `fold()` after `build()` works too.

### Bridged tool shape

`bridgeMcpTool(connection, tool, serverMode)` produces a `GloveFoldArgs` with these conventions:

- **Name**: `${entry.id}__${tool.name}` (e.g. `notion__search`). The `__` separator (exported as `MCP_NAMESPACE_SEP`) is regex-safe across all model providers.
- **Schema**: raw JSON Schema from the MCP server, passed via `jsonSchema` (no Zod). The MCP server is the source of truth.
- **`requiresPermission`**: in `serverMode` always `false`; otherwise `true` unless the MCP tool annotates `readOnlyHint: true`.
- **Result**: server `content[]` text is joined into `data` (what the model sees); the full `content[]` is also passed through as `renderData` so React renderers can use it.
- **Auth-expired contract**: any 401-shaped error during `callTool` is mapped to `{ status: "error", message: "auth_expired", data: null }`. Detect this from the conversation log, refresh your token, and the next call picks up the new value via `getAccessToken`.

### Discovery (`find_capability`) and ambiguity policies

`mountMcp` folds in a single tool the model can call: **`find_capability`**. It takes a brief `need` description, spins up a tiny subagent (with its own DiscoveryMemoryStore, inheriting the main agent's model and displayManager), and gives the subagent four tools:

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
| Discovery subagent factory | `discoveryTool({ adapter, entries, ambiguityPolicy })` |
| Tool namespace separator | `MCP_NAMESPACE_SEP` (`"__"`) |
| 401 detection on raw connect | `UnauthorizedError` |
| Run the OAuth flow | `runMcpOAuth(opts)` from `glove-mcp/oauth` |
| Persist OAuth state | `FsOAuthStore`, `MemoryOAuthStore` from `glove-mcp/oauth` |
| Build client metadata | `buildClientMetadata(opts)` from `glove-mcp/oauth` |

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

### `do(input, display, glove)` — third argument

A tool's `do` function now receives the running `IGloveRunnable` as a third argument. This is how `find_capability`'s discovery subagent reaches back to fold tools onto the main agent and to inherit its model/displayManager. Most tools ignore this.

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
36. **Extension tokens only bind to registered names**: `parseTokens` leaves any `/foo` or `@foo` in place when `foo` isn't in the relevant registry. Paths like `/usr/local` and emails like `a@b.com` survive untouched — but if a legitimate user message happens to mention `/compact` and you have a hook by that name, it WILL fire. Pick names that won't collide with normal prose.
37. **Skill-injected messages are `is_skill_injection: true`**: Synthetic user messages produced by `/skill` invocations have this flag set. Use it in transcript renderers to distinguish them from real user turns. They are persisted in the store like any other message and survive compaction (subject to `splitAtLastCompaction` like everything else).
38. **`glove_invoke_skill` reads the live registry per call**: The auto-registered tool checks `this.skills` at run time, so skills defined after `build()` with `exposeToAgent: true` are immediately callable. The tool's description is also rebuilt in place when a new exposed skill is registered, so the listing the model sees stays current.
39. **First mention wins**: When a message has multiple registered `@mentions`, only the first one routes — subsequent matches stay in the text. If you want fan-out to multiple subagents, build a single mention handler that does the dispatch.
40. **Hook `shortCircuit` still persists the user message**: Even when a hook short-circuits the turn, the user's (post-rewrite) message is appended to context first so transcripts stay consistent. The model just isn't called for that turn.
