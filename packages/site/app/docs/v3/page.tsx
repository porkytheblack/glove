import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block";

export const metadata: Metadata = {
  title: "v3.0.0 Release Notes — Glove",
  description:
    "Glove 3.0.0 ships first-class subagents, a guaranteed-symmetric event system, MemoryStore in core, sub-stores, pre-emptive compaction, and signal-aware tool execution. Migration guide included.",
};

export default function V3ReleaseNotesPage() {
  return (
    <div className="docs-content">
      <h1>v3.0.0 Release Notes</h1>

      <p>
        Glove 3.0.0 lands four big shifts: <strong>first-class subagents</strong>{" "}
        with a factory pattern, a <strong>guaranteed-symmetric event system</strong>{" "}
        for hooks/skills/subagents, <strong>sub-stores</strong> for per-run cost
        attribution, and a default <strong>MemoryStore</strong> in{" "}
        <code>glove-core</code> so a fresh <code>Glove</code> works without any
        store wiring.
      </p>

      <p>
        Alongside core, four packages ship at <strong>0.5.0</strong> as
        early-access:{" "}
        <code>glove-mcp</code>, <code>glovebox-core</code>,{" "}
        <code>glovebox-kit</code>, <code>glovebox-client</code>.
      </p>

      <h2>Highlights</h2>

      <ul>
        <li>
          <strong>First-class subagents.</strong>{" "}
          <code>defineSubAgent</code> takes a factory that returns a fully-built
          child <code>Glove</code>. The framework runs{" "}
          <code>child.processRequest(prompt, signal)</code> and returns the
          final agent text as the tool result.
        </li>
        <li>
          <strong>Sub-stores.</strong>{" "}
          <code>parentStore.createSubAgentStore(name, durable?)</code> spins up
          an isolated child store so subagent conversations and token usage are
          tracked independently. Implemented by the new <code>MemoryStore</code>
          ; opt-in for custom stores.
        </li>
        <li>
          <strong>Bracketed event symmetry.</strong>{" "}
          <code>subagent_invoked</code> /
          {" "}<code>subagent_completed</code> are fired by the Executor (not the
          dispatcher), so the bracket closes even when an abort short-circuits
          the dispatcher's promise. Subscribers see <strong>1:1 pairs</strong>.
        </li>
        <li>
          <strong>MemoryStore in core.</strong> No more boilerplate stores for
          prototyping — <code>Glove</code> instantiates a{" "}
          <code>MemoryStore</code> automatically when no store is supplied.
        </li>
        <li>
          <strong>Pre-emptive compaction.</strong> The Observer's new{" "}
          <code>ESCAPE_COMPACTION_THRESHOLD</code> (default 90%) prevents
          {" "}<code>tool_use</code> / <code>tool_result</code> pairs from being
          split across compaction boundaries.
        </li>
      </ul>

      <h2>Updated packages</h2>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>glove-core</code></td><td>3.0.0</td></tr>
          <tr><td><code>glove-react</code></td><td>3.0.0</td></tr>
          <tr><td><code>glove-voice</code></td><td>3.0.0</td></tr>
          <tr><td><code>glove-next</code></td><td>3.0.0</td></tr>
        </tbody>
      </table>

      <h2>New / promoted packages (early-access at 0.5.0)</h2>

      <p>
        Four packages ship as <strong>0.5.0</strong>. They&apos;re production-grade
        but the surface is still solidifying — semver-minor bumps may land
        in 0.6.x.
      </p>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glove-mcp</code></td>
            <td>
              MCP server bridging. <code>mountMcp</code> reloads
              previously-activated servers and registers the{" "}
              <code>discovermcp</code> discovery subagent. Promoted from
              internal use to a stable surface.{" "}
              <a href="/docs/mcp">MCP guide →</a>
            </td>
          </tr>
          <tr>
            <td><code>glovebox-core</code></td>
            <td>
              Authoring kit and <code>glovebox</code> build CLI. Wrap a built
              <code> Glove</code> runnable, run{" "}
              <code>glovebox build</code>, ship the resulting Dockerfile or
              nixpacks bundle to any container host.{" "}
              <a href="/docs/glovebox">Glovebox guide →</a>
            </td>
          </tr>
          <tr>
            <td><code>glovebox-kit</code></td>
            <td>
              In-container runtime. Hosts a Glove agent behind a single
              authenticated WebSocket plus an HTTP <code>/files</code> route
              for outputs. Most consumers don&apos;t import this directly —{" "}
              <code>glovebox build</code> generates a server entry that uses
              it.
            </td>
          </tr>
          <tr>
            <td><code>glovebox-client</code></td>
            <td>
              Client SDK for talking to a deployed Glovebox server. One
              WebSocket per session, multiple prompts multiplexed. Streams
              subscriber events and display slot pushes; resolves with the
              final assistant message and an outputs map of{" "}
              <code>FileRef</code>s.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Deprecated</h2>

      <p>
        <code>glove-sqlite</code> is deprecated and will not receive new
        features. The new <code>MemoryStore</code> in <code>glove-core</code>{" "}
        covers most prototyping needs; for production durability, BYO{" "}
        <code>StoreAdapter</code>. The package still installs and works, just
        without <code>createSubAgentStore</code> support.
      </p>

      <h2>Breaking changes</h2>

      <h3>1. <code>StoreAdapter.addTokens(args: TokenConsumptionCounter)</code></h3>

      <p>
        Was <code>(count: number)</code>. The counter is{" "}
        <code>{`{ tokens_in: number; tokens_out: number }`}</code> — the
        framework now records both directions separately, useful for
        per-direction cost reporting. <code>getTokenCount()</code> still
        returns a single sum. Affects every custom <code>StoreAdapter</code>.
      </p>

      <CodeBlock
        filename="my-store.ts"
        language="typescript"
        code={`// Before
async addTokens(count: number) {
  this.tokens += count
}

// After
async addTokens(args: TokenConsumptionCounter) {
  this.tokens += args.tokens_in + args.tokens_out
}`}
      />

      <p>
        In <code>glove-react</code>, the same change applies to{" "}
        <code>RemoteStoreActions.addTokens(sessionId, args: TokenConsumptionCounter)</code>{" "}
        — breaking for any consumer wiring custom remote-store actions.
      </p>

      <h3>2. <code>defineMention</code> → <code>defineSubAgent</code> (factory pattern)</h3>

      <p>
        <code>defineMention(args)</code> is removed. The whole <code>Mention*</code>{" "}
        family of types is replaced by <code>SubAgent*</code>. The shape changed
        too: instead of returning string content, the factory builds and returns
        a fully-built child <code>Glove</code>. The framework calls{" "}
        <code>child.processRequest(prompt, signal)</code> and uses the final
        agent text as the tool result.
      </p>

      <CodeBlock
        filename="lib/agent.ts"
        language="typescript"
        code={`// Before
glove.defineMention({
  name: "researcher",
  handler: async ({ prompt, controls }) => {
    return "research result"
  },
})

// After
import { Glove, MemoryStore } from "glove-core"

glove.defineSubAgent({
  name: "researcher",
  description: "Deep web research subagent",
  factory: async ({ parentStore, parentControls, prompt, name }) => {
    const subStore = await parentStore.createSubAgentStore?.(name, false)
      ?? new MemoryStore(\`\${name}_\${Date.now()}\`)

    return new Glove({
      store: subStore,
      model: parentControls.glove.model,
      displayManager: parentControls.displayManager,
      systemPrompt: "You are a researcher.",
      compaction_config: {
        compaction_instructions: "Summarize research progress.",
      },
    })
      .fold(searchTool)
      .fold(fetchTool)
      .build()
  },
})`}
      />

      <p>
        The agent invokes the subagent through the auto-registered{" "}
        <code>glove_invoke_subagent</code> tool — the user&apos;s{" "}
        <code>@subagent-name</code> text in messages still reaches the model
        verbatim as a routing nudge.
      </p>

      <h3>3. <code>glove-mcp</code>: <code>discoveryTool</code> → <code>discoverySubAgent</code>; <code>find_capability</code> → <code>discovermcp</code></h3>

      <p>
        <code>discoveryTool({"{...}"})</code> is renamed{" "}
        <code>discoverySubAgent({"{...}"})</code> and now returns{" "}
        <code>DefineSubAgentArgs</code> (used with{" "}
        <code>glove.defineSubAgent(...)</code> instead of{" "}
        <code>glove.fold(...)</code>). The discovery subagent&apos;s name is{" "}
        <code>discovermcp</code> (was <code>find_capability</code>); the model
        invokes via{" "}
        <code>glove_invoke_subagent({"{ name: \"discovermcp\", prompt: \"...\" }"})</code>.
      </p>

      <p>
        <code>mountMcp</code> consumers don&apos;t need to change anything — it
        wires the new shape internally. Update any system prompt that mentions
        the old name:
      </p>

      <CodeBlock
        filename="lib/agent.ts"
        language="typescript"
        code={`// Before
systemPrompt:
  "When the user asks for an external integration, " +
  "call find_capability to discover and activate the right MCP server."

// After
systemPrompt:
  "When the user asks for an external integration, " +
  "invoke the \`discovermcp\` subagent (via the \`glove_invoke_subagent\` tool) " +
  "with a brief description of what you need."`}
      />

      <h3>4. Hook / skill directives — placeholders, not stripped</h3>

      <p>
        User text containing <code>/skill-name</code> or <code>/hook-name</code>{" "}
        directives is no longer stripped from the persisted user message. Each
        bound directive is replaced by a non-triggerable placeholder of the
        form <code>[invoked_extension__hook_&lt;name&gt;]</code> or{" "}
        <code>[invoked_extension__skill_&lt;name&gt;]</code>. Hook and skill
        handlers receive <code>parsedText</code> containing the placeholder,
        not the bare directive.
      </p>

      <p>
        UIs that previously rendered raw user text now see the placeholder
        embedded in the message body. If you need the original text (e.g. for
        a hook that rewrites the message), read the new{" "}
        <code>Message.pre_modified_text</code> field.
      </p>

      <h3>5. <code>Tool.run</code> and <code>GloveFoldArgs.do</code> gain optional <code>signal</code></h3>

      <p>
        <code>Tool.run(input, handOver?, signal?)</code> — backward-compatible;
        tools that ignore the third arg still work.{" "}
        <code>GloveFoldArgs.do(input, display, glove, signal?)</code> similarly
        gains an optional fourth <code>signal</code>. Tools that perform
        long-running internal work (subagent dispatchers, fetches) should
        forward it so abort propagates all the way down.
      </p>

      <h2>What&apos;s new</h2>

      <h3>Subscriber events</h3>

      <p>Five new <code>SubscriberEvent</code> variants:</p>

      <ul>
        <li>
          <code>token_consumption</code> —{" "}
          <code>{`{ consumption: TokenConsumptionCounter }`}</code>. Fired by
          the Observer after each model turn.
        </li>
        <li>
          <code>hook_invoked</code> — <code>{`{ name }`}</code>. Fired by Glove
          just before a hook handler runs.
        </li>
        <li>
          <code>skill_invoked</code> —{" "}
          <code>{`{ name, source: "user" | "agent", args? }`}</code>. User-side
          fires from Glove; agent-side fires from the skill dispatch tool.
        </li>
        <li>
          <code>subagent_invoked</code> —{" "}
          <code>{`{ name, prompt }`}</code>. Fired by the Executor before
          invoking the subagent dispatch tool.
        </li>
        <li>
          <code>subagent_completed</code> —{" "}
          <code>{`{ name, status: "success" | "error", message? }`}</code>.
          Fired by the Executor after the dispatch tool resolves OR on abort.
        </li>
      </ul>

      <p>
        <strong>Bracket symmetry is guaranteed.</strong> The Executor brackets
        every <code>glove_invoke_subagent</code> call regardless of outcome,
        so a parent-side abort that cuts the dispatcher&apos;s promise still
        produces a matching close bracket. Subscribers can model subagent runs
        as a stack and trust the brackets.
      </p>

      <h3>Sub-stores</h3>

      <p>
        <code>StoreAdapter.createSubAgentStore?(namespace, durable?)</code> is
        a new optional hook. With <code>durable: false</code> (default) it
        returns a fresh child store per call; with <code>durable: true</code>{" "}
        it returns a cached child for the namespace, so a subagent can carry
        message history across invocations.
      </p>

      <p>
        The new <code>MemoryStore</code> in <code>glove-core</code> implements
        this out of the box, so subagents derived via the standard factory
        pattern get isolated child stores automatically.
      </p>

      <h3><code>MemoryStore</code> in <code>glove-core</code></h3>

      <p>
        A comprehensive in-memory <code>StoreAdapter</code> is now exported
        from <code>glove-core</code>. It implements the full surface
        (messages, tokens, turns, tasks, permissions, inbox, sub-stores) and
        is used as the default when <code>Glove</code> is constructed without
        a store.
      </p>

      <CodeBlock
        filename="lib/agent.ts"
        language="typescript"
        code={`import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core"

const agent = new Glove({
  store: new MemoryStore("session"),  // optional — default is a fresh MemoryStore
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant.",
  compaction_config: { compaction_instructions: "Summarize so far." },
}).build()`}
      />

      <h3>Display stack sharing for subagents</h3>

      <p>
        <code>AgentControls</code> exposes the parent&apos;s{" "}
        <code>displayManager</code> directly so subagent factories can build a
        child Glove that pushes UI to the parent&apos;s display stack. New{" "}
        <code>setDisplayManager(dm)</code> on{" "}
        <code>IGloveRunnable</code> / <code>IGloveBuilder</code> lets a
        subagent swap displays mid-run if it changes its mind.
      </p>

      <h3><code>Glove.build(store?)</code> and <code>Glove.rebuild(store?)</code></h3>

      <p>
        The store can now be supplied at build time instead of construction
        time. Tools folded before build are correctly transferred into the
        rebuilt executor — this is what makes the subagent factory pattern
        work cleanly.
      </p>

      <h3>Pre-emptive compaction</h3>

      <p>
        <code>Observer.ESCAPE_COMPACTION_THRESHOLD</code> (default 90%) is a
        soft trigger before the hard <code>CONTEXT_COMPACTION_LIMIT</code>. If
        the soft threshold is crossed AND the model just produced tool calls,{" "}
        <code>Agent.ask</code> runs <code>runCompactionNow()</code>{" "}
        before appending the tool calls — keeping{" "}
        <code>tool_use</code> and matching <code>tool_result</code> pairs
        together post-summary. Configurable via the Observer constructor&apos;s
        7th arg.
      </p>

      <h3><code>Message.pre_modified_text</code></h3>

      <p>
        When a hook rewrites a user message via{" "}
        <code>HookResult.rewriteText</code>, the original text is now
        preserved on the new <code>pre_modified_text</code> field of the
        message — so UIs can still display what the user actually typed.
      </p>

      <h2>Migration checklist</h2>

      <ol>
        <li>
          <strong>Update every custom <code>StoreAdapter</code></strong> to the
          new <code>addTokens(args: TokenConsumptionCounter)</code> signature.
          If you maintain a single sum, add{" "}
          <code>args.tokens_in + args.tokens_out</code>.
        </li>
        <li>
          <strong>If you wired <code>RemoteStoreActions.addTokens</code></strong>{" "}
          for <code>glove-react</code>, update its signature too.
        </li>
        <li>
          <strong>Replace any <code>defineMention</code> call</strong> with{" "}
          <code>defineSubAgent</code> + a factory that returns a built{" "}
          <code>IGloveRunnable</code>. Remove imports of{" "}
          <code>MentionContext</code>, <code>MentionHandler</code>,{" "}
          <code>MentionOptions</code>, <code>DefineMentionArgs</code>,{" "}
          <code>RegisteredMention</code>.
        </li>
        <li>
          <strong>If you call <code>discoveryTool</code> directly</strong>{" "}
          (rather than going through <code>mountMcp</code>), rename to{" "}
          <code>discoverySubAgent</code> and pass it to{" "}
          <code>glove.defineSubAgent(...)</code>.
        </li>
        <li>
          <strong>Update system prompts</strong> that mention{" "}
          <code>find_capability</code> — point at <code>discovermcp</code> via
          the <code>glove_invoke_subagent</code> dispatch tool instead.
        </li>
        <li>
          <strong>UIs reading raw user message text</strong> — be aware that
          slash directives now appear as{" "}
          <code>[invoked_extension__&lt;type&gt;_&lt;name&gt;]</code>{" "}
          placeholders. If you need the unmodified text after a hook rewrite,
          read <code>Message.pre_modified_text</code>.
        </li>
        <li>
          <strong>Optional: implement{" "}
          <code>StoreAdapter.createSubAgentStore</code></strong> on your custom
          store so subagents get isolated child stores for cost attribution.
          Stores that don&apos;t implement it still work — the dispatcher falls
          back to whatever the factory builds.
        </li>
        <li>
          <strong>Optional: forward <code>signal</code></strong> from{" "}
          <code>Tool.run</code> / <code>GloveFoldArgs.do</code> into any
          long-running internal work in your tools (network fetches, nested
          agent loops). Tools that ignore <code>signal</code> still get the
          executor&apos;s abortable-promise unwind for free.
        </li>
        <li>
          <strong>If you depend on <code>glove-sqlite</code></strong>, plan a
          migration to a custom <code>StoreAdapter</code> backed by your
          production database. <code>glove-sqlite</code> still works but is no
          longer maintained.
        </li>
      </ol>

      <h2>Where to read more</h2>

      <ul>
        <li>
          <a href="/docs/extensions">Hooks, Skills &amp; Subagents</a> — the
          extension model in detail.
        </li>
        <li>
          <a href="/docs/core">Core API</a> — full surface reference for
          <code> glove-core</code>.
        </li>
        <li>
          <a href="/docs/mcp">MCP integration</a> — discovery subagent and
          server bridging.
        </li>
        <li>
          <a href="/docs/glovebox">Glovebox</a> — sandboxed runtime for
          deploying built <code>Glove</code> agents.
        </li>
        <li>
          <a
            href="https://github.com/porkytheblack/glove/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            CHANGELOG.md on GitHub
          </a>{" "}
          — full per-version history.
        </li>
      </ul>
    </div>
  );
}
