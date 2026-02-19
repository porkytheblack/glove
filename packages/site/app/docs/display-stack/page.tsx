import { CodeBlock } from "@/components/code-block";

export default async function DisplayStackPage() {
  return (
    <div className="docs-content">
      <h1>The Display Stack</h1>

      <p>
        In <a href="/docs/getting-started">Getting Started</a> you built a
        weather tool that returns data to the AI, and the AI formats it as text.
        That works, but real applications need real UI — confirmation dialogs,
        data cards, forms, preference pickers.
      </p>

      <p>
        The display stack is how tools show UI to the user. Instead of
        returning raw data to the AI, a tool can push a React component onto a
        stack that your app renders. This guide walks through how to use it.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>How it works</h2>

      <p>
        Every tool&apos;s <code>do</code> function receives two arguments: the
        validated <code>input</code> and a <code>display</code> object. The
        display object has two methods:
      </p>

      <ul>
        <li>
          <code>display.pushAndForget({"{ input }"})</code> — push a component
          and <strong>keep the tool running</strong>. The tool returns normally.
          Use this for showing results — data cards, product grids, status
          updates.
        </li>
        <li>
          <code>display.pushAndWait({"{ input }"})</code> — push a component
          and <strong>pause the tool</strong> until the user responds. The
          tool&apos;s execution is suspended. Use this for collecting input —
          forms, confirmations, choices.
        </li>
      </ul>

      <p>
        Think of it this way: <code>pushAndForget</code> is like printing a
        receipt — here&apos;s your result. <code>pushAndWait</code> is like
        handing someone a clipboard — fill this out and give it back.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Adding a renderer to a tool</h2>

      <p>
        In <code>glove-react</code>, tools can define their UI inline with a{" "}
        <code>render</code> function. The tool definition and its component live
        together — no separate files, no string-based lookups.
      </p>

      <p>
        Here is the weather tool from Getting Started, upgraded with a
        display card:
      </p>

      <CodeBlock
        filename="lib/tools/weather.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig } from "glove-react";

export const weatherTool: ToolConfig = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  inputSchema: z.object({
    city: z.string().describe("The city to get weather for"),
  }),

  // The tool logic — calls your API and pushes a card
  async do(input, display) {
    const weather = await fetchWeather(input.city);

    // Show a weather card — tool keeps running
    await display.pushAndForget({ input: weather });

    return weather;
  },

  // The React component that renders the card
  render({ data }) {
    const { city, temperature, condition } = data as {
      city: string;
      temperature: string;
      condition: string;
    };
    return (
      <div style={{ padding: 16, border: "1px solid #333", borderRadius: 8 }}>
        <h3>{city}</h3>
        <p>{temperature} — {condition}</p>
      </div>
    );
  },
};`}
      />

      <p>
        When the AI calls <code>get_weather</code>, the <code>do</code>{" "}
        function runs, pushes the weather data onto the display stack, and the{" "}
        <code>render</code> function turns it into a card in your UI.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Using defineTool (recommended)</h2>

      <p>
        <code>defineTool</code> from <code>glove-react</code> is the
        recommended way to create tools with display UI. It provides type
        safety for display props and resolve values. Here is the same weather
        tool rewritten with <code>defineTool</code>:
      </p>

      <CodeBlock
        filename="lib/tools/weather.tsx"
        language="tsx"
        code={`import { defineTool } from "glove-react";
import { z } from "zod";

const inputSchema = z.object({
  city: z.string().describe("The city to get weather for"),
});

export const weatherTool = defineTool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  inputSchema,
  displayPropsSchema: z.object({
    city: z.string(),
    temperature: z.string(),
    condition: z.string(),
  }),
  displayStrategy: "stay", // Card stays visible (default)
  async do(input, display) {
    const weather = await fetchWeather(input.city);
    await display.pushAndForget(weather); // typed!
    return {
      status: "success" as const,
      data: weather,
      renderData: weather, // client-only, for renderResult
    };
  },
  render({ props }) {
    return (
      <div style={{ padding: 16, border: "1px solid #333", borderRadius: 8 }}>
        <h3>{props.city}</h3>
        <p>{props.temperature} — {props.condition}</p>
      </div>
    );
  },
  renderResult({ data }) {
    const { city, temperature, condition } = data as {
      city: string; temperature: string; condition: string;
    };
    return (
      <div style={{ padding: 16, border: "1px solid #333", borderRadius: 8 }}>
        <h3>{city}</h3>
        <p>{temperature} — {condition}</p>
      </div>
    );
  },
});`}
      />

      <p>
        The <code>defineTool</code> version provides typed{" "}
        <code>props</code> in <code>render()</code>, typed{" "}
        <code>resolve</code> in <code>render()</code> for pushAndWait tools,
        and typed <code>display.pushAndWait()</code> /{" "}
        <code>display.pushAndForget()</code>. See the{" "}
        <a href="/docs/react#define-tool">React API reference</a> for full
        details.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Rendering slots in your app</h2>

      <p>
        The <a href="/docs/react#useglove">useGlove</a> hook exposes{" "}
        <code>slots</code> (the current stack) and <code>renderSlot()</code>{" "}
        (renders a slot using the tool&apos;s <code>render</code> function).
        Add them to your chat component:
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useState } from "react";
import { useGlove } from "glove-react";

export default function Chat() {
  const {
    timeline,
    streamingText,
    busy,
    sendMessage,
    slots,       // Active display stack entries
    renderSlot,  // Renders a slot using its tool's render function
  } = useGlove();
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage(input.trim());
    setInput("");
  }

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto" }}>
      {/* Conversation timeline */}
      <div>
        {timeline.map((entry, i) => {
          if (entry.kind === "user") return <div key={i}><strong>You:</strong> {entry.text}</div>;
          if (entry.kind === "agent_text") return <div key={i}><strong>Assistant:</strong> {entry.text}</div>;
          return null;
        })}
      </div>

      {streamingText && <div style={{ opacity: 0.7 }}><strong>Assistant:</strong> {streamingText}</div>}

      {/* Display stack — render all active slots */}
      {slots.length > 0 && (
        <div style={{ margin: "1rem 0", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {slots.map(renderSlot)}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          disabled={busy}
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}`}
      />

      <p>
        That&apos;s all the wiring you need. Every tool with a{" "}
        <code>render</code> function will now show its UI automatically when the
        AI calls it.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Using the &lt;Render&gt; component</h2>

      <p>
        <code>&lt;Render&gt;</code> is a headless component that replaces
        manual <code>timeline.map()</code> / <code>slots.map(renderSlot)</code>{" "}
        rendering:
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`import { useGlove, Render } from "glove-react";

export default function Chat() {
  const glove = useGlove();

  return (
    <Render
      glove={glove}
      strategy="interleaved"
      renderMessage={({ entry }) => (
        <div>
          <strong>{entry.kind === "user" ? "You" : "Assistant"}:</strong> {entry.text}
        </div>
      )}
      renderStreaming={({ text }) => (
        <div style={{ opacity: 0.7 }}><strong>Assistant:</strong> {text}</div>
      )}
    />
  );
}`}
      />

      <p>
        <code>&lt;Render&gt;</code> automatically handles slot visibility based
        on <code>displayStrategy</code>, renders{" "}
        <code>renderResult</code> for completed tools, and interleaves slots
        inline next to their tool call. See the{" "}
        <a href="/docs/react#render-component">React API reference</a> for all
        props.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>pushAndWait — collecting user input</h2>

      <p>
        <code>pushAndWait</code> is the more powerful pattern. It pauses the
        tool until the user responds. The tool&apos;s <code>do</code> function
        literally <code>await</code>s the user&apos;s answer.
      </p>

      <p>
        Here is a confirmation tool. The AI calls it before taking a
        destructive action, and the tool waits for the user to click Confirm or
        Cancel:
      </p>

      <CodeBlock
        filename="lib/tools/confirm.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const confirmAction: ToolConfig = {
  name: "confirm_action",
  description:
    "Ask the user to confirm before proceeding. " +
    "Blocks until the user confirms or cancels.",
  inputSchema: z.object({
    title: z.string().describe("What you are asking confirmation for"),
    message: z.string().describe("Details about the action"),
  }),

  async do(input, display) {
    // This line PAUSES until the user clicks a button
    const confirmed = await display.pushAndWait({ input });

    // Execution resumes here after the user responds
    return confirmed
      ? "User confirmed the action."
      : "User cancelled the action.";
  },

  render({ data, resolve }: SlotRenderProps) {
    const { title, message } = data as { title: string; message: string };
    return (
      <div style={{ padding: 16, border: "1px dashed #f59e0b", borderRadius: 12 }}>
        <p style={{ fontWeight: 600 }}>{title}</p>
        <p style={{ color: "#888", marginBottom: 12 }}>{message}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => resolve(true)}>Confirm</button>
          <button onClick={() => resolve(false)}>Cancel</button>
        </div>
      </div>
    );
  },
};`}
      />

      <p>The flow is:</p>

      <ol>
        <li>
          The AI decides an action needs confirmation and calls{" "}
          <code>confirm_action</code>
        </li>
        <li>
          The <code>do</code> function runs and hits{" "}
          <code>display.pushAndWait</code> — the tool pauses
        </li>
        <li>
          The <code>render</code> function shows a dialog with two buttons
        </li>
        <li>
          The user clicks Confirm — <code>resolve(true)</code> is called
        </li>
        <li>
          The <code>do</code> function resumes with{" "}
          <code>confirmed = true</code> and returns the result to the AI
        </li>
        <li>
          The AI reads the result and continues (e.g., executes the action)
        </li>
      </ol>

      {/* ------------------------------------------------------------------ */}
      <h2>pushAndForget — displaying results</h2>

      <p>
        <code>pushAndForget</code> is simpler. It pushes UI onto the stack and
        the tool keeps running. Use it when you want to show something to the
        user without pausing.
      </p>

      <CodeBlock
        filename="lib/tools/show-results.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const searchProducts: ToolConfig = {
  name: "search_products",
  description: "Search the product catalog and display results.",
  inputSchema: z.object({
    query: z.string().describe("What to search for"),
  }),

  async do(input, display) {
    const results = await catalog.search(input.query);

    // Show results — tool does NOT pause
    await display.pushAndForget({ input: results });

    // Tool returns immediately, AI gets the data too
    return results;
  },

  render({ data }: SlotRenderProps) {
    const products = data as { name: string; price: number }[];
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {products.map((p, i) => (
          <div key={i} style={{ padding: 12, border: "1px solid #333", borderRadius: 8 }}>
            <strong>{p.name}</strong> — \${p.price}
          </div>
        ))}
      </div>
    );
  },
};`}
      />

      <p>
        The product grid appears in the UI while the AI simultaneously receives
        the raw data and can reference it in its response.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Combining both patterns</h2>

      <p>
        A single tool can use both <code>pushAndForget</code> and{" "}
        <code>pushAndWait</code>. For example, a checkout tool might display a
        cart summary (fire-and-forget) and then show a payment form (wait for
        input):
      </p>

      <CodeBlock
        filename="lib/tools/checkout.tsx"
        language="tsx"
        code={`async do(input, display) {
  const cart = await getCart(input.cartId);

  // Show the cart summary — don't wait
  await display.pushAndForget({ input: cart });

  // Show a payment form — wait for the user to submit
  const paymentDetails = await display.pushAndWait({
    input: { total: cart.total },
  });

  // Both pushes happened, user submitted payment — create the order
  return await createOrder(cart, paymentDetails);
},`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Registering your tools</h2>

      <p>
        Tools with renderers are registered the same way as plain tools — pass
        them in the <code>tools</code> array of your{" "}
        <a href="/docs/react#glove-client">GloveClient</a>:
      </p>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`import { GloveClient } from "glove-react";
import { weatherTool } from "./tools/weather";
import { confirmAction } from "./tools/confirm";
import { searchProducts } from "./tools/show-results";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful shopping assistant.",
  tools: [weatherTool, confirmAction, searchProducts],
});`}
      />

      <p>
        The framework automatically builds a renderer map from each tool&apos;s{" "}
        <code>name</code> and <code>render</code> function. No separate
        registry step is needed.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Using pre-built tools from the registry</h2>

      <p>
        The <a href="/tools">Tool Registry</a> has pre-built tools with
        renderers that you can copy into your project. Each tool includes the
        full <code>ToolConfig</code> with <code>do</code> and{" "}
        <code>render</code> already wired together.
      </p>

      <p>For example, to use the confirmation dialog:</p>

      <ol>
        <li>
          Go to{" "}
          <a href="/tools/confirm-action">confirm_action</a> in the registry
        </li>
        <li>Copy the source code into your project</li>
        <li>
          Import it and add it to your <code>tools</code> array
        </li>
      </ol>

      <p>
        Available tools include{" "}
        <a href="/tools/confirm-action">confirm_action</a>,{" "}
        <a href="/tools/collect-form">collect_form</a>,{" "}
        <a href="/tools/ask-preference">ask_preference</a>,{" "}
        <a href="/tools/text-input">text_input</a>,{" "}
        <a href="/tools/show-info-card">show_info_card</a>,{" "}
        <a href="/tools/suggest-options">suggest_options</a>, and{" "}
        <a href="/tools/approve-plan">approve_plan</a>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The render function in detail</h2>

      <p>
        The <code>render</code> function receives a{" "}
        <a href="/docs/react#slot-render-props">SlotRenderProps</a> object with
        three properties:
      </p>

      <ul>
        <li>
          <code>data</code> — the input that was passed to{" "}
          <code>pushAndWait</code> or <code>pushAndForget</code>. This is how
          you pass data from the tool&apos;s logic to its UI.
        </li>
        <li>
          <code>resolve</code> — a function that resolves the slot. For{" "}
          <code>pushAndWait</code> slots, the value you pass to{" "}
          <code>resolve()</code> becomes the return value in the{" "}
          <code>do</code> function. For <code>pushAndForget</code> slots,
          calling <code>resolve()</code> removes the slot from the stack.
        </li>
        <li>
          <code>reject</code> — a function that rejects the slot. For{" "}
          <code>pushAndWait</code> slots, this causes the promise in the{" "}
          <code>do</code> function to reject. Use this for cancellation flows.
        </li>
      </ul>

      <p>
        The render function is a regular React component. You can use hooks,
        state, effects — anything you normally use in React.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>When to use which pattern</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Use when</th>
            <th>Examples</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>pushAndForget</code></td>
            <td>You want to show something, tool doesn&apos;t need to wait</td>
            <td>Search results, data cards, charts, status updates, notifications</td>
          </tr>
          <tr>
            <td><code>pushAndWait</code></td>
            <td>You need user input before the tool can continue</td>
            <td>Confirmations, forms, preference pickers, payment flows, approval dialogs</td>
          </tr>
          <tr>
            <td>No display</td>
            <td>The tool just computes or fetches data</td>
            <td>API calls, calculations, database queries that the AI summarizes</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Display Strategies</h2>

      <p>
        Tools can control when their display slots are visible using{" "}
        <code>displayStrategy</code>:
      </p>

      <ul>
        <li>
          <code>&quot;stay&quot;</code> (default) — Slot is always visible.
          Use for persistent info cards and results.
        </li>
        <li>
          <code>&quot;hide-on-complete&quot;</code> — Slot is hidden when
          resolved or rejected. Use for forms, confirmations, and pickers.
          The <code>renderResult</code> function takes over to show a compact
          read-only view from history.
        </li>
        <li>
          <code>&quot;hide-on-new&quot;</code> — Slot is hidden when a newer
          slot from the same tool appears. Use for cart summaries or status
          panels that should only show the latest version.
        </li>
      </ul>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Slot visible</th>
            <th>Use cases</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>&quot;stay&quot;</code></td>
            <td>Always</td>
            <td>Weather cards, search results, product grids</td>
          </tr>
          <tr>
            <td><code>&quot;hide-on-complete&quot;</code></td>
            <td>Until resolved / rejected</td>
            <td>Confirmations, forms, preference pickers, approval dialogs</td>
          </tr>
          <tr>
            <td><code>&quot;hide-on-new&quot;</code></td>
            <td>Until a newer slot from the same tool appears</td>
            <td>Cart summaries, status panels, progress indicators</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>renderData and renderResult</h2>

      <p>
        When a tool completes, it often needs to leave behind a read-only view
        of what happened. The <code>renderData</code> and{" "}
        <code>renderResult</code> pattern makes this possible:
      </p>

      <ol>
        <li>
          The <code>do()</code> function returns{" "}
          <code>{"{ status, data, renderData }"}</code> —{" "}
          <code>data</code> is sent to the AI model, <code>renderData</code>{" "}
          stays client-only (model adapters explicitly strip it).
        </li>
        <li>
          When the conversation is reloaded from history,{" "}
          <code>renderResult({"{ data: renderData }"})</code> renders a
          read-only view.
        </li>
        <li>
          This is essential for tools using{" "}
          <code>&quot;hide-on-complete&quot;</code> — after the slot is hidden,{" "}
          <code>renderResult</code> shows what happened.
        </li>
      </ol>

      <CodeBlock
        filename="lib/tools/confirm.tsx"
        language="tsx"
        code={`async do(input, display) {
  const confirmed = await display.pushAndWait(input);
  return {
    status: "success" as const,
    data: confirmed ? "User confirmed" : "User cancelled",
    renderData: { confirmed }, // client-only
  };
},
renderResult({ data }) {
  const { confirmed } = data as { confirmed: boolean };
  return <div>{confirmed ? "Confirmed" : "Cancelled"}</div>;
},`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/showcase/travel-planner">Build a Travel Planner</a>{" "}
          — a full tutorial showcasing preference pickers, itinerary approval,
          forms, and info cards
        </li>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent</a>{" "}
          — a tutorial with plan approval, diff previews, and permission prompts
        </li>
        <li>
          <a href="/docs/showcase/ecommerce-store">Build a Shopping Assistant</a>{" "}
          — product grids, variant pickers, cart cards, and checkout forms
        </li>
        <li>
          <a href="/docs/showcase/terminal-agent">Build a Terminal Agent</a>{" "}
          — use <code>glove-core</code> directly for a REPL-based coding agent
        </li>
        <li>
          <a href="/docs/react#tool-display">ToolDisplay API reference</a>{" "}
          — full method signatures for <code>pushAndWait</code> and{" "}
          <code>pushAndForget</code>
        </li>
        <li>
          <a href="/docs/react#slot-render-props">SlotRenderProps</a> — all
          properties available in your <code>render</code> function
        </li>
        <li>
          <a href="/tools">Tool Registry</a> — browse and copy pre-built tools
          with renderers
        </li>
        <li>
          <a href="/docs/react#define-tool">defineTool API reference</a>{" "}
          — full type signatures and options for <code>defineTool</code>
        </li>
        <li>
          <a href="/docs/react#render-component">
            &lt;Render&gt; component
          </a>{" "}
          — all props and strategies for the headless render component
        </li>
        <li>
          <a href="/docs/react#slot-display-strategy">
            Display strategies reference
          </a>{" "}
          — detailed behavior for each display strategy
        </li>
      </ul>
    </div>
  );
}
