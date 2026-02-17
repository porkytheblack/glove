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
| `glove-core` | Runtime engine: agent loop, tool execution, display manager, model adapters, stores | `pnpm add glove-core` |
| `glove-react` | React hooks (`useGlove`), `GloveClient`, `GloveProvider`, `MemoryStore`, `ToolConfig` with colocated renderers | `pnpm add glove-react` |
| `glove-next` | One-line Next.js API route handler (`createChatHandler`) for streaming SSE | `pnpm add glove-next` |

**Most projects need just `glove-react` + `glove-next`.** `glove-core` is included as a dependency of `glove-react`.

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
- **Tool** — A capability: name, description, inputSchema (Zod), `do` function, optional `render`.
- **Display Stack** — Stack of UI slots tools push onto. `pushAndWait` blocks tool; `pushAndForget` doesn't.
- **Adapter** — Pluggable interfaces for Model, Store, DisplayManager, and Subscriber. Swap providers without changing app code.
- **Context Compaction** — Auto-summarizes long conversations to stay within context window limits.

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

### 3. Define tools + client

```typescript
// lib/glove.ts
import { GloveClient } from "glove-react";
import { z } from "zod";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant.",
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a city.",
      inputSchema: z.object({
        city: z.string().describe("City name"),
      }),
      async do(input) {
        const res = await fetch(`/api/weather?city=${input.city}`);
        return res.json();
      },
    },
  ],
});
```

### 4. Provider + Hook

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
// app/page.tsx
"use client";
import { useState } from "react";
import { useGlove } from "glove-react";

export default function Chat() {
  const { timeline, streamingText, busy, slots, sendMessage, renderSlot } = useGlove();
  const [input, setInput] = useState("");

  return (
    <div>
      {timeline.map((entry, i) => (
        <div key={i}>
          {entry.kind === "user" && <p><strong>You:</strong> {entry.text}</p>}
          {entry.kind === "agent_text" && <p><strong>AI:</strong> {entry.text}</p>}
          {entry.kind === "tool" && <p>Tool: {entry.name} — {entry.status}</p>}
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

## Display Stack Patterns

### pushAndForget — Show results (non-blocking)

```tsx
async do(input, display) {
  const data = await fetchData(input);
  await display.pushAndForget({ input: data }); // Shows UI, tool continues
  return data;
},
render({ data }) {
  return <Card>{data.title}</Card>;
},
```

### pushAndWait — Collect user input (blocking)

```tsx
async do(input, display) {
  const confirmed = await display.pushAndWait({ input }); // Pauses until user responds
  return confirmed ? "Confirmed" : "Cancelled";
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
```

### SlotRenderProps

| Prop | Type | Description |
|------|------|-------------|
| `data` | `T` | Input passed to pushAndWait/pushAndForget |
| `resolve` | `(value: unknown) => void` | Resolves the slot. For pushAndWait, the value returns to `do`. For pushAndForget, use `resolve()` or `removeSlot(id)` to dismiss. |

## Tool Definition Reference

```typescript
interface ToolConfig<I = any> {
  name: string;                              // Unique identifier
  description: string;                       // AI reads this to decide when to call
  inputSchema: z.ZodType<I>;                 // Zod schema for validation
  do: (input: I, display: ToolDisplay) => Promise<unknown>;  // Implementation
  render?: (props: SlotRenderProps) => ReactNode;             // Optional colocated UI
  requiresPermission?: boolean;              // Gate behind user approval
}
```

## useGlove Hook Return

| Property | Type | Description |
|----------|------|-------------|
| `timeline` | `TimelineEntry[]` | Messages + tool calls |
| `streamingText` | `string` | Current streaming buffer |
| `busy` | `boolean` | Agent is processing |
| `slots` | `Slot[]` | Active display stack |
| `tasks` | `Task[]` | Agent task list |
| `stats` | `GloveStats` | `{ turns, tokens_in, tokens_out }` |
| `sendMessage(text, images?)` | `void` | Send user message |
| `abort()` | `void` | Cancel current request |
| `renderSlot(slot)` | `ReactNode` | Render a display slot |
| `resolveSlot(id, value)` | `void` | Resolve a pushAndWait slot |
| `rejectSlot(id, reason?)` | `void` | Reject a pushAndWait slot |

## TimelineEntry

```typescript
type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "success" | "error"; output?: string };
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

## Supporting Files

For detailed API reference, see [api-reference.md](api-reference.md).
For example patterns from real implementations, see [examples.md](examples.md).

## Common Gotchas

1. **model_response_complete vs model_response**: Streaming adapters emit `model_response_complete`, not `model_response`. Subscribers must handle both.
2. **Closure capture in React hooks**: When re-keying sessions, use mutable `let currentKey = key` to avoid stale closures.
3. **React useEffect timing**: State updates don't take effect in the same render cycle — guard with early returns.
4. **Browser-safe imports**: `glove-core` barrel exports include native deps (better-sqlite3). For browser code, import from subpaths: `glove-core/core`, `glove-core/glove`, `glove-core/display-manager`, `glove-core/tools/task-tool`.
5. **`Displaymanager` casing**: The concrete class is `Displaymanager` (lowercase 'm'), not `DisplayManager`. Import it as: `import { Displaymanager } from "glove-core"`.
6. **`createAdapter` stream default**: `stream` defaults to `true`, not `false`. Pass `stream: false` explicitly if you want synchronous responses.
7. **Tool return values**: The `do` function's return value becomes the tool result sent back to the AI. Return structured data so the AI can reference it.
8. **Zod .describe()**: Always add `.describe()` to schema fields — the AI reads these descriptions to understand what to provide.
