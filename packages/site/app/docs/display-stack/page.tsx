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
        two properties:
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
      </ul>
    </div>
  );
}
