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
          — the persistence layer. Where messages, tokens, turn counts, and
          (optionally) tasks, permissions, inbox items, and subagent stores
          live. <code>MemoryStore</code> ships in <code>glove-core</code> for
          prototyping; bring your own implementation for Postgres, Redis,
          remote APIs, or anything else.
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
          — the typed event observer. Receives a discriminated{" "}
          <code>SubscriberEvent</code> union covering model events
          (<code>text_delta</code>, <code>tool_use</code>,{" "}
          <code>model_response_complete</code>), executor events
          (<code>tool_use_result</code>), observer events
          (<code>compaction_start</code>, <code>compaction_end</code>,{" "}
          <code>token_consumption</code>), and extension events
          (<code>hook_invoked</code>, <code>skill_invoked</code>,{" "}
          <code>subagent_invoked</code>, <code>subagent_completed</code>).
          Use it for logging, analytics, or real-time streaming.
        </li>
      </ul>

      <p>
        For example, switching from OpenAI to Anthropic only requires changing
        the ModelAdapter — your tools, UI, and application logic stay the same.
      </p>

      <h3 id="subagent-stores">Sub-stores for subagents</h3>

      <p>
        <code>StoreAdapter</code> exposes one optional method specifically for
        subagent isolation:{" "}
        <code>createSubAgentStore(namespace, durable?)</code>. A subagent
        factory typically calls{" "}
        <code>parentStore.createSubAgentStore(name, durable)</code> to derive
        a child store before building the child <code>Glove</code>.
      </p>

      <ul>
        <li>
          <code>durable: false</code> (the default) returns a fresh store on
          every invocation — the subagent has no memory across calls.
        </li>
        <li>
          <code>durable: true</code> returns the same store for the same
          namespace, so the subagent accumulates message history across
          invocations.
        </li>
      </ul>

      <p>
        <code>MemoryStore</code> implements this out of the box; custom store
        implementations can opt in by supplying their own factory.
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

      <h2 id="the-inbox">The Inbox</h2>

      <p>
        The <a href="/docs/display-stack">display stack</a> handles synchronous
        interactions — the user clicks a button, the tool gets the result
        immediately. But some things can&apos;t be resolved in the moment: a
        product is out of stock, a payment is processing, an approval is needed
        from someone else.
      </p>

      <p>
        The inbox is a persistent async mailbox. An agent posts a request it
        can&apos;t fulfill now, and an external service resolves it later. The
        next time the agent runs, resolved items are automatically injected
        into the conversation. This works across sessions, server restarts, and
        different instances of the same agent.
      </p>

      <p>
        When your store implements the four optional inbox methods
        (<code>getInboxItems</code>, <code>addInboxItem</code>,{" "}
        <code>updateInboxItem</code>, <code>getResolvedInboxItems</code>),
        Glove auto-registers the <code>glove_post_to_inbox</code> tool —
        just like it auto-registers <code>glove_update_tasks</code> when task
        methods exist. The agent can call it whenever it decides something
        needs async tracking.
      </p>

      <p>
        Both the request and response are plain text — the agent writes in
        natural language, and the external service responds in natural language.
        Items can be <strong>blocking</strong> (the agent is told to wait) or{" "}
        <strong>non-blocking</strong> (the agent continues, result arrives
        later). Pending inbox items survive{" "}
        <a href="#context-compaction">context compaction</a> — they&apos;re
        preserved in the summary so the agent never forgets what it&apos;s
        waiting for.
      </p>

      <p>
        On the React side, <code>useGlove()</code> returns{" "}
        <code>inbox: InboxItem[]</code> alongside <code>tasks</code>, so your
        UI can show what the agent is tracking. External services resolve
        items by calling your store&apos;s <code>updateInboxItem</code> (from
        a webhook handler, cron job, or admin script) — any process with
        access to the same backing store can resolve an item.
      </p>

      <p>
        See the full <a href="/docs/inbox">Inbox guide</a> for setup,
        external resolution patterns, and the coffee shop example.
      </p>

      {/* ============================================================== */}
      <h2 id="extensions">Hooks, Skills &amp; Subagents</h2>

      <p>
        Glove ships three extension primitives for shaping a turn before — or
        instead of — calling the model:
      </p>

      <ul>
        <li>
          <strong>Hooks</strong> bind to user-side <code>/name</code>{" "}
          directives. The handler runs before the model with full{" "}
          <code>AgentControls</code> access — it can rewrite the user text,
          force compaction, swap the model mid-conversation, or short-circuit
          the turn entirely.
        </li>
        <li>
          <strong>Skills</strong> bind to user-side <code>/name</code>{" "}
          directives <em>or</em> are pulled in by the agent via the
          auto-registered <code>glove_invoke_skill</code> tool when{" "}
          <code>exposeToAgent: true</code>. They return text or{" "}
          <code>ContentPart[]</code> that lands as a synthetic user message
          marked <code>is_skill_injection: true</code>.
        </li>
        <li>
          <strong>Subagents</strong> are isolated child agents. The main
          agent routes to them via the auto-registered{" "}
          <code>glove_invoke_subagent</code> tool. Each invocation calls a
          factory that builds and returns a fresh <code>IGloveRunnable</code>;
          the dispatcher runs <code>processRequest(prompt)</code> on it and
          returns the final agent text as the tool result.
        </li>
      </ul>

      <p>
        When a user-side directive binds, the original <code>/name</code>{" "}
        token is replaced with a non-triggerable placeholder of the form{" "}
        <code>[invoked_extension__hook_&lt;name&gt;]</code> or{" "}
        <code>[invoked_extension__skill_&lt;name&gt;]</code>. The placeholder
        survives in the persisted user message so transcripts can still show
        what the user typed without the directive re-firing on a future
        parse. Unbound <code>/name</code> tokens (filesystem paths, etc.) are
        left untouched.
      </p>

      <p>
        Subagent runs are bracketed by <code>subagent_invoked</code> /{" "}
        <code>subagent_completed</code> subscriber events with{" "}
        <strong>guaranteed 1:1 symmetry</strong> — the executor fires both
        events around every <code>glove_invoke_subagent</code> call, even on
        abort. While the child is running, the parent&apos;s subscribers fan
        out to it, so streaming UIs see the child&apos;s{" "}
        <code>text_delta</code> and <code>tool_use</code> events as part of
        the same stream.
      </p>

      <p>
        See the full <a href="/docs/extensions">Extensions guide</a> for
        types, dispatch order, and worked examples.
      </p>
    </div>
  );
}
