import Link from "next/link";
import { foundrySections } from "@/lib/foundry-nav";

export const metadata = {
  title: "Overview",
  description: "The architecture and boundaries of Glove Foundry.",
};

export default function FoundryOverviewPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Framework handbook / 00</span>
      <h1>Glove Foundry</h1>
      <p className="blog-lede">
        Foundry is to agent systems what an application framework is to the web:
        conventions, file routing, composition, a runtime, a development server,
        typed boundaries, and an inspection workbench in one coherent stack.
      </p>

      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        <strong>Foundry does not replace Glove.</strong> Glove provides the agent
        loop and capabilities. Foundry turns those capabilities into applications
        made of definitions, persisted instances, conversations, event-driven
        playbooks, schedules, and observable runs.
      </p></div>

      <h2 id="mental-model">The mental model</h2>
      <div className="foundry-model-grid">
        <div><span>01 / CODE</span><h3>Definition</h3><p>The typed set of things an agent <em>may</em> become. Identity comes from the file route.</p></div>
        <div><span>02 / DATA</span><h3>Instance</h3><p>A persisted agent identity with installed apps, playbooks, schedules, configuration, and context.</p></div>
        <div><span>03 / THREAD</span><h3>Conversation</h3><p>A durable stream of messages and work. An instance can participate in many conversations.</p></div>
        <div><span>04 / EXECUTION</span><h3>Run</h3><p>One context-aware assembly and execution, correlated across passes, tools, events, and artifacts.</p></div>
      </div>

      <h2 id="boundaries">Purpose-built boundaries</h2>
      <table>
        <thead><tr><th>Foundry owns</th><th>You provide</th></tr></thead>
        <tbody>
          <tr><td>Definition discovery, file identities, assembly, run lifecycle, inspection</td><td>Model provider configuration and API keys</td></tr>
          <tr><td>Instance, conversation, playbook, schedule, and installation contracts</td><td>Durable adapters for the persistence guarantees you need</td></tr>
          <tr><td>Application and transmission surfaces exposed to agents</td><td>Credential acquisition, selection policy, storage, and refresh</td></tr>
          <tr><td>A stable agent-system vocabulary over backend execution</td><td>Transport, identity, authorization, and deployment policy</td></tr>
        </tbody>
      </table>
      <p>
        Backend infrastructure details stay behind adapters. Foundry talks about
        inbound transmissions, workers, schedules, and connections—not the
        implementation vocabulary of any particular execution backend.
      </p>

      <h2 id="dynamic-work">The workflow is allowed to emerge</h2>
      <p>
        Foundry supports deterministic handlers and predefined schedules, but it
        does not require the entire job to be expressed as a static graph. An agent
        can interpret a request, split it into campaigns, provision peers, open
        shared work, create artifacts, schedule a follow-up, sleep, and reconvene.
        The boundaries are typed; the route through them can respond to intent.
      </p>

      <h2 id="read-the-handbook">Read by job</h2>
      <div className="doc-cards foundry-handbook-grid">
        {foundrySections.slice(1).flatMap((section) => section.items).map((item) => (
          <Link key={item.href} href={item.href} className="doc-card">
            <h3>{item.label}</h3><p>{item.summary}</p><span>Read →</span>
          </Link>
        ))}
      </div>
    </article>
  );
}
