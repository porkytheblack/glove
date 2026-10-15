import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Install & CLI",
  description:
    "Create a Foundry project with the setup wizard, choose a starter template, run the dev server and inspector, and use every CLI command and flag.",
};

export default function FoundryGettingStartedPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / Install &amp; CLI</span>
      <h1>Install Glove Foundry</h1>
      <p className="blog-lede">
        Let the setup wizard guide you from an empty folder to your first agent run.
        The generated project is ordinary TypeScript that you own.
      </p>

      <h2 id="requirements">Requirements</h2>
      <ul><li>Node.js 22+; use 22.13+ for SQLite memory</li><li>pnpm, npm, yarn, or bun</li><li>No API key needed for the guided demo; the minimal starter and live runs need a provider key</li></ul>

      <h2 id="scaffold">1. Follow the setup wizard</h2>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init`} />
      <p>The Clack-powered terminal UI guides you through these choices. Use arrow keys to move, Enter to select, and Ctrl+C to cancel.</p>
      <ol>
        <li><strong>Directory:</strong> a new folder, or your existing Next.js app.</li>
        <li><strong>Project:</strong> standalone runtime and inspector, or colocated Next.js integration.</li>
        <li><strong>Starter:</strong> guided travel concierge (keyless demo) or a minimal agent and tool.</li>
        <li><strong>Package manager:</strong> existing lockfiles are detected; choose pnpm, npm, yarn, or bun.</li>
        <li><strong>Installation:</strong> enabled by default. After confirmation, Foundry runs the selected package manager&apos;s install command in your new project. Opt out to install later.</li>
        <li><strong>Review:</strong> confirm the plan before project files are written.</li>
      </ol>
      <p>Cancellation before confirmation creates no files. Existing app files are never silently overwritten. If dependency installation fails, the generated project remains available and the CLI prints retry steps. No secrets are requested by the wizard.</p>
      <h3>Repeatable setup without prompts</h3>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init my-agent-system --template travel-concierge --package-manager pnpm --yes --install
cd my-agent-system`} />
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

  Glove Foundry

  Local:    http://127.0.0.1:4141
  Agents:   1
  Runtime:  ready
  Types:    .foundry/routes.d.ts`} />
      <p>
        Development mode discovers <code>agents/</code>, generates route types,
        starts the Effect runtime and HTTP API, opens the inspection surface, and
        restarts when agent or configuration files change.
      </p>
      <p>Open <code>http://127.0.0.1:4141</code>, choose <strong>Start a run</strong>, select <strong>concierge</strong>, and ask “Find a flight to Nairobi.” Open the run to follow its tool calls and result. Edit <code>agents/concierge/agent.ts</code> and save to try a change.</p>

      <h2 id="tree">What was created</h2>
      <p>The guided <code>travel-concierge</code> template contains one example of every convention:</p>
      <CodeBlock filename="project (travel-concierge)" language="text" code={`agents/concierge/
  agent.ts                                 the definition — start here
  composition.ts                           composeAgent(...): the installable catalogue
  flights.ts                               find_flights: an always-on tool
  tools/convert-currency.tool.ts           an installable shared tool (defineSharedTool)
  apps/calendar.app.ts                     an installable application (defineApp)
  instances.ts                             the seeded concierge-demo instance and its binding
  transmissions/messaging.transmission.ts  a chat transport (defineTransmission)
  events/message-received.event.ts         inbound event
  events/message-sent.event.ts             outbound event
  predicates/mentions-trip.predicate.ts    inbound match rule
  actions/reply.action.ts                  playbook action
  memory/traveller.memory.ts               memory profile (defineMemory)
  layers/trip-context.layer.ts             native Glove setup (defineLayer)
  subscribers/usage.subscriber.ts          observer (defineSubscriber)
  schedules/trip-countdown.ts              a schedule value (imported, not discovered)
  workbench.ts                             VFS + JavaScript REPL
  topology.ts                              accounts and routes (runtime data)
foundry.application.ts                     file data adapter, accounts, routes, bindings
foundry.config.ts                          port and execution policy
lib/demo-model.ts                          keyless demo model
lib/file-store.ts, lib/file-context.ts     durable transcripts and traveller memory
.data/                                     runtime state on disk (git-ignored)
src/client.ts                              a runnable typed client
.foundry/routes.d.ts                       generated — do not edit`} />
      <p>
        The <code>minimal</code> template is <code>agents/assistant/agent.ts</code> with one
        always-on tool, <code>lib/file-store.ts</code>, and the two root files. <Link href="/foundry/docs/project-structure">Project structure</Link>{" "}
        explains every convention.
      </p>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        <strong>Composed is not installed.</strong> Tools, apps and MCP servers listed in{" "}
        <code>composeAgent(...)</code> are a catalogue. They mount only on an instance that
        installs them — with <code>install(...)</code> when the instance is created,{" "}
        <code>client.install(...)</code>, or <code>PUT /api/installations</code>. The
        inspector shows installations but cannot change them. Put tools every instance should always have in the agent&apos;s{" "}
        <code>tools</code> field. See <Link href="/foundry/docs/capabilities">Tools, MCP &amp; memory</Link>.
      </p></div>

      <h2 id="call">4. Create an instance and send a message</h2>
      <CodeBlock filename="src/client.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });

// "concierge" is checked against the files in agents/.
const agent = await foundry.agent("concierge").create({
  workspaceId: "demo",
  context: { budgetUsd: 2_500 },
});
const conversation = await foundry.createConversation(agent.id);
const run = await foundry.send(agent.id, conversation.id, "I want to fly from Lisbon to Nairobi in April.");

console.log(\`run \${run.id} -> http://127.0.0.1:4141/runs/\${run.id}\`);
const completed = await run.wait();
console.log(completed.output);`} />
      <p>
        Run it with <code>npx tsx src/client.ts</code> while <code>pnpm dev</code> is running.
        The same calls are available over plain HTTP and through the{" "}
        <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link>.
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
      <p><strong>State lives on disk from the first run.</strong> Each run executes in its own process, so both starters keep instances, conversations, transcripts (and in the concierge, traveller memory and VFS files) under <code>.data/</code>. They survive the restart <code>pnpm dev</code> performs on every save; delete <code>.data/</code> to start fresh. These are single-host adapters — see <Link href="/foundry/docs/persistence">Persistence</Link> before deploying.</p>
      <p>Starter storage is disposable. Persist Foundry instance/activation data, Glove conversation history, structured memory, and VFS files with their respective adapters. A durable runtime-data adapter alone does not persist all of them. Read <Link href="/foundry/docs/persistence">Persistence</Link> before retaining user work, and <Link href="/foundry/docs/deploy">Deploy &amp; security</Link> before exposing the server.</p>
      <p><strong>Next:</strong> the <Link href="/foundry/docs/tutorial">tutorial</Link> builds a multi-tenant support agent with installed tools, schedules, approvals and an OpenAI SDK client.</p>
      <p>If setup fails, check your Node version and package-manager installation. Choose another port if 4141 is occupied. For provider errors, inspect the failed run’s events. Restart after changing environment values.</p>
      <h3>For contributors working in the Glove repository</h3>
      <CodeBlock filename="repository root" language="bash" code={`pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify`} />
    </article>
  );
}
