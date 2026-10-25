import Link from "next/link";
import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { RebuildShapes } from "@/components/rebuild-stories";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("three-always-on-agents-rebuilt")!;
export const metadata = postMetadata(post);

export default function ThreeAgentsRebuiltPost() {
  return (
    <article className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        In three months, xAI shipped Grok Bot, OpenAI shipped Dots and Anthropic shipped Claude
        Duet. All three are agents that keep working when you are not looking. We rebuilt each
        one from Foundry primitives, ran it end to end, and wrote down how to deploy it on Kuiper.
      </p>

      <p>
        The rebuilds are independent examples built from public docs and launch coverage. They
        are not affiliated with or endorsed by xAI, Anthropic or OpenAI, and they are not how those
        products work inside. What they show is how much of each product is the same set of parts.
      </p>

      <RebuildShapes />

      <h2 id="crew">Grok Bot: teammates you make</h2>
      <p>
        Grok Bot lets you make bots and tell each one its job. A new bot asks what you want it
        around for, then names itself for the work: Sales Outbound, Inbox Manager. Your main bot
        takes everyday requests, bots pass work to each other and share group chats, and they all
        work on one cloud computer and in the apps you connect, like Gmail.
      </p>
      <p>
        Our first build got this wrong. It had a definition per bot (a chief, an outreach bot, a
        bugs bot) and wired them together by route. That reads fine until you ask how a person
        makes a bot: they can&apos;t, because every bot is a file and every rename is a deploy.
        It is like Twitter keeping a page in its codebase for every user.
      </p>
      <p>
        The rebuild now has one <code>bot</code> definition that says what any bot can be. Each
        bot is an instance in the person&apos;s workspace. Its name and job are the
        instance&apos;s <code>name</code> and <code>description</code>, and a new bot sets them
        itself with a <code>take_job</code> tool that writes its own record. The main bot is a
        bot whose data says <code>primary: true</code>. A group chat is a conversation whose data
        lists its members. Skills live in the workspace, so every bot reads the same library.
      </p>
      <p>
        That changed Foundry too. Foundry had a <code>delegates</code> field that named workers by
        route, and it created a worker per route behind your back, so the bot you made was not the
        one that answered. We removed it. Foundry now hosts{" "}
        <Link href="/docs/mesh">Glove Mesh</Link> instead: agents message each other by instance
        id, their peers are whoever is in their workspace, and a reply comes back to the
        conversation that asked. Running many bots on one definition also exposed a scheduling
        bug, where one busy bot made the others skip their routines. That is fixed.{" "}
        <Link href="/foundry/docs/rebuilds/grok-bot">Read the build</Link>, and{" "}
        <Link href="/foundry/docs/agents-are-data">Agents are data</Link> for the rule.
      </p>
      <p>
        We also first built from launch coverage and got details wrong. Grok Bot&apos;s own docs
        (on cursor.com and docs.x.ai) have no &ldquo;chief&rdquo; role, only a main bot that a
        person can name anything; apps belong to the account, not to a bot; and group chats let
        the bots decide who answers. The rebuild follows the docs now.
      </p>
      <p>
        Connecting apps took a second pass too. The quick way is to point the agent at each
        app&apos;s MCP server and put every tool in its context. Foundry already has a better
        place for this: an app. A Foundry app owns the account it works with, the way messages
        come in (a Gmail watch that delivers new mail) and the way they go out (a send that
        Foundry delivers inside the account&apos;s session after you approve it). Foundry apps
        can now carry an MCP server too, opened with the installation&apos;s account, with a
        rule per tool: allow, ask or hide. The reads become functions the bot calls in code,{" "}
        <code>gmail.search_threads(…)</code>, so a dozen lookups are one program instead of a
        dozen turns. Accounts and tokens stay in your own store; Foundry reads them through a
        directory you supply. All three rebuilds now connect apps this way. Building it also
        turned up a hole: an agent could send on a bound route through{" "}
        <code>glove_foundry_transmit</code> without the approval the app&apos;s send asks for.
        That tool now sends only on routes the agent&apos;s playbooks declare, and asks when the
        transmission asks.
      </p>

      <h2 id="partner">Claude Duet: a partner</h2>
      <p>
        Duet is one agent in one thread. It sends a brief each morning, checks in through the day
        and messages you only about what you said you want to hear. It asks before it sends,
        pays, signs or deletes, some things it won&apos;t do even with approval, and a classifier
        keeps card and ID numbers from leaving.
      </p>
      <p>
        What makes it proactive is two schedules built from the person&apos;s data: their time
        zone, when they want the brief and which hours are worth a look. Change a preference and
        the next run moves the schedule:
      </p>
      <CodeBlock
        language="typescript"
        code={`schedules: (_agent, { agentInstance }) => partnerSchedules(agentInstance.context),`}
      />
      <p>
        The rest is approvals and a guard. <code>requiresPermission</code> takes a function, which
        turned out to matter: a message the guard will refuse should not ask you to approve it
        first. Long jobs go to its computer, another agent in the person&apos;s workspace, over
        the mesh. <Link href="/foundry/docs/rebuilds/claude-duet">Read the build</Link>.
      </p>

      <h2 id="dots">OpenAI Dots: your dot</h2>
      <p>
        You name your dot and make it your own. It keeps notes on your ongoing
        responsibilities, researches in the background with read-only tools, and works on a
        computer of its own. Before it acts, an auto-review checks your Custom Rules (allow,
        ask, or block) and built-in safety. You reach the same dot in ChatGPT, Slack or on a
        call.
      </p>
      <p>
        In Foundry, a dot is an instance whose data holds its name, your responsibilities and
        your rules, and a specialist dot for an organisation is the same definition with its own
        account.
        Read-only research is a tool list that depends on what started the run: a schedule gets
        only the read tools, so the acting tools are not there to misuse. The auto-review is a
        wrapper around each acting tool. Heavy jobs go to the person&apos;s builder over the
        mesh, and research runs don&apos;t get the mesh at all.{" "}
        <Link href="/foundry/docs/rebuilds/openai-dots">Read the build</Link>.
      </p>

      <h2 id="same">What they share</h2>
      <p>Line them up and the same parts keep appearing:</p>
      <ul>
        <li>One definition per kind of agent, and every agent as data: an instance per person or per job, with what makes it theirs in its data.</li>
        <li>Agents in a workspace that message each other by id over the mesh.</li>
        <li>Schedules for runs nobody asked for.</li>
        <li>Approvals on anything that changes the world.</li>
        <li>Connected apps as Foundry apps: the provider&apos;s MCP server for reads in code, a transmission for sends, a connection for new mail, and accounts in your own store.</li>
        <li>Transmissions and playbooks for messages from outside, like new mail or a Slack message.</li>
        <li>On Kuiper: the <code>/data</code> disk for all of it, the model gateway, and a lock on the API.</li>
      </ul>
      <p>
        The differences are mostly policy: who you talk to, what wakes the agent, and what waits
        for you. Those are the parts you write. The rest was already there.
      </p>

      <h2 id="try">Try them</h2>
      <CodeBlock
        language="bash"
        code={`pnpm --filter glove-foundry-bot-crew verify
pnpm --filter glove-foundry-proactive-partner verify
pnpm --filter glove-foundry-standing-agents verify`}
      />
      <p>
        Each runs offline with scripted models, so it checks the wiring with no keys. Add{" "}
        <code>ANTHROPIC_API_KEY</code> and run <code>pnpm dev</code> to use real models. The{" "}
        <Link href="/foundry/docs/rebuilds">Rebuilds</Link> section has a step-through of each.
      </p>
    </article>
  );
}
