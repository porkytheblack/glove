import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { ConnectedAppStory, CrewStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Grok Bot",
  description:
    "Build AI teammates like xAI's Grok Bot with Glove Foundry and deploy them on Kuiper: one bot definition and every bot as data, a main bot, bots that name themselves from their job, apps connected once per person (Gmail, Linear, any MCP server) with reads in code, sends delivered by Foundry and new mail pushed in, group chats and handoffs over the mesh, one shared computer, skills and routines, and approvals.",
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
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from the Grok Bot docs on cursor.com and docs.x.ai
          (sources at the end). It is not affiliated with or endorsed by xAI or Cursor, and it is
          not how Grok Bot is built. The code is in <a href={EXAMPLE}>examples/foundry-bot-crew</a>,
          and <code>pnpm verify</code> runs all of it offline, against local servers that use
          Google&apos;s and Linear&apos;s MCP tool names.
        </p>
      </div>

      <h2 id="what">What Grok Bot does</h2>
      <ul>
        <li><strong>Bots with a name and a job.</strong> Your first bot is made for you. A new one asks what you want it around for, or you give it a name, a title and a description. Each keeps its memory, files and preferences across sessions.</li>
        <li><strong>A main bot.</strong> One bot is your primary: it takes everyday requests that belong to no specialist and routes the rest.</li>
        <li><strong>Apps belong to your account.</strong> Your bots work in the apps you connect: Gmail, your calendar, your tracker. A bot asks for access when it needs an app, and once you connect it, every bot can use it.</li>
        <li><strong>One computer for all your bots.</strong> A persistent cloud computer with a browser, filesystem and terminal. Your bots share its files, browser sessions and logins, each on its own screen. Between people, computers are strictly isolated.</li>
        <li><strong>Sign-ins stay with you.</strong> Saved logins are filled without the model seeing them. For single sign-on, passkeys or a CAPTCHA, the bot hands you the computer for that one step.</li>
        <li><strong>Bots work together.</strong> They message each other and pass ownership of a task. A group chat holds two to six bots: they decide who answers, an @-mention hands a bot a request, and @everyone reaches all of them.</li>
        <li><strong>Skills and routines.</strong> A skill is reusable instructions shared by all your bots. You save one from chat or by showing the bot once (&ldquo;Teach a task&rdquo;). A routine runs a skill on a schedule or after an event.</li>
        <li><strong>Approvals.</strong> Sending, buying, deleting and publishing wait for you: allow once, always allow, or deny. An auto-review model checks risky actions against your &ldquo;Ask first&rdquo; and &ldquo;Allow automatically&rdquo; rules. A message from you takes priority and can redirect work in progress.</li>
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
          <tr><td>A bot&apos;s name and job</td><td>The instance&apos;s <code>name</code> and <code>description</code></td><td>The bot itself with <code>take_job</code>, or your app with <code>configureAgent</code></td></tr>
          <tr><td>Your main bot</td><td>A bot whose <code>context.primary</code> is <code>true</code></td><td>Onboarding</td></tr>
          <tr><td>Your bots</td><td>The instances in your workspace</td><td>Making or deleting a bot</td></tr>
          <tr><td>Connected apps</td><td>An account in your store, and on every bot of the person an installation with that account (plus Gmail&apos;s routes and a send binding)</td><td>Your Connect button: the provider&apos;s sign-in, then <code>connectApp</code></td></tr>
          <tr><td>&ldquo;Always allow&rdquo;</td><td>The installation&apos;s <code>config.alwaysAllow</code></td><td>Your app, when the person ticks it</td></tr>
          <tr><td>A group chat and who is in it</td><td>A conversation on the bot that hosts it, with <code>context.group.members</code></td><td>Your app</td></tr>
          <tr><td>Skills</td><td>Workspace entries, <code>skill:&lt;name&gt;</code></td><td>A bot with <code>save_skill</code>, after you review it</td></tr>
          <tr><td>Routines</td><td>Schedules on the bot that owns them</td><td>A bot with <code>glove_foundry_schedule</code></td></tr>
          <tr><td>The shared computer</td><td>One working environment per workspace</td><td>The bots, as they work</td></tr>
        </tbody>
      </table>
      <p>
        None of these needs a deploy. See <Link href="/foundry/docs/agents-are-data">Agents are
        data</Link> for the general rule.
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

  tools: (_agent, ctx) => botTools(ctx),             // take_job, connect_app, save_skill, request_sign_in, skills
  workingEnvironment: computer,                      // one per workspace
  repl: () => defineRepl({                           // the apps' reads, as functions
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools.filter((tool) => tool.readOnly)), keepDirect: false },
  }),
  mesh: { waitMs: 60_000 },                          // bots message each other by id

  // New mail goes to the main bot, once Gmail is connected.
  playbooks: (_agent, { agentInstance, installations }) => {
    const mail = installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
    return agentInstance.context.primary === true && mail?.accountId ? [newMailFor(mail.accountId)] : [];
  },

  accountSessions,                                   // the credential boundary (lib/accounts.ts)
});`}
      />
      <p>
        The prompt reads the instance. The main bot is told to take everyday requests and route
        the rest, a bot with no job is told to ask for one, and any other bot is told its own job,
        its owner&apos;s apps and how to send email from their address.
      </p>

      <h2 id="step-2">2. A person&apos;s bots are records</h2>
      <p>
        A person&apos;s workspace is their team. Their bots are plain data in{" "}
        <code>lib/people.ts</code>. The example seeds Maya, her sample Gmail account, her main bot
        and its thread; your app creates everyone else&apos;s when they sign up:
      </p>
      <CodeBlock
        filename="foundry.application.ts (excerpt)"
        language="typescript"
        code={`const mayaGmail = accountFor(MAYA, "gmail", sampleConnection(MAYA, "gmail").identity, true);
if (!(await readAccount(mayaGmail.id))) await saveAccount(mayaGmail, sampleConnection(MAYA, "gmail").tokens);

const mayaMain = defineAgentInstance(bot, mainBotFor(MAYA, { name: "Chief", installations: [installationFor(mayaGmail)] }));

export default defineApplication({
  name: "Bot crew",
  data,                                      // seeds written only when the id is missing
  services,                                  // your accounts, plus routes and bindings in a file
  routes: [gmailRoutes(mayaGmail.id).in, gmailRoutes(mayaGmail.id).out],
  bindings: [sendBinding(mayaMain.id, mayaGmail.id)],
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
  description: "Take on the job your owner described: give yourself a short name and one sentence saying what you do.",
  inputSchema: z.object({ name: z.string().min(1).max(40), description: z.string().min(1).max(300) }),
  async do(job) {
    const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
    await Effect.runPromise(ctx.data.putAgent({ ...current!, ...job, updatedAt: new Date().toISOString() }));
    return { status: "success", data: { renamed: job.name } };
  },
}`}
      />
      <p>
        The bot&apos;s next run reads the new name and job, and the next time the main bot lists
        the team it sees &ldquo;Sales Outbound&rdquo;. Your app can rename a bot the same way with{" "}
        <code>configureAgent</code>.
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
  config: z.object({ alwaysAllow: z.array(z.string()).default([]) }),
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
        <li><strong>Reads come from the provider&apos;s MCP server</strong>, opened with the installation&apos;s account. The tool policy runs reads and drafts, and asks before anything else unless the person chose &ldquo;Always allow&rdquo; for it.</li>
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
        tokens as they expire. That is the way Grok Bot fills a saved login by reference.
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
        a bot only ever sees its owner&apos;s team. The main bot lists them, picks the one whose
        job fits, and sends it the task by id. Bug Triage files the bug in Linear and passes the
        fix to Engineer the same way. Each final answer comes back to the conversation that sent
        the work, as a new turn.
      </p>
      <CodeBlock
        filename="what the main bot receives"
        language="text"
        code={`<mesh-message id="msg_…" thread="thread_…" from="maya-bot-2" name="Bug Triage" status="replied">
Fixed: Patched on branch fix/empty-export: export returns an empty file for an empty report. Added a test.
</mesh-message>`}
      />
      <p>
        A group chat is a conversation on the bot that hosts it, whose data lists its members.
        An @-mention sends that bot its part, @everyone is <code>glove_mesh_broadcast</code>, and
        with no mention the host asks the members whose job it is. A member with nothing to add
        replies with nothing, and an empty reply posts nothing, which keeps the chat from
        looping.
      </p>

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
        sandbox and browser</Link> per person: one live machine. Skills live in the workspace
        too, as <code>skill:&lt;name&gt;</code> entries. <code>save_skill</code> has{" "}
        <code>requiresPermission</code>, so Maya reads the draft before any bot can use it, and
        a routine is a schedule the bot sets with <code>glove_foundry_schedule</code>.
      </p>

      <h2 id="step-8">8. Approvals and sign-ins</h2>
      <p>
        Drafting is free; sending waits. The Gmail send tool comes from the transmission&apos;s{" "}
        <code>requiresPermission</code>, so Foundry records the exact email, holds the run, and
        resumes it when Maya answers in the inspector, through the API or in your app.
        &ldquo;Always allow&rdquo; for an app&apos;s tool is a write to the installation&apos;s{" "}
        <code>alwaysAllow</code>. A sign-in uses the same mechanism: <code>request_sign_in</code>{" "}
        asks for approval, and approving it is Maya doing that one step on the shared computer.
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

      <h2 id="step-9">9. New mail reaches the main bot</h2>
      <p>
        The <code>gmail-watch</code> connection runs once per connected account, and only while a
        bot has Gmail installed and its playbook wants mail. It calls <code>users.watch</code>{" "}
        daily (Google requires it at least every 7 days), pulls the Pub/Sub subscription, reads{" "}
        <code>history.list</code> with Maya&apos;s token, and passes each message in, claimed once by
        its Gmail id. The playbook puts it in the main bot&apos;s thread:
      </p>
      <CodeBlock
        filename="agents/bot/playbook.ts"
        language="typescript"
        code={`export function newMailFor(accountId: string) {
  const routes = gmailRoutes(accountId);
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [routes.in] },
    directives: [{ action: readMail, instruction: "New mail. If it needs an answer, reply from your owner's address with the Gmail send tool …" }],
    applications: [gmailApp],
    outbound: [{ route: routes.out, application: gmailApp, instruction: "Reply in the same Gmail thread." }],
  });
}`}
      />

      <h2 id="run">10. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-bot-crew verify

1. Chief (maya-main) is Maya's main bot, with gmail (maya-gmail); the Gmail watch is connected
2. "New bot" became "Sales Outbound": Renamed to Sales Outbound. I'll start on tonight's batch.
3. Bug Triage asked for Linear; once Maya signed in, all 4 of her bots have it
4. in the main thread: Bug Triage: Fixed: Patched on branch fix/empty-export: …
5. after approval: Sent the intro to dana@example.com.
6. after Maya signed in: Signed in to Salesforce. 12 open deals pulled.
7. skill monday-signups saved for the team; routine every Monday at 09:00
8. Offsite crew: both bots answered in the group chat
9. new mail: Replied to Lena Park about pricing.`}
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
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- LINEAR_CLIENT_SECRET=-
kuiper env set -u crew CREW_DATA_DIR=/data \\
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
        <li><strong>The API and inspector</strong> are locked by the <code>requestAuthorization</code> adapter in <code>foundry.application.ts</code>.</li>
        <li><strong>A real computer.</strong> Swap <code>agents/bot/computer.ts</code> for a <Link href="/foundry/docs/kuiper#services">Kuiper sandbox and browser</Link> per person, so sign-ins carry over between bots.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Grok Bot connects thousands of apps. Here there are two; any app with a hosted MCP server is another file like <code>linear.app.ts</code>, and an aggregator&apos;s MCP server can stand in for many at once.</li>
        <li>Skills are taught by describing a workflow, not by recording the screen with Teach a task.</li>
        <li>There are no Team Bots: one bot shared with a team, a private chat per teammate, running on each teammate&apos;s computer.</li>
        <li>Approvals are per tool, with &ldquo;Always allow&rdquo; kept per installation. Grok Bot also runs an auto-review model with &ldquo;Ask first&rdquo; and &ldquo;Allow automatically&rdquo; rules; the <Link href="/foundry/docs/rebuilds/openai-dots">Dots rebuild</Link> shows rules kept as data.</li>
        <li>The computer is a Glove working environment (files and scripts) until you swap in a Kuiper sandbox and browser.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://cursor.com/docs/grok-bot">Grok Bot</a>, <a href="https://cursor.com/docs/grok-bot/get-started">Get started</a>, <a href="https://cursor.com/docs/grok-bot/work">Work with Grok Bot</a>, <a href="https://cursor.com/docs/grok-bot/teams">Teams</a> and <a href="https://cursor.com/docs/grok-bot/security">Security</a>, Cursor docs</li>
        <li><a href="https://docs.x.ai/grok-bot/skills-routines-and-automations">Skills and routines</a>, xAI docs</li>
        <li><a href="https://x.ai/bot/guides/grok-bot-101">Grok Bot 101</a>, xAI</li>
        <li><a href="https://developers.google.com/workspace/gmail/api/guides/push">Push notifications</a>, <a href="https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list">history.list</a> and <a href="https://developers.google.com/workspace/gmail/api/reference/mcp">the Gmail MCP server</a>, Google</li>
        <li><a href="https://linear.app/docs/mcp">Linear MCP server</a>, Linear</li>
      </ul>
    </article>
  );
}
