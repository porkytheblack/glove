# Glove

**An agentic runtime for building applications as conversations.**

Glove is a TypeScript SDK that lets developers build entire applications on top of a single chat interface. Instead of pages, routes, and navigation flows, developers define tools (what the app can do) and renderers (what the app can show), and an AI agent handles the orchestration between them.

---

## The Idea

Every application is, at its core, a loop: the user expresses intent, the system acts on it, and shows the result. Traditional apps encode this loop in UI — buttons, forms, navigation hierarchies, page transitions. The developer has to anticipate every possible path a user might take and wire it all together.

Glove replaces that wiring with an agent. The user says what they want in natural language. The agent figures out what tools to call, what information to collect, and what to show. The developer's job shifts from building flows to building capabilities.

Think of a complex application like an e-commerce platform. The traditional version has hundreds of pages, search interfaces, checkout flows, account management screens, order tracking dashboards. The Glove version has tools (`search_products`, `add_to_cart`, `checkout`, `track_order`) and renderers (product grid, cart summary, payment form, order status). The agent connects them based on what the user asks for.

---

## Architecture

Glove has five core components:

### The Agentic Loop

The `Agent` class runs the core cycle: take a user message, prompt the model, execute any tool calls, feed results back, repeat until the model responds with text. This is the engine. It handles turn counting, abort signals, and auto-completion of in-progress tasks.

### The Prompt Machine

Wraps the model adapter. Manages system prompts, dispatches requests, and notifies subscribers of events. The model itself is swappable — any provider that implements the `ModelAdapter` interface works.

### The Executor

Runs tools. Validates inputs against Zod schemas, handles retries via Effect, manages permissions through a human-in-the-loop flow, and reports results back to the agent loop. Tools are registered at build time and are the primary way developers define what the application can do.

### The Observer

Watches the session. Tracks turn counts, token consumption, and triggers context compaction when the conversation gets too long. Compaction summarises the conversation history and appends the summary as a new message marked with `is_compaction: true`. The store preserves the full message history — compaction calls `resetCounters()` to reset token and turn counts rather than deleting messages. `Context.getMessages()` splits at the last compaction so the model only sees recent context, while the full history remains available for frontend display.

### The Display Manager

A headless state machine that manages what the user sees. Tools push UI slots onto a display stack. Each slot names a renderer and provides input data. The display manager doesn't render anything — it manages the stack lifecycle and notifies listeners when the stack changes.

This is the critical piece that separates Glove from other agent frameworks. The display manager is what makes Glove an application runtime, not just a chatbot backend.

---

## The Display Stack

When an agent uses a tool, that tool can push a slot onto the display stack in two ways:

- **`pushAndForget`** — fire and forget. Push a product grid, a status card, a chart. The tool doesn't wait for a response.
- **`pushAndWait`** — push and block. Push a form, a confirmation dialog, a permission request. The tool's execution pauses until the UI resolves the slot with a value.

This maps directly to application UI patterns:

| Traditional App | Glove Equivalent |
|---|---|
| Page navigation | Agent selects tools based on intent |
| Form submission | `pushAndWait` with a form renderer |
| Displaying data | `pushAndForget` with a data renderer |
| Confirmation dialog | `pushAndWait` with a confirmation renderer |
| Loading state | Slot on stack, not yet resolved |

The display manager is framework-agnostic. It exposes a `subscribe` method that any frontend framework can bind to. React, Vue, Svelte, web components, or a terminal UI — the integration is a few lines that map renderer names to components and wire up the resolve/reject callbacks.

Renderers are registered with input and output Zod schemas. The schemas aren't for rendering — they're the contract between tools and the UI layer, validated at runtime. A tool knows what shape of data to push, and the display manager ensures the UI returns the right shape back.

---

## Building with Glove

The developer-facing API is a builder:

```typescript
const app = new Glove({
  store: myStore,
  model: myModel,
  displayManager: new DisplayManager(),
  systemPrompt: "You are a shopping assistant...",
  compaction_config: {
    compaction_instructions: "Summarise the conversation so far...",
  },
})
  .fold({
    name: "search_products",
    description: "Search the product catalog",
    inputSchema: z.object({ query: z.string() }),
    do: async (input, display) => {
      const results = await catalog.search(input.query);
      await display.pushAndForget({ renderer: "product_grid", input: results });
      return results;
    },
  })
  .fold({
    name: "checkout",
    description: "Start the checkout process",
    inputSchema: z.object({ cartId: z.string() }),
    do: async (input, display) => {
      const cart = await carts.get(input.cartId);
      const payment = await display.pushAndWait({
        renderer: "payment_form",
        input: cart,
      });
      return await orders.create(cart, payment);
    },
  })
  .build();
```

`fold` is the tool registration method. Each fold defines a capability: a name and description (so the model knows when to use it), an input schema, and a `do` function that receives the validated input and a reference to the display manager. The display manager reference is how tools push UI.

The `build` call finalises the configuration. After that, the app processes requests:

```typescript
const result = await app.processRequest("find me running shoes under 100");
```

The agent takes it from there.

---

## Adapters

Glove is built on adapters — interfaces that decouple the runtime from specific implementations.

**`ModelAdapter`** — the AI provider. Wraps any LLM API. Implements `prompt()` which takes messages and tools, returns response messages and token counts. Swap between Anthropic, OpenAI, local models, or mock adapters for testing.

**`StoreAdapter`** — the persistence layer. Holds conversation messages, token counts, turn counts. Optionally supports tasks (for progress tracking) and permissions (for human-in-the-loop approval flows). Can be in-memory, backed by a database, or anything else.

**`DisplayManagerAdapter`** — the UI state layer. Manages the display stack, renderer registry, slot lifecycle, and listener notifications. The default `DisplayManager` class is an in-memory implementation. A distributed version could synchronise state across clients.

**`SubscriberAdapter`** — the event bus. Records events emitted by the prompt machine and executor (tool results, model responses, etc). Plug in logging, analytics, debugging tools, or real-time streaming.

---

## Human-in-the-Loop

Glove has first-class support for human-in-the-loop patterns through two mechanisms:

**Permissions** — tools can be marked as `requiresPermission`. When the executor encounters a permission-gated tool, it checks the store. If the permission is unset, it uses the hand-over function to push a permission request to the display manager, which blocks until the user grants or denies. The decision is persisted so the user isn't asked again.

**Hand-over** — the general-purpose escape hatch. Any tool can delegate to the user by calling its `handOver` function, which pushes a slot to the display manager and waits. This is how tools collect information, confirm destructive actions, or request input that the agent can't determine on its own.

Both mechanisms work through `pushAndWait` — the tool's execution suspends until the UI resolves the slot.

---

## Context Compaction

Long-running sessions accumulate tokens. The `Observer` watches token consumption and, when it crosses a configurable threshold, triggers compaction: the full conversation history is sent to the model with a summarisation prompt, and the summary is appended as a new message marked with `is_compaction: true`. The store calls `resetCounters()` to reset token and turn counts — the full message history is never deleted. `Context.getMessages()` splits at the last compaction boundary so the model only sees messages from the most recent compaction onward. Task state is preserved across compaction boundaries.

This means sessions can run indefinitely without degrading. The agent always has a clean, focused context window, and the frontend can read the complete conversation history directly from the store.

---

## What Glove Is Not

**Not a chatbot builder.** Glove doesn't provide conversation flows, decision trees, or dialog management. The agent decides what to do based on the model's reasoning, not a predefined graph.

**Not a UI framework.** Glove doesn't render anything. It manages state that a UI framework consumes. The rendering layer is entirely the developer's responsibility.

**Not an agent framework for pipelines.** Glove is designed for interactive, user-facing applications where a human is in the loop. It's not optimised for batch processing, background pipelines, or autonomous multi-step workflows that don't involve a user.

---

## Trade-offs

**Latency.** Every interaction round-trips through an LLM. Actions that currently take 50ms will take 1–2 seconds. For complex workflows and enterprise tools this is acceptable. For high-frequency, real-time interactions it's a problem. The escape hatch is renderer-initiated actions — deterministic operations that bypass the agent and call tools directly.

**Determinism.** "Add to cart" on a button always adds to cart. "Add that to my cart" spoken to an agent probably adds to cart. The gap between always and probably is real. Critical paths need deterministic fallbacks.

**Cost.** Every turn consumes tokens. Long sessions with many tool calls add up. Compaction helps with context window limits but doesn't reduce the cumulative cost of a session. Developers need to be mindful of tool design — fewer, more capable tools mean fewer round-trips.

---

## Where It Fits

Glove sits at the runtime layer. It's not the application and it's not the UI — it's the machinery in between. Developers define capabilities and components. Glove runs the agent loop that connects them.

The closest comparison is the Anthropic Agent SDK or Vercel's AI SDK, but with a critical addition: the display stack. Without the display manager, Glove would be another agent framework. With it, Glove is an application runtime — the foundation for building interactive software where the primary interface is a conversation.

---

*Glove is part of [dterminal](https://dterminal.dev) — tools for developers who build with AI.*
