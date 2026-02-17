import { CodeBlock } from "@/components/code-block";

export default async function AgentSkillPage() {
  return (
    <div className="docs-content">
      <h1>Agent Skill</h1>

      <p>
        Glove ships with an{" "}
        <a href="https://agentskills.io" target="_blank" rel="noopener">
          Agent Skill
        </a>{" "}
        that gives AI coding assistants deep knowledge of the framework &mdash;
        architecture, API reference, real patterns from the examples, and common
        gotchas.
      </p>

      <p>
        Once installed, your coding assistant automatically knows how to use
        Glove correctly &mdash; the right import paths, the right class names,
        the right patterns. No more guessing or hallucinating APIs.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Supported agents</h2>

      <p>The skill works with any agent that supports the skills format:</p>

      <ul>
        <li>
          <strong>Claude Code</strong> &mdash; Anthropic&apos;s CLI agent.
          Automatically uses the skill when working with Glove code. You can
          also invoke it directly with <code>/glove</code>.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Install with npx</h2>

      <p>
        The fastest way to install the skill is with the{" "}
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
        This installs the skill into your project&apos;s{" "}
        <code>.claude/skills/glove/</code> directory. The agent picks it up
        automatically.
      </p>

      <h3>Global install</h3>

      <p>
        To make the skill available in all your projects (not just the current
        one), add the <code>-g</code> flag:
      </p>

      <CodeBlock
        language="bash"
        code={`npx skills add porkytheblack/glove -a claude-code -g`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Manual install</h2>

      <p>
        If you prefer not to use the CLI, copy the skill files directly from the
        Glove repository:
      </p>

      <ol>
        <li>
          Clone or download the{" "}
          <a
            href="https://github.com/porkytheblack/glove"
            target="_blank"
            rel="noopener"
          >
            Glove repo
          </a>
        </li>
        <li>
          Copy the <code>.claude/skills/glove/</code> directory into your
          project&apos;s <code>.claude/skills/</code> folder
        </li>
      </ol>

      <p>Your project structure should look like:</p>

      <CodeBlock
        language="bash"
        code={`your-project/
├── .claude/
│   └── skills/
│       └── glove/
│           ├── SKILL.md           # Main skill file
│           ├── api-reference.md   # Full API reference
│           └── examples.md        # Real patterns from examples
├── src/
└── ...`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>What the skill knows</h2>

      <p>The skill gives your coding agent knowledge of:</p>

      <ul>
        <li>
          <strong>All three packages</strong> &mdash;{" "}
          <code>glove-core</code>, <code>glove-react</code>, and{" "}
          <code>glove-next</code>. Correct import paths, class names, method
          signatures.
        </li>
        <li>
          <strong>The display stack</strong> &mdash; when to use{" "}
          <code>pushAndWait</code> vs <code>pushAndForget</code>, how{" "}
          <code>SlotRenderProps</code> work, how to wire up{" "}
          <code>renderSlot</code>.
        </li>
        <li>
          <strong>Model providers</strong> &mdash; all 7 supported providers,
          their env variables, default models, and the{" "}
          <code>createAdapter</code> factory.
        </li>
        <li>
          <strong>Real example patterns</strong> &mdash; tool factories with
          shared state, WebSocket bridges, subscriber adapters, permission
          gating, terminal UIs with Ink.
        </li>
        <li>
          <strong>Common gotchas</strong> &mdash; like the{" "}
          <code>Displaymanager</code> casing (lowercase &apos;m&apos;), the{" "}
          <code>stream: true</code> default, browser-safe import paths, and
          handling both <code>model_response</code> and{" "}
          <code>model_response_complete</code> events.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Using the skill</h2>

      <p>
        Once installed, the skill activates automatically when your coding
        assistant detects you&apos;re working with Glove code. You don&apos;t
        need to do anything special &mdash; just write code as normal and the
        agent will reference the skill for accurate guidance.
      </p>

      <p>You can also invoke it directly in Claude Code:</p>

      <CodeBlock language="bash" code={`/glove`} />

      <p>
        This explicitly loads the skill context, which is useful when you want
        to ask the agent Glove-specific questions or have it scaffold a new
        tool, set up a provider, or debug a display stack issue.
      </p>

      <h3>Example prompts</h3>

      <p>With the skill installed, your agent can handle prompts like:</p>

      <ul>
        <li>
          &ldquo;Add a confirmation dialog tool that asks the user before
          deleting&rdquo;
        </li>
        <li>
          &ldquo;Set up the server route with Anthropic and connect the React
          client&rdquo;
        </li>
        <li>
          &ldquo;Create a tool factory for my inventory management
          system&rdquo;
        </li>
        <li>
          &ldquo;Why isn&apos;t my pushAndWait slot resolving?&rdquo;
        </li>
        <li>
          &ldquo;Add a subscriber that logs token usage to the console&rdquo;
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Skill structure</h2>

      <p>The skill is composed of three files:</p>

      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>SKILL.md</code>
            </td>
            <td>
              Main skill file. Architecture overview, quick start, display stack
              patterns, <code>ToolConfig</code> reference, provider table,
              common gotchas.
            </td>
          </tr>
          <tr>
            <td>
              <code>api-reference.md</code>
            </td>
            <td>
              Full API reference for all three packages &mdash; every class,
              interface, method, type, and event.
            </td>
          </tr>
          <tr>
            <td>
              <code>examples.md</code>
            </td>
            <td>
              Real patterns drawn from the four example implementations
              (weather-agent, coding-agent, nextjs-agent, coffee).
            </td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Updating the skill</h2>

      <p>
        To update to the latest version of the skill, re-run the install
        command:
      </p>

      <CodeBlock
        language="bash"
        code={`npx skills add porkytheblack/glove -a claude-code`}
      />

      <p>
        This overwrites the existing skill files with the latest versions from
        the repository.
      </p>
    </div>
  );
}
