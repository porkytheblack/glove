import Link from "next/link";
import { DocCards } from "@/components/doc-cards";
import { RebuildShapes } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuilds",
  description:
    "Four always-on agent products rebuilt with Glove Foundry and deployed on Kuiper: AI teammates like Grok Bot, a proactive partner like Claude Duet, a dot you name like OpenAI's dots, and a personal agent like Meta's Muse. Each is a runnable example with an illustrated build.",
};

const pages = [
  {
    href: "/foundry/docs/rebuilds/grok-bot",
    title: "Grok Bot",
    by: "xAI",
    shape: "Sibling bots a person makes and names, all instances of one definition, working in the apps the person connects (Gmail, Linear). Each runs on its own requests: a message, an @-mention, a sibling's handoff or its own routine. They share group chats, one computer and a skill library.",
    example: "foundry-bot-crew",
  },
  {
    href: "/foundry/docs/rebuilds/claude-duet",
    title: "Claude Duet",
    by: "Anthropic",
    shape: "One partner in one thread, working in the person's Gmail and Calendar. A morning brief and quiet check-ins on its own clock, new mail as it lands, approvals before it acts, and a guard on everything it sends.",
    example: "foundry-proactive-partner",
  },
  {
    href: "/foundry/docs/rebuilds/openai-dots",
    title: "OpenAI Dots",
    by: "OpenAI",
    shape: "A dot you name, holding your ongoing responsibilities and working from a connected mailbox. Read-only research between conversations, an auto-review with your Custom Rules before every action, its own computer, and the same dot in the app, Slack or a call.",
    example: "foundry-standing-agents",
  },
  {
    href: "/foundry/docs/rebuilds/meta-muse",
    title: "Meta Muse",
    by: "Meta",
    shape: "One personal agent per person, in the app and on WhatsApp, that does the work across the apps they connect at the access they choose. Its own computer, a separate Sentinel on everything that leaves it, logins it never sees, one-time cards, and a log of what it did and plans.",
    example: "foundry-personal-agent",
  },
];

export default function RebuildsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds</span>
      <h1>Rebuilds</h1>
      <p className="blog-lede">
        In 2026 four companies shipped agents that keep working when you are not looking: xAI&apos;s
        Grok Bot, Anthropic&apos;s Claude Duet, OpenAI&apos;s Dots and Meta&apos;s Muse. Each one is built here from
        Foundry primitives, step by step, and deployed on Kuiper. Read them to see how the parts
        fit together in a real product, or copy one as a starting point.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          These are independent examples built from public docs and launch coverage. They are not
          affiliated with or endorsed by xAI, Anthropic, OpenAI or Meta, and they are not how those
          products are built. Each page lists its sources.
        </p>
      </div>

      <RebuildShapes />

      <h2 id="pages">The four rebuilds</h2>
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
          <tr><th></th><th>Grok Bot</th><th>Claude Duet</th><th>OpenAI Dots</th><th>Meta Muse</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>Who you talk to</strong></td><td>The bot whose job it is; bots are siblings</td><td>One partner</td><td>Your dot, in the app, Slack or a call</td><td>Your Muse, in the app or on WhatsApp</td></tr>
          <tr><td><strong>Instances</strong></td><td>Every bot a person makes, all of one definition</td><td>A partner and a computer per person</td><td>A dot and a builder per person; specialist dots per organisation</td><td>One Muse per person</td></tr>
          <tr><td><strong>Conversations</strong></td><td>One chat per bot; a side of each group chat; one per mesh thread</td><td>Exactly one</td><td>One per channel, sharing memory</td><td>App and WhatsApp, sharing memory</td></tr>
          <tr><td><strong>What wakes it</strong></td><td>A message, an @-mention, a sibling&apos;s handoff, its own routine (a schedule or new mail)</td><td>You, new mail, the morning brief, check-ins</td><td>You, new mail, a Slack message, the research schedule</td><td>You, new mail, checks it set itself</td></tr>
          <tr><td><strong>Connected apps</strong></td><td>Gmail and Linear, per person</td><td>Gmail and Google Calendar</td><td>Gmail (the support mailbox)</td><td>Gmail and Calendar, read or act, as the person chooses</td></tr>
          <tr><td><strong>Who does long work</strong></td><td>The sibling whose job fits, over the mesh</td><td>Its computer, over the mesh</td><td>The builder, over the mesh</td><td>Muse, in its own browser on Kuiper</td></tr>
          <tr><td><strong>What waits for you</strong></td><td>Sends, new skills, new apps and sign-ins</td><td>Send, pay, sign, delete</td><td>Whatever your Custom Rules say to ask about</td><td>Send, buy, and any site the Sentinel asks about</td></tr>
          <tr><td><strong>The safety idea</strong></td><td>Your bots only see your workspace and your accounts</td><td>A guard on everything outbound</td><td>Read-only research, and a review before acting</td><td>A Sentinel it can&apos;t talk round, on everything its browser sends</td></tr>
        </tbody>
      </table>

      <h2 id="shared">What they share</h2>
      <p>Under the differences, all four use the same handful of Foundry parts:</p>
      <ul>
        <li><strong>Agents as data.</strong> A definition says what a kind of agent can be; each agent, its name, job and preferences are an instance in its person&apos;s workspace. See <Link href="/foundry/docs/agents-are-data">Agents are data</Link>.</li>
        <li><strong>The mesh</strong> between agents in a workspace, addressed by instance id, with replies coming back on their own. See <Link href="/foundry/docs/multi-agent#mesh">Multi-agent systems</Link>.</li>
        <li><strong>Schedules</strong> that start runs nobody asked for. See <Link href="/foundry/docs/automation#schedules">Playbooks, schedules &amp; sleep</Link>.</li>
        <li><strong>Approvals</strong> on any tool that changes something outside. See <Link href="/foundry/docs/approvals">Approvals &amp; steering</Link>.</li>
        <li><strong>Connected apps, the same in all four.</strong> Each provider is a Foundry app installed with the person&apos;s account: its MCP server for reads, which the agent calls as functions in code; a transmission for sends, delivered by Foundry after approval; and a connection that brings new mail into a playbook. Accounts and tokens stay in your own store. See <Link href="/foundry/docs/applications#people-connect">Apps &amp; transmissions</Link>.</li>
        <li><strong>Transmissions and playbooks</strong> for messages from outside, such as Gmail or Slack. See <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>.</li>
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
