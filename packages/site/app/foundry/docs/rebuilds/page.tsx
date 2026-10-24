import Link from "next/link";
import { DocCards } from "@/components/doc-cards";
import { RebuildShapes } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuilds",
  description:
    "Three always-on agent products rebuilt with Glove Foundry and deployed on Kuiper: AI teammates like Grok Bot, a proactive partner like Claude Duet, and standing agents like OpenAI Dots. Each is a runnable example with an illustrated build.",
};

const pages = [
  {
    href: "/foundry/docs/rebuilds/grok-bot",
    title: "Grok Bot",
    by: "xAI",
    shape: "Bots a person makes and names, all instances of one definition. A Chief runs them, they pass work over the mesh and share group chats, one computer and a skill library.",
    example: "foundry-bot-crew",
  },
  {
    href: "/foundry/docs/rebuilds/claude-duet",
    title: "Claude Duet",
    by: "Anthropic",
    shape: "One partner in one thread. A morning brief and quiet check-ins on its own clock, approvals before it acts, and a guard on everything it sends.",
    example: "foundry-proactive-partner",
  },
  {
    href: "/foundry/docs/rebuilds/openai-dots",
    title: "OpenAI Dots",
    by: "OpenAI",
    shape: "An agent per standing job. Read-only research between conversations, an auto-review with your rules in front of every action, and the same agent in the app and in Slack.",
    example: "foundry-standing-agents",
  },
];

export default function RebuildsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds</span>
      <h1>Rebuilds</h1>
      <p className="blog-lede">
        In 2026 three companies shipped agents that keep working when you are not looking: xAI&apos;s
        Grok Bot, Anthropic&apos;s Claude Duet and OpenAI&apos;s Dots. Each one is built here from
        Foundry primitives, step by step, and deployed on Kuiper. Read them to see how the parts
        fit together in a real product, or copy one as a starting point.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          These are independent examples built from public docs and launch coverage. They are not
          affiliated with or endorsed by xAI, Anthropic or OpenAI, and they are not how those
          products are built. Each page lists its sources.
        </p>
      </div>

      <RebuildShapes />

      <h2 id="pages">The three rebuilds</h2>
      <DocCards
        cards={pages.map((page) => ({
          href: page.href,
          kicker: page.by,
          title: page.title,
          desc: page.shape,
          packages: [`examples/${page.example}`],
        }))}
      />

      <h2 id="compare">Side by side</h2>
      <table>
        <thead>
          <tr><th></th><th>Grok Bot</th><th>Claude Duet</th><th>OpenAI Dots</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>Who you talk to</strong></td><td>Any bot, or the Chief, who routes to the others</td><td>One partner</td><td>Each dot, in the app or Slack</td></tr>
          <tr><td><strong>Instances</strong></td><td>Every bot a person makes, all of one definition</td><td>A partner and a computer per person</td><td>One per standing job, and a builder per person</td></tr>
          <tr><td><strong>Conversations</strong></td><td>One per chat, group chats included; one per mesh thread</td><td>Exactly one</td><td>One per channel, sharing memory</td></tr>
          <tr><td><strong>What wakes it</strong></td><td>You, an @-mention on X, a routine&apos;s schedule</td><td>You, the morning brief, check-ins</td><td>You, a Slack message, the research schedule</td></tr>
          <tr><td><strong>Who does long work</strong></td><td>The bot whose job fits, over the mesh</td><td>Its computer, over the mesh</td><td>The builder, over the mesh</td></tr>
          <tr><td><strong>What waits for you</strong></td><td>Sends, new skills and sign-ins</td><td>Send, pay, sign, delete</td><td>Whatever your rules say to ask about</td></tr>
          <tr><td><strong>The safety idea</strong></td><td>Your bots only see your workspace; only your posts reach your Chief</td><td>A guard on everything outbound</td><td>Read-only research, and a review before acting</td></tr>
        </tbody>
      </table>

      <h2 id="shared">What they share</h2>
      <p>Under the differences, all three use the same handful of Foundry parts:</p>
      <ul>
        <li><strong>Agents as data.</strong> A definition says what a kind of agent can be; each agent, its name, job and preferences are an instance in its person&apos;s workspace. See <Link href="/foundry/docs/agents-are-data">Agents are data</Link>.</li>
        <li><strong>The mesh</strong> between agents in a workspace, addressed by instance id, with replies coming back on their own. See <Link href="/foundry/docs/multi-agent#mesh">Multi-agent systems</Link>.</li>
        <li><strong>Schedules</strong> that start runs nobody asked for. See <Link href="/foundry/docs/automation#schedules">Playbooks, schedules &amp; sleep</Link>.</li>
        <li><strong>Approvals</strong> on any tool that changes something outside. See <Link href="/foundry/docs/approvals">Approvals &amp; steering</Link>.</li>
        <li><strong>Transmissions and playbooks</strong> for messages from outside, such as X or Slack. See <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.</li>
        <li><strong>Kuiper</strong> for the disk the state lives on, the model gateway, and the lock on the API. See <Link href="/foundry/docs/kuiper">Foundry on Kuiper</Link>.</li>
      </ul>

      <h2 id="run">Run them</h2>
      <p>
        Each example runs offline with <code>pnpm verify</code>: the agents use short scripts
        instead of models, so the check needs no keys and tests the wiring end to end. Add{" "}
        <code>ANTHROPIC_API_KEY</code> and run <code>pnpm dev</code> to use real models in the
        inspector. Each README has the Kuiper commands.
      </p>
    </article>
  );
}
