# React and Next.js: GloveClient, useGlove, <Render>, createChatHandler

> Read when putting a Glove agent behind a web UI: the Next.js quick start, `GloveProvider`, `useGlove`, `<Render>`, `GloveHandle`, timeline entries and the SSE route.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

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
| `sessionId` | `string` | The resolved session ID (auto-generated `glove_<uuid>` when nothing is configured — zero-config sessions) |
| `newConversation(id?)` | `Promise<string>` | Start a fresh conversation in place: mints an id (arg → `GloveClient.createSessionId` → generated), aborts in-flight work, resets timeline, rebuilds store/agent. No remount needed. |
| `switchConversation(id)` | `void` | Switch to an existing session in place — store swap + timeline rehydration. The `sessionId` config prop is also reactive (changing it does the same). |
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
