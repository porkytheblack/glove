import Link from "next/link";
import { DocCards } from "@/components/doc-cards";
import { LayerStack } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses");

const rows: {
  name: string;
  href: string;
  surface: string;
  context: string;
  state: string;
  workspace: string;
  team: string;
  system: string;
}[] = [
  {
    name: "Coding agent",
    href: "/docs/harnesses/coding",
    surface: "Terminal or web client over a socket; plan approval with pushAndWait",
    context: "Repository guides as skills, the task list, compaction",
    state: "Transcript, permission decisions",
    workspace: "A sandbox, or the host directory behind permission gates",
    team: "Read-only explorer and reviewer subagents",
    system: "Optional: Foundry for background runs",
  },
  {
    name: "Personal agent",
    href: "/docs/harnesses/personal",
    surface: "Telegram, email or WebChat",
    context: "Pinned preferences and live state at the tail",
    state: "Memory of people, events and notes",
    workspace: "A browser, documents, a sandbox",
    team: "A research subagent",
    system: "One instance per person, schedules, sleep, approvals",
  },
  {
    name: "Support desk",
    href: "/docs/harnesses/support",
    surface: "The ticket thread or chat widget",
    context: "The customer's record as live context",
    state: "Forms, facts and goals per conversation",
    workspace: "Usually none: MCP or tables over your systems",
    team: "A read-only research subagent",
    system: "Instance per customer, transmissions, playbooks, subscriptions, classifiers, approvals",
  },
  {
    name: "Voice agent",
    href: "/docs/harnesses/voice",
    surface: "Speech: a pipeline or a realtime model",
    context: "Runtime context, refreshed silently",
    state: "Forms that work over speech",
    workspace: "None in the voice loop",
    team: "A fast front agent and a heavy worker over mesh",
    system: "Durable work delegated to Foundry",
  },
  {
    name: "Research & documents",
    href: "/docs/harnesses/research",
    surface: "Chat, with files handed over by present",
    context: "Skills in /skills; the script library",
    state: "VFS snapshots between runs",
    workspace: "Working environment, a REPL, format adapters",
    team: "A reviewer subagent",
    system: "VFS persistence, background work",
  },
  {
    name: "Multi-agent workforce",
    href: "/docs/harnesses/workforce",
    surface: "The inspector, plus your own briefing UI",
    context: "One prompt per role",
    state: "Workspace entries, tasks, the shared inbox",
    workspace: "Shared VFS paths passed by reference",
    team: "Spawn, mesh, subagents",
    system: "Subscriptions that provision agents, schedules",
  },
];

export default function HarnessesPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprints</span>
      <h1>Harness blueprints</h1>
      <p className="blog-lede">
        A coding agent, a personal assistant and a support desk look nothing alike from the
        outside. Inside, they are the same parts: a loop, tools, context, state, a workspace, a
        surface and sometimes a team. What changes is which parts carry the weight. Each
        blueprint below lists the primitives a harness uses, what you write yourself, and how it
        deploys.
      </p>
      <p>
        If the parts are new to you, read <Link href="/docs/first-principles">First principles</Link>{" "}
        first. If you are about to build something and want to know whether it already exists,
        check the <Link href="/docs/primitives">primitives map</Link>.
      </p>

      <LayerStack caption="Every blueprint draws from the same three layers. Glove builds the harness, Foundry runs many of them as a system, Kuiper runs the system in production." />

      <h2 id="compare">Same parts, different weight</h2>
      <p>
        Read a column top to bottom and the pattern shows: every harness has a surface and
        context, most have state, and only some need a workspace or a team. The system column is
        where the agent stops being one conversation and becomes a service.
      </p>
      <table>
        <thead>
          <tr>
            <th>Harness</th>
            <th>Surface</th>
            <th>Context</th>
            <th>State</th>
            <th>Workspace</th>
            <th>Team</th>
            <th>System</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.href}>
              <td>
                <Link href={row.href}>{row.name}</Link>
              </td>
              <td>{row.surface}</td>
              <td>{row.context}</td>
              <td>{row.state}</td>
              <td>{row.workspace}</td>
              <td>{row.team}</td>
              <td>{row.system}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="blueprints">The blueprints</h2>
      <DocCards
        cards={[
          {
            href: "/docs/harnesses/coding",
            kicker: "Tools · Workspace · Context",
            title: "Coding agent",
            desc: "File and shell tools behind permission gates, a plan the person approves, a task list, repository skills, subagents, and a sandbox when the code is not yours to trust.",
            packages: ["glove-core", "glove-execution"],
          },
          {
            href: "/docs/harnesses/personal",
            kicker: "State · Time · Arrival",
            title: "Personal agent",
            desc: "An assistant that works while you don't: a chat channel, memory, reminders and sleep, a browser and documents, email, approvals before anything irreversible.",
            packages: ["glove-foundry", "glove-memory", "glove-execution"],
          },
          {
            href: "/docs/harnesses/support",
            kicker: "Identity · Arrival · Oversight",
            title: "Support desk",
            desc: "An agent per customer that wakes on tickets, triages with a classifier before any model runs, collects details with forms and waits for a human before refunds.",
            packages: ["glove-foundry", "glove-classifier", "glove-memory"],
          },
          {
            href: "/docs/harnesses/voice",
            kicker: "Surface · Team",
            title: "Voice agent",
            desc: "A fast front that keeps talking while a worker does the tool work, on a speech pipeline or a realtime model, with durable work handed to Foundry.",
            packages: ["glove-voice", "glove-voice-s2s", "glove-realtime", "glove-mesh"],
          },
          {
            href: "/docs/harnesses/research",
            kicker: "Workspace",
            title: "Research & documents",
            desc: "An analyst that computes in code, writes PDFs, decks and spreadsheets as files, and looks at its own output before handing it over.",
            packages: ["glove-working-environment", "glove-env-documents", "glove-js"],
          },
          {
            href: "/docs/harnesses/workforce",
            kicker: "Team · Identity · Time",
            title: "Multi-agent workforce",
            desc: "Agents provisioned by events, coordinating through workspace entries, tasks and mesh, with one inspector over all of it.",
            packages: ["glove-foundry", "glove-mesh"],
          },
        ]}
      />

      <h2 id="reading">How to read a blueprint</h2>
      <p>
        Each page opens with a bill of materials: for each of the three layers, the parts the
        harness uses and the primitives it takes from each, then the parts it doesn&apos;t need.
        The dashed box is what you write: usually your domain tools, your prompts, and the adapter for your own
        channel or data. Everything else is already built.
      </p>
      <p>
        Then comes one request or event walked through the harness, a skeleton you can start from,
        the things people most often hand-build for that shape (and what to use instead), and the
        steps to deploy it on <Link href="/foundry/docs/kuiper">Kuiper</Link>.
      </p>
      <p>
        To build the same parts up one at a time instead, follow{" "}
        <Link href="/docs/build/loop">Build it up</Link>, which takes one agent from a single tool to
        a deployed Foundry system in eight steps.
      </p>
    </article>
  );
}
