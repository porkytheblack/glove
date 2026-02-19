# Glove Example Patterns

Real patterns drawn from the example implementations in `examples/`.

## Example Overview

| Example | Type | Stack | Key Patterns |
|---------|------|-------|-------------|
| `examples/weather-agent` | Terminal CLI | Ink + glove-core | Local MemoryStore, AnthropicAdapter, pushAndWait for input, pushAndForget for display |
| `examples/coding-agent` | Full-stack | Node server + React SPA | SqliteStore, WebSocket bridge, 14 tools, permission system, planning workflow |
| `examples/nextjs-agent` | Web app | Next.js + glove-react | `defineTool`, `<Render>`, `renderResult`, `displayStrategy`, trip planning |
| `examples/coffee` | Web app | Next.js + glove-react | `defineTool`, `<Render>`, `renderResult`, `displayStrategy`, e-commerce flow, cart state |

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
import { Glove, SqliteStore, Displaymanager, createAdapter } from "glove-core";

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

---

## Pattern: Terminal UI with Ink (weather-agent)

```tsx
import {
  type StoreAdapter,
  type SubscriberAdapter,
  Displaymanager,
  AnthropicAdapter,
  Glove,
} from "glove-core";
import { render, Text, Box } from "ink";

// weather-agent defines MemoryStore locally (not imported from glove-react)
class MemoryStore implements StoreAdapter { /* ... */ }

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
- When recommending, explain briefly WHY these products match their preferences`;
```

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

## Monorepo Structure

```
glove/
├── packages/
│   ├── glove/          # glove-core — runtime engine
│   ├── react/          # glove-react — React bindings (GloveClient, useGlove, MemoryStore)
│   ├── next/           # glove-next — Next.js handler (createChatHandler)
│   └── site/           # Documentation website (glove.dterminal.net)
├── examples/
│   ├── weather-agent/  # Terminal CLI with Ink
│   ├── coding-agent/   # Full-stack with WebSocket server + React SPA
│   ├── nextjs-agent/   # Next.js trip planner
│   └── coffee/         # Next.js coffee e-commerce
└── pnpm-workspace.yaml
```
