import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Agents are data",
  description:
    "The one idea to get right in Foundry: a definition is everything a kind of agent could be, like a page that renders any props. Each agent, its name, its job, its apps and its teammates are data. What goes where, the mistakes that follow from getting it wrong, and how to fix them.",
};

export default function AgentsAreDataPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / Agents are data</span>
      <h1>Agents are data</h1>
      <p className="blog-lede">
        <code>defineAgent</code> does not define an agent. It defines everything a kind of
        agent could be: the tools, apps, memory, prompt and rules it can draw on. The agents
        themselves are instances, and they are data. Their names, jobs, apps, owners and
        teammates are data too. Get this right and adding an agent is a write to a database.
        Get it wrong and it is a deploy.
      </p>
      <p>
        This is how Foundry has always worked: a definition is code, an{" "}
        <Link href="/foundry/docs/definitions-and-instances">instance</Link> is a record, and{" "}
        <code>defineAgentInstance</code> describes one in code by pointing at the imported
        definition. What is easy to get wrong is how far it goes.
      </p>

      <h2 id="analogy">A page and its props</h2>
      <p>
        Think of a server-rendered page in Next.js. The page is code: it lays out what a
        profile can show and what it can do. Each profile is data passed in as props. Twitter
        does not have a page in its codebase for every user. When someone changes their name,
        nobody redeploys the site.
      </p>
      <p>
        Foundry works the same way. <code>agents/bot/agent.ts</code> is the page. Each bot a
        person creates (&ldquo;Sales Outbound&rdquo;, &ldquo;Inbox Manager&rdquo;, &ldquo;Bug
        Triage&rdquo;) is an instance of it, and none of them is above the others. The definition
        reads the instance and assembles the right agent for every run.
      </p>
      <CodeBlock
        filename="agents/bot/agent.ts (excerpt)"
        language="typescript"
        code={`export default defineAgent({
  description: "A bot: an AI teammate with its own job, apps and memory",
  components: composeAgent(gmail, sheets, tickets, xApp, memory), // what a bot CAN have
  systemPrompt: (_agent, ctx) => botPrompt(ctx),                  // built from the bot's data
  tools: (_agent, ctx) => botTools(ctx),
  model: botModel,                                                // chosen from the bot's data
  mesh: { waitMs: 60_000 },                                       // bots message each other by id
});`}
      />
      <p>
        A person&apos;s agents are records. Describe them as plain data, then either seed them
        or create them when the person signs up:
      </p>
      <CodeBlock
        filename="lib/people.ts"
        language="typescript"
        code={`export function botFor(person: Person, bot: { id: string; name?: string; job?: string }) {
  return {
    id: bot.id,
    workspaceId: person.id,                 // her team
    name: bot.name ?? "New bot",            // who it is
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name },
  };
}

// Her connected apps are installations too: the Gmail app with her account.
export function installationFor(account: ConnectedAccount): AgentInstallation {
  return { kind: "application", id: APPS[account.app].id, accountId: account.id };
}`}
      />
      <CodeBlock
        filename="foundry.application.ts: the demo account, seeded"
        language="typescript"
        code={`import bot from "./agents/bot/agent.js";

const mayaGmail = await readAccount("maya-gmail");             // from your account store
const inbox = defineAgentInstance(bot, botFor(maya, {
  id: "maya-inbox",
  name: "Inbox Manager",
  job: "Keeps Maya's inbox moving.",
  routines: [{ on: "new-mail", instruction: "Answer what you can; hand the rest on." }],
  installations: [installationFor(mayaGmail)],               // her Gmail, with her account
}));                                                         // the definition is imported, not named

export const data = new FileFoundryDataAdapter({
  file: ".data/foundry.json",
  agents: [inbox],                                           // written only if the id is missing
  conversations: [createConversation(inbox, chatWith(inbox.id))],
});`}
      />
      <CodeBlock
        filename="your app: when someone makes a bot"
        language="typescript"
        code={`await foundry.createAgent("bot", botFor(maya, { id: "maya-bot-4", name: "Inbox Manager" }));
await giveAccounts(foundry, "maya-bot-4", maya);             // install each app she connected, with her account

// Later, a rename is one more write. No deploy.
await foundry.configureAgent("maya-bot-4", { name: "Inbox Zero" });`}
      />
      <p>
        Over HTTP the kind of agent is its route, because a request crosses a process
        boundary. Inside the project, refer to the definition by importing it.
      </p>

      <h2 id="where">What goes where</h2>
      <table>
        <thead><tr><th>In the definition (code)</th><th>On the instance (data)</th></tr></thead>
        <tbody>
          <tr><td>Which tools, apps and MCP servers a kind of agent may use</td><td>Which ones this agent has installed</td></tr>
          <tr><td>How the prompt is built</td><td>What goes into it: its name, its job, its owner, its rules</td></tr>
          <tr><td>How the model is chosen</td><td>The facts it is chosen from, such as a role or a plan</td></tr>
          <tr><td>How schedules are computed</td><td>The time zone, the brief time, the routines it was taught</td></tr>
          <tr><td>Whether it is on the mesh, and the rule for who it may message</td><td>Who is actually in its workspace, and the data the rule reads</td></tr>
          <tr><td>Memory, workspace and store adapters</td><td>What it has remembered and the files it has written</td></tr>
          <tr><td>The shape of a group chat</td><td>Which agents are in this one: <code>conversation.context</code></td></tr>
        </tbody>
      </table>
      <p>
        Two more pieces of data hold this up. A <strong>workspace</strong> is a tenant: a
        person&apos;s or a company&apos;s agents live in one and only see each other. A{" "}
        <strong>conversation</strong> can carry its own data too, such as the members of a
        group chat or the channel it stands for.
      </p>

      <h2 id="mistakes">The mistakes it rules out</h2>
      <p>
        Each of these has been built for real, by people and by coding agents. They all come
        from treating a definition as an agent.
      </p>
      <table>
        <thead><tr><th>Mistake</th><th>What happens</th><th>Instead</th></tr></thead>
        <tbody>
          <tr>
            <td>A definition per agent: <code>agents/sales-outbound/</code>, <code>agents/inbox-manager/</code></td>
            <td>A person cannot make a bot. Every new one is a code change and a deploy.</td>
            <td>One <code>bot</code> definition; each bot an instance.</td>
          </tr>
          <tr>
            <td>A name or a job in code: <code>systemPrompt: &quot;You are Sales Outbound&quot;</code></td>
            <td>Renaming means redeploying, and two people cannot both have a sales bot with their own name.</td>
            <td><code>name</code> and <code>description</code> on the instance; the prompt reads them.</td>
          </tr>
          <tr>
            <td>Teammates by route: an agent that can only reach &ldquo;the coder definition&rdquo;</td>
            <td>Foundry has to invent a worker per route, so the agent you made is not the one that answers.</td>
            <td>Agents message each other by instance id over the <Link href="/foundry/docs/multi-agent#mesh">mesh</Link>; who is on the team is data.</td>
          </tr>
          <tr>
            <td>Branches on identity: <code>if (agentId === &quot;maya-inbox&quot;)</code></td>
            <td>Behaviour depends on ids baked into code, and breaks for the next person.</td>
            <td>Branch on data the instance carries: <code>context.routines</code> includes new mail.</td>
          </tr>
          <tr>
            <td>Per-user settings in environment variables or constants</td>
            <td>One deployment can only serve one person.</td>
            <td>Put them in <code>context</code>, read them in resolvers, change them with <code>configureAgent</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="new-definition">When a second definition is right</h2>
      <p>
        Split definitions by what a kind of agent can do and what it needs to load, never by
        who it is. A new definition earns its place when:
      </p>
      <ul>
        <li><strong>It runs differently:</strong> a voice front with a speech model and a <code>run</code> of its own, next to a text agent.</li>
        <li><strong>It loads different things:</strong> a coding worker that pulls in a sandbox SDK you do not want in the chat agent&apos;s process.</li>
        <li><strong>Its tools must never mix:</strong> a read-only research agent that should have no way to act at all.</li>
      </ul>
      <p>
        Even then, every agent of that kind is still an instance, created by your application
        with its own name and data.
      </p>

      <h2 id="agents-change-data">Agents can change their own data</h2>
      <p>
        Because identity is data, an agent can change it with a tool. A new bot that is told
        its job names itself:
      </p>
      <CodeBlock
        filename="agents/bot/tools.ts (excerpt)"
        language="typescript"
        code={`{
  name: "take_job",
  description: "Take on the job your owner described: give yourself a short name and one sentence saying what you do.",
  inputSchema: z.object({ name: z.string(), description: z.string() }),
  async do(job) {
    const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
    await Effect.runPromise(ctx.data.putAgent({ ...current!, ...job, updatedAt: new Date().toISOString() }));
    return { status: "success", data: { renamed: job.name } };
  },
}`}
      />
      <p>
        Its peers see the new name the next time they list who is on the team. Skills it is
        taught can go in the workspace, so every agent on the team reads the same library.
      </p>

      <h2 id="see-it">See it built</h2>
      <ul>
        <li><Link href="/foundry/docs/rebuilds/grok-bot">Rebuild Grok Bot</Link>: one bot definition; every bot, its name, its apps and its group chats are data.</li>
        <li><Link href="/foundry/docs/rebuilds/claude-duet">Rebuild Claude Duet</Link>: one partner per person, with its schedule built from the person&apos;s data.</li>
        <li><Link href="/foundry/docs/rebuilds/openai-dots">Rebuild OpenAI Dots</Link>: one definition; each dot&apos;s responsibility and rules are its data.</li>
        <li><Link href="/foundry/docs/definitions-and-instances">Definitions &amp; instances</Link>: the record, and every way to create and change one.</li>
      </ul>
    </article>
  );
}
