import { CodeBlock } from "@/components/code-block";

export default async function ExtensionsPage() {
  return (
    <div className="docs-content">
      <h1>Hooks, Skills &amp; Subagents</h1>

      <p>
        Glove ships three extension primitives: <code>/hook</code> directives
        that mutate agent state, <code>/skill</code> directives that inject
        context, and subagent factories the main agent routes to via the
        auto-registered <code>glove_invoke_subagent</code> tool.
      </p>

      <p>
        Hooks and skills are parsed out of the user&apos;s text in{" "}
        <code>processRequest</code> and dispatched before the model sees the
        turn. Subagents are addressed by the model itself — the user&apos;s{" "}
        <code>@name</code> text reaches the model verbatim and acts as a
        routing signal that nudges the agent to call the dispatch tool with{" "}
        <code>{`{ name, prompt }`}</code>.
      </p>

      <p>
        Builders that register no extensions see no behavioural change.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Three primitives</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Primitive</th>
            <th>How it&apos;s invoked</th>
            <th>Typical use</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/hook</code></td>
            <td>
              User-side <code>/name</code> directive. Handler runs before the
              model with full <code>AgentControls</code>; can rewrite the
              text or short-circuit the turn.
            </td>
            <td>
              Force compaction, swap model mid-conversation, cancel a turn,
              run a one-off side effect.
            </td>
          </tr>
          <tr>
            <td><code>/skill</code></td>
            <td>
              User-side <code>/name</code> directive that becomes a
              synthetic user message marked{" "}
              <code>is_skill_injection: true</code>. Optionally exposed to the
              agent via <code>glove_invoke_skill</code>.
            </td>
            <td>
              Tone presets, persona overlays, attaching a checklist, pulling
              in a prompt template.
            </td>
          </tr>
          <tr>
            <td>Subagent</td>
            <td>
              Factory builds a fresh child <code>Glove</code> on every
              invocation. The parent agent calls{" "}
              <code>glove_invoke_subagent</code> with{" "}
              <code>{`{ name, prompt }`}</code>; the framework runs the child
              and returns its final text as the tool result.
            </td>
            <td>
              Specialised reviewers, planners, deterministic responders,
              hand-offs to external agents.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        <code>/hook</code> and <code>/skill</code> only bind when the name
        matches a registered handler — paths like <code>/usr/local/bin</code>{" "}
        survive untouched. <code>@mention</code> tokens are never parsed by
        glove at all, so emails like <code>a@b.com</code> reach the model
        unchanged.
      </p>

      <p>
        When a user-side directive binds, the original <code>/name</code>{" "}
        token is replaced with a non-triggerable placeholder of the form{" "}
        <code>[invoked_extension__hook_&lt;name&gt;]</code> or{" "}
        <code>[invoked_extension__skill_&lt;name&gt;]</code>. The placeholder
        survives in the persisted user message — and in the{" "}
        <code>parsedText</code> handed to handlers — so transcripts can show
        what the user typed without the directive re-firing on a future
        parse.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Registering extensions</h2>

      <p>
        Three builder methods complement <code>fold</code>. They&apos;re
        chainable and legal at any time, including after <code>build()</code>{" "}
        — the same as <code>fold</code>.
      </p>

      <CodeBlock
        filename="lib/agent.ts"
        language="typescript"
        code={`import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";

const agent = new Glove({
  store: new MemoryStore("session"),
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant.",
  compaction_config: { compaction_instructions: "Summarize so far." },
})
  .defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  })
  .defineHook("stop", async () => ({
    shortCircuit: {
      message: { sender: "agent", text: "Stopped." },
    },
  }))
  .defineSkill({
    name: "concise",
    description: "Tighter, snappier responses",
    exposeToAgent: true,
    handler: async ({ source, args }) =>
      \`Be terse. (source=\${source}, hint=\${args ?? "none"})\`,
  })
  .defineSubAgent({
    name: "weather",
    description: "Run the weather subagent. Use for weather questions.",
    factory: async ({ prompt, parentStore, parentControls }) => {
      const subStore = await parentStore.createSubAgentStore?.("weather", false)
        ?? new MemoryStore(\`weather-\${Date.now()}\`);
      return new Glove({
        store: subStore,
        model: createAdapter({ provider: "anthropic" }),
        displayManager: parentControls.displayManager,
        systemPrompt: "You answer weather questions concisely.",
        compaction_config: { compaction_instructions: "Summarize so far." },
      }).build();
    },
  })
  .build();

await agent.processRequest("/concise tell me about Rust");
await agent.processRequest("/compact what's next?");
// "@weather" reaches the model verbatim. The model then calls
// glove_invoke_subagent({ name: "weather", prompt: "NYC" }).
await agent.processRequest("@weather NYC");`}
      />

      <p>
        Anything not matching a registered name is left in place. A user
        sending <code>&quot;ping /me at 3pm&quot;</code> with no{" "}
        <code>/me</code> hook keeps the slash intact.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Hooks</h2>

      <p>
        A hook is the most powerful primitive — it runs before the model
        sees the message and receives an <code>AgentControls</code> handle.
        Use it when you need to reach into the agent&apos;s internals.
      </p>

      <CodeBlock
        filename="extensions — hook types"
        language="typescript"
        code={`type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

interface HookContext {
  name: string;
  rawText: string;        // original user text
  parsedText: string;     // text with bound /name tokens replaced by placeholders
  controls: AgentControls;
  signal?: AbortSignal;
}

interface HookResult {
  rewriteText?: string;   // override parsedText for downstream skills + the user message
  shortCircuit?:
    | { message: Message }
    | { result: ModelPromptResult };
}

interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
  store: StoreAdapter;
  displayManager: DisplayManagerAdapter;
  forceCompaction: () => Promise<void>;
}`}
      />

      <p>
        Hooks run sequentially in the order their tokens appear in the
        message. Returning <code>{`{ rewriteText }`}</code> replaces the
        working text passed to subsequent hooks, skills, and the final user
        message. Returning <code>shortCircuit</code> persists the user
        message and immediately returns the supplied <code>Message</code> or{" "}
        <code>ModelPromptResult</code> — the model is not called.
      </p>

      <p>
        Each hook invocation also emits a <code>hook_invoked</code>{" "}
        subscriber event with the bound name.
      </p>

      <h3>Common hook recipes</h3>

      <CodeBlock
        filename="hook recipes"
        language="typescript"
        code={`// Force compaction on demand. Useful for "/compact" before a long question.
agent.defineHook("compact", async ({ controls }) => {
  await controls.forceCompaction();
});

// Swap to a stronger model for one specific turn.
agent.defineHook("opus", ({ controls }) => {
  controls.glove.setModel(opusAdapter);
  return; // no rewrite, no short-circuit
});

// Cancel the turn entirely with a canned response.
agent.defineHook("cancel", async () => ({
  shortCircuit: {
    message: { sender: "agent", text: "Cancelled — nothing was sent to the model." },
  },
}));

// Rewrite the user message before any skill / model call.
agent.defineHook("formal", async ({ parsedText }) => ({
  rewriteText: parsedText.replace(/\\bgonna\\b/g, "going to"),
}));`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Skills</h2>

      <p>
        Skills inject context. When a <code>/skill</code> token binds, its
        handler returns a string or <code>ContentPart[]</code>; Glove turns
        that into a synthetic user-role message persisted via{" "}
        <code>context.appendMessages</code> before the real user message,
        marked with <code>is_skill_injection: true</code> so consumers can
        style or filter them in the transcript. Each invocation emits a{" "}
        <code>skill_invoked</code> subscriber event with{" "}
        <code>source: &quot;user&quot;</code>.
      </p>

      <CodeBlock
        filename="extensions — skill types"
        language="typescript"
        code={`type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

interface SkillContext {
  name: string;
  // when source = "user": user message with bound /name tokens replaced by placeholders.
  // when source = "agent": same as args ?? "" (the model-supplied string).
  parsedText: string;
  args?: string;             // model-supplied free-form args (only when source = "agent")
  source: "user" | "agent";
  controls: AgentControls;
}

interface SkillOptions {
  description?: string;       // shown to the agent in the invoke-skill tool
  exposeToAgent?: boolean;    // default false
}

// defineSkill takes an object form mirroring fold(GloveFoldArgs).
interface DefineSkillArgs extends SkillOptions {
  name: string;
  handler: SkillHandler;
}`}
      />

      <h3>Letting the agent pull skills mid-turn</h3>

      <p>
        Set <code>exposeToAgent: true</code> on a skill and Glove
        auto-registers a single <code>glove_invoke_skill</code> tool. Its
        description lists every exposed skill (with the{" "}
        <code>description</code> you supply) and is rebuilt in place
        whenever a new exposed skill is defined — so additions registered
        post-<code>build()</code> are immediately visible to the model. Each
        agent-side invocation emits a <code>skill_invoked</code> event with{" "}
        <code>source: &quot;agent&quot;</code> and the supplied{" "}
        <code>args</code>.
      </p>

      <CodeBlock
        filename="exposing a skill to the agent"
        language="typescript"
        code={`agent.defineSkill({
  name: "research-mode",
  description: "Switch to long-form research mode with citations",
  exposeToAgent: true,
  handler: async ({ source, args, parsedText }) => {
    if (source === "agent") {
      // Agent invoked via glove_invoke_skill — args is the model-supplied string.
      return \`Switch into research mode. Focus: \${args ?? "general"}.\`;
    }
    // source === "user" — parsedText contains the rest of the user message,
    // with the /research-mode token replaced by [invoked_extension__skill_research-mode].
    return \`Switch into research mode. User said: \${parsedText}\`;
  },
});

// User can invoke it inline:
//   "/research-mode tell me about ribosomes"
// or the agent can invoke it as a tool:
//   glove_invoke_skill({ name: "research-mode", args: "ribosome assembly" })`}
      />

      <p>
        Tool result for <code>glove_invoke_skill</code> on success with a
        string handler return is{" "}
        <code>{`{ status: "success", data: { skill, content } }`}</code>.
        When the handler returns a <code>ContentPart[]</code>, text parts
        are joined into <code>data.content</code> (visible to the model)
        and the full part list is preserved on{" "}
        <code>renderData</code> (visible to client renderers, mirroring the
        MCP-bridge convention). On unknown or unexposed names the tool
        returns{" "}
        <code>{`{ status: "error", message: "Skill ... is not available", data: null }`}</code>.
      </p>

      <h3>User-invoked vs agent-invoked</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Aspect</th>
            <th>User <code>/skill</code></th>
            <th>Agent <code>glove_invoke_skill</code></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>How it lands in context</td>
            <td>Synthetic user message before the real turn (<code>is_skill_injection: true</code>)</td>
            <td>Tool result on the agent&apos;s tool_use</td>
          </tr>
          <tr>
            <td><code>SkillContext.source</code></td>
            <td><code>&quot;user&quot;</code></td>
            <td><code>&quot;agent&quot;</code></td>
          </tr>
          <tr>
            <td><code>SkillContext.args</code></td>
            <td>undefined</td>
            <td>free-form string the model supplied</td>
          </tr>
          <tr>
            <td>Gated by <code>exposeToAgent</code></td>
            <td>No — user-invoked always works</td>
            <td>Yes — only exposed skills are callable</td>
          </tr>
          <tr>
            <td><code>skill_invoked</code> event source</td>
            <td><code>&quot;user&quot;</code></td>
            <td><code>&quot;agent&quot;</code> (with <code>args</code>)</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Subagents</h2>

      <p>
        A subagent is an isolated child <code>Glove</code> the main agent
        routes to via <code>glove_invoke_subagent({`{ name, prompt }`})</code>.
        You register one with a <strong>factory</strong> — the framework
        calls it on every invocation, runs the returned runnable with the
        supplied prompt, and hands its final text back to the parent agent
        as the tool result.
      </p>

      <CodeBlock
        filename="extensions — subagent types"
        language="typescript"
        code={`type SubAgentFactory = (
  ctx: SubAgentFactoryContext,
) => Promise<IGloveRunnable> | IGloveRunnable;

interface SubAgentFactoryContext {
  /** Subagent name as registered with defineSubAgent. */
  name: string;
  /** The task prompt the parent agent supplied via glove_invoke_subagent. */
  prompt: string;
  /** The parent agent's store. Use createSubAgentStore(name, durable) to derive a child store. */
  parentStore: StoreAdapter;
  /** Full parent agent controls (context, observer, promptMachine, executor, glove, store, displayManager, forceCompaction). */
  parentControls: AgentControls;
}

interface SubAgentOptions {
  description?: string;       // shown to the agent in the invoke-subagent tool
}

interface DefineSubAgentArgs extends SubAgentOptions {
  name: string;
  factory: SubAgentFactory;
}`}
      />

      <h3>The factory contract</h3>

      <p>
        The factory runs once per invocation and must return a fully-built{" "}
        <code>IGloveRunnable</code> — i.e. the child <code>Glove</code> must
        already have <code>build()</code> called on it. The dispatcher then:
      </p>

      <ol>
        <li>
          Attaches every parent subscriber to the child for the duration of
          the run, so streaming events from the child fan out to the
          parent&apos;s consumers (UI, voice, logging) as part of the same
          stream.
        </li>
        <li>
          Calls <code>child.processRequest(prompt, signal)</code> — the
          parent&apos;s abort signal is forwarded so a parent-side cancel
          unwinds the child&apos;s <code>Agent.ask</code> loop on the next
          iteration.
        </li>
        <li>
          Extracts the last agent message&apos;s text from the result and
          returns it as <code>data.content</code> on the tool result.
        </li>
        <li>
          Detaches the parent subscribers from the child in a{" "}
          <code>finally</code> block so durable factories don&apos;t
          accumulate duplicate subscribers across invocations.
        </li>
      </ol>

      <h3>Sub-stores</h3>

      <p>
        The factory typically calls{" "}
        <code>parentStore.createSubAgentStore(name, durable)</code> to
        derive a child store. With <code>durable: false</code> (the default)
        every invocation gets a fresh store; with <code>durable: true</code>{" "}
        the same child store is returned for the same namespace so the
        subagent accumulates message history across calls.{" "}
        <code>MemoryStore</code> implements this out of the box, so the
        common case is friction-free.
      </p>

      <h3>Worked example</h3>

      <CodeBlock
        filename="defining a code-review subagent"
        language="typescript"
        code={`import { Glove, MemoryStore, createAdapter } from "glove-core";

agent.defineSubAgent({
  name: "reviewer",
  description: "Code review specialist. Use when the user asks for a code review.",
  factory: async ({ prompt, parentStore, parentControls }) => {
    // Derive an isolated store from the parent. durable: false → fresh per call.
    const subStore = await parentStore.createSubAgentStore?.("reviewer", false)
      ?? new MemoryStore(\`reviewer-\${Date.now()}\`);

    // Build a fresh child Glove with its own system prompt.
    // Sharing the parent's display manager lets reviewer tools render in the
    // same UI surface; pass a separate one to keep its UI isolated.
    const child = new Glove({
      store: subStore,
      model: createAdapter({ provider: "anthropic" }),
      displayManager: parentControls.displayManager,
      systemPrompt: "You are a senior code reviewer. Be specific and direct.",
      compaction_config: { compaction_instructions: "Summarize so far." },
    });

    // Fold reviewer-specific tools as needed before returning the built runnable.
    return child.build();
  },
});

// User: "@reviewer please look at PR #123"
// The model sees the full text including "@reviewer", picks
// glove_invoke_subagent, and calls it with { name: "reviewer", prompt: "..." }.
// The dispatcher invokes the factory, runs the child, and returns the child's
// final agent text as the tool result.`}
      />

      <h3>Tool result shape</h3>

      <p>
        Symmetric with <code>glove_invoke_skill</code>. On success:{" "}
        <code>{`{ status: "success", data: { subagent, content } }`}</code>.
        When the factory throws or the child run fails:{" "}
        <code>{`{ status: "error", message: "...", data: null }`}</code>.
        Unknown subagent names return an error result listing the registered
        names.
      </p>

      <h3>Subscriber bracket events</h3>

      <p>
        Every subagent run is bracketed by a matched pair of subscriber
        events with <strong>guaranteed 1:1 symmetry</strong>:
      </p>

      <ul>
        <li>
          <code>subagent_invoked</code> — fired by the Executor immediately
          before the dispatcher runs. Carries{" "}
          <code>{`{ name, prompt }`}</code>.
        </li>
        <li>
          <code>subagent_completed</code> — fired by the Executor after the
          dispatcher resolves, errors, or aborts. Carries{" "}
          <code>{`{ name, status: "success" | "error", message? }`}</code>.
        </li>
      </ul>

      <p>
        The bracket fires from the Executor (not the dispatcher tool) so that
        even when an abort signal short-circuits the dispatcher&apos;s
        promise chain, the closing bracket still arrives. Anything the child
        emits between the open and close brackets — <code>text_delta</code>,{" "}
        <code>tool_use</code>, <code>tool_use_result</code>, even nested
        subagent brackets — belongs to that subagent run, because the
        parent&apos;s subscribers are temporarily attached to the child for
        the duration.
      </p>

      <p>
        Match against the exported{" "}
        <code>SUBAGENT_DISPATCH_TOOL_NAME</code> constant (value:{" "}
        <code>&quot;glove_invoke_subagent&quot;</code>) when filtering tool
        events you want to attribute to subagent dispatch.
      </p>

      <h3>Context isolation</h3>

      <p>
        Subagents do <strong>not</strong> see the parent conversation. The
        only channel from parent to child is the <code>prompt</code> string
        the agent supplies — the factory is responsible for whatever context
        the child needs. This isolation keeps the parent context window from
        bloating with the subagent&apos;s intermediate work and matches
        Claude Code&apos;s subagent context model.
      </p>

      <h3>Common patterns</h3>

      <ul>
        <li>
          <strong>Fresh-per-call subagent</strong> — factory builds a brand
          new <code>Glove</code> with{" "}
          <code>createSubAgentStore(name, false)</code> each call. Best for
          stateless reviewers, planners, classifiers.
        </li>
        <li>
          <strong>Durable subagent</strong> — factory calls{" "}
          <code>createSubAgentStore(name, true)</code> so the child carries
          message history across invocations. Best for long-running
          assistants the parent agent dispatches to repeatedly.
        </li>
        <li>
          <strong>Deterministic responder</strong> — factory returns a tiny{" "}
          <code>Glove</code> with a no-op model adapter that always returns
          a canned message; bypasses any LLM call inside the subagent.
        </li>
        <li>
          <strong>External agent / API proxy</strong> — factory returns a
          minimal <code>IGloveRunnable</code> that proxies{" "}
          <code>processRequest</code> to another service.
        </li>
        <li>
          <strong>Multiple in one message</strong> — &quot;@reviewer
          @architect please discuss this design&quot; — both names reach the
          model, and it decides whether to call both subagents (in sequence
          or in parallel via separate tool calls).
        </li>
      </ul>

      <p>
        For memory tools specifically, see the{" "}
        <a href="/docs/memory">Memory</a> guide and prefer the
        subagent-delegation pattern: the entity / episodic / resources tools
        belong on focused retrieval subagents rather than directly on the
        main agent.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>How parsing works</h2>

      <p>
        <code>processRequest</code> walks the incoming text once, looking
        only for <code>/name</code> directive tokens (regex{" "}
        <code>(^|\\s)\\/([A-Za-z][\\w-]*)(?=\\s|$)</code>). For every match
        it asks the hook then skill registry whether the name binds. Bound
        tokens are <strong>replaced</strong> in place with a non-triggerable
        placeholder; unbound tokens stay untouched. <code>@name</code>{" "}
        tokens are <em>not</em> parsed — they pass through to the model
        verbatim.
      </p>

      <p>The dispatch order on a single turn is:</p>

      <ol>
        <li>Parse <code>/</code> directives from the raw text.</li>
        <li>
          Run hooks in document order, emitting{" "}
          <code>hook_invoked</code> for each. Apply any{" "}
          <code>rewriteText</code>; honour the first <code>shortCircuit</code>{" "}
          and return.
        </li>
        <li>
          Materialise skills (<code>source: &quot;user&quot;</code>),
          emitting <code>skill_invoked</code> for each — each becomes a
          synthetic user message persisted before the real one.
        </li>
        <li>
          Build the real user <code>Message</code> from the
          placeholder-substituted text (including any <code>@mention</code>s,
          untouched) plus any non-text <code>ContentPart</code>s the caller
          passed.
        </li>
        <li>
          Hand the message to <code>Agent.ask</code>. Subagents surface
          through the agent loop via <code>glove_invoke_subagent</code> tool
          calls bracketed by <code>subagent_invoked</code> /{" "}
          <code>subagent_completed</code> events.
        </li>
      </ol>

      {/* ------------------------------------------------------------------ */}
      <h2>The <code>is_skill_injection</code> flag</h2>

      <p>
        Skill-materialised messages set <code>is_skill_injection: true</code>{" "}
        on <code>Message</code>. Use it in your transcript renderer to
        distinguish them from real user turns — render in a muted style,
        collapse them by default, or filter them out entirely. Pair it with
        the existing <code>is_compaction</code> flag for similar treatment.
      </p>

      <CodeBlock
        filename="rendering example"
        language="tsx"
        code={`{messages.map((m, i) => {
  if (m.is_skill_injection) {
    return <div key={i} className="skill-injection">{m.text}</div>;
  }
  if (m.is_compaction) return null;
  return <div key={i}>{m.sender}: {m.text}</div>;
})}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>The <code>pre_modified_text</code> field</h2>

      <p>
        When a hook&apos;s <code>rewriteText</code> changes the user&apos;s
        message before the model sees it, the original text is preserved on{" "}
        <code>Message.pre_modified_text</code>. Use this in transcript
        renderers that want to show the user the text they actually typed
        (rather than the rewritten version the model received).
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Forcing compaction</h2>

      <p>
        <code>controls.forceCompaction()</code> calls{" "}
        <code>Observer.runCompactionNow()</code>, which is the same body as{" "}
        <code>tryCompaction</code> minus the token-threshold guard.
        It&apos;s safe to call whenever a hook fires. Subscribers see the
        usual <code>compaction_start</code> / <code>compaction_end</code>{" "}
        events.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>API surface</h2>

      <CodeBlock
        filename="glove-core/extensions"
        language="typescript"
        code={`// Builder methods (also available on the runnable post-build)
defineHook(name: string, handler: HookHandler): this;
defineSkill(args: DefineSkillArgs): this;
defineSubAgent(args: DefineSubAgentArgs): this;

// Auto-registered dispatch tool name — match against this constant
// when filtering tool events.
import { SUBAGENT_DISPATCH_TOOL_NAME } from "glove-core";
// SUBAGENT_DISPATCH_TOOL_NAME === "glove_invoke_subagent"

// Standalone helpers (rarely needed)
import {
  parseTokens,
  formatSkillMessage,
  createSkillInvokeTool,
  createSubAgentInvokeTool,
} from "glove-core";`}
      />

      <p>
        For full type signatures see the{" "}
        <a href="/docs/core">Core API</a> page.
      </p>
    </div>
  );
}
