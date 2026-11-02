import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { ConnectedAppStory, CrewStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Grok Bot",
  description:
    "Build AI teammates like xAI's Grok Bot with Glove Foundry and deploy them on Kuiper: one bot definition and every bot as data, sibling bots with a starred Primary Bot for asks that name no bot, bots that take a name, a job and a working style, apps connected once per person (Gmail, Linear, any MCP server) with reads in code, sends delivered by Foundry and new mail pushed in, group chats and handoffs over the mesh, one shared computer, skills invoked with / and routines, copies and templates, and approvals.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-bot-crew";

export default function GrokBotRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / Grok Bot</span>
      <h1>Rebuild Grok Bot</h1>
      <p className="blog-lede">
        Grok Bot gives you bots you keep around: AI teammates with names, jobs and context that
        builds up over time. They work in the apps you connect, like Gmail, on a cloud computer
        they share, pass work to each other, and come back when something needs your approval.
        This page builds the same shape in Foundry and deploys it on Kuiper. Two parts are worth
        copying: there is one bot definition and every bot is data, and every app a person
        connects is a Foundry app installed with their account.
      </p>
      <p>
        Grok Bot launched in beta on 11 August 2026 and runs on Cursor&apos;s cloud. SpaceXAI
        picks the model, with no picker and automatic failover. Here the operator sets one model
        for every bot (<code>BOT_MODEL</code>), with no failover.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from the Grok Bot docs on cursor.com and docs.x.ai
          (sources at the end). It is not affiliated with or endorsed by xAI (SpaceXAI) or Cursor, and it is
          not how Grok Bot is built. The code is in <a href={EXAMPLE}>examples/foundry-bot-crew</a>,
          and <code>pnpm verify</code> runs all of it offline, against local servers that use
          Google&apos;s and Linear&apos;s MCP tool names.
        </p>
      </div>

      <h2 id="what">What Grok Bot does</h2>
      <ul>
        <li><strong>Bots with a name, a job and a working style.</strong> Your first bot is made for you and starred. A new one asks what you want it around for, or you give it a name, a job and a working style. Each keeps its memory and preferences across sessions; files live on the shared computer. You can have up to 50.</li>
        <li><strong>Bots are siblings, one starred.</strong> There is no coordinator kind. One sibling is starred as the Primary Bot: it takes the asks that name no bot and hands specialists their part. The star is data you can move. You can also write to the bot whose job it is, and a bot can hand part of its work to another. Each bot&apos;s conversation is its own.</li>
        <li><strong>Apps belong to your account.</strong> Your bots work in the apps you connect: Gmail, your calendar, your tracker. A bot asks for access when it needs an app, and once you connect it, every bot can use it.</li>
        <li><strong>One computer for all your bots.</strong> A persistent cloud computer with a browser, filesystem and terminal. Your bots share its files, browser sessions and logins, each on its own screen. Isolation is per person: strict between people, but your bots are not a boundary from each other.</li>
        <li><strong>Sign-ins stay with you.</strong> For passwords, 2FA and CAPTCHAs you take over the bot&apos;s screen; other secrets go through a masked request, never chat.</li>
        <li><strong>Bots work together.</strong> They message each other and pass ownership of a task. A group chat holds two to six bots: they decide who answers, you can hand one of them a request, and @everyone reaches all of them.</li>
        <li><strong>Skills and routines.</strong> A skill is reusable instructions any bot can use, invoked with <code>/</code>. You save one from chat or by showing a bot the workflow in the browser (&ldquo;Teach a task&rdquo;). A routine assigns a workflow to one bot and runs it on a schedule or after an event, up to 50 per bot.</li>
        <li><strong>Copies and templates.</strong> Duplicating a bot copies its profile, skills and routines, not its memory or history. A template shares a bot&apos;s instructions, chosen memories, skills, routines and first-party integrations, without chats, keys, custom MCP servers or scripts, and a marketplace lists ready-made bots.</li>
        <li><strong>Approvals.</strong> Sending, buying, deleting and publishing wait for you: allow once, deny, or make an always-allow rule. Require-approval rules win, and sensitive actions can pass through Auto Review first. A direct message from you takes priority over background work and can redirect the current turn.</li>
        <li><strong>Team Bots</strong> (public beta, 28 September 2026). An owner publishes one shared bot. Each teammate gets a private chat the owner can&apos;t read, memory is team-wide plus per person, and a custom Slack app can be deployed.</li>
      </ul>

      <h2 id="flow">How work moves</h2>
      <CrewStory />

      <h2 id="data">One definition, every bot in data</h2>
      <p>
        The tempting build is a folder per bot: <code>agents/sales-outbound/</code>,{" "}
        <code>agents/inbox-manager/</code>. Then you can&apos;t make a bot, because each new one
        is a code change, and renaming one is a deploy. It is like Twitter keeping a page in its
        codebase for every user. Instead, <code>agents/bot/agent.ts</code> says what any bot{" "}
        <em>can</em> be, and each bot is an instance of it:
      </p>
      <table>
        <thead><tr><th>Grok Bot</th><th>In this build</th><th>Changed by</th></tr></thead>
        <tbody>
          <tr><td>A bot&apos;s name, job and working style</td><td>The instance&apos;s <code>name</code>, <code>description</code> and <code>context.style</code></td><td>The bot itself with <code>take_job</code>, or your app with <code>configureAgent</code></td></tr>
          <tr><td>Your bots, up to 50</td><td>The instances in your workspace</td><td>Making (<code>makeBot</code>) or deleting a bot</td></tr>
          <tr><td>Your Primary Bot</td><td><code>context.starred</code> on one instance</td><td>Your app with <code>starBot</code></td></tr>
          <tr><td>Connected apps</td><td>An account in your store, and on every bot of the person an installation with that account (plus Gmail&apos;s routes and a send binding)</td><td>Your Connect button: the provider&apos;s sign-in, then <code>connectApp</code></td></tr>
          <tr><td>&ldquo;Always allow&rdquo; and require-approval rules</td><td>The installation&apos;s <code>config.alwaysAllow</code> and <code>config.alwaysAsk</code>; asking wins</td><td>Your app, when the person sets them</td></tr>
          <tr><td>A bot&apos;s chat with you</td><td>A conversation on that bot, key <code>chat</code></td><td>Your app, when the bot is made</td></tr>
          <tr><td>A group chat and who is in it</td><td>A conversation per member, each with <code>context.group.members</code>; no host</td><td>Your app (<code>openGroup</code>)</td></tr>
          <tr><td>Skills</td><td>Workspace entries, <code>skill:&lt;name&gt;</code></td><td>A bot with <code>save_skill</code>, after you review it</td></tr>
          <tr><td>Routines on a schedule</td><td>Schedules on the bot that owns them, plus any a copy or template brought in <code>context.schedules</code></td><td>A bot with <code>glove_foundry_schedule</code></td></tr>
          <tr><td>Routines after an event</td><td>The bot&apos;s <code>context.routines</code>, which builds its playbook</td><td>A bot with <code>add_routine</code></td></tr>
          <tr><td>The shared computer</td><td>One working environment per workspace</td><td>The bots, as they work</td></tr>
        </tbody>
      </table>
      <p>
        None of these needs a deploy. See <Link href="/foundry/docs/agents-are-data">Agents are
        data</Link> for the general rule.
      </p>

      <h2 id="siblings">Siblings, and what starts a bot</h2>
      <p>
        The bots are siblings: the same definition, different data, and no coordinator kind.
        One sibling is starred as the Primary Bot. It takes the asks that name no bot and hands
        specialists their part. The star is <code>context.starred</code>, data you can move with{" "}
        <code>starBot</code>. What makes a bot run is the request that reaches it:
      </p>
      <table>
        <thead><tr><th>What starts a bot</th><th>In Foundry</th><th>Where it lands</th></tr></thead>
        <tbody>
          <tr><td>The person writes to it</td><td><code>send(botId, …)</code></td><td>That bot&apos;s <code>chat</code></td></tr>
          <tr><td>The person asks without naming a bot (the starred one)</td><td><code>askPrimary</code> sends it to the starred bot</td><td>That bot&apos;s <code>chat</code></td></tr>
          <tr><td>It is @-mentioned in a group chat, or nobody is (this build&apos;s rule)</td><td><code>postToGroup</code> sends to the bots a message names, or to all members</td><td>Its side of the group</td></tr>
          <tr><td>A sibling hands it work</td><td><code>glove_mesh_send_message</code> to its instance id</td><td>A thread on it; the answer goes back on its own</td></tr>
          <tr><td>Its routine on a schedule</td><td>A schedule it set with <code>glove_foundry_schedule</code></td><td>Its own conversation</td></tr>
          <tr><td>Its routine after an event, like new mail</td><td>A playbook built from its <code>context.routines</code></td><td>Its <code>chat</code></td></tr>
        </tbody>
      </table>
      <p>
        One event can wake more than one bot. New mail reaches every bot whose routine asks for
        it: Inbox Manager answers it, Bug Triage files it if it reports a bug.
      </p>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Installable capabilities", "Applications and connections", "MCP servers", "Transmissions", "Playbooks", "Code as the tool surface", "Foundry mesh", "Shared work", "Working environment", "Memory", "Content skills", "Schedule management", "Approvals", "Request authorization", "Model gateway", "Persistent disk"]}
        write={["What a bot can be: its prompt, tools and apps", "Your account store and OAuth callback", "Gmail and Pub/Sub calls", "The scripted models for offline runs"]}
      />

      <h2 id="step-1">1. What a bot can be</h2>
      <p>
        The definition lists everything a bot could have: the apps a person may connect, memory,
        the shared computer, the REPL, the mesh, the new-mail playbook. Which of it a given bot
        gets is decided from its data on each run. The file only assembles; the prompt and tools
        live beside it.
      </p>
      <CodeBlock
        filename="agents/bot/agent.ts"
        language="typescript"
        code={`export default defineAgent({
  description: "A bot: an AI teammate with its own job and memory, working in its owner's apps and on a computer it shares with their other bots",
  components: composeAgent(gmailApp, linearApp, memory),   // apps a bot may have, each installed with its owner's account

  model: botModel,                                   // from the bot's data
  systemPrompt: (_agent, ctx) => botPrompt(ctx),     // from the bot's data
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [memory],

  tools: (_agent, ctx) => botTools(ctx),             // take_job, connect_app, save_skill, add_routine, request_sign_in, skills
  skills: (_agent, ctx) => slashSkills(ctx.data, ctx.workspaceId),  // the library, invoked with /name
  workingEnvironment: computer,                      // one per workspace
  repl: () => defineRepl({                           // the apps' reads, as functions
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools.filter((tool) => tool.readOnly)), keepDirect: false },
  }),
  mesh: { waitMs: 60_000 },                          // siblings message each other by id

  // A routine after an event: new mail reaches the bots whose data asks for it.
  playbooks: (_agent, { agentInstance, installations }) => {
    const mail = installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
    const routines = (agentInstance.context.routines ?? []).filter((item) => item.on === "new-mail");
    return mail?.accountId && routines.length > 0 ? [newMailFor(mail.accountId, routines)] : [];
  },
  // Routines on a schedule that came as data, with a copy or a template.
  schedules: (_agent, { agentInstance }) => (agentInstance.context.schedules ?? []).map((item) => defineSchedule(item)),

  accountSessions,                                   // the credential boundary (lib/accounts.ts)
});`}
      />
      <p>
        The prompt reads the instance. A bot with no job is told to ask for one; any other bot
        is told its own job and working style, that its siblings are equals it can hand parts
        to, its routines, its owner&apos;s apps and how to send email from their address. The
        starred bot is also told that asks naming no bot come to it: it does its part and hands
        each sibling theirs with <code>glove_mesh_send_message</code>.
      </p>

      <h2 id="step-2">2. A person&apos;s bots are records</h2>
      <p>
        A person&apos;s workspace is their team. Their bots are plain data in{" "}
        <code>lib/people.ts</code>. The example seeds Maya, her sample Gmail account and her
        first bot, Inbox Manager, starred, whose routine is on new mail; your app creates
        everyone else&apos;s when they sign up, with <code>makeBot</code> (at most 50 per
        person), and stars their first bot:
      </p>
      <CodeBlock
        filename="foundry.application.ts (excerpt)"
        language="typescript"
        code={`const mayaGmail = accountFor(MAYA, "gmail", sampleConnection(MAYA, "gmail").identity, true);
if (!(await readAccount(mayaGmail.id))) await saveAccount(mayaGmail, sampleConnection(MAYA, "gmail").tokens);

const mayaInbox = defineAgentInstance(bot, botFor(MAYA, {
  id: "maya-inbox",
  name: "Inbox Manager",
  job: "Keeps Maya's inbox moving: answers what it can from her address and hands the rest to the bot whose job it is.",
  style: "Short replies in Maya's voice. Checks with her before promising a date or a price.",
  starred: true,                             // her Primary Bot: asks that name no bot come here
  routines: [{ on: "new-mail", instruction: "Read each new email. Answer the ones you can; hand the rest to a sibling." }],
  installations: [installationFor(mayaGmail)],
}));

export default defineApplication({
  name: "Bot crew",
  data,                                      // seeds written only when the id is missing
  services,                                  // your accounts, plus routes and bindings in a file
  routes: [gmailRoutes(mayaGmail.id).in, gmailRoutes(mayaGmail.id).out],
  bindings: [sendBinding(mayaInbox.id, mayaGmail.id)],
});`}
      />

      <h2 id="step-3">3. A bot names itself</h2>
      <p>
        A new bot asks what it is for. When Maya answers, it calls <code>take_job</code>, a
        tool that writes its own instance:
      </p>
      <CodeBlock
        filename="agents/bot/tools.ts (excerpt)"
        language="typescript"
        code={`{
  name: "take_job",
  description: "Take on the job your owner described: give yourself a short name, one sentence saying what you do, and your working style if they gave one.",
  inputSchema: z.object({
    name: z.string().min(1).max(40),
    description: z.string().min(1).max(300),
    style: z.string().max(200).optional(),
  }),
  async do({ style, ...job }) {
    const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
    const context = style ? { ...current!.context, style } : current!.context;
    await Effect.runPromise(ctx.data.putAgent({ ...current!, ...job, context, updatedAt: new Date().toISOString() }));
    return { status: "success", data: { renamed: job.name } };
  },
}`}
      />
      <p>
        The bot&apos;s next run reads the new name, job and working style, and the next time a
        sibling lists the team it sees &ldquo;Sales Outbound&rdquo;. Your app can rename a bot
        the same way with <code>configureAgent</code>.
      </p>

      <h2 id="step-4">4. Apps a person connects</h2>
      <p>
        An app is a <Link href="/foundry/docs/applications">Foundry app</Link>, installed per
        bot with the person&apos;s account, and it holds everything about its provider. Gmail
        reads and drafts through Google&apos;s Gmail MCP server, sends through its transmission,
        and hears about new mail through a connection:
      </p>
      <ConnectedAppStory />
      <CodeBlock
        filename="agents/bot/apps/gmail.app.ts"
        language="typescript"
        code={`export default defineApp({
  description: "Gmail: search, read and draft mail, send with approval, and hear about new mail",
  config: z.object({
    alwaysAllow: z.array(z.string()).default([]),  // "Always allow"
    alwaysAsk: z.array(z.string()).default([]),    // require-approval rules, which win
  }),
  inbound: [gmail],                // new mail, as events
  outbound: [gmail],               // sending: Google's server has no send tool
  connections: [gmailWatch],       // users.watch, Pub/Sub, history.list
  mcp: {
    entry: mcpServer("gmail"),     // https://gmailmcp.googleapis.com/mcp/v1, or a local server for a sample account
    auth: mcpCredentials(),        // the person's token as a bearer header, inside accountSessions
    tools: askUnlessAllowed(["search_threads", "get_thread", "get_message", "list_drafts", "list_labels", "create_draft"]),
  },
});`}
      />
      <ul>
        <li><strong>Reads come from the provider&apos;s MCP server</strong>, opened with the installation&apos;s account. The tool policy runs reads and drafts, and asks before anything else unless the person chose &ldquo;Always allow&rdquo; for it. A tool in <code>alwaysAsk</code> asks even if it is always allowed.</li>
        <li><strong>Sending is the Gmail transmission&apos;s outbound side.</strong> Foundry delivers it in its own process, inside the account session, after Maya approves the exact email, and only for a bot whose binding grants <code>gmail:send</code>. The bot never holds the token.</li>
        <li><strong>Linear is an app that is only an MCP server</strong> (<code>https://mcp.linear.app/mcp</code>). Most apps look like that; add a transmission when the provider pushes events or a send must run outside the agent.</li>
      </ul>
      <p>
        Accounts are yours. When a bot needs an app it asks with <code>connect_app</code>; your
        app shows that approval as a Connect button that runs the provider&apos;s sign-in. The
        callback saves the account and tokens in your store, then writes what Foundry needs:
      </p>
      <CodeBlock
        filename="lib/connect.ts (excerpt)"
        language="typescript"
        code={`export async function connectApp(foundry, person, app, { tokens, identity, alwaysAllow }) {
  const account = accountFor(person, app, identity);
  await saveAccount(account, tokens);                          // your store; Foundry reads it, never writes it
  if (app === "gmail") {
    await foundry.putRoute(gmailRoutes(account.id).in);        // new mail
    await foundry.putRoute(gmailRoutes(account.id).out);       // sending
  }
  for (const bot of await foundry.agents()) {                  // apps are the person's: every bot gets it
    if (bot.workspaceId !== person.id) continue;
    await foundry.install(bot.id, installationFor(account, alwaysAllow));
    if (app === "gmail") await foundry.putBinding(sendBinding(bot.id, account.id));
  }
  return account;
}`}
      />
      <p>
        Foundry reads accounts through your account directory (<code>services</code> in{" "}
        <code>foundry.application.ts</code>), keeps routes and bindings in{" "}
        <code>fileTopologyStore</code>, and asks <code>accountSessions</code> for each operation
        (<code>mcp:connect</code>, <code>gmail:send</code>, <code>gmail:watch</code>), which refreshes
        tokens as they expire. Grok Bot keeps secrets out of chat the same way, with a masked
        request.
      </p>

      <h2 id="step-5">5. Bots read their apps in code</h2>
      <p>
        The REPL turns each installed app&apos;s reads into a group of functions. Sales Outbound
        finds this week&apos;s signups in one program instead of a chain of tool calls, and only
        the result comes back into context:
      </p>
      <CodeBlock
        filename="what Sales Outbound runs"
        language="javascript"
        code={`execute_js({ code: \`
  const found = gmail.search_threads({ query: "subject:signup" });
  found.threads.map((thread) => thread.latest.subject)
\` })
// → ["New signup: Dana Lee (Northwind)", "New signup: Ravi Patel (Globex)"]`}
      />
      <p>
        Writes stay direct tools, so Maya can see them: the send waits for her, and filing a
        Linear issue runs because she always allows it. A person with ten connected apps does not
        put ten catalogues in context: <code>keepDirect: false</code> keeps the reads in code.
      </p>

      <h2 id="step-6">6. Bots pass work over the mesh</h2>
      <p>
        <code>mesh</code> gives every bot the <Link href="/foundry/docs/multi-agent#mesh">Glove
        Mesh tools</Link>, hosted by Foundry. Its peers are the other bots in its workspace, so
        a bot only ever sees its owner&apos;s team. When part of a task is a sibling&apos;s job,
        a bot lists them, picks the one whose job fits, and sends it that part by id. Maya tells
        Bug Triage about a crash; it files the bug in Linear and passes the fix to Engineer. The
        final answer comes back to the conversation that sent the work, as a new turn.
      </p>
      <CodeBlock
        filename="what Bug Triage receives"
        language="text"
        code={`<mesh-message id="msg_…" thread="thread_…" from="maya-bot-3" name="Engineer" status="replied">
Patched on branch fix/empty-export: export returns an empty file for an empty report. Added a test.
</mesh-message>`}
      />
      <p>
        An ask that names no bot goes to the starred bot. <code>askPrimary</code> sends it to
        that bot&apos;s chat, and its prompt says it is starred, so it does its part and hands
        each sibling theirs. When Maya asks how the week looks, Inbox Manager answers for the
        inbox and asks Sales Outbound for the leads:
      </p>
      <CodeBlock
        filename="lib/groups.ts (excerpt)"
        language="typescript"
        code={`export async function askPrimary(foundry, personId, text) {
  const primary = primaryOf(await foundry.agents(), personId);   // the bot with context.starred
  return foundry.send(primary.id, chatWith(primary.id).id, text);
}`}
      />
      <p>
        A group chat has no host. Each member keeps its own conversation for it, whose data
        lists the members, and your app shows them merged. In Grok Bot the bots decide who
        answers. In this build, <code>postToGroup</code> sends the person&apos;s message to the
        bots it @-mentions, or to every member for @everyone or no mention. A member with
        nothing to add replies with nothing, which posts nothing. A bot brings a sibling in the
        same way it hands off work, and the answer comes back to its side of the group.
      </p>
      <CodeBlock
        filename="lib/groups.ts (excerpt)"
        language="typescript"
        code={`export async function postToGroup(foundry, chat, text) {
  const team = await foundry.agents();
  const members = chat.members.map((id) => team.find((agent) => agent.id === id) ?? { id });
  for (const botId of addressed(text, members)) {               // the mentioned bots, or all of them
    await foundry.send(botId, groupConversationId(botId, chat), text);
  }
}`}
      />

      <h2 id="step-7">7. One computer, one skill library</h2>
      <p>
        The computer is a working environment saved per workspace with Foundry&apos;s own
        persistence, so files one bot writes, another can read:
      </p>
      <CodeBlock
        filename="agents/bot/computer.ts"
        language="typescript"
        code={`export const computer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: foundryDataEnvironmentPersistence({ scope: "workspace" }),
});`}
      />
      <p>
        Saves replace the whole snapshot, so if two bots write at once the last one wins. For
        bots that work side by side, use a <Link href="/foundry/docs/kuiper#services">Kuiper
        sandbox and browser</Link> per person: one live machine. As in Grok Bot, isolation is per
        person, so bots are not a boundary from each other, and deleting a bot leaves its files.
      </p>
      <p>
        Skills live in the workspace too, as <code>skill:&lt;name&gt;</code> entries.{" "}
        <code>save_skill</code> has <code>requiresPermission</code>, so Maya reads the draft
        before any bot can use it. The definition&apos;s <code>skills</code> turns each entry
        into a Glove skill, so <code>/monday-signups</code> in a message to any bot puts that
        skill&apos;s steps just before the message. Bots find and read skills themselves with{" "}
        <code>glove_read_skill</code>.
      </p>
      <p>
        A routine belongs to one bot: on a schedule it is a schedule the bot sets with{" "}
        <code>glove_foundry_schedule</code>; after an event, <code>add_routine</code> writes it
        to the bot&apos;s own data and its playbook is built from it on the next run. A bot can
        have several routines on one event, and <code>add_routine</code> refuses a 51st,
        counting the bot&apos;s schedules.
      </p>

      <h2 id="step-8">8. Approvals and sign-ins</h2>
      <p>
        Drafting is free; sending waits. The Gmail send tool comes from the transmission&apos;s{" "}
        <code>requiresPermission</code>, so Foundry records the exact email, holds the run, and
        resumes it when Maya answers in the inspector, through the API or in your app.
        &ldquo;Always allow&rdquo; for an app&apos;s tool is a write to the installation&apos;s{" "}
        <code>alwaysAllow</code>; a require-approval rule in <code>alwaysAsk</code> wins over it.
        A sign-in waits the same way: <code>request_sign_in</code> hands Maya the screen for a
        password, a 2FA code, a CAPTCHA or single sign-on. This example has no browser, so the bot says it couldn&apos;t sign in; mount a
        Kuiper browser and hand it over with <code>browser.handOff</code>, as{" "}
        <Link href="/foundry/docs/rebuilds/meta-muse#step-5">Meta Muse</Link> does, for the real
        thing.
        A message from Maya while a bot works can redirect it with{" "}
        <Link href="/foundry/docs/approvals#steering">steering</Link>.
      </p>
      <CodeBlock
        filename="your app"
        language="typescript"
        code={`const [pending] = await foundry.approvals({ status: "pending" });
// { toolName: "glove_app_gmail__gmail_send", agentId: "maya-bot-1",
//   input: { routeId: "maya-gmail-out", payload: { to: "dana@example.com", subject: "Quick intro", … } }, … }
await foundry.resolveApproval(pending.id, "approve");`}
      />

      <h2 id="step-9">9. New mail reaches the bots whose routine asks</h2>
      <p>
        The <code>gmail-watch</code> connection runs once per connected account, and only while a
        bot has Gmail installed and its playbook wants mail. It calls <code>users.watch</code>{" "}
        daily (Google requires it at least every 7 days), pulls the Pub/Sub subscription, reads{" "}
        <code>history.list</code> with Maya&apos;s token, and passes each message in, claimed once by
        its Gmail id. Each bot with a routine on new mail has a playbook built from it, and the
        mail lands in that bot&apos;s chat:
      </p>
      <CodeBlock
        filename="agents/bot/playbook.ts"
        language="typescript"
        code={`export function newMailFor(accountId: string, routines: ReadonlyArray<EventRoutine>) {
  const routes = gmailRoutes(accountId);
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [routes.in] },
    directives: routines.map((routine) => ({     // one per routine on new mail
      action: readMail,
      instruction: \`\${routine.instruction} To answer, reply from your owner's address …\`,
    })),
    applications: [gmailApp],
    outbound: [{ route: routes.out, application: gmailApp, instruction: "Reply in the same Gmail thread." }],
  });
}`}
      />

      <h2 id="step-10">10. Copies and templates</h2>
      <p>
        Both are data, in <code>lib/templates.ts</code>. <code>duplicateBot</code> makes a new bot
        for the same person, named &ldquo;&lt;name&gt; (copy)&rdquo;, with the original&apos;s job, working style, routines and app
        installations. Its schedules come along as <code>context.schedules</code>, which the
        definition&apos;s <code>schedules</code> turns into Foundry schedules on the copy&apos;s
        first run. Its memory and chats stay with the original, and skills are already the
        person&apos;s.
      </p>
      <p>
        <code>templateOf</code> makes a template: the bot&apos;s instructions, the memories its
        owner picks, skills, routines and first-party apps with their approval rules. It carries
        no chats, accounts, keys, custom MCP servers or scripts. <code>fromTemplate</code> makes a
        bot from one with the new person&apos;s own accounts, and <code>MARKETPLACE</code> lists
        two ready-made ones, Inbox Manager and Sales Outbound.
      </p>

      <h2 id="run">11. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-bot-crew verify

1. Inbox Manager (maya-inbox), starred, has gmail (maya-gmail) and a routine on new mail; the Gmail watch is connected
2. "New bot" became "Sales Outbound": Renamed to Sales Outbound. I'll start on tonight's batch.
3. Bug Triage asked for Linear; once Maya signed in, all 4 of her bots have it
4. Bug Triage, after asking Engineer: Fixed: Patched on branch fix/empty-export: …
5. after approval: Sent the intro to dana@example.com.
6. a sign-in waits for Maya: You approved the Salesforce sign-in, but I have no browser here to sign in with, so I left Salesforce alone.
7. skill monday-signups saved for the team; Sales Outbound runs it every Monday at 09:00; Bug Triage has a routine on new mail
8. Offsite crew: Sales Outbound and Bug Triage answered; Inbox Manager wasn't mentioned and stayed quiet
9. new mail woke Inbox Manager and Bug Triage. Bug Triage: not a bug. Inbox Manager: Replied to Lena Park about pricing.
10. an ask that named no bot went to Inbox Manager, the starred bot: Inbox is clear. Sales Outbound says: 14 new leads this week, …
11. /monday-signups, saved by Sales Outbound, in Inbox Manager's chat: Running monday-signups from the steps you saved.
12. Sales Outbound duplicated with its job, style, apps and Monday routine, and none of its memory or chats; its template carries no accounts`}
      />
      <p>
        With no API key every bot runs a short script instead of a model, chosen from its data,
        and Maya&apos;s accounts are samples on local MCP servers, so this checks the wiring, not
        the judgment. Add <code>ANTHROPIC_API_KEY</code> and run <code>pnpm dev</code> to try it
        with real models, and <code>pnpm connect &lt;person&gt; gmail</code> to connect a real
        account.
      </p>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`kuiper login
kuiper projects create crew && kuiper use crew
kuiper units create crew

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- LINEAR_CLIENT_SECRET=- FOUNDRY_TOKEN=-
kuiper env set -u crew CREW_DATA_DIR=/data \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}' \\
  'ANTHROPIC_API_KEY=\${{models.API_KEY}}' \\
  'ANTHROPIC_BASE_URL=\${{models.ANTHROPIC_BASE_URL}}' \\
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=\${{secrets.GOOGLE_CLIENT_SECRET}}' \\
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \\
  'GOOGLE_SERVICE_ACCOUNT_JSON=\${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \\
  LINEAR_CLIENT_ID=… 'LINEAR_CLIENT_SECRET=\${{secrets.LINEAR_CLIENT_SECRET}}'

kuiper deploy --source . -u crew --wait
kuiper dashboard -u crew --enable                 # inspector login`}
      />
      <ul>
        <li><strong>Models</strong> go through Kuiper&apos;s model gateway. The provider key stays with the organisation, and each call is counted with tokens and cost.</li>
        <li><strong>State</strong> (bots, threads, accounts and tokens, routes and bindings, transcripts, memory, skills, the computers, schedules) sits on the <code>/data</code> disk and survives redeploys. A new bot or a new connection is a write there, not a redeploy.</li>
        <li><strong>New mail needs nothing public.</strong> The Gmail watch pulls its subscription from inside the unit.</li>
        <li><strong>The API and inspector</strong> are locked by the <code>requestAuthorization</code> adapter in <code>foundry.application.ts</code>, made from <code>FOUNDRY_TOKEN</code>. Set it before the first deploy: Foundry won&apos;t listen on a public address without it.</li>
        <li><strong>A real computer.</strong> Mount a <Link href="/foundry/docs/kuiper#execution">Kuiper sandbox and browser</Link> per person with <code>glove-execution/kuiper</code> in place of <code>agents/bot/computer.ts</code>, so sign-ins carry over between bots.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Grok Bot has plugins invoked with @, native Google Docs, Sheets and Slides, API-key connectors, custom MCP servers, Stripe Link, X (posting is approval-gated) and Plaid (read-only). Here there are two apps, Gmail and Linear; any app with a hosted MCP server is another file like <code>linear.app.ts</code>, and an aggregator&apos;s MCP server can stand in for many at once.</li>
        <li>SpaceXAI picks Grok Bot&apos;s model, with automatic failover. Here the operator sets one model (<code>BOT_MODEL</code>), with no failover.</li>
        <li>Teach a task (a bot watching you work in the browser for up to 10 minutes, then drafting a skill) isn&apos;t built here. In Foundry it would start from a Kuiper browser you drive through <code>browser.handOff</code>, with the session recording on; drafting a skill from that recording is the missing part. Here a skill comes from a workflow you describe, through <code>save_skill</code>.</li>
        <li>There are no Team Bots: one shared bot an owner publishes, a private chat per teammate that the owner can&apos;t read, team-wide plus per-person memory, and a custom Slack app.</li>
        <li>Approvals are per tool, with &ldquo;Always allow&rdquo; and &ldquo;Always ask&rdquo; kept per installation. In Grok Bot, sensitive actions can also pass through Auto Review first; the <Link href="/foundry/docs/rebuilds/openai-dots">Dots rebuild</Link> shows an auto-review with its rules kept as data.</li>
        <li>The 50-routine cap is checked in <code>add_routine</code> and, through <code>configure</code>, in Foundry&apos;s <code>glove_foundry_schedule</code>. Both count the bot&apos;s event routines, the schedules it carried as data and its own recurring schedules; a one-off reminder isn&apos;t a routine.</li>
        <li>As in Grok Bot, isolation is per person, so bots are not a boundary from each other: they share one computer and every app their person connects. Deleting a bot leaves its files.</li>
        <li>The computer is a Glove working environment (files and scripts) until you swap in a Kuiper sandbox and browser.</li>
      </ul>

      <h2 id="left-out">Deliberately left out</h2>
      <p>
        Grok Bot can route bot traffic through your desktop to get past datacenter-IP blocks.
        This build leaves that out on purpose: it exposes your local network to every bot, and
        it exists to get around sites&apos; blocks.
      </p>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://cursor.com/docs/grok-bot">Grok Bot</a>, <a href="https://cursor.com/docs/grok-bot/get-started">Get started</a>, <a href="https://cursor.com/docs/grok-bot/work">Work with Grok Bot</a>, <a href="https://cursor.com/docs/grok-bot/teams">Teams</a> and <a href="https://cursor.com/docs/grok-bot/security">Security</a>, Cursor docs</li>
        <li><a href="https://docs.x.ai/grok-bot/skills-routines-and-automations">Skills and routines</a> and <a href="https://docs.x.ai/grok-bot/faq">FAQ</a>, xAI docs</li>
        <li><a href="https://x.ai/news/introducing-grok-bot">Introducing Grok Bot</a> and <a href="https://x.ai/bot/guides/grok-bot-101">Grok Bot 101</a>, xAI</li>
        <li><a href="https://developers.google.com/workspace/gmail/api/guides/push">Push notifications</a>, <a href="https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list">history.list</a> and <a href="https://developers.google.com/workspace/gmail/api/reference/mcp">the Gmail MCP server</a>, Google</li>
        <li><a href="https://linear.app/docs/mcp">Linear MCP server</a>, Linear</li>
      </ul>
    </article>
  );
}
