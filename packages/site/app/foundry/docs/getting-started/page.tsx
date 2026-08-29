import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Installation" };

export default function FoundryGettingStartedPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / 01</span>
      <h1>Install Glove Foundry</h1>
      <p className="blog-lede">
        Scaffold a typed application, add a provider key, and open the inspector.
        The generated project is ordinary TypeScript that you own.
      </p>

      <h2 id="requirements">Requirements</h2>
      <ul><li>Node.js 20 or newer</li><li>A package manager</li><li>A model provider key for live runs; the reference example can run deterministically without one</li></ul>

      <h2 id="scaffold">1. Scaffold</h2>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init my-agent-system
cd my-agent-system
pnpm install`} />
      <p>
        Once <code>glove-foundry</code> is installed in a project, the equivalent
        framework command is <code>glove foundry</code>. The explicit package form
        above also works before a local <code>glove</code> binary exists.
      </p>

      <h2 id="credentials">2. Configure the provider</h2>
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

      <h2 id="tree">What was created</h2>
      <CodeBlock filename="project" language="text" code={`agents/
  assistant/
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
const instance = await foundry.agent("assistant").create({
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

      <h2 id="verify">5. Verify the reference application</h2>
      <CodeBlock filename="terminal" language="bash" code={`pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify`} />
    </article>
  );
}
