import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Setup wizard and CLI" };

export default function FoundryGettingStartedPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / 01</span>
      <h1>Install Glove Foundry</h1>
      <p className="blog-lede">
        Let the setup wizard guide you from an empty folder to your first agent run.
        The generated project is ordinary TypeScript that you own.
      </p>

      <h2 id="requirements">Requirements</h2>
      <ul><li>Node.js 22.13+ recommended; CLI minimum 20.12</li><li>pnpm, npm, yarn, or bun</li><li>No API key needed for the guided demo; the minimal starter and live runs need a provider key</li></ul>

      <h2 id="scaffold">1. Follow the setup wizard</h2>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init`} />
      <p>The Clack-powered terminal UI guides you through these choices. Use arrow keys to move, Enter to select, and Ctrl+C to cancel.</p>
      <ol>
        <li><strong>Directory:</strong> a new folder, or your existing Next.js app.</li>
        <li><strong>Project:</strong> standalone runtime and inspector, or colocated Next.js integration.</li>
        <li><strong>Starter:</strong> guided travel concierge (keyless demo) or a minimal agent and tool.</li>
        <li><strong>Package manager:</strong> existing lockfiles are detected; choose pnpm, npm, yarn, or bun.</li>
        <li><strong>Installation:</strong> install dependencies now or receive commands for later.</li>
        <li><strong>Review:</strong> confirm the plan before project files are written.</li>
      </ol>
      <p>Cancellation before confirmation creates no files. Existing app files are never silently overwritten. If dependency installation fails, the generated project remains available and the CLI prints retry steps. No secrets are requested by the wizard.</p>
      <h3>Repeatable setup without prompts</h3>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init my-agent-system --template travel-concierge --package-manager pnpm --yes
cd my-agent-system
pnpm install`} />
      <p>
        Once <code>glove-foundry</code> is installed in a project, the equivalent
        framework command is <code>glove foundry</code>. The explicit package form
        above also works before a local <code>glove</code> binary exists.
      </p>

      <h2 id="credentials">2. Configure a provider when you are ready</h2>
      <p>The guided example works before this step. Copy <code>.env.example</code> to <code>.env.local</code>, add your key yourself, and restart the dev server. The minimal starter requires this key. Demo calendars and messengers do not become real integrations just because a model key is present.</p>
      <CodeBlock filename=".env.local" language="bash" code={`OPENROUTER_API_KEY=your_key_here
# optional
OPENROUTER_MODEL=openai/gpt-4.1-mini`} />
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        Foundry reads environment values for your adapter, but never acquires or
        refreshes application credentials. For installed apps, implement your own
        credential adapter and keep secrets out of definitions and persisted manifests.
      </p></div>

      <h2 id="run">3. Run</h2>
      <CodeBlock filename="terminal" language="bash" code={`pnpm dev
# Glove Foundry
# Local:   http://127.0.0.1:4141
# Types:   .foundry/routes.d.ts`} />
      <p>
        Development mode discovers <code>agents/</code>, generates route types,
        starts the Effect runtime and HTTP API, opens the inspection surface, and
        restarts when agent or configuration files change.
      </p>
      <p>Open <code>http://127.0.0.1:4141</code>, choose <strong>Start a run</strong>, select <strong>concierge</strong>, and ask “Find a flight to Nairobi.” Open the run to follow its tool calls and result. Edit <code>agents/concierge/agent.ts</code> and save to try a change.</p>

      <h2 id="tree">What was created</h2>
      <CodeBlock filename="project" language="text" code={`agents/
  concierge/
    agent.ts                 # the definition
    composition.ts           # imported, composable pieces
    tools/                   # shared or colocated tools
    apps/                    # installable application definitions
    memory/  inboxes/  mcp/  # lazily mounted capabilities
    layers/  subscribers/    # assembly and observation
    workbench.ts             # VFS + REPL
foundry.application.ts       # runtime adapters and services
foundry.config.ts            # fully typed framework config`} />

      <h2 id="call">4. Create an instance and send a message</h2>
      <CodeBlock filename="call-foundry.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "./.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({
  baseUrl: "http://127.0.0.1:4141",
});
const instance = await foundry.agent("concierge").create({
  context: { team: "brand" },
});
const conversation = await foundry.createConversation(instance.id);
const run = await foundry.send(
  instance.id,
  conversation.id,
  "Build three launch territories and review the strongest one.",
);
const result = await run.wait();`} />
      <p>
        In static code, import the definition. Serializable instance and
        conversation identifiers appear only where data crosses the runtime boundary.
      </p>

      <h2 id="commands">CLI command reference</h2>
      <CodeBlock filename="terminal" language="bash" code={`# Interactive setup
npx glove-foundry init

# Join an existing Next.js app
npx glove-foundry init . --target nextjs

# Explicit CI setup; no prompts, no dependency install unless requested
npx glove-foundry init service --template minimal --package-manager npm --yes
npx glove-foundry init service --yes --install

# Inside a project
glove foundry dev
glove foundry dev --port 4142 --no-watch
glove foundry start --root ./service
glove foundry help`} />
      <table><thead><tr><th>Create option</th><th>Behavior</th></tr></thead><tbody>
        <tr><td><code>--template</code></td><td><code>travel-concierge</code> (guided default) or <code>minimal</code></td></tr>
        <tr><td><code>--target</code></td><td><code>standalone</code> or <code>nextjs</code>; existing Next.js projects are detected</td></tr>
        <tr><td><code>--package-manager</code></td><td><code>pnpm</code>, <code>npm</code>, <code>yarn</code>, or <code>bun</code></td></tr>
        <tr><td><code>--yes</code> / <code>--no-interactive</code></td><td>Use defaults for unspecified options. Piped commands never wait for prompts.</td></tr>
        <tr><td><code>--interactive</code></td><td>Require a terminal; fail clearly when one is unavailable</td></tr>
        <tr><td><code>--install</code> / <code>--no-install</code></td><td>Install now or leave installation to you</td></tr>
        <tr><td><code>--help</code></td><td>Show all commands and options without creating files</td></tr>
      </tbody></table>
      <p>Runtime options are <code>--root</code>, <code>--port</code>, <code>--host</code>, and <code>--no-watch</code>. A non-loopback host requires an application-owned request authorization adapter. Next.js projects use <code>foundry:dev</code> and <code>foundry:start</code>, leaving the app’s existing scripts intact.</p>

      <h2 id="verify">5. Verify and prepare for deployment</h2>
      <CodeBlock filename="your generated project" language="bash" code={`pnpm typecheck
pnpm lint`} />
      <p>Starter storage is disposable. Persist Foundry instance/activation data, Glove conversation history, structured memory, and VFS files with their respective adapters. A durable runtime-data adapter alone does not persist all of them. Read the deployment guide before retaining user work or exposing the server.</p>
      <p>If setup fails, check your Node version and package-manager installation. Choose another port if 4141 is occupied. For provider errors, inspect the failed run’s events. Restart after changing environment values.</p>
      <h3>For contributors working in the Glove repository</h3>
      <CodeBlock filename="repository root" language="bash" code={`pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify`} />
    </article>
  );
}
