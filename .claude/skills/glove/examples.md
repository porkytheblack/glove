# Glove Example Patterns

Real patterns drawn from the example implementations in `examples/`.

## Example Overview

| Example | Type | Stack | Key Patterns |
|---------|------|-------|-------------|
| `examples/weather-agent` | Terminal CLI | Ink + glove-core | Local MemoryStore, AnthropicAdapter, pushAndWait for input, pushAndForget for display |
| `examples/coding-agent` | Full-stack | Node server + React SPA | SqliteStore, WebSocket bridge, 14 tools, permission system, planning workflow |
| `examples/nextjs-agent` | Web app | Next.js + glove-react | `defineTool`, `<Render>`, `renderResult`, `displayStrategy`, trip planning |
| `examples/coffee` | Web app | Next.js + glove-react + glove-voice | `defineTool`, `<Render>`, `renderResult`, `displayStrategy`, e-commerce flow, cart state, voice interaction, inbox (restock watches) |
| `examples/lola` | Web app | Next.js + glove-react + glove-voice | Voice-first movie companion, 9 TMDB tools, SileroVAD, `pushAndForget` only, cinematic UI |
| `examples/glovebox-pdf-extractor` | Sandboxed service | glovebox + glovebox/docs base | `glovebox.wrap`, `glovebox build`, S3 outputs via `adapters` export, `GloveboxClient` |
| *(pattern below)* | Full-stack | React SPA + Node/Express | `createRemoteModel`, auth headers, SSE streaming, separate frontend/backend |

---

## Pattern: Minimal Next.js Setup (nextjs-agent / coffee)

**Server — one line (coffee example):**
```typescript
// app/api/chat/route.ts
import { createChatHandler } from "glove-next";
export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

**Client — GloveClient with `defineTool`:**
```tsx
// app/lib/glove.tsx
import { GloveClient, defineTool } from "glove-react";
import { z } from "zod";

const inputSchema = z.object({
  question: z.string(),
  options: z.array(z.object({ label: z.string(), value: z.string() })),
});

const askPreference = defineTool({
  name: "ask_preference",
  description: "Ask user to pick from options",
  inputSchema,
  displayPropsSchema: inputSchema,
  resolveSchema: z.string(),
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const selected = await display.pushAndWait(input);
    return {
      status: "success" as const,
      data: `User selected: ${selected}`,
      renderData: { question: input.question, selected },
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

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant...",
  tools: [askPreference],
});
```

---

## Pattern: React SPA + Node Backend (Non-Next.js)

For React apps with a separate Node/Express backend (no Next.js), use `createRemoteModel` on the frontend and handle the SSE protocol on your server. This keeps API keys on the server and gives the frontend full control over auth headers.

### 1. Backend — Node server with `createChatHandler`

`createChatHandler` from `glove-next` uses Web API `Request`/`Response` — it works with any framework, not just Next.js. It handles SDK initialization, message formatting, tool serialization, and SSE streaming internally using the appropriate model adapter for your provider.

**Express (with Web API adapter):**
```typescript
// server/index.ts
import express from "express";
import cors from "cors";
import { createChatHandler } from "glove-next";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// createChatHandler returns (req: Request) => Promise<Response>
// It uses createAdapter internally — picks the right adapter for the provider
const handler = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  // Reads ANTHROPIC_API_KEY from env by default, or pass explicitly:
  // apiKey: process.env.ANTHROPIC_API_KEY,
});

// Simple auth middleware — verify JWT, session token, etc.
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.post("/api/chat", authMiddleware, async (req, res) => {
  // Convert Express request to Web API Request
  const webReq = new Request(`http://localhost${req.url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });

  const webRes = await handler(webReq);

  // Forward the SSE response
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const reader = webRes.body!.getReader();
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };
  pump();
});

app.listen(3001, () => console.log("API server on :3001"));
```

**Hono / Bun (native Web API — zero adapter code):**
```typescript
// server/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createChatHandler } from "glove-next";

const app = new Hono();
app.use("/api/*", cors({ origin: "http://localhost:5173" }));

const handler = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
});

app.post("/api/chat", async (c) => {
  // Auth check
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return c.json({ error: "Unauthorized" }, 401);

  // Hono uses Web API natively — pass the request directly
  return handler(c.req.raw);
});

export default app; // Works with Bun.serve, Deno.serve, or Cloudflare Workers
```

**How it works:**
- `createChatHandler` initializes the provider SDK (Anthropic SDK or OpenAI SDK) based on the `provider` config and handles message formatting, tool serialization, and SSE streaming
- The SSE protocol emits `text_delta`, `tool_use`, and `done` events — the same protocol that `glove-react`'s `createEndpointModel` and `createRemoteModel` understand
- Tools execute on the client side — the server only forwards tool definitions to the LLM provider

### 2. Frontend — GloveClient with `createRemoteModel` + auth

```tsx
// src/lib/glove.ts
import { GloveClient } from "glove-react";
import { createRemoteModel } from "glove-react/adapters";
import type { RemotePromptRequest } from "glove-react/adapters";

const API_URL = "http://localhost:3001";

// Get auth token from your auth system (Auth0, Clerk, Firebase, etc.)
function getAuthToken(): string {
  return localStorage.getItem("auth_token") ?? "";
}

export const gloveClient = new GloveClient({
  // Use createModel instead of endpoint — gives you control over fetch
  createModel: () =>
    createRemoteModel("claude-sonnet", {
      // Streaming mode — recommended for real-time UI
      async *promptStream(request: RemotePromptRequest, signal?: AbortSignal) {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAuthToken()}`,
          },
          body: JSON.stringify(request),
          signal,
        });

        if (!res.ok) {
          if (res.status === 401) throw new Error("Session expired. Please log in again.");
          throw new Error(`Server error: ${res.status}`);
        }

        // Parse the SSE stream
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              yield JSON.parse(line.slice(6));
            }
          }
        }
      },
    }),

  systemPrompt: "You are a helpful assistant.",
  tools: [/* your tools */],
});
```

### 3. Frontend — React app with GloveProvider

```tsx
// src/App.tsx
import { GloveProvider, useGlove, Render } from "glove-react";
import { gloveClient } from "./lib/glove";

function Chat() {
  const glove = useGlove();

  return (
    <Render
      glove={glove}
      renderMessage={({ entry }) => (
        <div className={entry.kind === "user" ? "user" : "agent"}>
          {entry.text}
        </div>
      )}
      renderStreaming={({ text }) => <div className="streaming">{text}</div>}
      renderInput={({ send, busy }) => (
        <input
          disabled={busy}
          placeholder="Type a message..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              send(e.currentTarget.value);
              e.currentTarget.value = "";
            }
          }}
        />
      )}
    />
  );
}

export default function App() {
  return (
    <GloveProvider client={gloveClient}>
      <Chat />
    </GloveProvider>
  );
}
```

**Key points:**
- API keys never leave the server — the frontend only sends an auth token
- `createRemoteModel` + `promptStream` gives full control over the fetch (headers, error handling, retries)
- The SSE protocol is the same one `glove-next`'s `createChatHandler` uses: `text_delta`, `tool_use`, `done` events
- For simpler setups without auth, use `endpoint` mode with a proxy (e.g. Vite's `proxy` config)

### Server-assigned session IDs with `getSessionId`

When the backend manages session creation (e.g. stored in a database), use `getSessionId` to fetch the ID asynchronously instead of generating it client-side:

```typescript
export const gloveClient = new GloveClient({
  createModel: () => createRemoteModel("claude-sonnet", { /* ... */ }),
  // Fetch session ID from backend — called once, before store is created
  getSessionId: async () => {
    const res = await fetch(`${API_URL}/api/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    const { id } = await res.json();
    return id;
  },
  createStore: (sid) => createRemoteStore(sid, storeActions),
});
```

The hook defers store creation until `getSessionId` resolves. Use `sessionReady` to show a loading state:

```tsx
function Chat() {
  const glove = useGlove();
  if (!glove.sessionReady) return <div>Setting up session...</div>;
  return <Render glove={glove} /* ... */ />;
}
```

You can also pass `getSessionId` at the hook level to override the client:

```tsx
const glove = useGlove({
  getSessionId: () => fetch("/api/session").then(r => r.json()).then(d => d.id),
});
```

### Alternative: Simple endpoint mode with Vite proxy (no auth)

If you don't need auth headers and just want the simplest setup:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});

// src/lib/glove.ts — just use endpoint mode
export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant.",
  tools: [/* your tools */],
});
```

This works because the Vite dev proxy forwards `/api/chat` to your backend, and `createEndpointModel` (used internally by `endpoint` mode) sends a plain `POST` with `Content-Type: application/json` — no auth headers.

---

## Pattern: Tool Factory with Shared State (coffee)

When tools need shared state (e.g., a shopping cart), use a factory pattern:

```typescript
// lib/theme.ts (re-exported from lib/tools/index.ts)
interface CartOps {
  add: (productId: string, quantity?: number) => void;
  get: () => CartItem[];
  clear: () => void;
}

export function createCoffeeTools(cartOps: CartOps): ToolConfig[] {
  return [
    createShowProductsTool(cartOps),
    createAddToCartTool(cartOps),
    createShowCartTool(cartOps),
    createCheckoutTool(cartOps),
    // ...
  ];
}

function createAddToCartTool(cartOps: CartOps): ToolConfig {
  return {
    name: "add_to_cart",
    description: "Add a product to the user's shopping bag.",
    inputSchema: z.object({
      product_id: z.string().describe("The product ID to add"),
      quantity: z.number().optional().default(1).describe("Quantity to add (default 1)"),
    }),
    async do(input) {
      const { product_id, quantity } = input as { product_id: string; quantity: number };
      const product = getProductById(product_id);
      if (!product) return "Product not found.";
      cartOps.add(product_id, quantity);
      const cart = cartOps.get();
      const totalItems = cart.reduce((s, i) => s + i.qty, 0);
      const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
      return `Added ${quantity}x ${product.name} to bag. Cart: ${totalItems} item(s), ${formatPrice(totalPrice)}.`;
    },
  };
}
```

---

## Pattern: Server-Side Agent with WebSocket Bridge (coding-agent)

For agents with server-side tools (file I/O, bash, git), use glove-core directly:

```typescript
// server.ts
import { Glove, Displaymanager, createAdapter } from "glove-core";
import { SqliteStore } from "glove-sqlite";

function createSession(sessionId: string, cwd: string) {
  const store = new SqliteStore({ dbPath: "./agent.db", sessionId });
  const model = createAdapter({ provider: "anthropic", stream: true });
  const display = new Displaymanager();

  const glove = new Glove({
    store, model, displayManager: display,
    systemPrompt: buildSystemPrompt(cwd),
    compaction_config: { compaction_instructions: "Summarize...", max_turns: 50 },
  });

  // Register tools with path resolution
  for (const tool of serverTools) {
    glove.fold({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema,
      requiresPermission: DESTRUCTIVE_TOOLS.has(tool.name),
      do: (input) => {
        if (typeof input.path === "string" && !input.path.startsWith("/")) {
          input.path = resolve(cwd, input.path);
        }
        return tool.run(input);
      },
    });
  }

  // Bridge events to WebSocket
  glove.addSubscriber({
    async record(event_type, data) {
      ws.send(JSON.stringify({ type: event_type, ...data }));
    },
  });

  return glove.build();
}
```

---

## Pattern: Subscriber Bridge for Streaming UI

Handle subscriber events to bridge between the agent and your UI layer. The key events are:

```typescript
class BridgeSubscriber implements SubscriberAdapter {
  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        // Streaming text — append to current response buffer
        process.stdout.write(data.text);
        break;
      case "tool_use":
        // Tool call started — data has { id, name, input }
        console.log(`Calling tool: ${data.name}`);
        break;
      case "tool_use_result":
        // Tool finished — data has { tool_name, call_id, result: { status, data } }
        console.log(`Tool ${data.tool_name}: ${data.result.status}`);
        break;
      case "model_response":
      case "model_response_complete":  // IMPORTANT: handle BOTH
        // Turn complete — data has { tokens_in, tokens_out, text, tool_calls }
        this.addTurn(data.tokens_in, data.tokens_out);
        break;
    }
  }
}
```

**Note**: Streaming adapters emit `model_response_complete`, sync adapters emit `model_response`. Always handle both.

---

## Pattern: Permission-Gated Destructive Tools

### Always gate (boolean form)

```typescript
const DESTRUCTIVE_TOOLS = new Set(["write_file", "edit_file", "bash"]);

glove.fold({
  name: "bash",
  description: "Execute a shell command",
  inputSchema: z.object({ command: z.string(), timeout: z.number().optional() }),
  requiresPermission: true,  // Triggers Displaymanager pushAndWait for approval
  async do(input) {
    const timeout = (input.timeout ?? 30) * 1000;
    const { stdout, stderr, code } = await execAsync(input.command, { timeout });
    return { stdout, stderr, exitCode: code };
  },
});
```

Each distinct `command` prompts independently (the default `MemoryStore`
keys decisions on `(toolName, JSON.stringify(input))`), so granting
`{ command: "ls" }` doesn't silently authorise `{ command: "rm -rf /" }`.
After the first approval for a given command, identical re-calls reuse
the cached decision.

### Gate per-input (function form) — read-only escape hatch

When the gate itself depends on input — e.g. you want `bash` to ask
before writes but never before reads — pass `requiresPermission` as a
function. Returning `false` skips the store lookup entirely; returning
`true` runs the normal `getPermission(name, input)` flow:

```typescript
const READ_ONLY = /^(ls|cat|head|tail|pwd|echo|grep|find|wc)\b/;

glove.fold({
  name: "bash",
  description: "Execute a shell command",
  inputSchema: z.object({ command: z.string(), timeout: z.number().optional() }),
  // Skip the prompt for obviously read-only commands; gate everything else.
  requiresPermission: (input) => !READ_ONLY.test(input.command),
  async do(input) {
    // ... same as above
  },
});
```

The gate runs on every call before the store is consulted, so a write
command always prompts even if a previous read command was allowed
through silently.

---

## Pattern: Terminal UI with Ink (weather-agent)

```tsx
import {
  type SubscriberAdapter,
  Displaymanager,
  AnthropicAdapter,
  Glove,
  MemoryStore,
} from "glove-core";
import { render, Text, Box } from "ink";

// MemoryStore from glove-core is the default. You can also omit the `store`
// from the Glove config and one will be constructed automatically.
const store = new MemoryStore("weather-agent");
const model = new AnthropicAdapter({
  model: "claude-sonnet-4-5-20250929",
  maxTokens: 2048,
  stream: true,
  apiKey: process.env.ANTHROPIC_API_KEY,
});
const display = new Displaymanager();

const glove = new Glove({
  store, model, displayManager: display,
  systemPrompt: "You are a weather assistant.",
  compaction_config: { compaction_instructions: "Summarize...", max_turns: 20 },
});

glove.fold({
  name: "check_weather",
  description: "Get weather for a location",
  inputSchema: z.object({ location: z.string().optional() }),
  async do(input, display) {
    let location = input.location;
    if (!location) {
      // Ask user interactively — pushAndWait blocks until user responds
      location = String(await display.pushAndWait({
        renderer: "input",
        input: { message: "Where do you want to check the weather?", placeholder: "e.g. Tokyo" },
      })).trim();
    }
    const weather = await fetchWeather(location);
    await display.pushAndForget({ renderer: "weather_card", input: weather });
    // Return formatted string, not raw object
    return `Weather in ${weather.location}: ${weather.temp}°C, ${weather.condition}.`;
  },
});

glove.addSubscriber(subscriber);
const agent = glove.build();
```

---

## Pattern: Type-Safe Tools with `defineTool`

Use `defineTool` for tools with display UI. It provides typed `props`, typed `resolve`, and typed `display.pushAndWait`:

```tsx
import { defineTool } from "glove-react";
import { z } from "zod";

const inputSchema = z.object({
  question: z.string(),
  options: z.array(z.object({ label: z.string(), value: z.string() })),
});

const askPreferenceTool = defineTool({
  name: "ask_preference",
  description: "Present options for user selection",
  inputSchema,
  displayPropsSchema: inputSchema,         // Same shape as input for this tool
  resolveSchema: z.string(),               // User returns a string value
  displayStrategy: "hide-on-complete",     // Hide after user responds
  async do(input, display) {
    const selected = await display.pushAndWait(input);  // TypedDisplay — typed!
    const option = input.options.find(o => o.value === selected);
    return {
      status: "success" as const,
      data: `User selected: ${selected}`,          // Sent to AI model
      renderData: { question: input.question, selected: option },  // Client-only
    };
  },
  render({ props, resolve }) {  // props is typed from displayPropsSchema
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
  renderResult({ data }) {  // Renders from history using renderData
    const { question, selected } = data as {
      question: string;
      selected: { label: string; value: string };
    };
    return (
      <div>
        <p>{question}</p>
        <span style={{ fontWeight: 600 }}>{selected.label}</span>
      </div>
    );
  },
});
```

Tools without display stay as raw `ToolConfig`:

```typescript
const getDateTool: ToolConfig = {
  name: "get_date",
  description: "Get today's date",
  inputSchema: z.object({}),
  async do() {
    return { status: "success", data: new Date().toLocaleDateString() };
  },
};
```

---

## Pattern: Headless Rendering with `<Render>`

The `<Render>` component replaces manual `timeline.map()` / `slots.map(renderSlot)` rendering:

```tsx
import { useGlove, Render } from "glove-react";
import type { MessageRenderProps, StreamingRenderProps, ToolStatusRenderProps } from "glove-react";

function renderMessage({ entry }: MessageRenderProps) {
  return (
    <div className={entry.kind === "user" ? "user-msg" : "agent-msg"}>
      {entry.text}
    </div>
  );
}

function renderToolStatus({ entry, hasSlot }: ToolStatusRenderProps) {
  if (hasSlot) return null;  // Hide when slot/renderResult is showing
  return <div className="tool-pill">{entry.name}: {entry.status}</div>;
}

export default function Chat() {
  const glove = useGlove();

  return (
    <Render
      glove={glove}
      strategy="interleaved"
      renderMessage={renderMessage}
      renderToolStatus={renderToolStatus}
      renderStreaming={({ text }) => <div className="streaming">{text}</div>}
      renderInput={({ send, busy }) => (
        <input
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") { send(e.currentTarget.value); e.currentTarget.value = ""; }
          }}
        />
      )}
    />
  );
}
```

**`<Render>` automatically:**
- Filters slot visibility based on `displayStrategy`
- Renders `renderResult` for completed tools with `renderData`
- Interleaves slots inline next to their tool call entry

---

## Pattern: Display Strategies

Control when slots are visible:

```tsx
// hide-on-complete — for interactive tools (forms, pickers, confirmations)
defineTool({
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const result = await display.pushAndWait(input);  // Slot visible while waiting
    // After resolve, slot is hidden. renderResult takes over from history.
    return { status: "success", data: "...", renderData: { result } };
  },
  renderResult({ data }) { /* compact read-only view */ },
});

// hide-on-new — for status panels that should only show the latest
defineTool({
  displayStrategy: "hide-on-new",
  async do(input, display) {
    await display.pushAndForget(input);  // Previous cart slot is auto-hidden
    return { status: "success", data: "...", renderData: input };
  },
});

// stay (default) — for persistent info cards
defineTool({
  displayStrategy: "stay",  // or omit — "stay" is the default
  async do(input, display) {
    await display.pushAndForget(input);  // Card stays visible forever
    return { status: "success", data: "...", renderData: input };
  },
});
```

---

## Pattern: renderData + renderResult for History

The `renderData` / `renderResult` pattern enables rendering tool results from history (e.g. after page reload):

```tsx
defineTool({
  name: "checkout",
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const cart = getCart();
    const result = await display.pushAndWait({ items: cart });
    if (!result) return { status: "success", data: "Cancelled", renderData: { cancelled: true } };

    // Email stays in renderData (client-only) — NOT sent to the AI model
    return {
      status: "success",
      data: `Order placed. ${cart.length} items.`,      // AI sees this
      renderData: { email: result.email, items: cart },  // Client-only
    };
  },
  renderResult({ data }) {
    const d = data as any;
    if (d.cancelled) return <p>Checkout cancelled</p>;
    return <div>Order confirmed — {d.email}</div>;
  },
});
```

**Data flow:**
1. `do()` returns `{ status, data, renderData }`
2. `data` → sent to AI model (via model adapter)
3. `renderData` → stripped by model adapter, stored in message history
4. On reload, `renderResult({ data: renderData })` renders the history view

---

## Pattern: Colocated Renderers with pushAndWait + pushAndForget

From the coffee example — a tool that shows products AND waits for selection, using `defineTool`:

```tsx
const inputSchema = z.object({
  product_ids: z.array(z.string()),
  prompt: z.string().optional(),
});

const resolveSchema = z.object({
  productId: z.string(),
  action: z.enum(["select", "add"]),
});

const showProductsTool = defineTool({
  name: "show_products",
  description: "Display product cards for browsing",
  inputSchema,
  displayPropsSchema: inputSchema,
  resolveSchema,
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const selected = await display.pushAndWait(input);
    const product = getProductById(selected.productId);
    return {
      status: "success" as const,
      data: `User ${selected.action === "add" ? "added" : "selected"} ${product.name}`,
      renderData: { productName: product.name, action: selected.action, price: product.price },
    };
  },
  render({ props, resolve }) {
    const products = getProductsByIds(props.product_ids);
    return (
      <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
        {products.map(p => (
          <div key={p.id}>
            <h4>{p.name}</h4>
            <p>{p.origin} — ${p.price}</p>
            <button onClick={() => resolve({ productId: p.id, action: "select" })}>Select</button>
            <button onClick={() => resolve({ productId: p.id, action: "add" })}>Add to bag</button>
          </div>
        ))}
      </div>
    );
  },
  renderResult({ data }) {
    const { action, productName, price } = data as any;
    return <div>{action === "add" ? "Added" : "Selected"} {productName} — ${price}</div>;
  },
});
```

---

## Pattern: Dynamic System Prompts with Product Catalogs

```typescript
const productCatalog = PRODUCTS.map(p =>
  `- ${p.name} (${p.id}): ${p.origin}, ${p.roast} roast, ${formatPrice(p.price)}/${p.weight}. Notes: ${p.notes.join(", ")}. Intensity: ${p.intensity}/10. ${p.description}`
).join("\n");

const systemPrompt = `You are a friendly, knowledgeable coffee barista at Glove Coffee.

## Product Catalog
${productCatalog}

## Your Workflow
1. Greet the customer warmly. Ask what they're in the mood for.
2. Use ask_preference to gather preferences progressively — don't ask everything at once.
3. Based on preferences, use show_products to display 2-3 recommendations.
4. When they select a product, use show_product_detail for the full card.
5. Use add_to_cart when they confirm.
6. When ready, use checkout to present the order form.
7. After checkout, use show_info with variant "success" to confirm.

## Tool Usage Guidelines
- ALWAYS use interactive tools (ask_preference, show_products) instead of listing in plain text
- Use show_info for sourcing details, brewing tips, or order confirmations
- Keep text responses short — 1-2 sentences between tool calls
- When recommending, explain briefly WHY these products match their preferences

## Inventory & Restock Notifications
- Some products may be out of stock. Always check stock levels before recommending.
- If a customer wants an out-of-stock product, offer to notify them when it's back using glove_post_to_inbox.
- Use tag "restock_watch" and describe which product they want in the request text.
- Set blocking=false — the customer can continue browsing while waiting.`;
```

### Inbox & Inventory (coffee example)

The coffee example demonstrates the inbox pattern with inventory tracking:

**Product model with stock:**
```typescript
interface Product {
  id: string; name: string; origin: string;
  roast: "Light" | "Medium-Light" | "Medium" | "Dark";
  price: number; weight: string; notes: string[];
  description: string; intensity: number;
  stock: number;  // 0 = out of stock
}
```

**Remote store actions for inbox persistence:**
```typescript
const storeActions: RemoteStoreActions = {
  // ...existing getMessages, appendMessages...
  getInboxItems: (sid) => fetch(`/api/sessions/${sid}/inbox`).then(r => r.json()),
  addInboxItem: (sid, item) => fetch(`/api/sessions/${sid}/inbox`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
  }),
  updateInboxItem: (sid, itemId, updates) => fetch(`/api/sessions/${sid}/inbox/update`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, updates }),
  }),
  getResolvedInboxItems: (sid) => fetch(`/api/sessions/${sid}/inbox/resolved`).then(r => r.json()),
};
```

**API routes:**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sessions/:id/inbox` | GET | Fetch session inbox items |
| `/api/sessions/:id/inbox` | POST | Add inbox item |
| `/api/sessions/:id/inbox/update` | POST | Update inbox item |
| `/api/sessions/:id/inbox/resolved` | GET | Fetch resolved items |
| `/api/inbox` | GET | List all pending items across sessions |
| `/api/inbox/resolve` | POST | Resolve a specific item externally |
| `/api/inbox/simulate-restock` | POST | Bulk resolve all restock_watch items |

**Right panel inbox UI:**
```tsx
const { inbox } = useGlove({ tools, sessionId });
// Pass to right panel
<RightPanel cart={cart} timeline={timeline} inbox={inbox} stats={stats} />

// In RightPanel — "Watching" section with status badges
{inbox.filter(i => i.status !== "consumed").map(item => (
  <div key={item.id}>
    <span>{item.tag}: {item.request}</span>
    <span className={item.status}>{item.status}</span>
  </div>
))}
```

**Testing flow:**
1. Ask for Yirgacheffe or Mandheling (both out of stock)
2. Agent offers to watch for restock via `glove_post_to_inbox`
3. Simulate restock: `curl -X POST localhost:3000/api/inbox/simulate-restock`
4. Send any new message — agent picks up resolved inbox item and notifies

---

## Pattern: Inbox (General)

The inbox enables async cross-instance communication. An agent posts a request that can't be resolved now; an external service resolves it later.

**Lifecycle:**
1. Agent calls `glove_post_to_inbox({ tag, request, blocking })` — item stored as `pending`
2. External service calls `SqliteStore.resolveInboxItem(dbPath, itemId, responseText)` — item becomes `resolved`
3. Next `agent.ask()` — resolved items injected as text messages, marked `consumed`
4. Pending blocking items appear as transient reminders (not persisted)
5. Compaction preserves pending items in summary

**External resolution (server-side):**
```typescript
import { SqliteStore } from "glove-sqlite";
// Resolve from background job, webhook, cron, etc.
SqliteStore.resolveInboxItem("path/to/db.db", "inbox_item_id", "Your item is ready.");
```

**React integration:**
```tsx
const { inbox } = useGlove({ tools, sessionId });
// inbox: InboxItem[] — pending, resolved, and consumed items
```

**Blocking vs non-blocking:**
- `blocking: false` (default) — agent continues, result arrives later
- `blocking: true` — agent is told it cannot proceed until resolved (soft enforcement via prompt)

---

## Pattern: Mesh — two-agent in-process messaging

`glove-mesh` reuses the inbox primitive to wire agents together. Each agent keeps its own `StoreAdapter`; `mountMesh` registers identity, subscribes to inbound, and folds four `glove_mesh_*` tools.

```typescript
import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

// One shared bus for the in-process demo.
const network = new MeshNetwork();

async function makeAgent(id: string, name: string, description: string) {
  const store = new MemoryStore(id);
  const glove = new Glove({
    store,
    model: createAdapter({ provider: "anthropic" }),
    displayManager: new Displaymanager(),
    systemPrompt: `You are ${name}. ${description} You can send messages to other agents via glove_mesh_*. Use glove_mesh_list_agents to see who's available.`,
    serverMode: true,
    compaction_config: { compaction_instructions: "Summarize the conversation." },
  }).build(store);

  await mountMesh(glove, {
    adapter: new InMemoryMeshAdapter(network, id),
    identity: { id, name, description, capabilities: ["chat"] },
  });

  return glove;
}

const planner = await makeAgent("planner", "Planner", "Plans tasks for the team.");
const worker  = await makeAgent("worker",  "Worker",  "Executes assigned tasks.");

await planner.processRequest("Find a worker and ask them to summarise the latest deploy. Block until they respond.");
// planner calls glove_mesh_send_message({ to: "worker", content: "...", blocking: true })
// → pending blocking InboxItem in planner's store (tag: mesh:waiting:<msg_id>)
// → resolved InboxItem in worker's store (tag: mesh:from:planner)

await worker.processRequest("Check your inbox and respond to any waiting messages.");
// worker sees the [Inbox: 1 item(s) resolved] banner with the message body
// → calls glove_mesh_send_message({ to: "planner", content: "...", in_reply_to: <id> })
//   (reply implies ack, so planner's pending item resolves)

await planner.processRequest("Continue.");
// planner sees the resolved [Inbox: ...] banner with worker's reply
```

**Key contract points:**
- `mountMesh` is async (must await) and not chainable; mirrors `mountMcp`.
- `mountMesh` throws `MeshStoreUnsupportedError` if `glove.store` lacks the four inbox methods.
- Sender ids are unverified — sign on `send` / verify on `subscribe` if you need auth.
- Broadcast blocking resolves on the FIRST ack from any peer; later acks arrive as ordinary inbox items.

---

## Pattern: Mesh — BYO transport (Redis pub/sub sketch)

For cross-process / distributed setups, implement `MeshAdapter` directly. The adapter is the only seam — the rest of the package is reusable.

```typescript
import type { MeshAdapter, MeshMessage, IncomingMeshMessage, AgentIdentity } from "glove-mesh";
import type { Redis } from "ioredis";

export class RedisMeshAdapter implements MeshAdapter {
  identifier: string;

  constructor(private redis: Redis, private agentId: string) {
    this.identifier = `redis-mesh-${agentId}`;
  }

  async register(identity: AgentIdentity) {
    await this.redis.hset("mesh:agents", this.agentId, JSON.stringify(identity));
  }
  async unregister() {
    await this.redis.hdel("mesh:agents", this.agentId);
  }
  async listAgents(): Promise<AgentIdentity[]> {
    const raw = await this.redis.hgetall("mesh:agents");
    return Object.values(raw).map((s) => JSON.parse(s));
  }
  async getAgent(id: string) {
    const raw = await this.redis.hget("mesh:agents", id);
    return raw ? (JSON.parse(raw) as AgentIdentity) : null;
  }

  async send(msg: MeshMessage) {
    // Remember sender so acks can route back.
    await this.redis.set(`mesh:msg:${msg.id}:sender`, msg.from, "EX", 3600);
    await this.redis.publish(`mesh:agent:${msg.to}`, JSON.stringify({ ...msg, kind: "direct" }));
  }
  async broadcast(msg: Omit<MeshMessage, "to">) {
    await this.redis.set(`mesh:msg:${msg.id}:sender`, this.agentId, "EX", 3600);
    await this.redis.publish("mesh:broadcast", JSON.stringify({ ...msg, kind: "broadcast", from: this.agentId }));
  }
  async acknowledge(messageId: string, note?: string) {
    const sender = await this.redis.get(`mesh:msg:${messageId}:sender`);
    if (!sender) throw new Error(`No record of message "${messageId}"`);
    const ack = {
      id: `ack_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      from: this.agentId,
      to: sender,
      content: note ?? "",
      created_at: new Date().toISOString(),
      kind: "ack" as const,
      ack_of: messageId,
      ack_note: note,
    };
    await this.redis.publish(`mesh:agent:${sender}`, JSON.stringify(ack));
  }

  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>) {
    const sub = this.redis.duplicate();
    sub.subscribe(`mesh:agent:${this.agentId}`, "mesh:broadcast");
    sub.on("message", async (_chan, raw) => {
      try {
        await handler(JSON.parse(raw) as IncomingMeshMessage);
      } catch (err) {
        // Per adapter contract: handler errors must not bubble.
        // eslint-disable-next-line no-console
        console.warn("[mesh-redis] handler:", err);
      }
    });
    return () => {
      sub.unsubscribe();
      sub.quit();
    };
  }
}
```

Wire it up identically to the in-memory case — just pass a `RedisMeshAdapter` instead of `InMemoryMeshAdapter`. The four mesh tools and the inbox routing don't change.

---

## Pattern: Abort Handling

```typescript
const controller = new AbortController();

try {
  const result = await glove.processRequest("Plan my trip", controller.signal);
} catch (err) {
  if (err instanceof AbortError) {
    console.log("User cancelled");
  }
}

// To cancel:
controller.abort();
```

In React:
```tsx
const { abort } = useGlove();
<button onClick={abort}>Stop</button>
```

---

## Pattern: Model Switching at Runtime

```typescript
// Server-side
const newModel = createAdapter({ provider: "openai", model: "gpt-4.1", stream: true });
glove.setModel(newModel);

// Via useGlove override
const { sendMessage } = useGlove({
  model: createEndpointModel("/api/chat-gpt4"),
});
```

---

## Pattern: Subagent with the Factory Pattern

Define a subagent the main agent can route a self-contained task to via the auto-registered `glove_invoke_subagent` tool. The factory builds a fresh child `Glove` per invocation; the dispatcher runs it and returns its final agent text as the tool result. The Executor brackets the call with `subagent_invoked` / `subagent_completed` events, guaranteed 1:1 even on abort.

```typescript
import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import z from "zod";

const searchTool = {
  name: "search",
  description: "Web search.",
  inputSchema: z.object({ query: z.string() }),
  async do(input: { query: string }) {
    const hits = await fetchWebSearch(input.query);
    return { status: "success" as const, data: hits };
  },
};

const fetchTool = {
  name: "fetch_url",
  description: "Fetch the contents of a URL.",
  inputSchema: z.object({ url: z.string().url() }),
  async do(input: { url: string }) {
    const res = await fetch(input.url);
    return { status: "success" as const, data: await res.text() };
  },
};

const parent = new Glove({
  store: new MemoryStore("parent"),
  model: createAdapter({ provider: "anthropic", stream: true }),
  displayManager: new Displaymanager(),
  systemPrompt:
    "You are a research assistant. When the user @-mentions @researcher or asks " +
    "for deep research, route to the researcher subagent via glove_invoke_subagent.",
  compaction_config: { compaction_instructions: "Summarise." },
})
  .defineSubAgent({
    name: "researcher",
    description: "Deep research subagent. Use for multi-step web research tasks.",
    factory: async ({ parentStore, parentControls, prompt }) => {
      // Sub-store: durable false → fresh per call. durable true → reused.
      const subStore =
        (await parentStore.createSubAgentStore?.("researcher", false)) ??
        new MemoryStore(`researcher_${Date.now()}`);

      return new Glove({
        store: subStore,
        model: parentControls.glove.model,             // inherit parent's model
        displayManager: parentControls.displayManager, // share parent's display stack
        systemPrompt:
          "You are a research subagent. Plan, search, fetch, and summarise. " +
          "Return a tight markdown summary at the end. The prompt you receive " +
          `is the only context you have: "${prompt}"`,
        compaction_config: {
          compaction_instructions: "Summarise research progress.",
          compaction_context_limit: 30_000,
        },
      })
        .fold(searchTool)
        .fold(fetchTool)
        .build();
    },
  })
  .build();

// Watch the bracket events fire symmetrically
parent.addSubscriber({
  async record(type, data) {
    if (type === "subagent_invoked") {
      console.log("[open]", (data as { name: string; prompt: string }).name);
    } else if (type === "subagent_completed") {
      const d = data as { name: string; status: string; message?: string };
      console.log("[close]", d.name, d.status, d.message ?? "");
    }
  },
});

// "@researcher" reaches the model verbatim. The model decides to call:
//   glove_invoke_subagent({ name: "researcher", prompt: "..." })
await parent.processRequest(
  "@researcher write a 5-bullet brief on the state of WebGPU in 2026",
);
```

**Why factory, not handler?** The factory builds a fresh child per call by default — message history doesn't bleed across invocations, and the child gets its own observer / executor / compaction config. Pass `durable: true` to `createSubAgentStore` if you want a subagent that carries history across calls within the same parent lifetime.

**Aborting a subagent run:** `parent.processRequest(text, signal)` forwards `signal` into the dispatcher, which forwards it into `child.processRequest(prompt, signal)`. A parent-side abort propagates into the child's `Agent.ask` loop and unwinds it on the next iteration. The Executor still fires `subagent_completed` (with `status: "error"` and `message: "Subagent run aborted by the user."`).

---

## Pattern: Push-to-Talk with `useGlovePTT` (Recommended)

The simplest way to add voice with push-to-talk:

```tsx
import { useGlove, Render } from "glove-react";
import { useGlovePTT, VoicePTTButton } from "glove-react/voice";
import { stt, createTTS } from "@/lib/voice";

function ChatPanel() {
  const glove = useGlove({ endpoint: "/api/chat", tools });
  const ptt = useGlovePTT({
    runnable: glove.runnable,
    voice: { stt, createTTS },
    hotkey: "Space",
  });

  return (
    <>
      <Render
        glove={glove}
        voice={ptt}
        renderInput={() => null}
      />
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={e => setInput(e.target.value)} />
        <VoicePTTButton ptt={ptt}>
          {({ enabled, recording, mode }) => (
            <button className={recording ? "recording" : enabled ? "active" : ""}>
              <MicIcon />
            </button>
          )}
        </VoicePTTButton>
        <button type="submit">Send</button>
      </form>
    </>
  );
}
```

**What `useGlovePTT` handles automatically:**
- Pipeline enable/disable (click toggles, hold records)
- Auto-mute on start (manual mode)
- Unmute on hold, commit + re-mute on release
- Keyboard hotkey (Space by default, ignores INPUT/TEXTAREA/SELECT)
- Click-vs-hold discrimination (300ms threshold)
- Minimum recording duration (350ms)
- Pipeline death detection (auto-resets `enabled`)

---

## Pattern: Voice Integration with `useGloveVoice` (Low-Level)

For full control over the voice pipeline (e.g. VAD mode, custom turn logic), use `useGloveVoice` directly. Both coffee and lola examples use this pattern:

### 1. Token Routes

```typescript
// app/api/voice/stt-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });

// app/api/voice/tts-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });
```

### 2. Client Voice Adapters

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

// SileroVAD — dynamic import for SSR safety
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

### 3. useGloveVoice Hook

```tsx
import { useGlove } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import { stt, createTTS, createSileroVAD } from "@/lib/voice";

function App() {
  const { runnable } = useGlove({ tools, sessionId });

  // Init VAD on mount
  const vadRef = useRef(null);
  const [vadReady, setVadReady] = useState(false);
  useEffect(() => {
    createSileroVAD().then((v) => { vadRef.current = v; setVadReady(true); });
  }, []);

  const voice = useGloveVoice({
    runnable,
    voice: { stt, createTTS, vad: vadReady ? vadRef.current : undefined },
  });

  // voice.mode: "idle" | "listening" | "thinking" | "speaking"
  // voice.start(), voice.stop(), voice.interrupt(), voice.commitTurn()
}
```

---

## Pattern: Voice-First Tools (Lola)

In voice-first apps, all tools use `pushAndForget` (never `pushAndWait`). Tool results return descriptive text for the LLM to narrate:

```typescript
const searchMoviesTool = defineTool({
  name: "search_movies",
  description: "Search for movies by title or keywords",
  inputSchema: z.object({ query: z.string() }),
  displayPropsSchema: z.object({ movies: z.array(z.any()) }),
  displayStrategy: "hide-on-new",
  async do(input, display) {
    const movies = await searchMovies(input.query);
    await display.pushAndForget({ movies });
    return {
      status: "success" as const,
      data: movies.slice(0, 5).map(m =>
        `${m.title} (${m.release_date?.slice(0, 4)}) — ${m.vote_average}/10`
      ).join("; "),
      renderData: { movies },
    };
  },
  render({ props }) {
    return <PosterGrid movies={props.movies} />;
  },
  renderResult({ data }) {
    return <PosterGrid movies={(data as any).movies} />;
  },
});
```

---

## Pattern: Dynamic System Prompt for Voice

Switch between text and voice system prompts based on voice state:

```typescript
const basePrompt = "You are a helpful barista assistant...";

const voiceInstructions = `
Voice mode is active. The user is speaking to you.
- Keep responses under 2 sentences
- Narrate tool results concisely
- Use natural conversational language
- Do not use markdown, lists, or formatting
`;

function App() {
  const voice = useGloveVoice({ runnable, voice: voiceConfig });
  const systemPrompt = voice.isActive ? basePrompt + voiceInstructions : basePrompt;
  const glove = useGlove({ systemPrompt, tools, sessionId });
}
```

---

## Pattern: Thinking Sound

Play an ambient sound while the agent is thinking (between user utterance and agent response):

```typescript
const thinkingAudio = useRef<HTMLAudioElement | null>(null);

useEffect(() => {
  if (voice.mode === "thinking") {
    thinkingAudio.current = new Audio("/thinking.mp3");
    thinkingAudio.current.loop = true;
    thinkingAudio.current.volume = 0.3;
    thinkingAudio.current.play();
  } else {
    thinkingAudio.current?.pause();
    thinkingAudio.current = null;
  }
}, [voice.mode]);
```

---

## Pattern: Barge-in Protection with unAbortable

Full barge-in protection for mutation-critical tools (like checkout) requires **two layers**:

**Layer 1 — Voice barge-in suppression:** GloveVoice checks `displayManager.resolverStore.size > 0` before calling `interrupt()` during `speech_start`. If a `pushAndWait` resolver is pending (the form is open), barge-in is suppressed entirely.

**Layer 2 — Abort signal resistance:** Setting `unAbortable: true` on the tool makes glove-core skip the `abortablePromise` wrapper. Even if `interrupt()` fires (e.g. programmatically), the tool runs to completion.

`pushAndWait` alone only suppresses the voice trigger — it does NOT make the tool survive an abort signal. Only `unAbortable: true` guarantees completion.

```tsx
// Coffee Shop checkout — both layers working together
const checkout = defineTool({
  name: "checkout",
  unAbortable: true,              // Layer 2: survives abort signals
  displayStrategy: "hide-on-complete",
  async do(_input, display) {
    const result = await display.pushAndWait({ items });  // Layer 1: suppresses voice barge-in
    if (!result) return "Cancelled";
    cartOps.clear();              // Safe — tool guaranteed to complete
    return "Order placed!";
  },
});
```

For voice-first apps (like Lola), prefer `pushAndForget` everywhere so barge-in always works naturally.

---

## Pattern: Narrating Display Slots

Use `voice.narrate()` to speak arbitrary text through TTS without involving the model. This is ideal for reading aloud display slot content (e.g., order summaries, confirmation details):

```tsx
const checkout = defineTool({
  name: "checkout",
  unAbortable: true,
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const cart = getCart();

    // Narrate the cart summary before showing the form
    await voice.narrate(
      `Your order has ${cart.length} items totaling ${formatPrice(total)}.`
    );

    const result = await display.pushAndWait({ items: cart });
    if (!result) return "Cancelled";

    // Narrate the confirmation
    await voice.narrate("Order placed! You'll receive a confirmation email shortly.");

    cartOps.clear();
    return "Order placed!";
  },
});
```

**Key points:**
- `narrate()` resolves when all audio finishes playing
- Auto-mutes mic during narration to prevent feedback into STT/VAD
- Creates a fresh TTS adapter per call (same pattern as model turns)
- Safe to call from `pushAndWait` tool handlers — the model is paused waiting for the tool result

---

## Pattern: Mic Mute/Unmute + Audio Visualization

Use `mute()`/`unmute()` to gate mic audio forwarding to STT/VAD. The `audio_chunk` event still fires when muted, enabling waveform visualization:

```tsx
function VoiceControls() {
  const voice = useGloveVoice({ runnable, voice: voiceConfig });
  const [level, setLevel] = useState(0);

  // Visualize audio levels (works even when muted)
  useEffect(() => {
    const gv = voiceRef.current;
    if (!gv) return;
    const handler = (pcm: Int16Array) => {
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      setLevel(Math.sqrt(sum / pcm.length) / 32768);
    };
    gv.on("audio_chunk", handler);
    return () => { gv.off("audio_chunk", handler); };
  }, [voice.isActive]);

  return (
    <div>
      <AudioLevelBar level={level} />
      <button onClick={voice.isMuted ? voice.unmute : voice.mute}>
        {voice.isMuted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
```

**Key points:**
- `audio_chunk` emits raw `Int16Array` PCM from the mic, even when muted
- Muting stops STT transcription and VAD detection without tearing down the capture pipeline
- `isMuted` state is tracked in the React hook for UI binding

---

## Pattern: Compaction Loading Indicator

Use `isCompacting` from `useGlove()` to show feedback during context compaction:

```tsx
function Chat() {
  const { isCompacting, timeline, sendMessage } = useGlove();

  return (
    <div>
      {timeline.map((entry, i) => /* render entries */)}
      {isCompacting && (
        <div className="compaction-indicator">
          Compacting context...
        </div>
      )}
    </div>
  );
}
```

Voice automatically silences TTS during compaction — no action needed on the voice side.

---

## Monorepo Structure

```
glove/
├── packages/
│   ├── glove/          # glove-core — runtime engine
│   ├── glove-sqlite/   # glove-sqlite — SQLite store adapter
│   ├── react/          # glove-react — React bindings (GloveClient, useGlove, MemoryStore)
│   ├── next/           # glove-next — Next.js handler (createChatHandler)
│   ├── glove-voice/    # glove-voice — Voice pipeline (STT/TTS/VAD adapters)
│   └── site/           # Documentation website (glove.dterminal.net)
├── examples/
│   ├── weather-agent/  # Terminal CLI with Ink
│   ├── coding-agent/   # Full-stack with WebSocket server + React SPA
│   ├── nextjs-agent/   # Next.js trip planner
│   ├── coffee/         # Next.js coffee e-commerce + voice
│   └── lola/           # Voice-first movie companion
└── pnpm-workspace.yaml
```

---

## Pattern: Headless agent with one MCP server (env-var bearer token)

Smallest possible MCP-enabled agent. Static catalogue of one entry, in-memory adapter, env-var token. Use when you have a long-lived API key for a single integration.

```ts
import { Glove, Displaymanager, AnthropicAdapter, MemoryStore } from "glove-core";
import {
  mountMcp,
  type McpAdapter,
  type McpCatalogueEntry,
} from "glove-mcp";

const entries: McpCatalogueEntry[] = [
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects, cycles.",
    url: "https://mcp.linear.app/mcp",
  },
];

class EnvAdapter implements McpAdapter {
  identifier: string;
  private active = new Set<string>(["linear"]); // pre-activate at boot
  constructor(id: string) { this.identifier = id; }

  async getActive() { return [...this.active]; }
  async activate(id: string) { this.active.add(id); }
  async deactivate(id: string) { this.active.delete(id); }

  async getAccessToken(id: string) {
    const t = process.env[`${id.toUpperCase()}_TOKEN`];
    if (!t) throw new Error(`No token for "${id}"`);
    return t;
  }
}

const glove = new Glove({
  store: new MemoryStore("convo-1"),
  model: new AnthropicAdapter({ model: "claude-sonnet-4.5", stream: true }),
  displayManager: new Displaymanager(),
  systemPrompt: "Linear assistant. Help triage and update issues.",
  serverMode: true,
  compaction_config: { compaction_instructions: "Summarise." },
});

await mountMcp(glove, { adapter: new EnvAdapter("convo-1"), entries });
glove.build();

await glove.processRequest("List my open Linear issues assigned to me");
```

Linear is pre-activated, so its tools (`linear__list_issues` etc.) are folded at boot and available on the model's first turn — no `discovermcp` round-trip needed.

---

## Pattern: Multi-MCP agent with discovery

When the agent might use many integrations and you don't know which up front. The model calls `glove_invoke_subagent({ name: "discovermcp", prompt: "send an email" })`; the discovery subagent matches the catalogue, activates the right server, folds its tools.

```ts
import { mountMcp, type McpCatalogueEntry } from "glove-mcp";

const entries: McpCatalogueEntry[] = [
  {
    id: "notion", name: "Notion",
    description: "Pages, databases, blocks, comments.",
    url: "https://mcp.notion.com/mcp",
    tags: ["docs", "knowledge-base"],
  },
  {
    id: "gmail", name: "Gmail",
    description: "Search/read emails, labels, drafts.",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    tags: ["email"],
  },
  {
    id: "linear", name: "Linear",
    description: "Issues, projects, cycles.",
    url: "https://mcp.linear.app/mcp",
    tags: ["issues", "tickets"],
  },
];

await mountMcp(glove, {
  adapter,
  entries,
  ambiguityPolicy: { type: "auto-pick-best" }, // serverMode default; explicit for clarity
  clientInfo: { name: "My App", version: "1.0.0" },
});
glove.build();
```

Discovery doesn't pre-activate anything. The agent boots with only `glove_invoke_subagent` (plus your own folded tools). When the user says "draft an email to my team about the Q3 deck", the model calls `glove_invoke_subagent({ name: "discovermcp", prompt: "send an email" })`; the subagent picks `gmail`, calls `adapter.activate("gmail")`, connects, and folds `gmail__create_draft` etc. onto the parent agent. The Executor brackets the call with `subagent_invoked` / `subagent_completed` for any subscribers watching. Next turn the model uses the freshly bridged tools.

---

## Pattern: OAuth token acquisition with `runMcpOAuth`

Run the MCP authorization spec OAuth flow yourself, persist tokens to disk, then have the agent's `getAccessToken` read from the same store. The acquired `access_token` is the bearer string.

`scripts/auth.ts` (one-time per user):

```ts
import { FsOAuthStore, runMcpOAuth } from "glove-mcp/oauth";

// Notion supports DCR — no client_id/secret needed
await runMcpOAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "notion",
  port: 53683,
  clientInfo: { name: "My App", version: "1.0.0" },
});

// Gmail doesn't support DCR — pass pre-registered Cloud Console OAuth client
await runMcpOAuth({
  serverUrl: "https://gmailmcp.googleapis.com/mcp/v1",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "gmail",
  port: 53684,
  preRegisteredClient: {
    client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
    client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
  },
  scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
  // Gmail returns 200 to unauthenticated initialize/listTools — verify with a real call
  verify: { type: "callTool", name: "list_labels" },
});
```

Adapter for the agent:

```ts
import { FsOAuthStore } from "glove-mcp/oauth";
import type { McpAdapter } from "glove-mcp";

const STORE = new FsOAuthStore(".mcp-oauth.json");

class OAuthAdapter implements McpAdapter {
  identifier: string;
  private active = new Set<string>();
  constructor(id: string) { this.identifier = id; }

  async getActive() { return [...this.active]; }
  async activate(id: string) { this.active.add(id); }
  async deactivate(id: string) { this.active.delete(id); }

  async getAccessToken(id: string) {
    const state = await STORE.get(id);
    if (state.tokens?.access_token) return state.tokens.access_token;
    throw new Error(`Run \`pnpm auth-${id}\` to grant access.`);
  }
}
```

---

## Pattern: Handling `auth_expired` and refresh

The framework never refreshes tokens. Bridged tools surface 401s as `{ status: "error", message: "auth_expired", data: null }`. Watch for it in a subscriber and refresh from your app.

```ts
glove.addSubscriber({
  async record(type, data) {
    if (type === "tool_use_result") {
      const r = data.result;
      if (r.status === "error" && r.message === "auth_expired") {
        const id = data.tool_name.split("__")[0];   // "notion" from "notion__search"
        await refreshAndStore(id);                   // your refresh logic
        // Tool result already returned; agent will see auth_expired and decide to retry
        // or surface to user. Optionally inject a system message hinting at retry.
      }
    }
  },
});

async function refreshAndStore(id: string) {
  // For OAuth tokens with a refresh_token: call the OAuth server's token endpoint.
  // For internal integrations / static keys: probably nothing to do — log and notify.
  // After refresh, write the new tokens back to your OAuthStore so the next
  // getAccessToken call picks them up.
}
```

---

## Pattern: Memory schema definition (`glove-memory`)

The schema is shared across every adapter. Define node classes, relationships, episode kinds, and resource roots in one place; pass the same `MemorySchema` instance to all four adapters so the curator's reasoning crosses subsystems consistently.

```ts
import { MemorySchema, InMemoryEntityAdapter, InMemoryEpisodicAdapter, InMemoryResourcesAdapter, InMemoryContextAdapter } from "glove-memory";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],          // multi-set: any matching set folds the write
    searchableProperties: ["name", "email"],
  })
  .defineNodeClass({
    name: "Organization",
    schema: z.object({ name: z.string(), domain: z.string().optional() }),
    identityKeys: [["domain"], ["name"]],
    searchableProperties: ["name"],
  })
  .defineRelationship({ type: "worksAt",   from: "Person", to: "Organization" })
  .defineRelationship({ type: "knows",     from: "Person", to: "Person",
                        propertiesSchema: z.object({ since: z.string().optional() }).optional() })
  .defineEpisodeKind({  name: "meeting",   description: "A scheduled gathering." })
  .defineEpisodeKind({  name: "decision",  description: "A consequential commitment made by a participant." })
  .defineResourceRoot({ path: "/research",    description: "External research artifacts." })
  .defineResourceRoot({ path: "/transcripts", description: "Meeting transcripts." });

// Adapters share the schema so what one writes the next can read.
const entity   = new InMemoryEntityAdapter({   schema });
const episodic = new InMemoryEpisodicAdapter({ schema /*, embedder */ });
const resources = new InMemoryResourcesAdapter({ schema /*, embedder */ });
const context  = new InMemoryContextAdapter({  schema });
```

Adding a new node class, relationship, episode kind, or optional property is always safe at runtime. Adding a *required* property breaks new writes that don't supply it. Renaming or changing identity keys needs a consumer-managed rewrite — the adapter won't notice.

---

## Pattern: Subagent-delegated memory reader (recommended)

The lead architectural recommendation in `glove-memory`: don't attach entity / episodic / resources tools directly to your main Glove. Build subagents — one per retrieval task — and register them on the main agent. Each subagent attaches only the adapter slice it needs; the main agent stays small and routes via `glove_invoke_subagent`. `useContext` is the exception — it stays on the main agent.

```ts
import { Glove, Displaymanager, MemoryStore, createAdapter } from "glove-core";
import {
  useMemoryReader, useEpisodicReader, useResourcesReader, useContext,
} from "glove-memory";

const model = createAdapter({ provider: "anthropic", stream: true });

// `lookup` — answers "who is Don?" / "what do you know about Acme?". Sees only
// the entity graph; doesn't render episode kinds or resource roots.
const lookupFactory = ({ parentStore, parentControls }) =>
  useMemoryReader(
    new Glove({
      store: parentStore,
      model,
      displayManager: parentControls.displayManager,
      systemPrompt:
        "You answer factual questions about people, organizations, and their " +
        "relationships. Use glove_memory_find for fuzzy lookups, glove_memory_get " +
        "for one-hop neighbourhoods, glove_memory_query for deeper traversal.",
      compaction_config: { compaction_instructions: "Summarise lookup runs." },
      serverMode: true,
    }),
    entity,
  );

// `recall` — answers "what did we discuss with Don last week?". Reads episodes;
// reads entity for resolving names to ids.
const recallFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You answer questions about past events. Resolve participant names to ids " +
      "via glove_memory_find first, then use glove_episodic_timeline / " +
      "glove_episodic_find / glove_episodic_search depending on whether the user " +
      "asked about a specific person, a window, or a topic.",
    compaction_config: { compaction_instructions: "Summarise recall runs." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicReader(glove, episodic);
  return glove;
};

// `find-notes` — browses the resource filesystem; reads entity for "notes
// about <person>" lookups.
const findNotesFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You find research notes, transcripts, and link collections in the " +
      "resource filesystem. Use glove_resources_grep / _glob / _search to locate " +
      "files; glove_resources_read to fetch contents. When the user asks for " +
      "notes about a specific person or organization, look up the entity id " +
      "first and use glove_resources_links_for to find everything that links " +
      "to it.",
    compaction_config: { compaction_instructions: "Summarise filesystem runs." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useResourcesReader(glove, resources);
  return glove;
};

// Main agent — keeps useContext for system-prompt injection and the small
// "remember that…" tool surface. Every other memory task is delegated.
const main = useContext(
  new Glove({
    store: new MemoryStore("convo-1"),
    model,
    displayManager: new Displaymanager(),
    systemPrompt:
      "You are an assistant. Route lookups about people / orgs to the lookup " +
      "subagent, recall of past events to the recall subagent, and research " +
      "notes / transcripts to the find-notes subagent. Use the context tools " +
      "when the user says 'remember that…' or asks what you know about them.",
    compaction_config: { compaction_instructions: "Summarise conversation." },
  }),
  context,
)
  .defineSubAgent({ name: "lookup",     description: "Look up people, organizations, and relationships.", factory: lookupFactory })
  .defineSubAgent({ name: "recall",     description: "Recall past meetings, decisions, and events.",      factory: recallFactory })
  .defineSubAgent({ name: "find-notes", description: "Find research notes, transcripts, and links.",       factory: findNotesFactory })
  .build();

// "@lookup who works at Acme?" reaches the model verbatim. The model calls
// glove_invoke_subagent({ name: "lookup", prompt: "who works at Acme?" }).
await main.processRequest("@lookup who works at Acme?");
```

The shape generalises. Any subagent — for any role, not just memory — picks the smallest combination of `use*Reader` / `use*Curator` calls that makes its job possible. Reader-only when it just resolves ids or summaries; curator when it actually needs to mutate; nothing at all when memory isn't relevant.

---

## Pattern: Curator composition

Same advice on the write side. A parent curator that routes to specialised write-side subagents — entity-linker, episode-recorder, resource-filer — beats a single curator with every write tool attached. Each subagent attaches only the adapter slice it needs, so its tool descriptions render only the schema slice for its role.

```ts
import { Glove, Displaymanager } from "glove-core";
import {
  useMemoryReader, useMemoryCurator,
  useEpisodicReader, useEpisodicCurator,
  useResourcesCurator,
} from "glove-memory";

// Sees: node classes, relationships. NOT episode kinds, NOT resource roots.
const linkerFactory = ({ parentStore, parentControls }) =>
  useMemoryCurator(
    new Glove({
      store: parentStore,
      model,
      displayManager: parentControls.displayManager,
      systemPrompt:
        "You extract entities and relationships from the conversation slice you " +
        "receive. Use addNode (which dedups via identity keys) for entities, and " +
        "connect for relationships. If addNode returns identity_ambiguous, merge " +
        "the matched ids first then retry the write.",
      compaction_config: { compaction_instructions: "Summarise linker work." },
      serverMode: true,
    }),
    entity,
  );

// Sees: episode kinds (for writes) + read-only entity classes (to resolve
// participant ids). Does NOT see resource roots.
const recorderFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You record episodes from the conversation slice. Look up participant " +
      "entity ids via glove_memory_find before calling glove_episodic_record. " +
      "Pick a registered kind from the list in the record-tool description.",
    compaction_config: { compaction_instructions: "Summarise recorder work." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicCurator(glove, episodic);
  return glove;
};

// Sees: resource roots + read-only entities and episodes (so metadata.links
// points at real ids). Does NOT see write tools for entity / episodic.
const filerFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You file research notes, transcripts, and link collections under the " +
      "registered resource roots. Use glove_memory_find / glove_episodic_find " +
      "to resolve link target ids before writing, so metadata.links references " +
      "are valid.",
    compaction_config: { compaction_instructions: "Summarise filer work." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicReader(glove, episodic);
  glove = useResourcesCurator(glove, resources);
  return glove;
};

// Parent curator owns no memory tools — it just routes. Each subagent only
// renders the schema slice for its role.
const curator = new Glove({
  store: curatorStore,
  model,
  displayManager: new Displaymanager(),
  systemPrompt:
    "You orchestrate memory extraction from conversation history. Route work to " +
    "your subagents in sequence: linker (entities + relationships), recorder " +
    "(episodes), filer (resources). Each subagent only sees the slice of the " +
    "schema relevant to its role.",
  compaction_config: { compaction_instructions: "Summarise curator runs." },
  serverMode: true,
})
  .defineSubAgent({ name: "linker",   description: "Extract entities and relationships.",          factory: linkerFactory })
  .defineSubAgent({ name: "recorder", description: "Record episodes; resolves participant ids first.", factory: recorderFactory })
  .defineSubAgent({ name: "filer",    description: "File research artifacts; resolves link targets first.", factory: filerFactory })
  .build();
```

Adapters are still shared. The linker's `addNode` becomes immediately visible to the recorder's `find`. Splitting memory across subagents would defeat the point of sequencing them.

---

## Pattern: Context flow ("remember that…")

`useContext` does two things: folds four context tools onto the agent and wraps `processRequest` so each turn calls `adapter.render()` and prepends the rendered markdown block to the system prompt. The user instructs the agent in plain English; the agent calls `glove_context_set`; on the *next* turn the rendered context block shows up in the system prompt automatically.

```ts
import { Glove, Displaymanager, MemoryStore, createAdapter } from "glove-core";
import { MemorySchema, InMemoryContextAdapter, useContext } from "glove-memory";

const schema = new MemorySchema();      // context doesn't need node / episode / resource definitions
const context = new InMemoryContextAdapter({ schema });

const main = useContext(
  new Glove({
    store: new MemoryStore("convo-1"),
    model: createAdapter({ provider: "anthropic", stream: true }),
    displayManager: new Displaymanager(),
    systemPrompt:
      "You are a helpful assistant. When the user says 'remember that…' or " +
      "tells you a preference, call glove_context_set with section: \"preferences\" " +
      "and pinned: true so it lands in your system prompt next turn.",
    compaction_config: { compaction_instructions: "Summarise the conversation." },
  }),
  context,
).build();

// Turn 1 — agent calls glove_context_set({
//   section: "preferences",
//   content: "Prefers tea over coffee. Allergic to peanuts.",
//   pinned: true,
// })
await main.processRequest(
  "Remember that I prefer tea over coffee, and I'm allergic to peanuts."
);

// Turn 2 — useContext re-renders and the rendered block is now part of the
// system prompt the model sees. No extra wiring; render happens every turn.
await main.processRequest("Suggest a snack to go with my drink.");

// You can also list / mutate from outside the agent — useful for a settings UI.
const all = await context.list("preferences");
await context.update(
  all[0].id,
  { content: "Prefers tea over coffee. Allergic to peanuts and tree nuts." },
  { source: "user-settings", actor: "user:don", timestamp: new Date().toISOString() },
);
// Next agent turn picks up the updated render automatically.
```

`useContext` snapshots the developer-supplied system prompt at registration time, then composes `<base>\n\n<rendered>` every turn — pinned context goes **after** developer guardrails so user preferences don't shadow them. Re-rendering happens every turn, so external updates between turns are reflected immediately. Multiple `useContext` calls stack (each captures its then-current base), but most consumers call it once.

---

## Pattern: Glovebox PDF Extractor (`examples/glovebox-pdf-extractor`)

A worked example of wrapping a Glove agent for sandboxed deployment. Lives at `examples/glovebox-pdf-extractor` and runs on the `glovebox/docs:1.2` base (pandoc / qpdf / pdftk-java / ghostscript / libreoffice headless prebuilt). The agent reads PDFs from `/input`, extracts tables / text, and writes results to `/output` — clients hit one WebSocket endpoint and stream events back.

### Wrap module (`glovebox.ts`)

```typescript
import { glovebox, rule, composite } from "glovebox-core"
import { agent } from "./src/agent"     // built IGloveRunnable

export default glovebox.wrap(agent, {
  name: "pdf-extractor",
  base: "glovebox/docs",
  packages: {
    apt: ["poppler-utils"],             // adds pdftotext / pdfimages on top of the docs base
  },
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

The agent itself is a normal Glove build — `defineTool` for `extract_tables`, `extract_text`, `summarize_pdf`, etc. — using `glove-core` with `serverMode: true`. Tools shell out to the system binaries declared in `packages.apt` and the docs base (`pdftotext`, `pdftk`, `pandoc`). Outputs are written to `/output`; the kit picks them up after `processRequest` resolves.

### Build + deploy

```bash
pnpm install
pnpm dlx glovebox build ./glovebox.ts --out ./dist

# Local Docker
docker build -t pdf-extractor ./dist
docker run --rm -p 8080:8080 \
  -e GLOVEBOX_KEY=$(cat ./dist/glovebox.key) \
  -e GLOVEBOX_PUBLIC_URL=http://localhost:8080 \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  pdf-extractor

# Or push ./dist to Railway / Render and let nixpacks.toml drive the build.
```

### Calling it from a Node service

```typescript
import { readFile } from "node:fs/promises"
import { GloveboxClient } from "glovebox-client"

const client = GloveboxClient.make({
  endpoints: {
    pdf: { url: "wss://pdf.example.com/", key: process.env.GLOVEBOX_PDF_KEY! },
  },
})

const pdfBytes = await readFile("./invoice.pdf")
const box = client.box("pdf")

// One-time sanity check: confirm the deployment is the docs base with poppler.
const env = await box.environment()
if (!env.packages.apt?.includes("poppler-utils")) {
  throw new Error("This endpoint isn't the PDF extractor — wrong key/url?")
}

const result = box.prompt("Extract the line-items table from invoice.pdf as CSV.", {
  files: { "invoice.pdf": { mime: "application/pdf", bytes: pdfBytes } },
})

// Stream tool calls + text deltas as they happen.
for await (const event of result.events) {
  if (event.event_type === "tool_use") {
    const d = event.data as { tool_name: string }
    console.log(`→ ${d.tool_name}`)
  }
}

const summary = await result.message
const outputs = await result.outputs
const csv = await result.read("line-items.csv")    // routes via ClientStorage based on FileRef.kind

console.log(summary)
console.log(`Got ${Object.keys(outputs).length} output file(s)`)
```

### S3 outputs for large extracts

If a single extract can exceed the 1MB inline cap and you don't want clients hitting the box's `localServer` for hours, swap the outputs policy to S3 and register the adapter via the `adapters` export:

```typescript
import { S3Storage } from "glovebox-kit"
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

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
  base: "glovebox/docs",
  storage: {
    outputs: composite([
      rule.inline({ below: "256KB" }),
      rule.s3({ bucket: process.env.OUTPUTS_BUCKET!, prefix: "extracts/" }),
    ]),
  },
  env: {
    ANTHROPIC_API_KEY: { required: true, secret: true },
    OUTPUTS_BUCKET:    { required: true },
    AWS_REGION:        { required: true, default: "us-east-1" },
  },
})
```

The build CLI's synthetic entry awaits `adapters()` and forwards the result into `startGlovebox({ adapters })`, where it gets merged into the registry by name. `validateOutputsPolicy` checks every effective policy at boot — if `OUTPUTS_BUCKET` is unset the container fails fast instead of failing the first extract.

The exact tool definitions for this example live in the repo at `examples/glovebox-pdf-extractor/src/` — see that directory for the agent code, system prompt, and shell helpers that drive `pdftotext` / `pdftk`.

For long-running agents, a separate background task that proactively refreshes tokens before `expires_in` hits zero is usually cleaner — the agent never sees `auth_expired` in the happy path.

## Pattern: Continuum runtime with two warm agents talking via filesystem-backed mesh

Spins up a `ContinuumRunner` with two `.concurrent()` agents. Both mount `glove-mesh` against a shared filesystem network so each agent runs in its own subprocess but can still send each other messages without an external broker. Mirrors the package's own `tests/agent-to-agent-mesh.test.ts`.

```typescript
// agents/mesh-pair.ts — fixture both subprocesses load
import { join } from "node:path";
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { mountMesh } from "glove-mesh";
import { agent, z } from "glove-continuum-signal";
import { FilesystemMeshAdapter } from "./fs-mesh-adapter.js"; // see package tests/fixtures/

function meshRoot(): string {
  const r = process.env.MESH_ROOT;
  if (!r) throw new Error("MESH_ROOT env var not set");
  return r;
}

function inboxCapableStore(name: string) {
  // MemoryStore from glove-core already implements all four inbox methods.
  // For persistence across runner restarts, swap for an inbox-capable
  // file/SQLite-backed StoreAdapter.
  return new MemoryStore(`mesh-${name}`);
}

export const meshSender = agent("mesh-sender")
  .input(z.object({ to: z.string(), content: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store(inboxCapableStore)
  .factory(async (ctx) => {
    const glove = new Glove({
      store: ctx.store ?? undefined,
      model: createMyModelThatCallsMeshSend(), // e.g. real LLM or a test SendingModel
      displayManager: new Displaymanager(),
      systemPrompt:
        "On every prompt, call glove_mesh_send_message with {to, content} parsed from the user input.",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);

    await mountMesh(glove, {
      adapter: new FilesystemMeshAdapter({ root: meshRoot(), agentId: ctx.name }),
      identity: { id: ctx.name, name: ctx.name, description: "Sends." },
    });
    return glove;
  });

export const meshReceiver = agent("mesh-receiver")
  .input(z.object({ noop: z.string() }))
  .concurrent()
  .timeout(15_000)
  .store(inboxCapableStore)
  .factory(async (ctx) => {
    const glove = new Glove({
      store: ctx.store ?? undefined,
      model: createMyEchoModel(),
      displayManager: new Displaymanager(),
      systemPrompt: "mesh-receiver",
      compaction_config: { compaction_instructions: "n/a" },
    }).build(ctx.store ?? undefined);

    await mountMesh(glove, {
      adapter: new FilesystemMeshAdapter({ root: meshRoot(), agentId: ctx.name }),
      identity: { id: ctx.name, name: ctx.name, description: "Receives." },
    });
    return glove;
  });
```

```typescript
// runner.ts — entry point
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ContinuumRunner, ConsoleSubscriber } from "glove-continuum-signal";
import { meshSender, meshReceiver } from "./agents/mesh-pair.js";

process.env.MESH_ROOT = mkdtempSync(`${tmpdir()}/my-mesh-`);

const runner = new ContinuumRunner({
  subscribers: [new ConsoleSubscriber()],
  pollIntervalMs: 50,
});
runner.registerAgent(meshSender, new URL("./agents/mesh-pair.ts", import.meta.url).pathname);
runner.registerAgent(meshReceiver, new URL("./agents/mesh-pair.ts", import.meta.url).pathname);

await runner.start();

// Both warm subprocesses spawn and mount mesh against the shared MESH_ROOT.
// Send a message: notify the sender, its model emits a glove_mesh_send_message
// tool call, the executor runs the mesh tool, the FilesystemMeshAdapter writes
// to <MESH_ROOT>/inbox/mesh-receiver/<msgId>.json, and the receiver's polling
// subscribe handler picks it up and writes to its inbox via mountMesh.
const runId = await runner.notify("mesh-sender", {
  to: "mesh-receiver",
  content: "hello peer",
});
await runner.waitForRun(runId);

// Inspect the receiver's store to confirm delivery.
const receiverInbox = await runner.getAdapter(); // adapter holds the Run records, not the agent stores
// (For inbox inspection, either back the receiver's store on disk and read the file,
// or expose a read-only HTTP endpoint from inside the receiver agent.)

await runner.stop({ graceful: true, timeoutMs: 5_000 });
```

What's happening end-to-end:

1. `runner.notify("mesh-sender", input)` writes a `kind: "notify"` Run to the runner's adapter.
2. The tick loop routes the run to `mesh-sender`'s warm subprocess via IPC.
3. The bootstrap's notify chain calls `glove.processRequest('{"to":"mesh-receiver","content":"hello peer"}')`.
4. The sender's model returns a `glove_mesh_send_message` tool call.
5. The executor runs the tool, which calls `FilesystemMeshAdapter.send(...)`.
6. The adapter writes `<MESH_ROOT>/inbox/mesh-receiver/<msgId>.json` atomically (tmp + rename).
7. The receiver's subprocess polls its inbox directory (~100ms) and reads the new file.
8. `mountMesh`'s subscribe handler runs in the receiver subprocess, dropping a resolved `InboxItem` into the receiver's store.
9. Bootstrap sends `notify:completed` IPC; runner marks the sender's run completed.

Two separate subprocesses, no shared memory, mesh as the only transport. For cross-machine deployments, swap `FilesystemMeshAdapter` for one backed by Redis pub/sub or NATS — the contract (`MeshAdapter`) is identical, the rest of the stack doesn't change.

The `FilesystemMeshAdapter` source lives at `packages/glove-continuum-signal/tests/fixtures/fs-mesh-adapter.ts` — copy it into your own codebase as a starting point for a production adapter (it's deliberately tests-only in the package itself: no retention/compaction, single-writer assumption per `(root, agentId)`).
