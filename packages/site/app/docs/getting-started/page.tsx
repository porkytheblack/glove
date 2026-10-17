import { CodeBlock } from "@/components/code-block";
import { DocCards } from "@/components/doc-cards";

export const metadata = {
  title: "Quickstart",
  description:
    "Build a working Glove agent in 15 minutes — the full-stack Next.js path and the server-only path.",
};

export default function GettingStartedPage() {
  return (
    <div className="docs-content">
      <h1>Quickstart</h1>

      <p>
        Fifteen minutes to a working agent that calls a tool you wrote. Two
        paths — pick one; they share the same runtime and the same tool
        definitions.
      </p>

      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>For</th>
            <th>Packages</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><a href="/foundry/docs/getting-started">Foundry</a></td>
            <td>A complete server-side agent system with instances, apps, events, schedules, workspaces, and inspection</td>
            <td><code>glove-foundry</code></td>
          </tr>
          <tr>
            <td>
              <a href="#full-stack">Full-stack</a>
            </td>
            <td>Next.js App Router, tools running in the browser</td>
            <td>
              <code>glove-react</code>, <code>glove-next</code>
            </td>
          </tr>
          <tr>
            <td>
              <a href="#server-only">Server-only</a>
            </td>
            <td>CLI, worker, backend service — no React</td>
            <td>
              <code>glove-core</code>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          This page teaches the lower-level Glove loop. For the opinionated application
          framework—the route tree, runtime data model, development server, and
          inspector—start with the <a href="/foundry/docs/getting-started">Foundry quickstart</a>.
        </p>
      </div>

      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          Not installed yet? <a href="/docs/installation">Installation</a>{" "}
          covers packages, providers and environment variables. This guide
          assumes React components, hooks and basic TypeScript; we explain{" "}
          <a href="https://zod.dev" target="_blank" rel="noopener noreferrer">
            Zod
          </a>{" "}
          and every Glove concept as it comes up.
        </p>
      </div>

      <h2 id="the-three-ideas">The three ideas</h2>

      <p>
        Refer back to these if anything below feels unfamiliar — each has a full
        page in <a href="/docs/concepts">Core Concepts</a>.
      </p>

      <p>
        <strong>Tools</strong> are the capabilities your app exposes. A tool is
        a name, a description (this is what the model reads to decide), a Zod{" "}
        <code>inputSchema</code>, and an async <code>do()</code>.
      </p>

      <p>
        <strong>The agent loop</strong> is the engine. A user message goes in;
        the model calls whichever tools it needs, reads the results, and either
        answers or calls more. You never sequence it yourself.
      </p>

      <p>
        <strong>The display stack</strong> is how a tool shows UI mid-run.{" "}
        <code>pushAndForget</code> renders and keeps going;{" "}
        <code>pushAndWait</code> renders and pauses the tool until the user
        responds. Section 6 uses it.
      </p>

      {/* ================================================================== */}
      <h2 id="full-stack">Full-stack (Next.js + React)</h2>

      <h3 id="1-install">1. Install</h3>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-react glove-next zod`}
      />

      <ul>
        <li>
          <code>glove-next</code> — the server handler that talks to your model
          provider (<a href="/docs/next">reference</a>)
        </li>
        <li>
          <code>glove-react</code> — hooks and components for the UI, with{" "}
          <code>glove-core</code> bundled as a dependency (
          <a href="/docs/react">reference</a>)
        </li>
        <li>
          <code>zod</code> — validates tool inputs at runtime
        </li>
      </ul>

      <h3 id="2-server-route">2. Create the server route</h3>

      <p>
        One line gives you a streaming POST endpoint. It holds your API key and
        proxies the model; it never sees your tool implementations.
      </p>

      <CodeBlock
        filename="app/api/chat/route.ts"
        language="typescript"
        code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",              // "openai", "gemini", "ollama", …
  model: "claude-sonnet-5",
});`}
      />

      <CodeBlock
        filename=".env.local"
        language="bash"
        code={`ANTHROPIC_API_KEY=sk-ant-...`}
      />

      <h3 id="3-define-tools">3. Define your tools</h3>

      <p>
        The <code>GloveClient</code> holds the system prompt and the tool list.
        Tools defined here run in the browser, so they can touch component state
        and the display stack directly.
      </p>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`import { GloveClient } from "glove-react";
import { z } from "zod";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful weather assistant.",

  tools: [
    {
      name: "get_weather",
      // The description IS the interface — the model picks tools by reading it.
      description: "Get the current weather for a city.",
      inputSchema: z.object({
        city: z.string().describe("The city to get weather for"),
      }),
      async do(input) {
        const res = await fetch(
          \`https://wttr.in/\${encodeURIComponent(input.city)}?format=j1\`,
        );
        const data = await res.json();
        const now = data.current_condition[0];
        return {
          city: input.city,
          temperature: \`\${now.temp_C}°C\`,
          condition: now.weatherDesc[0].value,
        };
      },
    },
  ],
});`}
      />

      <p>
        Whatever <code>do()</code> returns is fed back to the model as the tool
        result. Keep it small and structured — it costs context on every
        subsequent turn.
      </p>

      <h3 id="4-provider">4. Add the provider</h3>

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

      <CodeBlock
        filename="app/layout.tsx"
        language="tsx"
        code={`import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}`}
      />

      <h3 id="5-chat-ui">5. Build the chat UI</h3>

      <p>
        <code>useGlove()</code> gives you the timeline, the streaming text, a
        busy flag and <code>sendMessage</code>. <code>&lt;Render&gt;</code>{" "}
        wires them together — including display-stack slots and tool result
        rendering — so you only supply the pieces you care about.
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useGlove, Render } from "glove-react";

export default function Chat() {
  const glove = useGlove();

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto" }}>
      <h1>Weather Chat</h1>
      <Render
        glove={glove}
        renderMessage={({ entry }) => (
          <p>
            <strong>{entry.kind === "user" ? "You" : "Assistant"}:</strong>{" "}
            {entry.text}
          </p>
        )}
        renderStreaming={({ text }) => <p style={{ opacity: 0.7 }}>{text}</p>}
        renderInput={({ send, busy }) => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("msg") as HTMLInputElement;
              if (!input.value.trim() || busy) return;
              send(input.value.trim());
              input.value = "";
            }}
          >
            <input name="msg" placeholder="Ask about the weather…" disabled={busy} />
            <button type="submit" disabled={busy}>Send</button>
          </form>
        )}
      />
    </main>
  );
}`}
      />

      <p>
        Prefer to drive the timeline yourself? <code>useGlove()</code> returns
        it as a plain array — map over <code>entry.kind</code> (
        <code>user</code>, <code>agent_text</code>, <code>tool</code>) and
        render whatever you like. <code>&lt;Render&gt;</code> is a convenience,
        not a requirement.
      </p>

      <h3 id="6-display">6. Make a tool show UI</h3>

      <p>
        This is the part that makes Glove an application runtime rather than a
        chat wrapper. A tool can push a component and{" "}
        <strong>block until the user answers it</strong>:
      </p>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`{
  name: "book_trip",
  description: "Book a trip once the user has confirmed the details.",
  inputSchema: z.object({ city: z.string(), nights: z.number() }),
  async do(input, display) {
    // Renders <ConfirmTrip {...input} /> and suspends here.
    const confirmed = await display.pushAndWait({
      renderer: "confirm_trip",
      input,
    });

    if (!confirmed.ok) return { status: "cancelled" };
    return await bookings.create(input);
  },
}`}
      />

      <p>
        Register <code>confirm_trip</code> as a renderer on the React side and{" "}
        <code>&lt;Render&gt;</code> mounts it in the conversation. The full
        story — renderers, display strategies, typed props via{" "}
        <code>defineTool</code> — is in{" "}
        <a href="/docs/display-stack">The Display Stack</a>.
      </p>

      <h3 id="7-run">7. Run it</h3>

      <CodeBlock filename="terminal" language="bash" code={`pnpm dev`} />

      <p>
        Open <code>http://localhost:3000</code> and ask “What&apos;s the weather
        in Tokyo?”. The model calls <code>get_weather</code> and answers from
        the result.
      </p>

      {/* ================================================================== */}
      <h2 id="server-only">Server-only (Node, CLI, worker)</h2>

      <p>
        No React, no Next.js — construct <code>Glove</code>, fold tools onto it,
        and call <code>processRequest</code>. This is the shape for cron jobs,
        queue workers, terminal agents and WebSocket servers.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-core zod`}
      />

      <CodeBlock
        filename="scripts/run-agent.ts"
        language="typescript"
        code={`import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { z } from "zod";

const agent = new Glove({
  store: new MemoryStore("local-session"),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-5" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful weather assistant.",
  compaction_config: {
    // Runs automatically when the context gets long.
    compaction_instructions: "Summarize the conversation so far.",
  },
})
  .fold({
    name: "get_weather",
    description: "Get the current weather for a city.",
    inputSchema: z.object({ city: z.string() }),
    async do(input) {
      return { status: "success", data: { city: input.city, temperature: "22°C" } };
    },
  })
  .build();

const result = await agent.processRequest("What's the weather in Tokyo?");
console.log(result);`}
      />

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`npx tsx scripts/run-agent.ts`}
      />

      <h3 id="streaming-server">Watching it work</h3>

      <p>
        Subscribers are the server-side equivalent of the React timeline —
        stream deltas to a terminal, a log, a socket, or a metrics sink:
      </p>

      <CodeBlock
        filename="scripts/run-agent.ts"
        language="typescript"
        code={`app.addSubscriber({
  async record(event, data) {
    if (event === "text_delta") process.stdout.write(data.text);
    if (event === "tool_use") console.log(\`\\n→ \${data.name}\`);
    if (event === "tool_use_result") console.log(\`← \${data.result.status}\`);
  },
});`}
      />

      <p>
        More on long-running processes, WebSocket servers and terminal UIs in{" "}
        <a href="/docs/server-side">Server-Side Agents</a>.
      </p>

      <h2 id="persistence">Making it persist</h2>

      <p>
        <code>MemoryStore</code> lives in process memory — perfect for scripts
        and tests, gone on restart. For real sessions implement{" "}
        <code>StoreAdapter</code> against your own backend; it is a small
        interface (messages, turns, tokens, inbox) and the one seam that decides
        where conversation state lives.
      </p>

      <ul>
        <li>
          <strong>MemoryStore</strong> (<code>glove-core</code>) — in-process,
          for prototypes
        </li>
        <li>
          <strong>createRemoteStore</strong> (<code>glove-react</code>) —
          delegates to your own API endpoints
        </li>
        <li>
          <strong>Custom StoreAdapter</strong> — Postgres, Redis, DynamoDB,
          anything (<a href="/docs/core">contract</a>)
        </li>
      </ul>

      <h2 id="next-steps">Where to go next</h2>

      <DocCards
        cards={[
          {
            href: "/docs/packages",
            kicker: "Tour",
            title: "All Packages",
            desc: "Memory, sandboxes, mesh, MCP, voice — what each one solves and the snippet that turns it on.",
          },
          {
            href: "/docs/display-stack",
            kicker: "Build",
            title: "The Display Stack",
            desc: "Confirmation dialogs, forms and data cards pushed by the tools that need them.",
          },
          {
            href: "/docs/concepts",
            kicker: "Understand",
            title: "Core Concepts",
            desc: "The agent loop, adapters, subscribers and context compaction.",
          },
          {
            href: "/docs/extensions",
            kicker: "Extend",
            title: "Hooks, Skills & Subagents",
            desc: "Shape a turn before it runs, inject context on demand, delegate to isolated children.",
          },
          {
            href: "/docs/memory",
            kicker: "Remember",
            title: "Memory",
            desc: "Entities, episodes, resources and standing context — across sessions.",
          },
          {
            href: "/docs/react",
            kicker: "Reference",
            title: "React API",
            desc: "GloveClient, useGlove, <Render>, defineTool and typed display props.",
          },
        ]}
      />
    </div>
  );
}
