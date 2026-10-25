import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { CrewStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Grok Bot",
  description:
    "Build AI teammates like xAI's Grok Bot with Glove Foundry and deploy them on Kuiper: one bot definition and every bot as data, a main bot, bots that name themselves from their job, apps connected once per account, group chats and handoffs over the mesh, one shared computer, skills and routines, sign-ins handed back, and @bot on X.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-bot-crew";

export default function GrokBotRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / Grok Bot</span>
      <h1>Rebuild Grok Bot</h1>
      <p className="blog-lede">
        Grok Bot gives you bots you keep around: AI teammates with names, jobs and context that
        builds up over time. They work on a cloud computer they share, pass work to each other,
        and come back when something needs your approval. This page builds the same shape in
        Foundry and deploys it on Kuiper. The part to copy is the design: there is one bot
        definition, and every bot is data.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from the Grok Bot docs on cursor.com and docs.x.ai
          (sources at the end). It is not affiliated with or endorsed by xAI or Cursor, and it is
          not how Grok Bot is built. The code is in <a href={EXAMPLE}>examples/foundry-bot-crew</a>,
          and <code>pnpm verify</code> runs all of it offline.
        </p>
      </div>

      <h2 id="what">What Grok Bot does</h2>
      <ul>
        <li><strong>Bots with a name and a job.</strong> Your first bot is made for you. A new one asks what you want it around for, or you give it a name, a title and a description. Each keeps its memory, files and preferences across sessions.</li>
        <li><strong>A main bot.</strong> One bot is your primary: it takes everyday requests that belong to no specialist and routes the rest. Tagging @bot on X hands the post to your main bot.</li>
        <li><strong>One computer for all your bots.</strong> A persistent cloud computer with a browser, filesystem and terminal. Your bots share its files, browser sessions and logins, each on its own screen. Between people, computers are strictly isolated.</li>
        <li><strong>Apps belong to your account.</strong> A bot asks for access when it needs an app, and once you connect it, every bot can use it.</li>
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
          <tr><td>Connected apps</td><td>The same installations on every bot of the account</td><td>A bot asking with <code>connect_app</code>, approved by you</td></tr>
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
        uses={["Definitions", "Instances", "Conversations", "Foundry mesh", "Shared work", "Working environment", "Memory", "Content skills", "Schedule management", "Transmissions", "Applications and connections", "Playbooks", "Approvals", "Request authorization", "Model gateway", "Persistent disk"]}
        write={["What a bot can be: its prompt, tools and apps", "Where a person's bots are created", "The X webhook forwarder", "The scripted models for offline runs"]}
      />

      <h2 id="step-1">1. What a bot can be</h2>
      <p>
        The definition lists everything a bot could have: every app, memory, the shared
        computer, the mesh, the X playbook. Which of it a given bot gets is decided from its
        data on each run. The file only assembles; the prompt and tools live beside it.
      </p>
      <CodeBlock
        filename="agents/bot/agent.ts"
        language="typescript"
        code={`export default defineAgent({
  description: "A bot: an AI teammate with its own job and memory, working on a computer it shares with its owner's other bots",
  components: composeAgent(gmail, sheets, tickets, xApp, memory),

  model: botModel,                                   // from the bot's data
  systemPrompt: (_agent, ctx) => botPrompt(ctx),     // from the bot's data
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [memory],

  tools: (_agent, ctx) => botTools(ctx),             // take_job, connect_app, save_skill, request_sign_in, skills
  workingEnvironment: computer,                      // one per workspace
  mesh: { waitMs: 60_000 },                          // bots message each other by id

  // Only the main bot takes tasks from X, and only its owner's posts.
  playbooks: (_agent, { agentInstance, installations }) =>
    agentInstance.context.primary === true
    && typeof agentInstance.context.xUserId === "string"
    && installations.some((item) => item.kind === "application" && item.id === xApp.id)
      ? [mentionsFrom(agentInstance.context.xUserId)]
      : [],

  accountSessions: {
    identifier: "x-bot-token",
    withSession: (_request, use) => use({ token: process.env.X_BOT_TOKEN || OFFLINE_X_TOKEN }),
  },
});`}
      />
      <p>
        The prompt reads the instance. The main bot is told to take everyday requests and route
        the rest, a bot with no job is told to ask for one, and any other bot is told its own job:
      </p>
      <CodeBlock
        filename="agents/bot/prompt.ts (excerpt)"
        language="typescript"
        code={`if (bot.context.primary === true) {
  lines.push(\`You are \${bot.name ?? "the main bot"}, \${owner}'s main bot. You take everyday requests that belong to no other bot.\`,
    "When another bot's job fits better, find it with glove_mesh_list_agents and hand the work over with glove_mesh_send_message.");
} else if (!bot.description) {
  lines.push(\`You are a new bot on \${owner}'s team and you have no job yet.\`,
    \`Greet \${owner} and ask what they want you around for. When they tell you, call take_job …\`);
} else {
  lines.push(\`You are \${bot.name}, one of \${owner}'s bots. Your job: \${bot.description}\`);
}`}
      />

      <h2 id="step-2">2. A person&apos;s bots are records</h2>
      <p>
        A person&apos;s workspace is their team. Their bots are plain data in{" "}
        <code>lib/people.ts</code>. The example seeds Maya&apos;s main bot and its thread with{" "}
        <code>defineAgentInstance</code>; your app creates everyone else&apos;s when they sign up:
      </p>
      <CodeBlock
        filename="lib/people.ts (excerpt)"
        language="typescript"
        code={`export function mainBotFor(person: Person, bot: { name: string; apps: AppName[] }) {
  return {
    id: \`\${person.id}-main\`,
    workspaceId: person.id,
    name: bot.name,
    description: \`\${person.name}'s main bot. Takes everyday requests and hands work to the bot whose job fits.\`,
    context: { owner: person.name, primary: true, ...(person.xUserId ? { xUserId: person.xUserId } : {}) },
    installations: [
      ...bot.apps.map((app) => install(APPS[app])),
      ...(person.xUserId ? [install(xApp, undefined, { account: xBot })] : []),
    ],
  };
}

export function botFor(person: Person, bot: { id: string; name?: string; job?: string; apps: AppName[] }) {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name },
    installations: bot.apps.map((app) => install(APPS[app])),   // the account's apps
  };
}`}
      />
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`const mayaMain = defineAgentInstance(bot, mainBotFor(MAYA, { name: "Chief", apps: ["gmail", "sheets"] }));

export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [mayaMain],                     // written only when the id is missing
  conversations: [createConversation(mayaMain, { id: "maya-main-thread", title: "Main", context: { conversationKey: "main" } })],
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

      <h2 id="step-4">4. Apps belong to the account</h2>
      <p>
        A new bot gets the apps its owner already connected. When a bot needs one that
        isn&apos;t connected, it asks. Approving is Maya finishing the provider&apos;s login, and
        the app is then installed on every one of her bots:
      </p>
      <CodeBlock
        filename="agents/bot/tools.ts (excerpt)"
        language="typescript"
        code={`{
  name: "connect_app",
  description: "Ask your owner to connect an app you need. Apps belong to their account, so once connected every one of their bots can use it.",
  inputSchema: z.object({ app: z.enum(APP_NAMES), why: z.string().min(1) }),
  requiresPermission: true,                  // the approval is the owner finishing the provider's login
  async do({ app }) {
    const installation = install(APPS[app]);
    const team = (await Effect.runPromise(ctx.data.listAgents())).filter((bot) => bot.workspaceId === ctx.workspaceId);
    for (const bot of team) {
      if (bot.installations.some((item) => item.id === installation.id)) continue;
      await Effect.runPromise(ctx.data.putAgent({ ...bot, installations: [...bot.installations, installation], updatedAt: new Date().toISOString() }));
    }
    return { status: "success", data: { connected: app, bots: team.length } };
  },
}`}
      />
      <p>
        App credentials stay out of the bot. Foundry asks an{" "}
        <Link href="/foundry/docs/applications">account session</Link> for each operation, the way
        Grok Bot fills a saved login by reference.
      </p>

      <h2 id="step-5">5. Bots pass work over the mesh</h2>
      <p>
        <code>mesh</code> gives every bot the <Link href="/foundry/docs/multi-agent#mesh">Glove
        Mesh tools</Link>, hosted by Foundry. Its peers are the other bots in its workspace, so
        a bot only ever sees its owner&apos;s team. The main bot lists them, picks the one whose
        job fits, and sends it the task by id. Bug Triage passes the fix to Engineer the same way.
        Each final answer comes back to the conversation that sent the work, as a new turn. A
        handoff names the output (a path under <code>/workspace</code>), what is done, the
        evidence, open questions and the next owner.
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

      <h2 id="step-6">6. One computer, one skill library</h2>
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

      <h2 id="step-7">7. Approvals and sign-ins</h2>
      <p>
        Drafting is free; sending waits. <code>send_email</code> in the Gmail app has{" "}
        <code>requiresPermission</code>, so Foundry records the exact email, holds the run, and
        resumes it when Maya answers in the inspector, through the API or in your app. A sign-in
        uses the same mechanism: <code>request_sign_in</code> asks for approval, and approving
        it is Maya doing that one step on the shared computer. The bot never sees the password.
        A message from Maya while a bot works can redirect it with{" "}
        <Link href="/foundry/docs/approvals#steering">steering</Link>.
      </p>
      <CodeBlock
        filename="your app"
        language="typescript"
        code={`const [pending] = await foundry.approvals({ status: "pending" });
// { toolName: "send_email", agentId: "maya-bot-1", input: { draftId: "draft_1a2b3c4d" }, … }
await foundry.resolveApproval(pending.id, "approve");`}
      />

      <h2 id="step-8">8. Tag it on X</h2>
      <p>
        X sends mentions to a webhook. A transmission turns X&apos;s body into a typed mention.
        Only a main bot with Maya&apos;s X user id in its data gets the playbook, and its
        predicate matches only her posts, so one bot account serves everyone and a
        stranger&apos;s mention starts nothing:
      </p>
      <CodeBlock
        filename="agents/bot/playbook.ts"
        language="typescript"
        code={`export function mentionsFrom(authorId: string) {
  return composePlaybook({
    name: "x-mentions",
    transmission: xMentions,
    match: { event: mention, routes: [xMentionsIn], predicate: { definition: fromOwner, parameters: { authorId } } },
    directives: [{
      action: takeTask,
      instruction: "First reply on X with reply_on_x: one short sentence saying you are on it. Then do the work in this thread: hand it to the right bot.",
    }],
    applications: [xApp],
  });
}`}
      />
      <p>
        <code>reply_on_x</code> asks the account session for the operation; the token never
        enters the bot&apos;s process. The forwarder (<code>scripts/x-webhook.ts</code>) answers
        X&apos;s CRC check, rejects deliveries without a valid signature and fires the route with{" "}
        <code>conversationKey: &quot;main&quot;</code>, so the mention joins the main bot&apos;s thread.
      </p>

      <h2 id="run">9. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-bot-crew verify

1. Chief (maya-main) is Maya's main bot, with gmail and sheets connected
2. "New bot" became "Sales Outbound": Renamed to Sales Outbound. I'll start on tonight's batch.
3. Bug Triage asked for the ticket tracker; after Maya connected it, all 4 of her bots have it
4. in the main thread: Bug Triage: Fixed: Patched on branch fix/empty-export: …
5. after approval: Sent the intro to dana@example.com.
6. after Maya signed in: Signed in to Salesforce. 12 open deals pulled.
7. skill monday-signups saved for the team; routine every Monday at 09:00
8. Offsite crew: both bots answered in the group chat
9. on X, as the bot: "On it. Bug Triage has this; results will be in your main thread."; a stranger's tag started nothing`}
      />
      <p>
        With no API key every bot runs a short script instead of a model, chosen from its data,
        so this checks the wiring, not the judgment. Add <code>ANTHROPIC_API_KEY</code> and run{" "}
        <code>pnpm dev</code> to try it with real models in the inspector.
      </p>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`kuiper login
kuiper projects create crew && kuiper use crew
kuiper units create crew

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set X_BOT_TOKEN=-
kuiper env set -u crew CREW_DATA_DIR=/data \\
  'ANTHROPIC_API_KEY=\${{models.API_KEY}}' \\
  'ANTHROPIC_BASE_URL=\${{models.ANTHROPIC_BASE_URL}}' \\
  'X_BOT_TOKEN=\${{secrets.X_BOT_TOKEN}}'

kuiper deploy --source . -u crew --wait
kuiper dashboard -u crew --enable                 # inspector login`}
      />
      <ul>
        <li><strong>Models</strong> go through Kuiper&apos;s model gateway. The provider key stays with the organisation, and each call is counted with tokens and cost.</li>
        <li><strong>State</strong> (bots, threads, transcripts, memory, skills, the computers, schedules) sits on the <code>/data</code> disk and survives redeploys. A new bot is a new row there, not a redeploy.</li>
        <li><strong>The API and inspector</strong> are locked by the <code>requestAuthorization</code> adapter in <code>foundry.application.ts</code>.</li>
        <li><strong>The X forwarder</strong> runs as a second unit from the same source, with <code>--start-command &quot;pnpm x-webhook&quot;</code>. It is the only public way in for X, and it reaches Foundry at <code>{"${{crew.INTERNAL_URL}}"}</code>. The example&apos;s README has the commands.</li>
        <li><strong>A real computer.</strong> Swap <code>agents/bot/computer.ts</code> for a <Link href="/foundry/docs/kuiper#services">Kuiper sandbox and browser</Link> per person, so sign-ins carry over between bots.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Skills are taught by describing a workflow, not by recording the screen with Teach a task.</li>
        <li>There are no Team Bots: one bot shared with a team, a private chat per teammate, running on each teammate&apos;s computer.</li>
        <li>Approvals are per tool. Grok Bot also runs an auto-review model with &ldquo;Ask first&rdquo; and &ldquo;Allow automatically&rdquo; rules; the <Link href="/foundry/docs/rebuilds/openai-dots">Dots rebuild</Link> shows rules kept as data.</li>
        <li>Routines run on schedules. Grok Bot can also start one from an event, which here would be a transmission and a playbook.</li>
        <li>The computer is a Glove working environment (files and scripts) until you swap in a Kuiper sandbox and browser.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://cursor.com/docs/grok-bot">Grok Bot</a>, <a href="https://cursor.com/docs/grok-bot/get-started">Get started</a>, <a href="https://cursor.com/docs/grok-bot/work">Work with Grok Bot</a>, <a href="https://cursor.com/docs/grok-bot/teams">Teams</a> and <a href="https://cursor.com/docs/grok-bot/security">Security</a>, Cursor docs</li>
        <li><a href="https://docs.x.ai/grok-bot/skills-routines-and-automations">Skills and routines</a> and <a href="https://docs.x.ai/grok-bot/tag-on-x">Tag @bot on X</a>, xAI docs</li>
        <li><a href="https://x.ai/bot/guides/grok-bot-101">Grok Bot 101</a>, xAI</li>
        <li><a href="https://flaviocopes.com/grok-bot/">A deep dive into Grok Bot</a>, Flavio Copes</li>
      </ul>
    </article>
  );
}
