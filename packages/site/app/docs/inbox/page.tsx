import { CodeBlock } from "@/components/code-block";

export default async function InboxPage() {
  return (
    <div className="docs-content">
      <h1>The Inbox</h1>

      <p>
        In <a href="/docs/display-stack">The Display Stack</a> you learned how
        tools show UI and collect user input within a single conversation turn.
        But what happens when something can&apos;t be resolved right now?
      </p>

      <p>
        The inbox is a persistent async mailbox. An agent posts a request it
        can&apos;t fulfill immediately — and an external service resolves it
        later. The next time the agent runs, it picks up the result automatically.
        This works across sessions, server restarts, and different instances of
        the same agent.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>When to use the inbox</h2>

      <p>The display stack handles synchronous, in-process interactions well:</p>

      <ul>
        <li>User clicks a button → tool gets the result immediately</li>
        <li>User fills a form → tool processes the submission</li>
      </ul>

      <p>
        The inbox handles <strong>asynchronous, cross-instance</strong> scenarios:
      </p>

      <ul>
        <li>A product is out of stock → watch for restock, notify later</li>
        <li>A payment is processing → wait for webhook confirmation</li>
        <li>A background job is running → poll until complete</li>
        <li>An approval is needed → another human resolves it later</li>
      </ul>

      <p>
        Think of it this way: the display stack is like handing someone a
        clipboard and waiting. The inbox is like dropping a letter in a mailbox
        and checking back later.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>How it works</h2>

      <ol>
        <li>
          The agent calls <code>glove_post_to_inbox</code> with a tag, a
          natural language request, and a blocking flag
        </li>
        <li>
          The item is persisted in the store with status{" "}
          <code>&quot;pending&quot;</code>
        </li>
        <li>
          An external service (background job, webhook, cron, admin action)
          resolves the item with a text response
        </li>
        <li>
          Next time <code>agent.ask()</code> runs, resolved items are injected
          into the conversation as text messages and marked{" "}
          <code>&quot;consumed&quot;</code>
        </li>
        <li>
          Pending blocking items appear as transient reminders so the agent
          knows it&apos;s still waiting
        </li>
      </ol>

      <p>
        The inbox survives context compaction — pending items are preserved in
        the compaction summary so the agent never forgets what it&apos;s waiting
        for.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The built-in tool</h2>

      <p>
        When your store implements inbox methods, Glove automatically registers
        the <code>glove_post_to_inbox</code> tool. The agent can call it
        whenever it decides something needs to be tracked asynchronously.
      </p>

      <CodeBlock
        filename="glove_post_to_inbox — input schema"
        language="typescript"
        code={`{
  tag: string,       // Category label, e.g. "restock_watch", "payment_pending"
  request: string,   // Natural language: "Notify when Yirgacheffe is back in stock"
  blocking: boolean, // Default false. If true, agent should wait for resolution
}`}
      />

      <p>
        The tool returns the inbox item ID. The agent can reference it in
        conversation and the user sees it tracked in the UI.
      </p>

      <h3>Blocking vs non-blocking</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Behavior</th>
            <th>Use for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>blocking: false</code></td>
            <td>Agent continues normally, result arrives later</td>
            <td>Restock watches, background jobs, optional notifications</td>
          </tr>
          <tr>
            <td><code>blocking: true</code></td>
            <td>Agent is told it cannot proceed until resolved</td>
            <td>Payment confirmations, required approvals, critical dependencies</td>
          </tr>
        </tbody>
      </table>

      <p>
        Blocking is <strong>soft enforcement</strong> — the agent receives a
        message saying it should wait, but it&apos;s not mechanically prevented
        from acting. This matches how tasks and permissions work in Glove.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Enabling the inbox</h2>

      <p>
        The inbox is enabled by implementing four optional methods on your store.
        All built-in stores (<code>SqliteStore</code>, <code>MemoryStore</code>,{" "}
        <code>createRemoteStore</code>) already support it.
      </p>

      <CodeBlock
        filename="StoreAdapter — inbox methods"
        language="typescript"
        code={`interface StoreAdapter {
  // ...existing methods...

  // Inbox (optional — enables glove_post_to_inbox when present)
  getInboxItems?(): Promise<InboxItem[]>;
  addInboxItem?(item: InboxItem): Promise<void>;
  updateInboxItem?(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void>;
  getResolvedInboxItems?(): Promise<InboxItem[]>;
}`}
      />

      <p>
        When all four methods are present, Glove auto-registers the{" "}
        <code>glove_post_to_inbox</code> tool — just like{" "}
        <code>glove_update_tasks</code> is auto-registered when task methods
        exist.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The InboxItem type</h2>

      <CodeBlock
        filename="glove-core/core"
        language="typescript"
        code={`type InboxItemStatus = "pending" | "resolved" | "consumed";

interface InboxItem {
  id: string;               // Auto-generated unique ID
  tag: string;              // Category label
  request: string;          // What the agent asked for (natural language)
  response: string | null;  // External service's response (null while pending)
  status: InboxItemStatus;  // Lifecycle state
  blocking: boolean;        // Whether the agent should wait
  created_at: string;       // ISO 8601 timestamp
  resolved_at: string | null;
}`}
      />

      <p>
        Both <code>request</code> and <code>response</code> are plain text.
        The agent writes in natural language, and the external service responds
        in natural language. No structured payloads — the model interprets the
        text.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Resolving items externally</h2>

      <p>
        The whole point of the inbox is that something <em>outside</em> the
        agent resolves the request. Glove provides a static helper for this:
      </p>

      <CodeBlock
        filename="Background job / webhook handler"
        language="typescript"
        code={`import { SqliteStore } from "glove-core";

// Resolve an inbox item from any process that has DB access
const resolved = SqliteStore.resolveInboxItem(
  "path/to/sessions.db",     // Same DB the agent uses
  "inbox_17119...",           // The item ID
  "Great news! The Yirgacheffe is back in stock and ready to order."
);

if (!resolved) {
  console.log("Item not found or already resolved");
}`}
      />

      <p>
        This opens its own database connection, updates the item, and closes.
        It can be called from a completely separate process — a cron job, a
        webhook handler, an admin script, or another service entirely.
      </p>

      <p>
        For web apps, you&apos;ll typically expose this as an API endpoint:
      </p>

      <CodeBlock
        filename="app/api/inbox/resolve/route.ts"
        language="typescript"
        code={`import { NextResponse } from "next/server";
import { SqliteStore } from "glove-core";

export async function POST(req: Request) {
  const { itemId, response } = await req.json();

  const resolved = SqliteStore.resolveInboxItem(DB_PATH, itemId, response);

  if (!resolved) {
    return NextResponse.json({ error: "Not found or already resolved" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>React integration</h2>

      <p>
        The <code>useGlove</code> hook returns <code>inbox</code> alongside{" "}
        <code>tasks</code>:
      </p>

      <CodeBlock
        filename="app/components/chat.tsx"
        language="tsx"
        code={`const { inbox, tasks, timeline, sendMessage } = useGlove({ tools, sessionId });

// Show pending watches in a sidebar
{inbox.filter(i => i.status === "pending").map(item => (
  <div key={item.id}>
    <span className="tag">{item.tag}</span>
    <span className="request">{item.request}</span>
    <span className="status">pending</span>
  </div>
))}

// Resolved items show up too — until consumed by the agent
{inbox.filter(i => i.status === "resolved").map(item => (
  <div key={item.id}>
    <span className="tag">{item.tag}</span>
    <span className="response">{item.response}</span>
    <span className="status">resolved</span>
  </div>
))}`}
      />

      <p>
        Inbox state is hydrated from the store on mount and refreshed after
        each <code>processRequest</code> call.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Wiring remote store actions</h2>

      <p>
        When using <code>createRemoteStore</code> (the typical setup for
        Next.js apps), you need to wire inbox actions to your API routes.
        Without these, inbox falls back to in-memory storage and items vanish
        on reload.
      </p>

      <CodeBlock
        filename="app/lib/store-actions.ts"
        language="typescript"
        code={`import type { RemoteStoreActions } from "glove-react";

export const storeActions: RemoteStoreActions = {
  // ...existing getMessages, appendMessages...

  // Inbox — required for persistence across reloads
  getInboxItems: (sid) =>
    fetch(\`/api/sessions/\${sid}/inbox\`).then(r => r.json()),

  addInboxItem: (sid, item) =>
    fetch(\`/api/sessions/\${sid}/inbox\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
    }),

  updateInboxItem: (sid, itemId, updates) =>
    fetch(\`/api/sessions/\${sid}/inbox/update\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, updates }),
    }),

  getResolvedInboxItems: (sid) =>
    fetch(\`/api/sessions/\${sid}/inbox/resolved\`).then(r => r.json()),
};`}
      />

      <p>
        The corresponding API routes delegate to <code>SqliteStore</code>{" "}
        methods — the same pattern as the message routes.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>System prompt guidance</h2>

      <p>
        Like all tools, the agent uses the inbox better when you explain it in
        the system prompt. Here&apos;s what works well:
      </p>

      <CodeBlock
        filename="System prompt excerpt"
        language="text"
        code={`## Async Notifications
- Some requests can't be fulfilled immediately (out of stock, pending approval, etc.)
- Use glove_post_to_inbox to track these for the customer
- Use a descriptive tag (e.g. "restock_watch", "approval_pending")
- Describe what the customer wants in natural language in the request field
- Set blocking=false unless the customer literally cannot proceed without the result
- When an inbox item is resolved, you'll see the response — inform the customer`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Example: Coffee shop restock</h2>

      <p>
        The <a href="/docs/showcase/coffee-shop">Coffee Shop</a> example
        demonstrates the inbox with inventory tracking:
      </p>

      <ol>
        <li>
          Customer asks for Yirgacheffe — it&apos;s out of stock
        </li>
        <li>
          Agent offers to watch for restocking and calls{" "}
          <code>glove_post_to_inbox</code> with tag{" "}
          <code>&quot;restock_watch&quot;</code>
        </li>
        <li>
          The item appears in the &quot;Watching&quot; section of the sidebar
        </li>
        <li>
          An external process resolves the item (simulated via{" "}
          <code>POST /api/inbox/simulate-restock</code>)
        </li>
        <li>
          Customer sends a new message — the agent picks up the resolved item
          and says &quot;Great news! The Yirgacheffe is back in stock&quot;
        </li>
      </ol>

      {/* ------------------------------------------------------------------ */}
      <h2>Lifecycle diagram</h2>

      <CodeBlock
        filename="Inbox item lifecycle"
        language="text"
        code={`Agent calls glove_post_to_inbox
    │
    ▼
┌─────────┐   External service    ┌──────────┐   Next ask() call   ┌──────────┐
│ pending  │ ──────────────────▶  │ resolved │ ─────────────────▶  │ consumed │
└─────────┘   resolveInboxItem()  └──────────┘   injected as text  └──────────┘
    │                                                                     │
    │ (if blocking)                                                       │
    ▼                                                                     ▼
Agent sees transient                                          Agent sees resolved
"still pending" reminder                                      response in context
on each ask() call                                            and informs the user`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Comparison with the display stack</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Display Stack</th>
            <th>Inbox</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Timing</td>
            <td>Synchronous — within a single turn</td>
            <td>Asynchronous — across sessions and instances</td>
          </tr>
          <tr>
            <td>Resolved by</td>
            <td>The user (clicking buttons, filling forms)</td>
            <td>External services (background jobs, webhooks)</td>
          </tr>
          <tr>
            <td>Persistence</td>
            <td>Ephemeral — slots live in memory</td>
            <td>Persistent — survives restarts and reloads</td>
          </tr>
          <tr>
            <td>UI</td>
            <td>Rich React components via render/renderResult</td>
            <td>Text-based — agent interprets the response</td>
          </tr>
          <tr>
            <td>Use for</td>
            <td>Forms, confirmations, data cards</td>
            <td>Restock watches, payment webhooks, background jobs</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/display-stack">The Display Stack</a>{" "}
          — synchronous UI interactions with pushAndWait and pushAndForget
        </li>
        <li>
          <a href="/docs/showcase/coffee-shop">Coffee Shop Example</a>{" "}
          — see the inbox in action with inventory tracking
        </li>
        <li>
          <a href="/docs/core">Core API</a>{" "}
          — StoreAdapter interface and InboxItem type reference
        </li>
        <li>
          <a href="/docs/react">React API</a>{" "}
          — useGlove hook return values including inbox
        </li>
      </ul>
    </div>
  );
}
