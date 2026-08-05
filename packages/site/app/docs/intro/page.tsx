import { CodeBlock } from "@/components/code-block";
import { DocCards } from "@/components/doc-cards";

export const metadata = {
  title: "What is Glove?",
  description:
    "Glove is an open-source TypeScript framework for AI-powered apps: you define tools, an agent decides when to use them.",
};

export default function IntroPage() {
  return (
    <div className="docs-content">
      <h1>What is Glove?</h1>

      <p>
        Glove is an open-source TypeScript framework for building applications
        where an <strong>AI agent drives the app</strong>. You define
        capabilities as <strong>tools</strong>. The agent decides which ones to
        call, in what order, and renders the results — as text, as UI, or as
        speech.
      </p>

      <p>
        It is not a chatbot SDK. The runtime ships a display stack, a persistent
        inbox, a memory layer, a mesh for agents to talk over, sandboxes for the
        model to compute in, and a packaging story for deployment. Every piece
        is a separate package you can adopt on its own.
      </p>

      <h2 id="the-core-idea">The core idea</h2>

      <p>
        Traditional apps encode user flows in UI — pages, routes, navigation
        hierarchies, state machines. Glove replaces that wiring with an agent
        loop:
      </p>

      <CodeBlock
        filename="what a session looks like"
        language="text"
        code={`User: "Find me running shoes under $100"
  → agent calls search_products  → pushes a product grid onto the display stack

User: "Add the Nike ones to my cart and check out"
  → agent calls add_to_cart      → returns the updated cart
  → agent calls checkout         → pushes a payment form and WAITS for the user
  → the tool resumes with the submitted payment and creates the order`}
      />

      <p>
        You never wrote a route, a wizard, or a step counter. You wrote three
        tools and let the model sequence them.
      </p>

      <h2 id="key-terms">Key terms</h2>

      <p>
        Five words carry most of the framework. Each has a page of its own; this
        is the one-line version.
      </p>

      <table>
        <thead>
          <tr>
            <th>Term</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Tool</strong>
            </td>
            <td>
              A capability: a name, a description, a Zod input schema, and an
              async <code>do()</code>. Registered with <code>fold()</code>.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Agent loop</strong>
            </td>
            <td>
              Prompt the model → run the tools it asks for → feed results back →
              repeat until it answers with text.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Display stack</strong>
            </td>
            <td>
              What the user sees. Tools push components onto it —{" "}
              <code>pushAndForget</code> to show, <code>pushAndWait</code> to
              pause the tool until the user responds.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Store</strong>
            </td>
            <td>
              Where the conversation lives. In-memory, SQLite, your own backend
              — anything implementing <code>StoreAdapter</code>.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Adapter</strong>
            </td>
            <td>
              The seam at every layer: model, store, display, subscriber, voice.
              Swap the implementation, keep the app.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="what-you-can-build">What you can build</h2>

      <ul>
        <li>
          <strong>Commerce and booking flows</strong> — search, cart, checkout,
          confirmation dialogs rendered inline by the tools that need them.
        </li>
        <li>
          <strong>Voice-first products</strong> — the same tools, spoken:
          cascade (STT → agent → TTS), realtime speech-to-speech, or a live
          avatar in a LiveKit room.
        </li>
        <li>
          <strong>Back-office and analyst agents</strong> — a sandboxed working
          environment where the agent writes scripts, produces spreadsheets and
          PDFs, and hands back artifacts.
        </li>
        <li>
          <strong>Operations agents over many services</strong> — dozens of MCP
          servers folded behind one SQL or code-eval tool instead of a hundred
          tool definitions.
        </li>
        <li>
          <strong>Multi-agent systems</strong> — a planner and its workers,
          messaging over the mesh, supervised as subprocesses.
        </li>
      </ul>

      <h2 id="how-it-fits-together">How it fits together</h2>

      <p>
        One runtime, five components, and a set of packages that plug into it.
      </p>

      <CodeBlock
        filename="architecture"
        language="text"
        code={`  your tools ─┐
              ▼
┌──────────────────────────────────────────────────────────┐
│  Agent          the agentic loop                         │
│  PromptMachine  model wrapper + system prompt            │
│  Executor       tool runner (Zod validation, retries)    │
│  Observer       turns, tokens, context compaction        │
│  DisplayManager the UI state machine                     │
└──────────────────────────────────────────────────────────┘
      ▼                ▼               ▼            ▼
 ModelAdapter    StoreAdapter   DisplayManager   Subscriber
 (any LLM)       (any DB)       (any UI layer)   (any sink)`}
      />

      <h2 id="where-to-go-next">Where to go next</h2>

      <DocCards
        cards={[
          {
            href: "/docs/installation",
            kicker: "Step 1",
            title: "Installation",
            desc: "Pick the packages your app shape needs, set a provider key, and you are running.",
          },
          {
            href: "/docs/getting-started",
            kicker: "Step 2",
            title: "Quickstart",
            desc: "A working agent with a real tool in 15 minutes — full-stack or server-only.",
          },
          {
            href: "/docs/concepts",
            kicker: "Step 3",
            title: "Core Concepts",
            desc: "The agent loop, tools, the display stack and compaction, explained properly.",
          },
          {
            href: "/docs/packages",
            kicker: "Reference",
            title: "All Packages",
            desc: "Every package Glove ships, what it solves, and the smallest snippet that uses it.",
          },
        ]}
      />
    </div>
  );
}
