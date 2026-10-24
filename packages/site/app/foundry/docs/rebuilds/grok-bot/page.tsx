import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { CrewStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Grok Bot",
  description:
    "Build AI teammates like xAI's Grok Bot with Glove Foundry and deploy them on Kuiper: one bot definition and every bot as data, bots that name themselves from their job, a Chief, group chats, bots passing work over the mesh, one shared computer, skills and routines, sign-ins handed back, and @-mentions on X.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-bot-crew";

export default function GrokBotRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / Grok Bot</span>
      <h1>Rebuild Grok Bot</h1>
      <p className="blog-lede">
        xAI&apos;s Grok Bot lets a person make AI teammates and give each one a job. A Chief runs
        the others, bots pass work to each other and share group chats, they share one cloud
        computer, and they come back when something needs approval. This page builds the same
        shape in Foundry and deploys it on Kuiper. The part to copy is the design: there is one
        bot definition, and every bot is data.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from xAI&apos;s public pages and launch coverage (sources
          at the end). It is not affiliated with or endorsed by xAI, and it is not how Grok Bot is
          built. The code is in <a href={EXAMPLE}>examples/foundry-bot-crew</a>, and{" "}
          <code>pnpm verify</code> runs all of it offline.
        </p>
      </div>

      <h2 id="what">What Grok Bot does</h2>
      <ul>
        <li>You make bots yourself. A new one asks &ldquo;What do you want me around for?&rdquo;, and once you tell it, it takes a name for the job, such as Sales Outbound or Inbox Manager.</li>
        <li>A Chief manages the other bots. You can also put bots in group chats, where they pass work and ownership between them.</li>
        <li>All your bots share one cloud computer, with a browser, files and your logins. When a site needs a login, the bot hands the browser back to you; it never holds the password.</li>
        <li>Show a bot a task once and it becomes a skill. Routines run skills on a schedule.</li>
        <li>Each bot has its own memory, and approval settings decide what needs your yes. You can also tag the bot on X.</li>
      </ul>

      <h2 id="flow">How work moves</h2>
      <CrewStory />

      <h2 id="data">One definition, every bot in data</h2>
      <p>
        The tempting build is a folder per bot: <code>agents/sales-outbound/</code>,{" "}
        <code>agents/inbox-manager/</code>. Then a person can&apos;t make a bot, because each new
        one is a code change, and renaming one is a deploy. It is like Twitter keeping a page in
        its codebase for every user. Instead, <code>agents/bot/agent.ts</code> says what any bot{" "}
        <em>can</em> be, and each bot is an instance of it:
      </p>
      <table>
        <thead><tr><th>Grok Bot</th><th>In this build</th><th>Changed by</th></tr></thead>
        <tbody>
          <tr><td>A bot&apos;s name and job</td><td>The instance&apos;s <code>name</code> and <code>description</code></td><td>The bot itself, with <code>take_job</code>, or your app with <code>configureAgent</code></td></tr>
          <tr><td>The apps a bot can use</td><td>Installations on the instance</td><td>Your app: <code>install</code> / <code>uninstall</code></td></tr>
          <tr><td>The Chief</td><td>A bot whose <code>context.role</code> is <code>&quot;chief&quot;</code></td><td>Onboarding</td></tr>
          <tr><td>Your team</td><td>The instances in your workspace</td><td>Making or deleting a bot</td></tr>
          <tr><td>A group chat and who is in it</td><td>A conversation on the Chief, with <code>context.group.members</code></td><td>Your app</td></tr>
          <tr><td>Skills</td><td>Workspace entries, <code>skill:&lt;name&gt;</code></td><td>A bot, with <code>save_skill</code>, after you review it</td></tr>
          <tr><td>Routines</td><td>Schedules on the bot</td><td>A bot, with <code>glove_foundry_schedule</code></td></tr>
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
        data on each run. The file only assembles; the prompt, tools and apps live beside it.
      </p>
      <CodeBlock
        filename="agents/bot/agent.ts"
        language="typescript"
        code={`export default defineAgent({
  description: "A bot: an AI teammate with its own job, apps, memory and a computer it shares with its owner's other bots",
  components: composeAgent(gmail, sheets, tickets, xApp, memory),

  model: botModel,                                   // from the bot's data
  systemPrompt: (_agent, ctx) => botPrompt(ctx),     // from the bot's data
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [memory],

  tools: (_agent, ctx) => botTools(ctx),             // take_job, save_skill, request_sign_in
  workingEnvironment: computer,                      // one per workspace
  configure: async (agent, ctx) => {
    const skills = await loadSkills(data, ctx.workspaceId);
    if (skills.length > 0) useReadSkill(agent, skills);
  },

  mesh: { waitMs: 60_000 },                          // bots message each other by id

  // Only a Chief takes tasks from X, and only its owner's posts.
  playbooks: (_agent, { agentInstance, installations }) =>
    agentInstance.context.role === "chief"
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
        The prompt reads the instance. A Chief is told to run the others, a bot with no job is
        told to ask for one, and any other bot is told its own job:
      </p>
      <CodeBlock
        filename="agents/bot/prompt.ts (excerpt)"
        language="typescript"
        code={`if (bot.context.role === "chief") {
  lines.push(\`You are \${bot.name ?? "Chief"}, \${owner}'s chief of staff. You run their bots.\`,
    "See who is on the team with glove_mesh_list_agents, and hand work to the bot whose job fits with glove_mesh_send_message.");
} else if (!bot.description) {
  lines.push(\`You are a new bot on \${owner}'s team and you have no job yet.\`,
    \`Greet \${owner} and ask what they want you around for. When they tell you, call take_job …\`);
} else {
  lines.push(\`You are \${bot.name}, one of \${owner}'s bots. Your job: \${bot.description}\`);
}`}
      />

      <h2 id="step-2">2. A person&apos;s bots are rows</h2>
      <p>
        A person&apos;s workspace is their team. Their Chief, every bot they make and every group
        chat are created by your application, as data:
      </p>
      <CodeBlock
        filename="lib/people.ts"
        language="typescript"
        code={`export function chiefFor(person: Person) {
  return {
    id: \`\${person.id}-chief\`,
    workspaceId: person.id,
    name: "Chief",
    description: \`\${person.name}'s chief of staff. Hands work to the right bot and keeps \${person.name} posted.\`,
    context: { owner: person.name, role: "chief", ...(person.xUserId ? { xUserId: person.xUserId } : {}) },
    installations: person.xUserId ? [install(xApp, undefined, { account: xBot })] : [],
  };
}

export function botFor(person: Person, bot: { id: string; name?: string; job?: string; apps?: AppName[] }) {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name },
    installations: (bot.apps ?? []).map((app) => install(APPS[app])),
  };
}

export function groupChat(person: Person, chat: { id: string; name: string; members: string[] }) {
  return { id: chat.id, workspaceId: person.id, title: chat.name, context: { group: { name: chat.name, members: chat.members } } };
}`}
      />
      <CodeBlock
        filename="when Maya makes a bot"
        language="typescript"
        code={`await foundry.createAgent("bot", botFor(maya, { id: "maya-bot-1", apps: ["gmail", "sheets"] }));`}
      />

      <h2 id="step-3">3. A bot names itself</h2>
      <p>
        The new bot asks what it is for. When Maya answers, it calls <code>take_job</code>, a
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
        The next run of that bot reads the new name and job, and the next time the Chief lists
        the team it sees &ldquo;Sales Outbound&rdquo;.
      </p>

      <h2 id="step-4">4. Bots pass work over the mesh</h2>
      <p>
        <code>mesh</code> gives every bot the <Link href="/foundry/docs/multi-agent#mesh">Glove
        Mesh tools</Link>, hosted by Foundry. Its peers are the other bots in its workspace, so
        a bot only ever sees its owner&apos;s team. The Chief lists them, picks the one whose job
        fits, and sends it the task by id. Bug Triage passes the fix to Engineer the same way.
        Each final answer comes back to the conversation that sent the work, as a new turn.
      </p>
      <CodeBlock
        filename="what the Chief receives"
        language="text"
        code={`<mesh-message id="msg_…" thread="thread_…" from="maya-bot-2" name="Bug Triage" status="replied">
Fixed: Patched on branch fix/empty-export: export returns an empty file for an empty report. Added a test.
</mesh-message>`}
      />
      <p>
        A group chat is a conversation on the Chief whose data lists its members. The prompt
        tells the Chief who is in it; when a message @-mentions a bot, the Chief sends it that
        part and posts each answer in the chat.
      </p>

      <h2 id="step-5">5. One computer and one skill library</h2>
      <p>
        The computer is a working environment saved per workspace, so files one bot writes,
        another can read. Skills live in the workspace too:
      </p>
      <CodeBlock
        filename="agents/bot/skills.ts (excerpt)"
        language="typescript"
        code={`export async function saveSkill(data: FoundryDataAdapter, workspaceId: string, skill: SavedSkill) {
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId, key: \`skill:\${skill.name}\`, value: skill, updatedAt: new Date().toISOString(),
  }));
}`}
      />
      <p>
        <code>save_skill</code> has <code>requiresPermission</code>, so Maya reads the draft
        before any bot can use it. Every bot&apos;s <code>configure</code> loads the library with{" "}
        <code>useReadSkill</code>, and a routine is a schedule the bot sets with{" "}
        <code>glove_foundry_schedule</code>.
      </p>

      <h2 id="step-6">6. Approvals and sign-ins</h2>
      <p>
        Drafting is free; sending waits. <code>send_email</code> in the Gmail app has{" "}
        <code>requiresPermission</code>, so Foundry records the exact email, holds the run, and
        resumes it when Maya answers in the inspector, through the API or in your app. A sign-in
        uses the same mechanism: <code>request_sign_in</code> asks for approval, and approving
        it is Maya signing in on the shared browser. The bot never sees the password.
      </p>
      <CodeBlock
        filename="your app"
        language="typescript"
        code={`const [pending] = await foundry.approvals({ status: "pending" });
// { toolName: "send_email", agentId: "maya-bot-1", input: { draftId: "draft_1a2b3c4d" }, … }
await foundry.resolveApproval(pending.id, "approve");`}
      />

      <h2 id="step-7">7. Tag it on X</h2>
      <p>
        X sends mentions to a webhook. A transmission turns X&apos;s body into a typed mention.
        Only a Chief with Maya&apos;s X user id in its data gets the playbook, and its predicate
        matches only her posts, so one bot account serves everyone and a stranger&apos;s mention
        starts nothing:
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
        <code>conversationKey: &quot;main&quot;</code>, so the mention joins Maya&apos;s main thread.
      </p>

      <h2 id="run">8. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-bot-crew verify

1. Chief (maya-chief) is on Maya's team
2. "New bot" became "Sales Outbound": Renamed to Sales Outbound. I'll start on tonight's batch.
3. in the Chief's thread: Bug Triage: Fixed: Patched on branch fix/empty-export: …
4. after approval: Sent the intro to dana@example.com.
5. after Maya signed in: Signed in to Salesforce. 12 open deals pulled.
6. skill monday-signups saved for the team; routine every Monday at 09:00
7. Offsite crew: both bots answered in the group chat
8. on X, as the bot: "On it. Bug Triage has this; …"; a stranger's tag started nothing`}
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
        <li><strong>A real computer.</strong> Swap <code>agents/bot/computer.ts</code> for a <Link href="/foundry/docs/kuiper#services">Kuiper sandbox and browser</Link> per person, so a sign-in carries over between bots.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Skills are taught by describing them, not by recording your screen.</li>
        <li>The shared computer is a Glove working environment (files and scripts) until you swap in a Kuiper sandbox and browser.</li>
        <li>A bot reaches services through apps and account sessions you write.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://x.ai/bot">Grok Bot</a>, xAI</li>
        <li><a href="https://docs.x.ai/grok-bot/tag-on-x">Work with Grok Bot: tag @bot on X</a>, xAI docs</li>
        <li><a href="https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/">xAI launches Grok Bot: always-on AI teammates with their own cloud computers</a>, Unite.AI</li>
      </ul>
    </article>
  );
}
