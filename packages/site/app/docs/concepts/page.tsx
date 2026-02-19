export default function ConceptsPage() {
  return (
    <div className="docs-content">
      <h1>Core Concepts</h1>

      <p>
        This page explains how Glove works under the hood. If you haven&apos;t
        built your first app yet, start with{" "}
        <a href="/docs/getting-started">Getting Started</a> — it takes 15
        minutes and you&apos;ll come back here with useful context.
      </p>

      <h2 id="the-agent-loop">The Agent Loop</h2>

      <p>
        Every Glove app is driven by a loop. Here is what happens each time a
        user sends a message:
      </p>

      <ol>
        <li>The user&apos;s message is added to the conversation history</li>
        <li>
          The AI reads the full conversation and the list of available tools
        </li>
        <li>
          The AI either responds with text (ending the loop) or requests one or
          more tool calls
        </li>
        <li>
          Glove executes the requested tools and adds the results to the
          conversation
        </li>
        <li>Go back to step 2</li>
      </ol>

      <p>
        The key insight: the AI decides which tools to call and in what order.
        You don&apos;t write if/else logic or state machines. You define
        capabilities, and the AI uses them to fulfill user requests.
      </p>

      <p>
        This loop is implemented by the{" "}
        <a href="/docs/core#agent">Agent class</a>. On the client side, the{" "}
        <a href="/docs/react#useglove">useGlove hook</a> manages this loop
        automatically.
      </p>

      <h2 id="tools">Tools</h2>

      <p>
        A tool is a capability your app exposes to the AI. Each tool has four
        parts:
      </p>

      <ul>
        <li>
          <strong>name</strong> — a unique identifier (like{" "}
          <code>&quot;get_weather&quot;</code>)
        </li>
        <li>
          <strong>description</strong> — a plain-English explanation of what it
          does. The AI reads this to decide when to use the tool.
        </li>
        <li>
          <strong>inputSchema</strong> — a{" "}
          <a href="https://zod.dev" target="_blank" rel="noopener noreferrer">
            Zod
          </a>{" "}
          schema that defines what input the tool expects. Glove validates
          inputs at runtime before your code runs.
        </li>
        <li>
          <strong>do</strong> — the function that runs when the AI calls the
          tool. It receives the validated input and returns a result that gets
          sent back to the AI.
        </li>
      </ul>

      <p>
        Tools can be pure functions (compute something, fetch data, call an
        API) or interactive — they can push UI to the{" "}
        <a href="#the-display-stack">display stack</a> to show the user results
        or ask for input.
      </p>

      <p>
        See{" "}
        <a href="/docs/react#tool-config">ToolConfig</a> for the full type
        definition.
      </p>

      <p>
        For tools with display UI, use <code>defineTool</code> from{" "}
        <code>glove-react</code> — it provides typed display props, typed
        resolve values, and colocated <code>renderResult</code> for history
        rendering. See the{" "}
        <a href="/docs/display-stack">Display Stack guide</a> for examples.
      </p>

      <h2 id="the-display-stack">The Display Stack</h2>

      <p>
        The display stack is what makes Glove an app framework, not just a
        chatbot. When a tool runs, it can push a React component onto a stack
        that your app renders. This is how tools show UI to the user —
        product grids, forms, confirmation dialogs, data cards, anything.
      </p>

      <p>
        The <code>do</code> function receives a <code>display</code> parameter
        with two methods:
      </p>

      <ul>
        <li>
          <strong>
            <code>pushAndForget</code>
          </strong>{" "}
          — push a component and keep the tool running. Use this for
          showing results: data cards, product grids, status updates. The tool
          returns normally.
        </li>
        <li>
          <strong>
            <code>pushAndWait</code>
          </strong>{" "}
          — push a component and <em>pause</em> the tool until the user
          responds. Use this for collecting input: forms, confirmations,
          preference pickers. The tool resumes when the user submits.
        </li>
      </ul>

      <p>
        Think of it like this: <code>pushAndForget</code> is like printing a
        receipt — here is your result. <code>pushAndWait</code> is like handing
        someone a clipboard — fill this out and give it back.
      </p>

      <p>
        Tools can also control when their display slots are visible using{" "}
        <strong>display strategies</strong>:{" "}
        <code>&quot;stay&quot;</code> (always visible),{" "}
        <code>&quot;hide-on-complete&quot;</code> (hidden after the user
        responds), and <code>&quot;hide-on-new&quot;</code> (hidden when a
        newer slot from the same tool appears). The{" "}
        <code>&lt;Render&gt;</code> component from <code>glove-react</code>{" "}
        handles this visibility logic automatically.
      </p>

      <p>
        On the React side, the{" "}
        <a href="/docs/react#useglove">useGlove hook</a> exposes{" "}
        <code>slots</code> (the current stack) and{" "}
        <code>renderSlot()</code> (renders a slot using the tool&apos;s{" "}
        <code>render</code> function). See{" "}
        <a href="/docs/react#tool-display">ToolDisplay</a> for the full API.
      </p>

      <h2 id="colocated-renderers">Colocated Renderers</h2>

      <p>
        When you define a tool in <code>glove-react</code>, you can include a{" "}
        <code>render</code> function alongside the <code>do</code> function.
        This means the tool&apos;s logic and its UI live together in the same
        object — no separate component files, no string-based lookups.
      </p>

      <p>
        When you call <code>display.pushAndWait({"{ input }"})</code> from a
        tool that has a <code>render</code> function, Glove automatically uses
        the tool&apos;s name to match the slot to the renderer. The{" "}
        <a href="/docs/react#useglove">useGlove hook</a> builds the renderer
        map and provides <code>renderSlot()</code> to your component.
      </p>

      <p>
        For type-safe colocated renderers, use <code>defineTool</code>{" "}
        instead of raw <code>ToolConfig</code>. It adds typed{" "}
        <code>props</code> and <code>resolve</code> in the{" "}
        <code>render</code> function, plus a <code>renderResult</code>{" "}
        function for showing read-only views from history. See the{" "}
        <a href="/docs/react#define-tool">React API reference</a> for
        details.
      </p>

      <h2 id="adapters">Adapters</h2>

      <p>
        Glove uses four pluggable interfaces (called adapters) to stay
        flexible. Each adapter can be swapped without changing your application
        code:
      </p>

      <ul>
        <li>
          <strong>
            <a href="/docs/core#model-adapter">ModelAdapter</a>
          </strong>{" "}
          — the AI provider. Anthropic, OpenAI, local models, or mocks for
          testing. Anything that takes messages and returns responses.
        </li>
        <li>
          <strong>
            <a href="/docs/core#store-adapter">StoreAdapter</a>
          </strong>{" "}
          — the persistence layer. Where messages, tokens, and turn counts are
          stored. In-memory, SQLite, Postgres, or a remote API.
        </li>
        <li>
          <strong>
            <a href="/docs/core#display-manager-adapter">
              DisplayManagerAdapter
            </a>
          </strong>{" "}
          — the UI state layer. Manages the display stack.
          Framework-agnostic — works with React, Vue, Svelte, or a terminal UI.
        </li>
        <li>
          <strong>
            <a href="/docs/core#subscriber-adapter">SubscriberAdapter</a>
          </strong>{" "}
          — the event observer. Receives events like{" "}
          <code>text_delta</code>, <code>tool_use</code>, and{" "}
          <code>tool_use_result</code>. Use it for logging, analytics, or
          real-time streaming.
        </li>
      </ul>

      <p>
        For example, switching from OpenAI to Anthropic only requires changing
        the ModelAdapter — your tools, UI, and application logic stay the same.
      </p>

      <h2 id="context-compaction">Context Compaction</h2>

      <p>
        AI models have a limited context window — the maximum amount of
        conversation they can read at once. Long conversations eventually hit
        this limit.
      </p>

      <p>
        Glove handles this automatically: when the conversation gets too long,
        it summarizes everything so far and injects the summary as a new
        message. This is called <strong>compaction</strong>. The store
        preserves the full message history — compaction never deletes
        messages. Instead, it calls <code>resetCounters()</code> on the store
        to reset token and turn counts, and appends a compaction summary
        message marked with{" "}
        <code>is_compaction: true</code>.
      </p>

      <p>
        When the agent loop calls <code>Context.getMessages()</code>, the
        result is split at the last compaction boundary — the model only sees
        messages from the most recent compaction onward. This keeps the
        context window small and focused while the underlying store retains
        every message ever exchanged.
      </p>

      <p>
        Because full history is preserved, the frontend can read directly from
        the store to display the complete conversation — including messages
        from before compaction — even though the model never sees them. Task
        state is also preserved across compaction boundaries, so sessions can
        run indefinitely without losing track of what they were doing.
      </p>

      <p>
        You can configure compaction behavior with{" "}
        <a href="/docs/react#compaction-config">CompactionConfig</a>.
      </p>
    </div>
  );
}
