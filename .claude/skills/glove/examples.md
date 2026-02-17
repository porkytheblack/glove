# Glove Example Patterns

Real patterns drawn from the example implementations in `examples/`.

## Example Overview

| Example | Type | Stack | Key Patterns |
|---------|------|-------|-------------|
| `examples/weather-agent` | Terminal CLI | Ink + glove-core | Local MemoryStore, AnthropicAdapter, pushAndWait for input, pushAndForget for display |
| `examples/coding-agent` | Full-stack | Node server + React SPA | SqliteStore, WebSocket bridge, 14 tools, permission system, planning workflow |
| `examples/nextjs-agent` | Web app | Next.js + glove-react | GloveClient, createChatHandler, colocated renderers, trip planning |
| `examples/coffee` | Web app | Next.js + glove-react | E-commerce flow, cart state, product catalog, checkout |

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

**Client — GloveClient with tools:**
```typescript
// app/lib/glove.tsx
import { GloveClient } from "glove-react";
import { z } from "zod";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant...",
  tools: [
    {
      name: "ask_preference",
      description: "Ask user to pick from options",
      inputSchema: z.object({
        question: z.string(),
        options: z.array(z.object({ label: z.string(), value: z.string() })),
      }),
      async do(input, display) {
        return await display.pushAndWait({ input });
      },
      render({ data, resolve }) {
        const { question, options } = data as any;
        return (
          <div>
            <p>{question}</p>
            {options.map((opt: any) => (
              <button key={opt.value} onClick={() => resolve(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
        );
      },
    },
  ],
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

## Pattern: Colocated Renderers with pushAndWait + pushAndForget

From the coffee example — a tool that shows products AND waits for selection:

```tsx
const showProducts: ToolConfig = {
  name: "show_products",
  description: "Display product cards for browsing",
  inputSchema: z.object({
    product_ids: z.array(z.string()),
    prompt: z.string().optional(),
  }),
  async do(input, display) {
    const products = getProducts(input.product_ids);
    // Blocks until user picks a product or action
    return await display.pushAndWait({ input: { products, prompt: input.prompt } });
  },
  render({ data, resolve }) {
    const { products, prompt } = data as any;
    return (
      <div>
        {prompt && <p>{prompt}</p>}
        <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
          {products.map((p: any) => (
            <div key={p.id} style={{ border: "1px solid #333", padding: 12, borderRadius: 8 }}>
              <h4>{p.name}</h4>
              <p>{p.origin} — ${p.price}</p>
              <button onClick={() => resolve({ productId: p.id, action: "select" })}>
                Select
              </button>
              <button onClick={() => resolve({ productId: p.id, action: "add" })}>
                Add to bag
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  },
};
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
