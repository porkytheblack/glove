import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { GloveLogo } from "@/components/glove-logo";

export const metadata: Metadata = {
  title: "Glove Foundry — the framework for agent systems",
  description:
    "A file-routed, Effect-native framework for composing, running, inspecting, and deploying complete Glove agent systems.",
};

const capabilities = [
  ["Definitions", "Typed, file-routed agent blueprints with colocated tools, apps, memory, MCP, layers, and workbenches."],
  ["Instances", "Persisted runtime data that selects installations, playbooks, schedules, conversations, and instance context."],
  ["Assembly", "Every major surface can resolve lazily from the current instance, conversation, message, and history."],
  ["Operations", "Runs, retries, passes, tool calls, transmissions, artifacts, and messages share one observable timeline."],
];

export default function FoundryPage() {
  return (
    <main className="foundry-page">
      <section className="foundry-hero">
        <div className="foundry-hero-copy">
          <div className="foundry-eyebrow"><GloveLogo /> Glove Foundry <span>0.1</span></div>
          <h1>The application framework for <em>agent systems.</em></h1>
          <p>
            Define the possible. Persist the chosen. Assemble each agent from the
            context in front of it—and inspect the whole system while it works.
          </p>
          <div className="foundry-hero-actions">
            <Link href="/foundry/docs/getting-started" className="btn-primary">Build your first Foundry →</Link>
            <Link href="/foundry/docs" className="btn-secondary">Read the handbook</Link>
          </div>
          <div className="foundry-install"><span>$</span> npx glove-foundry init my-agent-system</div>
        </div>

        <div className="foundry-assembly" aria-label="Foundry assembly model">
          <div className="assembly-topline"><span>ASSEMBLY / LIVE</span><i /></div>
          <div className="assembly-column">
            <div className="assembly-node code"><b>01</b><span><small>CODE</small>Agent definition</span></div>
            <div className="assembly-connector"><span>file route</span></div>
            <div className="assembly-node data"><b>02</b><span><small>DATA</small>Instance choices</span></div>
            <div className="assembly-connector"><span>message + context</span></div>
            <div className="assembly-node run"><b>03</b><span><small>RUNTIME</small>Observable run</span><i /></div>
          </div>
          <div className="assembly-readout">
            <span>tools 08</span><span>apps 02</span><span>memory 03</span><span>passes live</span>
          </div>
        </div>
      </section>

      <section className="foundry-statement">
        <span>THE THESIS</span>
        <h2>Stop drawing every route through the work.</h2>
        <p>
          Traditional workflow software asks you to predict the branches. Foundry
          lets you define capable agents, available worlds, and operational
          boundaries. The system can then understand intent, create the plan, make
          the artifacts, ask for help, and adapt the route while it is running.
          Deterministic control is still there when you need it. It is no longer the
          only way to build.
        </p>
      </section>

      <section className="foundry-cap-grid">
        {capabilities.map(([title, text], index) => (
          <article key={title}>
            <span>0{index + 1}</span><h3>{title}</h3><p>{text}</p>
          </article>
        ))}
      </section>

      <section className="foundry-code-section">
        <div>
          <span className="section-label">File-routed by default</span>
          <h2>Write the agent. Foundry assembles the runtime.</h2>
          <p>
            A folder is a boundary, not a dumping ground. Colocate the parts that
            change together. Import real definitions when code can reference code;
            use serializable IDs only at data and persistence boundaries.
          </p>
          <Link href="/foundry/docs/composition">Explore composition →</Link>
        </div>
        <CodeBlock
          filename="agents/brand-lead/agent.ts"
          language="typescript"
          code={`import { defineAgent } from "glove-foundry";
import { components } from "./composition.js";
import { brandWorkspace } from "./workbench.js";

export default defineAgent({
  description: "Leads a brand workforce",
  components,
  workingEnvironment: (_agent, ctx) =>
    ctx.messageText.includes("campaign")
      ? brandWorkspace
      : undefined,
  tools: (_agent, ctx) =>
    ctx.installations.flatMap((app) => app.tools),
  systemPrompt: (_agent, ctx) =>
    promptFor(ctx.agentInstance, ctx.message, ctx.history),
});`}
        />
      </section>

      <section className="foundry-spectrum">
        <div><span>Glove capabilities</span><strong>models · memory · inboxes · voice · images · mesh · MCP · working environments</strong></div>
        <div><span>Foundry framework</span><strong>routes · instances · installations · playbooks · schedules · conversations · inspection</strong></div>
        <div><span>Your adapters</span><strong>identity · persistence · credentials · transport · deployment</strong></div>
      </section>

      <section className="foundry-final-cta">
        <div><span>READY / 01</span><h2>Give the idea somewhere to become work.</h2></div>
        <Link href="/foundry/docs/getting-started" className="btn-primary">Open the installation guide →</Link>
      </section>
    </main>
  );
}
