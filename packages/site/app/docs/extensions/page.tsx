import { CodeBlock } from "@/components/code-block";

export default async function ExtensionsPage() {
  return (
    <div className="docs-content">
      <h1>Hooks, Skills &amp; Mentions</h1>

      <p>
        Glove agents accept three kinds of inline directive in a user message:
        <code>/hook</code> tokens that mutate agent state,{" "}
        <code>/skill</code> tokens that inject context, and{" "}
        <code>@mention</code> tokens that route the turn to a custom handler.
        Skills can also be exposed to the agent so it pulls them in mid-turn
        through a tool call.
      </p>

      <p>
        These extensions live entirely in <code>glove-core</code>. They are
        registered on the builder, parsed out of the incoming text in{" "}
        <code>processRequest</code>, and dispatched before the model sees the
        turn. Builders that register no extensions see no behavioural change.
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
              Routes the turn to a custom handler instead of running the
              local agent loop.
            </td>
            <td>
              Hand off to a sub-Glove, an external agent, or a deterministic
              non-LLM responder.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        A token only binds when its name matches a registered handler.
        Unbound tokens stay in the text, so paths like{" "}
        <code>/usr/local/bin</code> and emails like <code>a@b.com</code>{" "}
        are never hijacked.
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
  .defineSkill(
    "concise",
    async ({ source, args }) => \`Be terse. (source=\${source}, hint=\${args ?? "none"})\`,
    { description: "Tighter, snappier responses", exposeToAgent: true },
  )
  .defineMention("weather-only", async ({ message }) => {
    const text = await fetchWeather(message.text);
    return { sender: "agent", text };
  })
  .build();

await agent.processRequest("/concise tell me about Rust");
await agent.processRequest("/compact what's next?");
await agent.processRequest("@weather-only NYC");`}
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
  parsedText: string;     // post-strip user text
  args?: string;          // model-supplied free-form args (only when source = "agent")
  source: "user" | "agent";
  controls: AgentControls;
}

interface SkillOptions {
  description?: string;   // shown to the agent in the invoke-skill tool
  exposeToAgent?: boolean; // default false
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
        code={`agent.defineSkill(
  "research-mode",
  async ({ source, args }) => {
    const hint = args ? \` Focus area: \${args}.\` : "";
    return \`Switch into long-form research mode. Cite sources.\${hint}\`;
  },
  {
    description: "Switch to long-form research mode with citations",
    exposeToAgent: true,
  },
);

// User can invoke it inline:
//   "/research-mode tell me about ribosomes"
// or the agent can invoke it as a tool:
//   glove_invoke_skill({ name: "research-mode", args: "ribosome assembly" })`}
      />

      <p>
        Tool result for <code>glove_invoke_skill</code> is{" "}
        <code>{`{ status: "success", data: { skill, content } }`}</code>{" "}
        when the skill is exposed and known, otherwise{" "}
        <code>{`{ status: "error", message: "Skill ... is not available" }`}</code>.
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
      <h2>Mentions</h2>

      <p>
        A mention reroutes the turn. When an <code>@name</code> binds, Glove
        persists the user message and hands off to your handler instead of
        running the local agent loop. The handler returns a{" "}
        <code>Message</code> or a full <code>ModelPromptResult</code>.
      </p>

      <CodeBlock
        filename="extensions — mention types"
        language="typescript"
        code={`type MentionHandler = (ctx: MentionContext) => Promise<ModelPromptResult | Message>;

interface MentionContext {
  name: string;
  message: Message;        // already-persisted user message (post-strip)
  controls: AgentControls;
  handOver?: HandOverFunction;
  signal?: AbortSignal;
}`}
      />

      <p>
        Only the <em>first</em> matching mention in the message is honoured.
        Subsequent <code>@registered-name</code> occurrences stay in the
        text. Common patterns:
      </p>

      <ul>
        <li>
          <strong>Sub-Glove</strong> — call{" "}
          <code>subGlove.processRequest(message.text)</code> from the handler
          and return its result.
        </li>
        <li>
          <strong>Deterministic responder</strong> — bypass the LLM entirely
          for known commands (status, help, version).
        </li>
        <li>
          <strong>External agent / API</strong> — proxy to another service
          and return its reply as an agent message.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>How parsing works</h2>

      <p>
        <code>processRequest</code> walks the incoming text once, looking for{" "}
        <code>(^|\\s)([/@])([A-Za-z][\\w-]*)(?=\\s|$)</code>. For every match
        it asks the relevant registry whether the name binds. Bound tokens
        are removed (with surrounding whitespace collapsed); unbound tokens
        are left in place.
      </p>

      <p>The dispatch order on a single turn is:</p>

      <ol>
        <li>Parse tokens from the raw text.</li>
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
          Build the real user <code>Message</code> from the stripped text and
          any non-text <code>ContentPart</code>s the caller passed.
        </li>
        <li>
          If a mention bound, persist the user message and call its handler.
          Otherwise hand the message to <code>Agent.ask</code> as before.
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
defineSkill(name: string, handler: SkillHandler, opts?: SkillOptions): this;
defineMention(name: string, handler: MentionHandler): this;

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
