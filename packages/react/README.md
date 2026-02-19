# glove-react

React bindings for the [Glove](https://github.com/porkytheblack/glove) agent framework — hooks, components, and tools with colocated renderers.

## Install

```bash
npm install glove-react glove-next
```

Requires `react >= 18.0.0` as a peer dependency.

## Quick start

### 1. Server route (Next.js)

```typescript
// app/api/chat/route.ts
import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
});
```

### 2. Define tools

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
  displayPropsSchema: inputSchema,     // optional, recommended for tools with UI
  resolveSchema: z.string(),
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const selected = await display.pushAndWait(input);
    return {
      status: "success" as const,
      data: `User selected: ${selected}`,
      renderData: { question: input.question, selected }, // client-only, not sent to AI
    };
  },
  render({ props, resolve }) {
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
  renderResult({ data }) {
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
});
```

### 3. Provider + UI

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

## Key exports

### Components & hooks

- **`GloveProvider`** — Context provider wrapping your app
- **`useGlove(config?)`** — Main hook returning `timeline`, `streamingText`, `busy`, `slots`, `tasks`, `stats`, `sendMessage`, `abort`, `renderSlot`, `renderToolResult`, `resolveSlot`, `rejectSlot`
- **`Render`** — Headless render component with automatic slot visibility, interleaving, and `renderResult` rendering

### Tool helpers

- **`defineTool(config)`** — Type-safe tool builder with colocated `render` and `renderResult`. Provides typed display props and resolve values.
- **`ToolConfig`** — Raw tool interface for tools without display UI

### Client

- **`GloveClient`** — Configuration container. Pass `endpoint` (for server-side models via `glove-next`) or `createModel` (for client-side models).

### Adapters

- **`MemoryStore`** — In-memory store for prototyping
- **`createRemoteStore`** — Delegates store operations to your API endpoints
- **`createRemoteModel`** — Custom model adapter with `prompt` and optional `promptStream`
- **`createEndpointModel`** — SSE-based model compatible with `glove-next` handlers
- **`parseSSEStream`** — Parse an SSE response stream into `RemoteStreamEvent` objects

### Display strategies

| Strategy | Behavior |
|----------|----------|
| `"stay"` (default) | Slot always visible |
| `"hide-on-complete"` | Hidden when slot is resolved/rejected |
| `"hide-on-new"` | Hidden when a newer slot from the same tool appears |

## Documentation

- [React API Reference](https://glove.dterminal.net/docs/react)
- [Display Stack Guide](https://glove.dterminal.net/docs/display-stack)
- [Getting Started](https://glove.dterminal.net/docs/getting-started)

## License

MIT
