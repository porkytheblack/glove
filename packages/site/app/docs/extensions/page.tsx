import { CodeBlock } from "@/components/code-block";

export default async function ExtensionsPage() {
  return (
    <div className="docs-content">
      <h1>Hooks, Skills &amp; Mentions</h1>

      <p>
        Glove ships three extension primitives: <code>/hook</code> directives
        that mutate agent state, <code>/skill</code> directives that inject
        context, and <code>@mention</code> subagents the main agent can
        route to via a built-in tool.
      </p>

      <p>
        Hooks and skills are parsed out of the user&apos;s text in{" "}
        <code>processRequest</code> and dispatched before the model sees the
        turn. Mentions, following Claude Code&apos;s subagent convention,
        are <em>not</em> parsed — the user&apos;s <code>@name</code> text
        reaches the model verbatim and acts as a routing signal that nudges
        the agent to call the auto-registered{" "}
        <code>glove_invoke_subagent</code> tool.
      </p>

      <p>
        Builders that register no extensions see no behavioural change.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Three kinds of directive</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>What it does</th>
            <th>Typical use</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/hook</code></td>
            <td>
              Runs a builder-defined handler with full access to agent
              internals. Can rewrite the user text or short-circuit the turn.
            </td>
            <td>
              Force compaction, swap model mid-conversation, cancel a turn,
              run a one-off side effect.
            </td>
          </tr>
          <tr>
            <td><code>/skill</code></td>
            <td>
              Materialises into a synthetic user message persisted before the
              real one, marked <code>is_skill_injection: true</code>.
            </td>
            <td>
              Tone presets, persona overlays, attaching a checklist, pulling
              in a prompt template.
            </td>
          </tr>
          <tr>
            <td><code>@mention</code></td>
            <td>
              Registers a subagent. The main agent calls the auto-registered{" "}
              <code>glove_invoke_subagent</code> tool with a name + prompt;
              the subagent&apos;s output comes back as the tool result.
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

      {/* ------------------------------------------------------------------ */}
      <h2>Registering extensions</h2>

      <p>
        Three new builder methods complement <code>fold</code>. They&apos;re
        chainable and legal at any time, including after <code>build()</code>{" "}
        — the same as <code>fold</code>.
      </p>

      <CodeBlock
        filename="lib/agent.ts"
        language="typescript"
        code={`import { Glove } from "glove-core";

const agent = new Glove({ /* store, model, displayManager, systemPrompt, ... */ })
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
  .defineMention({
    name: "weather",
    description: "Run the weather subagent. Use for weather questions.",
    handler: async ({ prompt }) => fetchWeather(prompt),
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
  parsedText: string;     // text with bound tokens removed
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
  forceCompaction: () => Promise<void>;
}`}
      />

      <p>
        Hooks run sequentially in the order their tokens appear in the
        message. Returning <code>{`{ rewriteText }`}</code> replaces the
        working text passed to subsequent hooks, skills, and the final user
        message. Returning <code>shortCircuit</code> persists the user
        message and immediately returns the supplied{" "}
        <code>Message</code> or <code>ModelPromptResult</code> — the model
        is not called.
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
        style or filter them in the transcript.
      </p>

      <CodeBlock
        filename="extensions — skill types"
        language="typescript"
        code={`type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

interface SkillContext {
  name: string;
  // when source = "user": user message after token stripping.
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
        post-<code>build()</code> are immediately visible to the model.
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
    // source === "user" — parsedText is the rest of "/research-mode <text>".
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
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Mentions (Subagents)</h2>

      <p>
        Mentions are Glove&apos;s subagent surface, modelled directly on{" "}
        <a href="https://code.claude.com/docs/en/sub-agents" target="_blank" rel="noopener noreferrer">
          Claude Code&apos;s subagent convention
        </a>. Defining one auto-registers a single{" "}
        <code>glove_invoke_subagent</code> tool the main agent can call with{" "}
        <code>{`{ name, prompt }`}</code>. The handler runs in isolation,
        returns text (or <code>ContentPart[]</code>), and that output comes
        back as the tool result.
      </p>

      <p>
        The user&apos;s <code>@name</code> text in the original message is{" "}
        <strong>not parsed or stripped</strong>. It reaches the model
        verbatim and acts as a routing signal — when the agent sees{" "}
        <code>@reviewer please look at this</code> and{" "}
        <code>glove_invoke_subagent</code> in its tool list, it picks the
        right subagent and writes the task prompt itself. This matches how
        Claude Code routes subagents: one tool, one mechanism, whether the
        invocation came from the user or from the agent&apos;s own decision.
      </p>

      <CodeBlock
        filename="extensions — mention types"
        language="typescript"
        code={`type MentionHandler = (ctx: MentionContext) => Promise<string | ContentPart[]>;

interface MentionContext {
  name: string;
  prompt: string;            // task prompt the agent supplied via the tool
  controls: AgentControls;
  signal?: AbortSignal;
}

interface MentionOptions {
  description?: string;       // shown to the agent in the invoke-subagent tool
}

// defineMention takes an object form mirroring fold(GloveFoldArgs).
interface DefineMentionArgs extends MentionOptions {
  name: string;
  handler: MentionHandler;
}`}
      />

      <h3>Registering a subagent</h3>

      <CodeBlock
        filename="defining a subagent"
        language="typescript"
        code={`agent.defineMention({
  name: "reviewer",
  description: "Code review specialist. Use when the user asks for a code review.",
  handler: async ({ prompt }) => {
    // The subagent runs in isolation — \`prompt\` is its only input.
    // Common pattern: spin up another Glove instance with its own system prompt.
    return await reviewerGlove.processRequest(prompt).then(r => r.messages[0]?.text ?? "");
  },
});

// User: "@reviewer please look at PR #123"
// Model sees the full text including "@reviewer", picks glove_invoke_subagent,
// and calls it with { name: "reviewer", prompt: "review PR #123 ..." }.
// The handler's return text becomes the tool result.`}
      />

      <h3>Tool result shape</h3>

      <p>
        Symmetric with <code>glove_invoke_skill</code>. On success with a
        string handler return:{" "}
        <code>{`{ status: "success", data: { subagent, content } }`}</code>.
        For <code>ContentPart[]</code> returns, text parts are joined into{" "}
        <code>data.content</code> and the full part list is preserved on{" "}
        <code>renderData</code>. Unknown subagent names return{" "}
        <code>{`{ status: "error", message: "...", data: null }`}</code>.
      </p>

      <h3>Context isolation</h3>

      <p>
        Subagents do <strong>not</strong> see the parent conversation. The
        only channel from parent to subagent is the <code>prompt</code>{" "}
        string the agent supplies — the handler is responsible for whatever
        context the subagent needs. If you spin up a sub-Glove inside the
        handler, give it its own system prompt and store. This isolation
        matches Claude Code&apos;s subagent context model and keeps the
        parent context window from bloating with the subagent&apos;s
        intermediate work.
      </p>

      <h3>Common patterns</h3>

      <ul>
        <li>
          <strong>Sub-Glove</strong> — handler builds (or reuses) a separate{" "}
          <code>Glove</code> instance with its own model + system prompt and
          calls <code>subGlove.processRequest(prompt)</code>.
        </li>
        <li>
          <strong>Deterministic responder</strong> — handler returns a
          canned string, bypassing any LLM. Useful for{" "}
          <code>@status</code>, <code>@help</code>, <code>@version</code>.
        </li>
        <li>
          <strong>External agent / API</strong> — handler proxies to another
          service and returns its response.
        </li>
        <li>
          <strong>Multiple in one message</strong> — &quot;@reviewer
          @architect please discuss this design&quot; — both names reach the
          model, and the agent decides whether to call both subagents (in
          sequence, or in parallel via separate tool calls).
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>How parsing works</h2>

      <p>
        <code>processRequest</code> walks the incoming text once, looking
        only for <code>/name</code> directive tokens (regex{" "}
        <code>(^|\\s)\\/([A-Za-z][\\w-]*)(?=\\s|$)</code>). For every match
        it asks the hook then skill registry whether the name binds. Bound
        tokens are removed (with surrounding whitespace collapsed); unbound
        tokens stay in place. <code>@name</code> tokens are <em>not</em>{" "}
        parsed — they pass through to the model verbatim.
      </p>

      <p>The dispatch order on a single turn is:</p>

      <ol>
        <li>Parse <code>/</code> directives from the raw text.</li>
        <li>
          Run hooks in document order. Apply any{" "}
          <code>rewriteText</code>; honour the first <code>shortCircuit</code>{" "}
          and return.
        </li>
        <li>
          Materialise skills (<code>source: &quot;user&quot;</code>) — each
          becomes a synthetic user message persisted before the real one.
        </li>
        <li>
          Build the real user <code>Message</code> from the stripped text
          (including any <code>@mention</code>s, untouched) plus any
          non-text <code>ContentPart</code>s the caller passed.
        </li>
        <li>
          Hand the message to <code>Agent.ask</code>. Mentions surface
          through the agent loop via <code>glove_invoke_subagent</code>{" "}
          tool calls.
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
      <h2>Forcing compaction</h2>

      <p>
        <code>controls.forceCompaction()</code> calls{" "}
        <code>Observer.runCompactionNow()</code>, which is the same body as{" "}
        <code>tryCompaction</code> minus the token-threshold guard.
        It&apos;s safe to call whenever a hook fires. Subscribers see the
        usual <code>compaction_start</code> /{" "}
        <code>compaction_end</code> events.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>API surface</h2>

      <CodeBlock
        filename="glove-core/extensions"
        language="typescript"
        code={`// Builder methods
defineHook(name: string, handler: HookHandler): this;
defineSkill(args: DefineSkillArgs): this;
defineMention(args: DefineMentionArgs): this;

// Standalone helpers (rarely needed)
import { parseTokens, formatSkillMessage, createSkillInvokeTool } from "glove-core";`}
      />

      <p>
        For full type signatures see the{" "}
        <a href="/docs/core">Core API</a> page.
      </p>
    </div>
  );
}
