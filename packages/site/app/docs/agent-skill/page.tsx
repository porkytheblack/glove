import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/agent-skill");

export default async function AgentSkillPage() {
  return (
    <div className="docs-content">
      <h1>Agent Skills</h1>

      <p>
        Glove ships{" "}
        <a href="https://agentskills.io" target="_blank" rel="noopener">
          Agent Skills
        </a>{" "}
        that teach coding agents to build with Glove the way the framework is
        designed: from its primitives. The most common mistake agents make with
        Glove is rebuilding something it already provides, such as a job queue
        instead of a schedule, an approval table instead of{" "}
        <code>requiresPermission</code>, or a summariser instead of compaction.
        Each skill leads with the parts of an agent harness and a{" "}
        <em>before you build X, use Y</em> table, then points to detailed
        references only when the task needs them.
      </p>

      <h2 id="the-skills">The three skills</h2>

      <p>
        They follow the same three layers as the docs:{" "}
        <Link href="/docs/first-principles">harness, system and production</Link>.
      </p>

      <table>
        <thead>
          <tr><th>Skill</th><th>Layer</th><th>Use it for</th><th>Source</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glove</code></td>
            <td>Harness</td>
            <td>
              <code>glove-core</code> and every capability package: the loop,
              tools, models, stores, runtime context, skills, hooks, subagents,
              the display stack, memory, forms, goals, facts, MCP, REPLs,
              scratchpad, VFS, working environments, browsers and sandboxes,
              classifiers, voice, image and video, mesh and continuum.
            </td>
            <td><a href="https://github.com/porkytheblack/glove/tree/main/.claude/skills/glove"><code>.claude/skills/glove</code></a></td>
          </tr>
          <tr>
            <td><code>glove-foundry</code></td>
            <td>System</td>
            <td>
              Foundry applications: definitions and instances, conversations,
              installable capabilities, schedules, sleep and spawn,
              transmissions and playbooks, approvals and steering, the client,
              REST and OpenAI-compatible APIs, persistence and the inspector.
            </td>
            <td><a href="https://github.com/porkytheblack/glove/tree/main/.claude/skills/glove-foundry"><code>.claude/skills/glove-foundry</code></a></td>
          </tr>
          <tr>
            <td><code>kuiper</code></td>
            <td>Production</td>
            <td>
              Deploying a Foundry app on <a href="https://kuiper.sh">Kuiper</a>:
              the CLI, what the builder infers, request authorization, the{" "}
              <code>/data</code> disk, secrets and variable templates, the model
              gateway, browsers, sandboxes, the inbox, logs and the Inspect card.
            </td>
            <td><a href="https://github.com/porkytheblack/glove/tree/main/.claude/skills/kuiper"><code>.claude/skills/kuiper</code></a></td>
          </tr>
        </tbody>
      </table>

      <p>
        Agents that read plain text instead of skills can use{" "}
        <a href="/llms.txt"><code>/llms.txt</code></a>,{" "}
        <a href="/llms-full.txt"><code>/llms-full.txt</code></a> and{" "}
        <a href="/foundry/llms-full.txt"><code>/foundry/llms-full.txt</code></a>,
        and Kuiper&apos;s <a href="https://kuiper.sh/llms.txt"><code>kuiper.sh/llms.txt</code></a>.
      </p>

      <h2 id="install">Install with npx</h2>

      <p>
        The fastest way to install the skills is with the{" "}
        <a href="https://skills.sh" target="_blank" rel="noopener">
          skills CLI
        </a>
        :
      </p>

      <CodeBlock
        language="bash"
        code={`npx skills add porkytheblack/glove -a claude-code`}
      />

      <p>
        This installs the skills into your project&apos;s{" "}
        <code>.claude/skills/</code> directory and the agent picks them up
        automatically. Add <code>-g</code> to install them for every project:
      </p>

      <CodeBlock
        language="bash"
        code={`npx skills add porkytheblack/glove -a claude-code -g`}
      />

      <h3 id="manual-install">Manual install</h3>

      <p>
        Copy the skill folders you need from the{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/.claude/skills" target="_blank" rel="noopener">
          repository
        </a>{" "}
        into your project&apos;s <code>.claude/skills/</code>. Every link inside
        a skill is either relative to that skill&apos;s folder or an absolute URL,
        so a copied skill works outside the Glove repository.
      </p>

      <CodeBlock
        language="text"
        code={`your-project/
└── .claude/
    └── skills/
        ├── glove/
        │   ├── SKILL.md                       # the parts of a harness, the primitives table, rules, decision guide
        │   └── references/
        │       ├── core.md                    # the loop, stores, subscribers, providers, server-side, inbox
        │       ├── tools-and-display.md       # tools, ToolResultData, summaries, the display stack
        │       ├── react-next.md              # GloveClient, useGlove, <Render>, createChatHandler
        │       ├── extensions.md              # hooks, skills, subagents
        │       ├── memory-and-workflows.md    # memory, forms, goals, facts, preparation
        │       ├── mcp.md                     # glove-mcp
        │       ├── execution-and-workspace.md # scratchpad, REPLs, VFS, working environment, browsers, sandboxes
        │       ├── classifier.md              # glove-classifier
        │       ├── voice.md                   # pipelines, realtime speech, avatars, LiveKit
        │       ├── media.md                   # image and video workflows
        │       ├── multi-agent.md             # mesh and continuum
        │       ├── packages.md                # every package in one table
        │       ├── api-reference.md           # exact signatures
        │       ├── examples.md                # patterns from the example apps
        │       └── gotchas.md                 # the full list of pitfalls
        ├── glove-foundry/
        │   ├── SKILL.md                       # definition / instance / run, the system primitives table, layout, persistence
        │   └── references/
        │       ├── condensed-reference.md     # fields, endpoints, CLI flags, built-in tool inputs
        │       ├── building.md                # authoring rules for apps, playbooks, schedules, guidance, voice, multi-agent
        │       └── contributing.md            # only for changing glove-foundry itself
        └── kuiper/
            ├── SKILL.md                       # deploy, production-ready Foundry, variables, models, inbox, sandboxes, operate
            └── references/
                └── cli.md                     # every kuiper command and flag`}
      />

      <h2 id="what-the-skills-know">What the skills teach</h2>

      <ul>
        <li>
          <strong>The parts of a harness.</strong> Loop, tools, context, state,
          workspace, surface and team for <code>glove</code>; identity, time,
          arrival, oversight and access for <code>glove-foundry</code>; run,
          keep, reach and watch for <code>kuiper</code>. Each part comes with
          the question it answers, so an agent can place a request before it
          writes code.
        </li>
        <li>
          <strong>Before you build X, use Y.</strong> Every primitive from the{" "}
          <Link href="/docs/primitives">primitives map</Link>, phrased as the
          thing an agent is about to hand-build, with the API and package that
          already does it.
        </li>
        <li>
          <strong>The rules the primitives follow.</strong> Everything the model
          does is a tool; adapters at every boundary; mount, don&apos;t wrap; live
          state at the tail of the prompt; work in files and code; people in the
          loop through primitives; credentials never in the model.
        </li>
        <li>
          <strong>Decision guides.</strong> glove-core or Foundry; plain tools,
          a REPL, the scratchpad or a working environment; which way to collect
          information; which surface.
        </li>
        <li>
          <strong>The rules that prevent silent bugs.</strong> Such as the{" "}
          <code>Displaymanager</code> casing, event key differences, permissions
          keyed on tool and input, goals living in{" "}
          <code>glove-memory/goals</code>, and every Foundry run being a fresh
          process that forgets an in-memory store.
        </li>
        <li>
          <strong>Deep references on demand.</strong> Full API signatures, worked
          patterns from the examples, and per-package guides, read only when the
          task needs them.
        </li>
      </ul>

      <h2 id="using">Using the skills</h2>

      <p>
        Once installed, the skills activate when your coding assistant sees
        Glove, Foundry or Kuiper code, or when you ask it to build an agent. You
        can also load one explicitly in Claude Code:
      </p>

      <CodeBlock language="bash" code={`/glove
/glove-foundry
/kuiper`} />

      <h3 id="example-prompts">Example prompts</h3>

      <ul>
        <li>&ldquo;Build a coding agent that works in a sandbox and asks before it writes files&rdquo;</li>
        <li>&ldquo;Give this agent a reminder it can set for itself every weekday morning&rdquo;</li>
        <li>&ldquo;Wake an agent per customer when a ticket arrives, and have a person approve refunds&rdquo;</li>
        <li>&ldquo;Keep the user&apos;s preferences in front of the model on every turn without touching the system prompt&rdquo;</li>
        <li>&ldquo;Deploy this Foundry folder on Kuiper with its state on the disk and models through the gateway&rdquo;</li>
      </ul>

      <h2 id="skills-in-history">How user-invoked skills land in history</h2>

      <p>
        The skills above are install-time bundles for your coding agent. The
        runtime <code>defineSkill</code> system inside <code>glove-core</code>{" "}
        — the <code>/skill-name</code> directives users type into chat — has
        a behavior worth highlighting because it shows up in your stored
        message history.
      </p>

      <p>
        When a user types something like{" "}
        <code>&quot;/research-mode tell me about ribosomes&quot;</code>,
        Glove parses the directive token but does <strong>not</strong> strip
        it from the message. Instead, the bound <code>/name</code> token is
        replaced in the persisted user text with a non-triggerable
        placeholder of the form{" "}
        <code>[invoked_extension__skill_&lt;name&gt;]</code> for skills, and{" "}
        <code>[invoked_extension__hook_&lt;name&gt;]</code> for hooks. The
        skill or hook handler runs as expected; the persisted user message
        records exactly which extensions fired.
      </p>

      <CodeBlock
        language="text"
        code={`User typed:
  "/research-mode tell me about ribosomes"

Persisted user message text:
  "[invoked_extension__skill_research-mode] tell me about ribosomes"

Skill handler receives:
  ctx.parsedText = "[invoked_extension__skill_research-mode] tell me about ribosomes"
  ctx.source     = "user"
  ctx.args       = undefined`}
      />

      <p>
        The placeholder is intentionally non-triggerable — re-parsing it
        does not re-bind to the skill — so historical messages can be
        replayed safely without firing the extension a second time. UIs
        that render the transcript should detect the placeholder and either
        substitute a chip showing &ldquo;skill: research-mode&rdquo; or
        strip it entirely; the agent reads it verbatim and infers context
        from it.
      </p>

      <p>
        Synthetic user messages that the skill itself injects (the handler&apos;s
        return value) are persisted with{" "}
        <code>is_skill_injection: true</code> so transcript renderers can
        style them differently from real user turns. See{" "}
        <Link href="/docs/extensions">Hooks, Skills &amp; Subagents</Link>{" "}
        for the full <code>defineSkill</code> /{" "}
        <code>defineHook</code> / <code>defineSubAgent</code> surface.
      </p>

      <h2 id="updating">Updating the skills</h2>

      <p>
        Installing or releasing npm packages does not update installed skill
        copies. Re-run the install command to fetch the latest versions:
      </p>

      <CodeBlock
        language="bash"
        code={`npx skills add porkytheblack/glove -a claude-code`}
      />
    </div>
  );
}
