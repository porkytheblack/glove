import { CodeBlock } from "@/components/code-block";

export default async function GettingStartedPage() {
  return (
    <div className="docs-content">
      <h1>Getting Started</h1>

      <p>
        Build a working AI-powered chat app in 15 minutes. By the end, you will
        have a Next.js app where users can ask about the weather and the AI
        calls your custom tool to answer.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Prerequisites</h2>

      <p>Before you start, make sure you have:</p>

      <ul>
        <li>
          <strong>Node.js 18+</strong> installed on your machine
        </li>
        <li>
          <strong>A Next.js project</strong> — an existing one, or create one
          with <code>npx create-next-app@latest</code>
        </li>
        <li>
          <strong>An API key</strong> from{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</a> or{" "}
          <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">Anthropic</a>
        </li>
      </ul>

      <p>
        <strong>What you should know:</strong> This guide assumes familiarity
        with React components, hooks (<code>useState</code>), and basic
        TypeScript. If you know how to build a form in React, you have
        everything you need. We will explain{" "}
        <a href="https://zod.dev" target="_blank" rel="noopener noreferrer">Zod</a> and
        Glove-specific concepts as they come up.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Key Concepts</h2>

      <p>
        Three ideas power every Glove app. Refer back to these if anything
        later in the guide feels unfamiliar:
      </p>

      <p>
        <strong>Tools</strong> are capabilities your app can perform — things
        like &ldquo;get weather&rdquo; or &ldquo;search products.&rdquo; Each
        tool has a name, a description (so the AI knows what it does), an input
        schema (defined with <a href="https://zod.dev" target="_blank" rel="noopener noreferrer">Zod</a>,
        a validation library), and a <code>do</code> function that runs when
        the AI calls it.
      </p>

      <p>
        <strong>The display stack</strong> lets tools show UI to the user. A
        tool can push a React component onto a stack that your app renders.
        There are two modes: <code>pushAndWait</code> pauses the tool until the
        user responds (like a confirmation dialog), while{" "}
        <code>pushAndForget</code> shows UI and lets the tool keep running
        (like showing a data card). We won&apos;t use the display stack in this
        guide, but you can learn about it in{" "}
        <a href="/docs/concepts#the-display-stack">Concepts</a>.
      </p>

      <p>
        <strong>The agent loop</strong> is the engine that drives everything.
        When a user sends a message, the AI reads the available tools, calls
        whichever tools it needs, reads the results, and either responds or
        calls more tools. This loop repeats until the AI has enough information
        to give a final answer.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>1. Install packages</h2>

      <p>
        Install Glove and Zod (the validation library Glove uses for tool
        inputs):
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-core glove-react glove-next zod`}
      />

      <p>Or with npm:</p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`npm install glove-core glove-react glove-next zod`}
      />

      <p>
        Here is what each package does:
      </p>

      <ul>
        <li>
          <code>glove-react</code> — React hooks and components for your UI (<a href="/docs/react">API reference</a>)
        </li>
        <li>
          <code>glove-next</code> — server handler that connects to AI providers (<a href="/docs/next">API reference</a>)
        </li>
        <li>
          <code>glove-core</code> — the runtime engine (included as a dependency of <code>glove-react</code>)
        </li>
        <li>
          <code>zod</code> — validates tool inputs at runtime
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>2. Create the server route</h2>

      <p>
        Create an API route that handles chat requests. The{" "}
        <code>createChatHandler</code> function from <code>glove-next</code>{" "}
        does this in one line — it connects to your AI provider and streams
        responses back:
      </p>

      <CodeBlock
        filename="app/api/chat/route.ts"
        language="typescript"
        code={`import { createChatHandler } from "glove-next";

// This creates a POST endpoint that streams AI responses
export const POST = createChatHandler({
  provider: "openai",    // or "anthropic"
  model: "gpt-4.1-mini",  // or "claude-sonnet-4-20250514"
});`}
      />

      <p>
        Set your API key in <code>.env.local</code> at the root of your project:
      </p>

      <CodeBlock
        filename=".env.local"
        language="bash"
        code={`OPENAI_API_KEY=sk-...`}
      />

      <p>
        Using Anthropic? Change to{" "}
        <code>provider: &quot;anthropic&quot;</code> and{" "}
        <code>model: &quot;claude-sonnet-4-20250514&quot;</code>, then set{" "}
        <code>ANTHROPIC_API_KEY</code> instead. See{" "}
        <a href="/docs/next#supported-providers">all supported providers</a>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>3. Define your tools</h2>

      <p>
        Create a <code>GloveClient</code> with a system prompt and tools. This
        is where you tell the AI what your app can do:
      </p>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`import { GloveClient } from "glove-react";
import { z } from "zod";

export const gloveClient = new GloveClient({
  // Where to send chat requests (the route you created above)
  endpoint: "/api/chat",

  // Instructions for the AI — what role should it play?
  systemPrompt: "You are a helpful weather assistant.",

  // Tools — capabilities the AI can use
  tools: [
    {
      name: "get_weather",
      description: "Get the current weather for a city.",

      // Zod schema: defines what input the AI must provide
      // z.object() creates an object schema, z.string() validates a string
      inputSchema: z.object({
        city: z.string().describe("The city to get weather for"),
      }),

      // This runs when the AI decides to use this tool
      async do(input) {
        // In a real app, you'd call a weather API here
        return {
          city: input.city,
          temperature: "72°F",
          condition: "Sunny",
        };
      },
    },
  ],
});`}
      />

      <p>
        The <code>inputSchema</code> tells the AI what arguments the tool
        expects, and Zod validates them at runtime. The <code>do</code>{" "}
        function runs when the AI calls this tool — its return value is sent
        back to the AI as the tool result.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>4. Add the provider</h2>

      <p>
        Wrap your app with <code>GloveProvider</code> so any component can
        access the agent. Create a client component for the provider:
      </p>

      <CodeBlock
        filename="app/providers.tsx"
        language="tsx"
        code={`"use client";

import { GloveProvider } from "glove-react";
import { gloveClient } from "@/lib/glove";

export function Providers({ children }: { children: React.ReactNode }) {
  return <GloveProvider client={gloveClient}>{children}</GloveProvider>;
}`}
      />

      <p>
        Then wrap your root layout with it:
      </p>

      <CodeBlock
        filename="app/layout.tsx"
        language="tsx"
        code={`import { Providers } from "./providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>5. Build the chat UI</h2>

      <p>
        Use the <code>useGlove</code> hook to get the conversation state and a
        function to send messages:
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useState } from "react";
import { useGlove } from "glove-react";

export default function Chat() {
  // useGlove gives you everything you need:
  // - timeline: array of messages and tool calls
  // - streamingText: text being streamed right now
  // - busy: true while the AI is thinking
  // - sendMessage: send a user message
  const { timeline, streamingText, busy, sendMessage } = useGlove();
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage(input.trim());
    setInput("");
  }

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Weather Chat</h1>

      {/* Render the conversation */}
      <div>
        {timeline.map((entry, i) => {
          // Each entry has a "kind" that tells you what type it is
          if (entry.kind === "user") {
            return (
              <div key={i} style={{ margin: "1rem 0" }}>
                <strong>You:</strong> {entry.text}
              </div>
            );
          }

          if (entry.kind === "agent_text") {
            return (
              <div key={i} style={{ margin: "1rem 0" }}>
                <strong>Assistant:</strong> {entry.text}
              </div>
            );
          }

          if (entry.kind === "tool") {
            return (
              <div
                key={i}
                style={{
                  margin: "0.5rem 0",
                  padding: "0.5rem",
                  background: "#f0f0f0",
                  borderRadius: 4,
                  fontSize: "0.875rem",
                }}
              >
                Tool: <strong>{entry.name}</strong> — {entry.status}
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Show text as it streams in */}
      {streamingText && (
        <div style={{ margin: "1rem 0", opacity: 0.7 }}>
          <strong>Assistant:</strong> {streamingText}
        </div>
      )}

      {/* Message input */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the weather..."
          disabled={busy}
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}`}
      />

      <h3>Using the Render component</h3>

      <p>
        The manual mapping above is great for learning, but <code>glove-react</code>{" "}
        includes a <code>&lt;Render&gt;</code> component that handles the timeline,
        streaming text, and input for you. Here is the same UI with less boilerplate:
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useGlove, Render } from "glove-react";

export default function Chat() {
  const glove = useGlove();

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Weather Chat</h1>
      <Render
        glove={glove}
        renderMessage={({ entry }) => (
          <div style={{ margin: "1rem 0" }}>
            <strong>{entry.kind === "user" ? "You" : "Assistant"}:</strong> {entry.text}
          </div>
        )}
        renderStreaming={({ text }) => (
          <div style={{ margin: "1rem 0", opacity: 0.7 }}>
            <strong>Assistant:</strong> {text}
          </div>
        )}
        renderInput={({ send, busy }) => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("msg") as HTMLInputElement;
              if (!input.value.trim() || busy) return;
              send(input.value.trim());
              input.value = "";
            }}
            style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}
          >
            <input
              name="msg"
              placeholder="Ask about the weather..."
              disabled={busy}
              style={{ flex: 1, padding: "0.5rem" }}
            />
            <button type="submit" disabled={busy}>Send</button>
          </form>
        )}
      />
    </div>
  );
}`}
      />

      <p>
        <code>&lt;Render&gt;</code> also handles display stack slots, display
        strategies, and tool result rendering automatically — features you will
        use when you start building with the{" "}
        <a href="/docs/display-stack">display stack</a>. For now, both
        approaches work identically.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>6. Run it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm dev`}
      />

      <p>
        Open{" "}
        <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer">
          http://localhost:3000
        </a>{" "}
        and try asking &ldquo;What&apos;s the weather in Tokyo?&rdquo;. The AI
        will call your <code>get_weather</code> tool and respond with the
        result.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <p>You have a working agent. Here is where to go next:</p>

      <ul>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> — add
          interactive UI to your tools: confirmation dialogs, forms, data cards,
          and more
        </li>
        <li>
          <a href="/docs/concepts">Core Concepts</a> — understand the
          architecture: the agent loop, adapters, and context compaction
        </li>
        <li>
          <a href="/docs/react">React API Reference</a> — explore the full API
          including{" "}
          <a href="/docs/react#glove-client">GloveClient</a>,{" "}
          <a href="/docs/react#useglove">useGlove</a>, and{" "}
          <a href="/docs/react#tool-config">ToolConfig</a>
        </li>
        <li>
          <a href="/docs/react#define-tool">defineTool</a> — type-safe tool
          definitions with typed display props and resolve values
        </li>
        <li>
          <a href="/tools">Tool Registry</a> — browse pre-built tools you can
          drop into your app
        </li>
      </ul>
    </div>
  );
}
