import { CodeBlock } from "@/components/code-block";

export default async function CoffeeShopPage() {
  return (
    <div className="docs-content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Build a Coffee Shop Assistant</h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 20,
            background: "rgba(158, 212, 184, 0.12)",
            border: "1px solid rgba(158, 212, 184, 0.3)",
            fontSize: 12,
            fontWeight: 600,
            color: "#9ED4B8",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            lineHeight: 1,
            marginTop: 6,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Voice Enabled
        </span>
      </div>

      <p>
        In this showcase you will explore a working coffee ordering assistant
        that supports both text and voice interaction. The user types or speaks
        to a friendly barista AI, browses specialty coffees through interactive
        cards, adds items to a bag, and checks out through a form — all inside
        a single chat interface.
      </p>

      <p>
        This is a <strong>real, runnable example</strong> in the Glove monorepo
        at <code>examples/coffee/</code>. Unlike the other showcases, which
        walk through conceptual builds, this page explains an app you can
        launch and use today. It demonstrates three capabilities that work
        together: interactive tool cards (the display stack), voice-driven
        conversation (ElevenLabs STT and TTS with Silero VAD), and an{" "}
        <code>unAbortable</code> checkout pattern that prevents voice
        interruptions from killing a critical form.
      </p>

      <p>
        <strong>Prerequisites:</strong> You should have completed{" "}
        <a href="/docs/getting-started">Getting Started</a> and read{" "}
        <a href="/docs/display-stack">The Display Stack</a>. If you plan to
        set up voice, read the <a href="/docs/voice">Voice</a> docs as well.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        A coffee ordering assistant where a user can say &ldquo;I want
        something fruity and light&rdquo; and the app will:
      </p>

      <ol>
        <li>
          Ask about brew method and taste preferences through clickable
          option chips (<code>pushAndWait</code>)
        </li>
        <li>
          Show a horizontal carousel of matching coffees with origin,
          tasting notes, intensity bars, and pricing — the user clicks to
          select or add directly (<code>pushAndWait</code>)
        </li>
        <li>
          Display an expanded product detail card with the full
          description (<code>pushAndForget</code>)
        </li>
        <li>
          Show the shopping bag as a persistent summary card that updates
          as items are added (<code>pushAndForget</code>)
        </li>
        <li>
          Present a checkout form with grind selection, email input, and
          order totals — the form is <code>unAbortable</code>, meaning it
          survives voice interruptions (<code>pushAndWait</code>)
        </li>
        <li>
          Confirm the order with a success info card (<code>pushAndForget</code>)
        </li>
      </ol>

      <p>
        In voice mode, the same flow works hands-free. The AI narrates
        product details instead of showing clickable cards, uses voice-only
        tools (<code>get_products</code>, <code>get_cart</code>), and asks
        preference questions verbally instead of through option chips.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Understanding the architecture</h2>

      <p>
        The coffee shop is a Next.js application. It uses <code>glove-react</code>{" "}
        for the display stack and chat loop, <code>glove-next</code> for the
        LLM proxy, and <code>glove-voice</code> for the voice pipeline. Here
        is how the pieces connect:
      </p>

      <ul>
        <li>
          <strong><code>/api/chat</code></strong> — a{" "}
          <code>createChatHandler</code> route that proxies to the LLM
          provider. It sends tool schemas to the AI and streams back
          responses. It does not execute tools.
        </li>
        <li>
          <strong><code>/api/voice/stt-token</code></strong> and{" "}
          <strong><code>/api/voice/tts-token</code></strong> — server routes
          that generate short-lived ElevenLabs tokens. The browser calls
          these before starting the voice pipeline so that API keys never
          leave the server.
        </li>
        <li>
          <strong>Tool <code>do</code> functions</strong> — run in the
          browser. When the AI requests a tool call, <code>useGlove</code>{" "}
          executes the <code>do</code> function client-side. The function
          uses <code>display.pushAndWait()</code> or{" "}
          <code>display.pushAndForget()</code> to show React components in
          the chat.
        </li>
        <li>
          <strong>Cart state</strong> — managed with React{" "}
          <code>useState</code> in the browser. A <code>CartOps</code>{" "}
          interface (<code>add</code>, <code>get</code>, <code>clear</code>)
          is passed to tool factories so they can read and modify the bag.
        </li>
        <li>
          <strong>Session persistence</strong> — each conversation is
          stored in SQLite via <code>createRemoteStore</code>, so
          refreshing the page restores the full history.
        </li>
      </ul>

      <p>
        The app also has a <strong>text mode</strong> and a{" "}
        <strong>voice mode</strong>. In text mode, the AI uses interactive
        tools with clickable UI. In voice mode, it swaps to voice-friendly
        tools that return plain text for the AI to narrate. The system prompt
        itself changes when voice activates — more on this in the{" "}
        <a href="#dynamic-system-prompts">dynamic system prompts</a> section.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Tool categories</h2>

      <p>
        The coffee shop has 9 tools organized into three categories based on
        how they interact with the user. Understanding these categories is key
        to designing tools that work in both text and voice modes.
      </p>

      <h3>Interactive tools (pushAndWait)</h3>

      <p>
        These tools show a UI component and <strong>block</strong> until the
        user interacts. The AI pauses while the card is on screen. Think of
        them as questions that need a click to answer.
      </p>

      <p>
        The <code>ask_preference</code> tool presents a question with
        multiple-choice options. The AI calls it to gather brew method, taste
        preference, or occasion — one question at a time, progressively.
      </p>

      <CodeBlock
        filename="app/lib/tools/ask-preference.tsx"
        language="tsx"
        code={`import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";

const inputSchema = z.object({
  question: z.string().describe("The question to display"),
  options: z
    .array(
      z.object({
        label: z.string().describe("Display text"),
        value: z.string().describe("Value returned when selected"),
      }),
    )
    .describe("2-6 options to present"),
});

export function createAskPreferenceTool() {
  return defineTool({
    name: "ask_preference",
    description:
      "Present the user with a set of options to choose from. " +
      "Blocks until they pick one. Use for brew method, roast " +
      "preference, mood, or any multiple-choice question.",
    inputSchema,
    displayPropsSchema: inputSchema,
    resolveSchema: z.string(),
    displayStrategy: "hide-on-complete",

    async do(input, display) {
      const selected = await display.pushAndWait(input);
      const selectedOption = input.options.find((o) => o.value === selected);
      return {
        status: "success" as const,
        data: \`User selected: \${selected}\`,
        renderData: {
          question: input.question,
          selected: selectedOption ?? { label: selected, value: selected },
        },
      };
    },

    render({ props, resolve }) {
      return (
        <div style={{ padding: 20, background: "#fefdfb", border: "1px dashed #8fa88f" }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: "#1e2e1e" }}>
            {props.question}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {props.options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => resolve(opt.value)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  border: "1px solid #b8cab8",
                  color: "#2d422d",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    },

    renderResult({ data }) {
      const { question, selected } = data as {
        question: string;
        selected: { label: string; value: string };
      };
      return (
        <div style={{ padding: 20, background: "#fefdfb", border: "1px dashed #8fa88f" }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: "#1e2e1e" }}>
            {question}
          </p>
          <div style={{ display: "inline-block", padding: "8px 16px", background: "#111a11", color: "#fefdfb", fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
            {selected.label}
          </div>
        </div>
      );
    },
  });
}`}
      />

      <p>
        When the user clicks an option, <code>resolve(opt.value)</code> sends
        the string back to the <code>do</code> function. The{" "}
        <code>displayStrategy: &quot;hide-on-complete&quot;</code> makes the
        option chips disappear after the user picks, replaced by a compact{" "}
        <code>renderResult</code> showing just the selected option. This keeps
        the conversation clean when multiple preference questions are asked in
        sequence.
      </p>

      <p>
        The <code>show_products</code> tool shows a horizontal carousel of
        product cards. Each card has a &ldquo;Details&rdquo; button (to drill
        into a product) and an &ldquo;Add to bag&rdquo; button (to add
        directly). The AI passes an array of product IDs, or{" "}
        <code>[&quot;all&quot;]</code> for the full catalog:
      </p>

      <CodeBlock
        filename="app/lib/tools/show-products.tsx (do function)"
        language="tsx"
        code={`export function createShowProductsTool(cartOps: CartOps) {
  return defineTool({
    name: "show_products",
    description:
      "Display a carousel of coffee products for the user to browse " +
      "and select from. Blocks until the user picks a product.",
    inputSchema: z.object({
      product_ids: z
        .array(z.string())
        .describe('Array of product IDs to show, or ["all"] for the full catalog'),
      prompt: z.string().optional().describe("Optional text shown above the products"),
    }),
    displayPropsSchema: inputSchema,
    resolveSchema: z.object({
      productId: z.string(),
      action: z.enum(["select", "add"]),
    }),
    displayStrategy: "hide-on-complete",

    async do(input, display) {
      const selected = await display.pushAndWait(input);
      const product = getProductById(selected.productId);
      if (!product) return "Product not found.";

      // If the user clicked "Add to bag", update the cart immediately
      const resultText =
        selected.action === "add"
          ? (() => {
              cartOps.add(selected.productId);
              const cart = cartOps.get();
              const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
              return \`User added \${product.name} to their bag. Cart now has \${cart.length} item(s), total \${formatPrice(total)}.\`;
            })()
          : \`User selected \${product.name} (\${product.origin}, \${product.roast} roast, \${formatPrice(product.price)}).\`;

      return {
        status: "success" as const,
        data: resultText,
        renderData: {
          productId: selected.productId,
          action: selected.action,
          productName: product.name,
          price: product.price,
        },
      };
    },

    // render() shows a scrollable carousel of ProductCard components
    // renderResult() shows a compact "Added Yirgacheffe - $22.00" label
  });
}`}
      />

      <p>
        The resolve schema is an object with <code>productId</code> and{" "}
        <code>action</code> (<code>&quot;select&quot;</code> or{" "}
        <code>&quot;add&quot;</code>). This lets the AI know whether the
        user wants to see details or add straight to the bag. If the action
        is <code>&quot;add&quot;</code>, the <code>do</code> function updates
        the cart via <code>cartOps.add()</code> before returning the result
        to the AI.
      </p>

      <h3>Display tools (pushAndForget)</h3>

      <p>
        These tools show a card and <strong>do not block</strong>. The AI
        keeps talking immediately after the card appears. Use them for
        information the user should see but does not need to act on.
      </p>

      <p>
        The <code>show_product_detail</code> tool shows an expanded card
        with the full product description, origin, roast level, tasting
        notes, and intensity bar. The <code>show_cart</code> tool shows a
        summary of the shopping bag with line items, quantities, and
        totals. The <code>show_info</code> tool shows general information
        cards for sourcing details, brewing tips, or order confirmations.
      </p>

      <CodeBlock
        filename="app/lib/tools/show-cart.tsx"
        language="tsx"
        code={`export function createShowCartTool(cartOps: CartOps) {
  return defineTool({
    name: "show_cart",
    description:
      "Display the current shopping bag contents as a summary card. Non-blocking.",
    inputSchema: z.object({}),
    displayPropsSchema: z.object({ items: z.array(z.any()) }),
    displayStrategy: "hide-on-new",

    async do(_input, display) {
      const cart = cartOps.get();
      if (cart.length === 0) return "The bag is empty.";

      await display.pushAndForget({ items: cart });
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      return {
        status: "success" as const,
        data: \`Displayed cart: \${cart.length} item(s), \${formatPrice(total)}.\`,
        renderData: { items: cart },
      };
    },

    render({ props }) {
      return <CartSummary items={props.items as CartItem[]} />;
    },

    renderResult({ data }) {
      const { items } = data as { items: CartItem[] };
      return <CartSummary items={items} />;
    },
  });
}`}
      />

      <p>
        The cart tool uses <code>displayStrategy: &quot;hide-on-new&quot;</code>.
        This means when the AI calls <code>show_cart</code> again (after the
        user adds another item), the previous cart card disappears and the
        new one takes its place. Without this strategy, the conversation
        would accumulate stale cart snapshots.
      </p>

      <p>
        The <code>show_info</code> tool supports a <code>variant</code>{" "}
        field — <code>&quot;info&quot;</code> for general cards and{" "}
        <code>&quot;success&quot;</code> for order confirmations. The success
        variant shows a green accent bar on the left:
      </p>

      <CodeBlock
        filename="app/lib/tools/show-info.tsx"
        language="tsx"
        code={`export function createShowInfoTool() {
  return defineTool({
    name: "show_info",
    description:
      "Display a persistent information card in the chat. Use for " +
      "sourcing details, brewing tips, order confirmations, or general info.",
    inputSchema: z.object({
      title: z.string().describe("Card title"),
      content: z.string().describe("Card body text"),
      variant: z
        .enum(["info", "success"])
        .optional()
        .describe("info = general, success = confirmation/order placed"),
    }),
    displayPropsSchema: z.object({
      title: z.string(),
      content: z.string(),
      variant: z.string(),
    }),

    async do(input, display) {
      const variant = input.variant ?? "info";
      await display.pushAndForget({ title: input.title, content: input.content, variant });
      return {
        status: "success" as const,
        data: \`Displayed info card: \${input.title}\`,
        renderData: { title: input.title, content: input.content, variant },
      };
    },

    render({ props }) {
      const accentColor = props.variant === "success" ? "#4ade80" : "#6b8a6b";
      return (
        <div style={{
          background: "#fefdfb",
          border: "1px solid #dce5dc",
          borderLeft: \`3px solid \${accentColor}\`,
          padding: 16,
          maxWidth: 400,
        }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: "#111a11" }}>
            {props.title}
          </p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, lineHeight: 1.6, color: "#3d5a3d", whiteSpace: "pre-wrap" }}>
            {props.content}
          </p>
        </div>
      );
    },
  });
}`}
      />

      <h3>Voice-friendly tools (no UI)</h3>

      <p>
        These tools return plain text. They have no <code>render</code>{" "}
        function, no display stack involvement. The AI calls them, gets text
        back, and speaks it to the user. They exist so the voice mode has
        equivalents for the interactive tools that require clicking.
      </p>

      <CodeBlock
        filename="app/lib/tools/get-products.ts"
        language="typescript"
        code={`import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { formatPrice, getProductsByIds } from "../products";

export function createGetProductsTool(): ToolConfig {
  return {
    name: "get_products",
    description:
      "Look up product details and return them as text. " +
      "Use this in voice mode instead of show_products.",
    inputSchema: z.object({
      product_ids: z
        .array(z.string())
        .describe('Array of product IDs to look up, or ["all"] for everything'),
    }),

    async do(input) {
      const ids = (input as { product_ids: string[] }).product_ids;
      const products = getProductsByIds(ids.includes("all") ? "all" : ids);

      if (products.length === 0) {
        return { status: "error" as const, data: "No products found for the given IDs." };
      }

      const lines = products.map(
        (p) =>
          \`- \${p.name} (\${p.id}): \${p.origin}, \${p.roast} roast, \${formatPrice(p.price)}/\${p.weight}. Notes: \${p.notes.join(", ")}. Intensity: \${p.intensity}/10. \${p.description}\`,
      );

      return { status: "success" as const, data: lines.join("\\n") };
    },
  };
}`}
      />

      <CodeBlock
        filename="app/lib/tools/get-cart.ts"
        language="typescript"
        code={`import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { formatPrice } from "../products";
import type { CartOps } from "../theme";

export function createGetCartTool(cartOps: CartOps): ToolConfig {
  return {
    name: "get_cart",
    description:
      "Look up the current shopping bag contents and return them as text. " +
      "Use this in voice mode instead of show_cart.",
    inputSchema: z.object({}),

    async do() {
      const cart = cartOps.get();
      if (cart.length === 0) {
        return { status: "success" as const, data: "The bag is empty." };
      }

      const lines = cart.map(
        (item) => \`- \${item.name} x\${item.qty} — \${formatPrice(item.price * item.qty)}\`,
      );
      const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const totalItems = cart.reduce((s, i) => s + i.qty, 0);

      return {
        status: "success" as const,
        data: \`\${totalItems} item(s) in bag:\\n\${lines.join("\\n")}\\nSubtotal: \${formatPrice(subtotal)}\`,
      };
    },
  };
}`}
      />

      <p>
        Notice these are plain <code>ToolConfig</code> objects, not{" "}
        <code>defineTool</code> calls. Since they have no display UI, they
        do not need typed display props or resolve schemas. They are pure
        data lookups — the AI gets text back and narrates it aloud.
      </p>

      <p>
        All 9 tools are assembled through a factory function that receives
        the <code>CartOps</code> interface:
      </p>

      <CodeBlock
        filename="app/lib/tools/index.ts"
        language="typescript"
        code={`import type { ToolConfig } from "glove-react";
import type { CartOps } from "../theme";
import { createAskPreferenceTool } from "./ask-preference";
import { createShowProductsTool } from "./show-products";
import { createShowProductDetailTool } from "./show-product-detail";
import { createAddToCartTool } from "./add-to-cart";
import { createShowCartTool } from "./show-cart";
import { createCheckoutTool } from "./checkout";
import { createShowInfoTool } from "./show-info";
import { createGetProductsTool } from "./get-products";
import { createGetCartTool } from "./get-cart";

export function createCoffeeTools(cartOps: CartOps): ToolConfig[] {
  return [
    createAskPreferenceTool(),
    createShowProductsTool(cartOps),
    createShowProductDetailTool(),
    createAddToCartTool(cartOps),
    createShowCartTool(cartOps),
    createCheckoutTool(cartOps),
    createShowInfoTool(),
    // Voice-friendly tools — return data as text for the LLM to narrate
    createGetProductsTool(),
    createGetCartTool(cartOps),
  ];
}`}
      />

      <p>
        The tool factory pattern lets tools that need cart access (like{" "}
        <code>show_products</code>, <code>checkout</code>, and{" "}
        <code>get_cart</code>) share the same <code>CartOps</code> instance.
        Cart state lives in React, not on the server, so it updates
        instantly when the user adds an item.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The unAbortable pattern</h2>

      <p>
        This is the key pattern in the coffee shop example. The checkout
        tool uses <code>unAbortable: true</code>, which means the tool
        keeps running even when the user interrupts it.
      </p>

      <p>
        Why does this matter? In voice mode, the user might speak while
        the checkout form is on screen. Normally, speaking triggers a{" "}
        <strong>barge-in</strong> — the voice pipeline interrupts the
        current AI turn, aborts any running tools, and starts listening
        for the new utterance. This is great for casual conversation
        (the user can say &ldquo;actually, never mind&rdquo; mid-response),
        but it is terrible for checkout. If the user accidentally makes a
        sound — a cough, a background noise, even saying &ldquo;let me
        type my email&rdquo; — the checkout form would vanish and the
        cart data would be lost.
      </p>

      <p>
        The <code>unAbortable</code> flag provides two layers of
        protection:
      </p>

      <ol>
        <li>
          <strong>Voice layer: barge-in suppression.</strong> When any{" "}
          <code>pushAndWait</code> resolver is active (the display
          manager&apos;s resolver store has entries), the voice pipeline
          suppresses barge-in. The user&apos;s microphone still picks up
          audio, but the pipeline will not interrupt the current turn.
          This means speaking during checkout does not trigger a new AI
          response.
        </li>
        <li>
          <strong>Core layer: abort resistance.</strong> Even if an abort
          signal fires (from any source, not just voice), the Glove core
          checks <code>tool.unAbortable</code> before killing the tool.
          If the flag is set, the tool keeps running to completion. The
          <code>pushAndWait</code> promise resolves normally when the
          user submits the form.
        </li>
      </ol>

      <p>
        Here is the checkout tool implementation:
      </p>

      <CodeBlock
        filename="app/lib/tools/checkout.tsx"
        language="tsx"
        code={`import React, { useState } from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { formatPrice, GRIND_OPTIONS, type CartItem } from "../products";
import type { CartOps } from "../theme";

export function createCheckoutTool(cartOps: CartOps) {
  return defineTool({
    name: "checkout",
    description:
      "Present the checkout form with the current cart, grind selection, " +
      "and email input. Blocks until the user submits or cancels. " +
      "Only call when the user is ready to checkout.",
    inputSchema: z.object({}),
    displayPropsSchema: z.object({ items: z.array(z.any()) }),
    resolveSchema: z.union([
      z.object({ grind: z.string(), email: z.string() }),
      z.null(),
    ]),
    unAbortable: true,
    displayStrategy: "hide-on-complete",

    async do(_input, display) {
      const cart = cartOps.get();
      if (cart.length === 0) return "Cannot checkout — the bag is empty.";

      const result = await display.pushAndWait({ items: cart });

      if (!result) {
        return {
          status: "success" as const,
          data: "User cancelled checkout and wants to continue shopping.",
          renderData: { cancelled: true },
        };
      }

      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      cartOps.clear();
      return {
        status: "success" as const,
        data: \`Order placed! Grind: \${result.grind}. Cart cleared. Total items ordered: \${cart.length}.\`,
        renderData: {
          grind: result.grind,
          email: result.email,
          items: cart,
          total,
        },
      };
    },

    render({ props, resolve }) {
      return <CheckoutForm items={props.items as CartItem[]} onSubmit={resolve} />;
    },

    renderResult({ data }) {
      const result = data as
        | { cancelled: true }
        | { grind: string; email: string; items: CartItem[]; total: number };

      if ("cancelled" in result) {
        return (
          <div style={{ padding: 16, background: "#fefdfb", border: "1px solid #dce5dc" }}>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#6b8a6b", fontStyle: "italic" }}>
              Checkout cancelled — continued shopping.
            </p>
          </div>
        );
      }

      return (
        <div style={{ background: "#fefdfb", border: "1px solid #dce5dc", borderLeft: "3px solid #4ade80", padding: 16 }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: "#111a11" }}>
            Order Confirmed
          </p>
          {result.items.map((item) => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: "#3d5a3d" }}>
              <span>{item.name} x{item.qty}</span>
              <span style={{ fontFamily: "'DM Mono', monospace" }}>{formatPrice(item.price * item.qty)}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #dce5dc", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600 }}>Total</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600 }}>{formatPrice(result.total)}</span>
          </div>
        </div>
      );
    },
  });
}`}
      />

      <p>
        The <code>CheckoutForm</code> component is a regular React form
        with <code>useState</code> for grind selection and email input. It
        shows the bag items, a grind picker (Whole Bean, French Press,
        Pour Over, Espresso, Aeropress), an email field, subtotal, shipping
        (free over $40), and total. The &ldquo;Place Order&rdquo; button
        calls <code>resolve(&#123; grind, email &#125;)</code> and the
        &ldquo;Continue shopping&rdquo; link calls <code>resolve(null)</code>.
      </p>

      <p>
        The critical line is <code>unAbortable: true</code>. Without it,
        a voice interrupt during checkout would abort the tool, dismiss
        the form, and lose the cart data. With it, the form stays on screen
        no matter what happens in the voice pipeline.
      </p>

      <p>
        Here is the conceptual flow of what happens when the user speaks
        during checkout:
      </p>

      <CodeBlock
        filename="conceptual flow"
        language="typescript"
        code={`// 1. User says "let me check out"
// 2. AI calls checkout tool
// 3. do() calls display.pushAndWait({ items: cart })
// 4. CheckoutForm renders on screen — resolver is registered

// 5. User accidentally speaks while filling in email
// 6. Voice pipeline detects speech...
// 7. Voice layer checks: resolverStore.size > 0? YES
//    -> Barge-in SUPPRESSED. Speech is ignored.

// 8. Even if an abort signal fires from another source:
// 9. Core checks: tool.unAbortable? YES
//    -> Tool keeps running. pushAndWait stays active.

// 10. User fills in email, clicks "Place Order"
// 11. resolve({ grind: "Pour Over", email: "..." })
// 12. do() receives the result, clears the cart, returns to AI
// 13. AI confirms the order with show_info variant="success"`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Voice integration</h2>

      <p>
        The voice pipeline has four components: speech-to-text (STT),
        text-to-speech (TTS), voice activity detection (VAD), and the
        React hook that ties them together. Here is how to set up each
        piece.
      </p>

      <h3>Step 1: Token routes</h3>

      <p>
        ElevenLabs uses token-based authentication. Your server generates
        short-lived tokens, and the browser uses them to connect directly
        to ElevenLabs. This keeps your API key on the server. Glove
        provides a <code>createVoiceTokenHandler</code> helper that
        handles the token exchange:
      </p>

      <CodeBlock
        filename="app/api/voice/stt-token/route.ts"
        language="typescript"
        code={`import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });`}
      />

      <CodeBlock
        filename="app/api/voice/tts-token/route.ts"
        language="typescript"
        code={`import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });`}
      />

      <p>
        These routes read your <code>ELEVENLABS_API_KEY</code> from the
        server environment and return a temporary token. The browser calls
        them before starting each voice session.
      </p>

      <h3>Step 2: Adapter configuration</h3>

      <p>
        Create a client-side module that configures the ElevenLabs adapters
        and the Silero VAD. The VAD is dynamically imported to avoid
        pulling <code>onnxruntime-web</code> (a WASM dependency) into the
        Next.js server bundle during SSR or prerendering:
      </p>

      <CodeBlock
        filename="app/lib/voice.ts"
        language="typescript"
        code={`import { createElevenLabsAdapters } from "glove-voice";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? \`Token fetch failed (\${res.status})\`);
  }
  return data.token;
}

// ElevenLabs STT (Scribe) + TTS adapters
export const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("/api/voice/stt-token"),
  getTTSToken: () => fetchToken("/api/voice/tts-token"),
  voiceId: "56bWURjYFHyYyVf490Dp", // "George" — warm, friendly barista persona
});

// Silero VAD — dynamically imported to avoid WASM in SSR
export async function createSileroVAD() {
  const { SileroVADAdapter } = await import("glove-voice/silero-vad");
  const vad = new SileroVADAdapter({
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    wasm: { type: "cdn" },
  });
  await vad.init();
  return vad;
}`}
      />

      <p>
        The <code>voiceId</code> selects the TTS voice. The coffee shop
        uses &ldquo;George&rdquo; — a warm, conversational voice that fits
        the friendly barista persona. The VAD thresholds control how
        sensitive the turn detection is: <code>positiveSpeechThreshold</code>{" "}
        is the confidence needed to start detecting speech, and{" "}
        <code>negativeSpeechThreshold</code> is when it decides the user
        has stopped talking.
      </p>

      <h3>Step 3: The useGloveVoice hook</h3>

      <p>
        In the chat component, initialize the VAD on mount and pass
        everything to <code>useGloveVoice</code>:
      </p>

      <CodeBlock
        filename="app/components/chat.tsx (voice setup)"
        language="tsx"
        code={`import { useGlove, Render } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import type { TurnMode } from "glove-react/voice";
import { stt, createTTS, createSileroVAD } from "../lib/voice";
import { systemPrompt, voiceSystemPrompt } from "../lib/system-prompt";

export default function Chat({ sessionId }: { sessionId: string }) {
  const [turnMode, setTurnMode] = useState<TurnMode>("vad");

  // Cart state, tools, and glove hook setup...
  const tools = useMemo(() => createCoffeeTools(cartOps), [cartOps]);
  const glove = useGlove({ tools, sessionId });
  const { runnable } = glove;

  // Initialize Silero VAD model on mount (dynamic import avoids SSR issues)
  const [vadReady, setVadReady] = useState(false);
  const vadRef = useRef<Awaited<ReturnType<typeof createSileroVAD>> | null>(null);

  useEffect(() => {
    createSileroVAD().then((v) => {
      vadRef.current = v;
      setVadReady(true);
    });
  }, []);

  // Build voice config — only include VAD once it has loaded
  const voiceConfig = useMemo(
    () => ({
      stt,
      createTTS,
      vad: vadReady ? vadRef.current ?? undefined : undefined,
      turnMode,
    }),
    [vadReady, turnMode],
  );

  const voice = useGloveVoice({ runnable, voice: voiceConfig });

  // Swap system prompt when voice activates
  useEffect(() => {
    if (!runnable) return;
    if (voice.isActive) {
      runnable.setSystemPrompt(voiceSystemPrompt);
    } else {
      runnable.setSystemPrompt(systemPrompt);
    }
  }, [voice.isActive, runnable]);

  // voice.start()  — requests mic, opens STT, begins listening
  // voice.stop()   — releases mic, closes STT and TTS
  // voice.mode     — "idle" | "listening" | "thinking" | "speaking"
  // voice.isActive — true when mode is not "idle"
}`}
      />

      <p>
        The <code>useGloveVoice</code> hook returns a simple state machine.
        It cycles through four modes:{" "}
        <code>idle</code> (not started), <code>listening</code> (microphone
        active, waiting for speech), <code>thinking</code> (user finished
        speaking, waiting for AI response), and <code>speaking</code> (TTS
        playing back the AI response). After speaking finishes, it returns
        to <code>listening</code> automatically.
      </p>

      <p>
        The hook also supports two turn modes:{" "}
        <code>&quot;vad&quot;</code> (hands-free — the VAD detects when the
        user stops talking and auto-commits the turn) and{" "}
        <code>&quot;manual&quot;</code> (push-to-talk — the user holds a
        button or spacebar to record, and the turn commits on release).
      </p>

      <h3>Step 4: The voice orb</h3>

      <p>
        The coffee shop displays an animated orb that communicates voice
        state through motion:
      </p>

      <ul>
        <li>
          <strong>Listening:</strong> A gentle breathing pulse on the outer
          ring — &ldquo;I am here, speak.&rdquo;
        </li>
        <li>
          <strong>Thinking:</strong> The ring tightens and rotates —
          &ldquo;Processing your words.&rdquo;
        </li>
        <li>
          <strong>Speaking:</strong> Concentric ripples expand outward —
          &ldquo;Sound is coming from me.&rdquo;
        </li>
      </ul>

      <p>
        In VAD mode, tapping the orb ends the voice session. During
        speaking, tapping triggers barge-in (interrupt) and snaps back to
        listening. In manual mode, the orb acts as the push-to-talk
        button — click to start recording, click again to stop and commit.
        The CSS animations are driven by a class that changes with the
        voice mode: <code>voice-orb--listening</code>,{" "}
        <code>voice-orb--thinking</code>,{" "}
        <code>voice-orb--speaking</code>, and{" "}
        <code>voice-orb--recording</code> for manual mode.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="dynamic-system-prompts">Dynamic system prompts</h2>

      <p>
        The coffee shop uses two system prompts — one for text mode and one
        for voice mode. When the user activates the microphone, the
        component calls <code>runnable.setSystemPrompt(voiceSystemPrompt)</code>{" "}
        to swap the prompt. When voice ends, it swaps back.
      </p>

      <p>
        The voice prompt adds a section at the end that tells the AI which
        tools to avoid and which to use instead:
      </p>

      <CodeBlock
        filename="app/lib/system-prompt.ts (voice additions)"
        language="typescript"
        code={`export const voiceSystemPrompt = \`\${systemPrompt}

## Voice Mode — IMPORTANT
The user is interacting via voice. They CANNOT click buttons or interact
with visual elements. You must adapt your tool usage and speaking style.

### Tool Substitutions (voice mode)
These tools block on user clicks and MUST NOT be used in voice mode:
- **show_products** -> use **get_products** instead (returns product data
  as text for you to narrate)
- **show_cart** -> use **get_cart** instead (returns full cart breakdown
  as text)
- **ask_preference** -> DO NOT use. Instead, ask the user verbally and
  let them respond by speaking.

These tools still work in voice mode (non-blocking):
- **get_products** — look up products and narrate the results.
- **get_cart** — look up cart contents and read them back.
- **add_to_cart** — works normally. Confirm verbally what you added.
- **show_product_detail** — still displays a card, but describe the
  product verbally too.
- **show_info** — still displays a card, but speak the key info aloud.
- **checkout** — still works (the form will appear on screen).

### Speaking Style
- Be conversational — speak naturally, as if chatting at a coffee counter.
- Describe products verbally — mention name, origin, roast, key tasting
  notes, and price.
- Keep it concise — voice responses should be shorter than text.
- Ask one thing at a time.\`;`}
      />

      <p>
        The tool substitution pattern is the heart of multimodal tool design.
        Every interactive tool (<code>show_products</code>,{" "}
        <code>show_cart</code>, <code>ask_preference</code>) has a
        voice-friendly counterpart that either returns text data or is
        replaced by natural conversation. The AI is smart enough to follow
        these instructions consistently — when the system prompt says
        &ldquo;use <code>get_products</code> instead of{" "}
        <code>show_products</code>&rdquo;, it does.
      </p>

      <p>
        The checkout tool is the interesting exception. It works in both
        modes because even in voice mode, the user needs a visual form to
        enter their email address and select a grind. The system prompt
        says <code>checkout</code> &ldquo;still works (the form will appear
        on screen)&rdquo; so the AI knows to use it normally.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns summary</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Pattern</th>
            <th>Display Strategy</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>ask_preference</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>Multi-choice chips disappear after user picks an option</td>
          </tr>
          <tr>
            <td><code>show_products</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>Product carousel disappears after user selects or adds</td>
          </tr>
          <tr>
            <td><code>checkout</code></td>
            <td><code>pushAndWait</code> + <code>unAbortable</code></td>
            <td><code>hide-on-complete</code></td>
            <td>Order form stays on screen even during voice interrupts</td>
          </tr>
          <tr>
            <td><code>show_product_detail</code></td>
            <td><code>pushAndForget</code></td>
            <td><code>stay</code></td>
            <td>Product detail card persists in the conversation</td>
          </tr>
          <tr>
            <td><code>show_cart</code></td>
            <td><code>pushAndForget</code></td>
            <td><code>hide-on-new</code></td>
            <td>Old cart card replaced when updated cart appears</td>
          </tr>
          <tr>
            <td><code>show_info</code></td>
            <td><code>pushAndForget</code></td>
            <td><code>stay</code></td>
            <td>Info cards (sourcing, brewing, confirmations) persist</td>
          </tr>
          <tr>
            <td><code>add_to_cart</code></td>
            <td>No display</td>
            <td>n/a</td>
            <td>Pure data — updates cart state, returns confirmation text</td>
          </tr>
          <tr>
            <td><code>get_products</code></td>
            <td>No display</td>
            <td>n/a</td>
            <td>Voice-only — returns product data as text for narration</td>
          </tr>
          <tr>
            <td><code>get_cart</code></td>
            <td>No display</td>
            <td>n/a</td>
            <td>Voice-only — returns cart contents as text for narration</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Running it</h2>

      <p>
        The coffee shop is a working example in the Glove monorepo. To run
        it locally:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`# Clone the repo and install dependencies
git clone https://github.com/your-org/glove.git
cd glove
pnpm install`}
      />

      <p>
        Create a <code>.env.local</code> file in the{" "}
        <code>examples/coffee/</code> directory with your API keys:
      </p>

      <CodeBlock
        filename="examples/coffee/.env.local"
        language="bash"
        code={`# Required — LLM provider
OPENROUTER_API_KEY=your-openrouter-key

# Optional — only needed for voice mode
ELEVENLABS_API_KEY=your-elevenlabs-key`}
      />

      <p>
        Then start the dev server:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-coffee run dev`}
      />

      <p>Try these conversations in text mode:</p>

      <ul>
        <li>
          <strong>&ldquo;What do you recommend?&rdquo;</strong> — the AI
          asks about your preferences through option chips, then shows
          matching coffees in a carousel
        </li>
        <li>
          <strong>&ldquo;Tell me about the Yirgacheffe&rdquo;</strong> — a
          detailed product card appears with origin, tasting notes,
          intensity bar, and description
        </li>
        <li>
          <strong>&ldquo;Add it to my bag&rdquo;</strong> — the cart
          updates instantly; the AI shows the bag summary
        </li>
        <li>
          <strong>&ldquo;I am ready to check out&rdquo;</strong> — the
          checkout form appears with grind selection, email, and totals
        </li>
      </ul>

      <p>Try these in voice mode (click the microphone button):</p>

      <ul>
        <li>
          <strong>&ldquo;What coffees do you have?&rdquo;</strong> — the AI
          narrates the catalog instead of showing cards
        </li>
        <li>
          <strong>&ldquo;Add the Huila Reserve&rdquo;</strong> — the AI
          confirms verbally: &ldquo;Done! I have added the Huila Reserve
          to your bag.&rdquo;
        </li>
        <li>
          <strong>&ldquo;What is in my bag?&rdquo;</strong> — the AI reads
          back the contents and total
        </li>
        <li>
          <strong>&ldquo;Let me check out&rdquo;</strong> — the checkout
          form appears on screen (even in voice mode, you need the form to
          type your email)
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Key takeaways</h2>

      <p>
        The coffee shop demonstrates several patterns worth learning from:
      </p>

      <ul>
        <li>
          <strong>Tool factories with shared state.</strong> The{" "}
          <code>CartOps</code> interface lets multiple tools read and modify
          the same cart without prop drilling or global state.
        </li>
        <li>
          <strong>Dual tool sets for multimodal interaction.</strong>{" "}
          Interactive tools for text mode, text-only equivalents for voice
          mode. The system prompt tells the AI which set to use.
        </li>
        <li>
          <strong><code>unAbortable</code> for critical flows.</strong> The
          checkout form cannot be dismissed by voice interrupts — two
          layers of protection ensure the user&apos;s form data is safe.
        </li>
        <li>
          <strong>Dynamic system prompts.</strong> Swapping the system
          prompt at runtime lets a single app support completely different
          interaction styles without duplicating tool logic.
        </li>
        <li>
          <strong>Display strategy selection.</strong> Using{" "}
          <code>hide-on-complete</code> for interactive tools keeps the
          conversation clean, while <code>hide-on-new</code> for the cart
          prevents stale data, and <code>stay</code> for info cards keeps
          useful context visible.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/voice">Voice Documentation</a> — full guide to
          STT, TTS, VAD, turn modes, and the voice pipeline lifecycle
        </li>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> — deep dive
          into <code>pushAndWait</code>, <code>pushAndForget</code>, and
          display strategies
        </li>
        <li>
          <a href="/docs/showcase/ecommerce-store">Build a Shopping Assistant</a>{" "}
          — a conceptual ecommerce build that explores product browsing,
          variant selection, and cart patterns
        </li>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent</a>{" "}
          — the gate-execute-display pattern for server mutations with
          diff previews and command approval
        </li>
        <li>
          <a href="/docs/showcase/travel-planner">Build a Travel Planner</a>{" "}
          — progressive preference gathering with all client-side tools
        </li>
        <li>
          <a href="/docs/showcase/terminal-agent">Build a Terminal Agent</a>{" "}
          — use <code>glove-core</code> directly without React or Next.js
        </li>
        <li>
          <a href="/docs/react#define-tool">defineTool API Reference</a>{" "}
          — full API for typed tool definitions with{" "}
          <code>displayPropsSchema</code>, <code>resolveSchema</code>, and{" "}
          <code>unAbortable</code>
        </li>
      </ul>
    </div>
  );
}
