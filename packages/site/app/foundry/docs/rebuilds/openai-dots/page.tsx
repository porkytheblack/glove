import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { StandingAgentStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild OpenAI Dots",
  description:
    "Build always-on agents like OpenAI's dots with Glove Foundry and deploy them on Kuiper: a dot you name holding your ongoing responsibilities, read-only proactive research, an auto-review with Custom Rules (allow, ask, block) before every action, its own computer, the same dot in the app, Slack and on a call, and specialist dots as instances with their own identity.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-standing-agents";

export default function OpenAIDotsRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / OpenAI Dots</span>
      <h1>Rebuild OpenAI Dots</h1>
      <p className="blog-lede">
        OpenAI&apos;s dots are always-on agents that get to know what matters to you and keep
        working on it. You name your dot and make it your own. It has its own cloud computer,
        researches in the background with tools that can only read, and checks every action
        against your rules before it runs. You reach the same dot in ChatGPT, in Slack or on a
        call. This page builds the same shape in Foundry and deploys it on Kuiper.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from OpenAI&apos;s announcement, its help center and early
          hands-on reviews (sources at the end). It is not affiliated with or endorsed by OpenAI,
          and it is not how dots are built. The code is in{" "}
          <a href={EXAMPLE}>examples/foundry-standing-agents</a>, and <code>pnpm verify</code>{" "}
          runs all of it offline.
        </p>
      </div>

      <h2 id="what">What dots do</h2>
      <ul>
        <li><strong>A dot you name.</strong> You start with a primary dot, give it a name and make it your own. It learns your preferences and keeps notes on decisions and its ongoing responsibilities, and works on several projects without separate threads.</li>
        <li><strong>Proactive research.</strong> When you aren&apos;t working with it, it looks for ways to help using your connected apps, with tools restricted to read-only: they can&apos;t send messages, change app content, or control the browser or computer.</li>
        <li><strong>Its own computer.</strong> A cloud computer and browser of its own, which you can open to inspect its work. Saved passwords are used without exposing them to the model.</li>
        <li><strong>Custom Rules and auto-review.</strong> You set which actions it takes on its own, which need your approval, and which it must not take. Auto-review checks actions that could affect your accounts or share information against your instructions, your rules and built-in safety: the work proceeds, waits for approval, or is yours to do. Changing a password always stays with you.</li>
        <li><strong>Where you work.</strong> ChatGPT on desktop, web and mobile, Slack and Teams, and voice calls. It carries context across every channel, and messages you with progress, questions and decisions.</li>
        <li><strong>Specialist dots.</strong> An organisation can set up dots with their own identity, credentials and access for one well-defined responsibility, such as invoice processing or support.</li>
      </ul>

      <h2 id="flow">How a dot works</h2>
      <StandingAgentStory />

      <h2 id="map">Each feature, as a Foundry primitive</h2>
      <table>
        <thead><tr><th>Dots</th><th>Foundry</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>A dot you name</td><td>An instance of one <code>dot</code> definition; its name, responsibilities, rules and routing are its data</td><td><code>lib/dot.ts</code></td></tr>
          <tr><td>Ongoing responsibilities</td><td>A list on the instance; research reads every one&apos;s sources</td><td><code>lib/dot.ts</code></td></tr>
          <tr><td>Proactive research, read-only</td><td>A <code>research</code> schedule every 2 hours. On runs the person didn&apos;t start (research, new mail, spawned work), the <code>tools</code> resolver returns only read tools, the Gmail app mounts only its reads, and the mesh and computer aren&apos;t mounted</td><td><code>agents/dot/</code></td></tr>
          <tr><td>Works in your apps</td><td>A Gmail app installed with the mailbox the dot works from: Google&apos;s MCP server for reads (in code), the Gmail transmission for sending, a connection for new mail</td><td><code>agents/dot/apps/gmail.app.ts</code></td></tr>
          <tr><td>Notes to itself</td><td><code>keep_note</code> and <code>read_notes</code>, one file per dot</td><td><code>lib/sources.ts</code></td></tr>
          <tr><td>Custom Rules and auto-review</td><td>A wrapper around every acting tool and around Gmail&apos;s send: a block, <code>requiresPermission</code>, or a plain run</td><td><code>lib/auto-review.ts</code>, <code>agents/dot/tools.ts</code></td></tr>
          <tr><td>Built-in safety</td><td>A list checked before the rules: <code>change_password</code> is always yours</td><td><code>lib/auto-review.ts</code></td></tr>
          <tr><td>Its own computer</td><td>A working environment saved per dot with <code>foundryDataEnvironmentPersistence</code></td><td><code>agents/dot/workspace.ts</code></td></tr>
          <tr><td>ChatGPT, Slack, a call</td><td>Conversations on one instance, keyed <code>app</code> and <code>slack</code>; Slack through a transmission and a playbook; <code>voiceCall</code> for calls</td><td><code>agents/dot/</code></td></tr>
          <tr><td>Context across channels</td><td>One <code>defineMemory</code> namespace per instance</td><td><code>lib/memory.ts</code></td></tr>
          <tr><td>Starts tasks elsewhere (Codex)</td><td>The person&apos;s <code>Builder</code>, reached over the mesh</td><td><code>agents/builder/</code></td></tr>
          <tr><td>Activity View</td><td>The inspector: runs, mesh threads, approvals, and <Link href="/foundry/docs/approvals#steering">steering</Link> to stop or redirect</td><td>built in</td></tr>
          <tr><td>Specialist dots</td><td>The same definition, an instance in the organisation&apos;s workspace with its own name, Slack account and connected mailbox</td><td><code>specialistFor</code> in <code>lib/dot.ts</code></td></tr>
        </tbody>
      </table>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Tools that change at runtime", "Installable capabilities", "MCP servers", "Code as the tool surface", "Permission gates", "Approvals", "Schedules", "Memory", "Working environment", "Transmissions", "Applications and connections", "Playbooks", "Foundry mesh", "Voice calls", "Request authorization", "Model gateway", "Persistent disk"]}
        write={["Each person's dot: its name, responsibilities and rules", "Your account store and OAuth callback", "The acting tools and what each hands off", "The Slack events forwarder"]}
      />

      <h2 id="step-1">1. A dot is an instance you name</h2>
      <p>
        There is one <code>dot</code> definition. Each dot is an instance, and its data is what
        makes it yours: the name you gave it, the responsibilities it keeps (what should stay
        true, which sources to read, what deserves your attention, what it must not do yet), your
        Custom Rules, and where to send updates. The prompt is built from it.
      </p>
      <CodeBlock
        filename="lib/dot.ts (excerpt)"
        language="typescript"
        code={`export const SAM = {
  id: "sam",
  dot: {
    name: "Pip",
    owner: "Sam",
    responsibilities: [
      {
        job: "Track product feedback from #feedback and the support inbox, and group the reports.",
        sources: ["#feedback", "support inbox"],
        attention: "A problem several people report, or anything that blocks a customer.",
        mustNot: "Reply to anyone without Sam's approval.",
      },
      {
        job: "Make sure every customer who wrote to support hears back within a day.",
        sources: ["support inbox"],
        attention: "Anyone who has waited more than a day.",
        mustNot: "Promise a ship date.",
      },
    ],
    rules: { send_email: "ask", open_draft_pr: "allow", merge_pr: "block" },
    routing: { progress: "app", decisions: "slack" },
    slackUserId: "U0SAM",
  },
};`}
      />
      <p>
        The example seeds Sam&apos;s dot and his builder with <code>defineAgentInstance</code>, with
        the support mailbox he connected as a sample account; everyone else&apos;s is created when
        they sign up (<code>scripts/onboard.ts</code>, <code>scripts/connect.ts</code>):
      </p>
      <CodeBlock
        filename="foundry.application.ts (excerpt)"
        language="typescript"
        code={`export const samsDot = defineAgentInstance(dot, primaryDot(SAM.id, SAM.dot, [installationFor(samsGmail)]));
export const samsBuilder = defineAgentInstance(builder, builderFor(SAM.id));

export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [samsDot, samsBuilder],
  conversations: [createConversation(samsDot, { id: \`\${samsDot.id}-app\`, title: "App", context: { conversationKey: "app" } })],
});`}
      />
      <CodeBlock
        filename="agents/dot/agent.ts"
        language="typescript"
        code={`export default defineAgent({
  description: "An always-on agent that works on its person's responsibilities and acts within their rules",
  components: composeAgent(gmailApp, slackApp, person),

  model: (_agent, ctx) => (isCall(ctx) ? callModel() : dotModel(ctx.agentInstance.workspaceId)),
  systemPrompt: async (_agent, ctx) => dotPrompt(await currentDot(ctx), ctx, isCall(ctx)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [person],

  tools: (_agent, ctx) => dotTools(ctx),
  schedules: [research],
  playbooks: (_agent, ctx) => dotPlaybooks(ctx),      // the owner's Slack messages; new mail

  // The mailbox's reads as functions: research reads it in code.
  repl: () => defineRepl({
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools.filter((tool) => tool.readOnly)), keepDirect: false },
  }),
  // Gmail's send, under auto-review; gone on runs the dot starts itself.
  configure: (agent, ctx) => reviewSends(agent, ctx),

  // Its own computer, but not on research runs: those only read.
  workingEnvironment: (_agent, ctx) => (readOnly(ctx.request) ? undefined : dotComputer),

  // Coding jobs start on the person's builder over the mesh. Research runs get none.
  mesh: {
    peers: (_self, peer) => peer.definitionId === "builder",
    mount: (ctx) => !readOnly(ctx.request),
  },

  // The Slack bot user is the app's; every other account is one a person connected.
  accountSessions: {
    identifier: "dot-accounts",
    withSession: (request, use) => request.accountId === slackBot.id
      ? use({ token: process.env.SLACK_BOT_TOKEN || OFFLINE_SLACK_TOKEN })
      : connectedAccounts.withSession(request, use),
  },

  run: (agent, ctx) => (isCall(ctx) ? call(agent, ctx) : ctx.defaultRun()),
});`}
      />

      <h2 id="step-2">2. Proactive research that can only read</h2>
      <p>
        The research schedule wakes the dot every two hours to read the sources of every
        responsibility. What makes the run safe is not an instruction in the prompt but what is
        mounted: tools, the Gmail app&apos;s tools, the mesh and the computer all resolve per run,
        and a run the person did not start gets only reads. Nothing that acts is there. New mail
        counts as such a run, because mail comes from anyone.
      </p>
      <CodeBlock
        filename="agents/dot/research.ts"
        language="typescript"
        code={`/** Runs the person started: from the app, or by messaging the dot in Slack (only its owner gets in). New mail does not count. */
export function startedByPerson(request: FoundryRequest): boolean {
  if (request.source?.kind === "direct") return true;
  return request.source?.kind === "transmission" && request.source.provider === slackMessages.id;
}

/** Runs on the dot's own time. A run the person started, or the builder's reply to one, may act. */
export function readOnly(request: FoundryRequest): boolean {
  return !(startedByPerson(request) || request.source?.kind === "mesh");
}`}
      />
      <CodeBlock
        filename="agents/dot/tools.ts"
        language="typescript"
        code={`export async function dotTools(ctx: AgentAssemblyContext): Promise<GloveFoldArgs<any>[]> {
  const read = researchTools(ctx.agentId);           // read_channel, read_notes, keep_note, suggest
  if (readOnly(ctx.request)) return read;
  const review = reviewOf(await currentDot(ctx), []);
  return [...read, ...actionsFor(ctx.agentId).map((action) => reviewed(action, review))];
}

// agents/dot/apps/gmail.app.ts: on the dot's own time, only the mailbox's reads mount.
tools: (tool, ctx) => (readOnly(ctx.request) && !tool.readOnly && !reads.includes(tool.name) ? "hide" : policy(tool, ctx)),`}
      />
      <p>
        The check is on every source but the person&apos;s own, not only on{" "}
        <code>&quot;activation&quot;</code>. A research run still has Foundry&apos;s{" "}
        <code>glove_foundry_spawn</code>, and a spawned run&apos;s source is{" "}
        <code>&quot;spawn&quot;</code>; checking only for activations would let research start
        a run that can act.
      </p>

      <h2 id="step-3">3. Custom Rules and auto-review</h2>
      <p>
        Every acting tool passes through one wrapper before it is mounted, so the dot never sees
        an unreviewed version. Built-in safety comes first, then your Custom Rule for that action,
        then a check of the input against your instructions:
      </p>
      <CodeBlock
        filename="lib/auto-review.ts"
        language="typescript"
        code={`export const ALWAYS_YOURS: ReadonlySet<string> = new Set(["change_password"]);

export function levelFor(name: string, rules: Readonly<Record<string, Level>>): Level {
  if (ALWAYS_YOURS.has(name)) return "block";
  return rules[name] ?? "ask";
}

export function reviewed<I>(action: Action<I>, review: Review): GloveFoldArgs<I> {
  const { recipient, handOff, ...tool } = action;
  const level = levelFor(action.name, review.rules);
  if (level === "block") {
    return { ...tool, do: async (input) => notRun(action.name, \`It stays with \${review.owner}. \${handOff(input)} \${review.tellPerson}\`) };
  }
  // Writing to someone the person never heard from always asks, even on "allow".
  const unknownRecipient = (input: I) =>
    recipient !== undefined && !review.contacts.includes(recipient(input).trim().toLowerCase());
  return { ...tool, requiresPermission: level === "ask" ? true : unknownRecipient };
}`}
      />
      <table>
        <thead><tr><th>Rule</th><th>What happens</th></tr></thead>
        <tbody>
          <tr><td><code>allow</code></td><td>Runs on its own, unless it would write to an address that never wrote in; then it asks.</td></tr>
          <tr><td><code>ask</code></td><td><code>requiresPermission: true</code>. Foundry records the exact input and holds the run for an <Link href="/foundry/docs/approvals">approval</Link>.</td></tr>
          <tr><td><code>block</code></td><td>Never runs. The dot is told what to hand the person, and where to tell them.</td></tr>
          <tr><td>Built-in safety</td><td>Always the person&apos;s, whatever the rule says.</td></tr>
        </tbody>
      </table>
      <p>
        An action with no rule asks. Each tool&apos;s description includes its rule, so the model
        knows before it tries.
      </p>
      <p>
        Email goes out through the Gmail app&apos;s transmission, so Foundry delivers it from the
        mailbox in its own process. The dot puts the same review around that send in{" "}
        <code>configure</code>, under the rule <code>send_email</code>. The people who wrote in
        are read from the mailbox through the app, so &ldquo;allow&rdquo; still asks before
        writing to anyone else:
      </p>
      <CodeBlock
        filename="agents/dot/tools.ts (excerpt)"
        language="typescript"
        code={`export async function reviewSends(agent: IGloveRunnable, ctx: Pick<AgentAssemblyContext, "agentId" | "agentInstance" | "data" | "request">) {
  const name = installedApplicationTransmissionToolName(gmailApp, gmail);
  if (readOnly(ctx.request)) return aroundTool(agent, name, () => undefined);   // research and new mail can't send
  const review = reviewOf(await currentDot(ctx), await knownContacts(agent));    // who wrote in, via gmail.search_threads
  aroundTool(agent, name, (send) => reviewed({
    name: send.name,
    description: "Send an email from the mailbox you work from: a reply (pass threadId and inReplyTo) or a new message.",
    jsonSchema: send.jsonSchema,
    rule: "send_email",
    recipient: (input) => input.payload.to,
    handOff: (input) => \`Send "\${input.payload.subject}" to \${input.payload.to} yourself.\`,
    do: (input, _display, _glove, signal) => send.run(input, signal),           // Foundry still delivers it
  }, review));
}`}
      />

      <h2 id="step-4">4. Its own computer</h2>
      <p>
        The dot works on a computer of its own: a working environment with files, scripts and
        the public web, saved per dot by Foundry&apos;s data adapter. Research runs don&apos;t get
        it. For bigger coding jobs it starts a task on the person&apos;s builder over the mesh, the
        way a dot starts a task in Codex, and the builder&apos;s reply comes back to the
        conversation that asked.
      </p>
      <CodeBlock
        filename="agents/dot/workspace.ts"
        language="typescript"
        code={`export const dotComputer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
});`}
      />

      <h2 id="step-5">5. The app, Slack and a call, one memory</h2>
      <p>
        Each channel is a conversation on the same instance, created with a{" "}
        <code>conversationKey</code> of <code>app</code> or <code>slack</code>. Slack messages
        arrive through a transmission; a playbook per dot matches only its owner&apos;s Slack user
        id, and the forwarder fires the route with <code>conversationKey: &quot;slack&quot;</code>.
        Teams works the same way, with its own transmission. A call is{" "}
        <Link href="/foundry/docs/voice"><code>voiceCall</code></Link> over the same assembled dot.
        The transcripts stay separate, and memory is one namespace per instance, so what Sam says
        in the app is known in Slack.
      </p>
      <CodeBlock
        filename="agents/dot/playbook.ts"
        language="typescript"
        code={`export function messagesFrom(slackUserId: string) {
  return composePlaybook({
    name: "slack-messages",
    transmission: slackMessages,
    match: { event: message, routes: [slackMessagesIn], predicate: { definition: fromOwner, parameters: { slackUserId } } },
    directives: [{
      action: answer,
      instruction: "Answer with post_to_slack in the same channel. For a mention in a channel, answer in its thread. Use what you know from the app too.",
    }],
    applications: [slackApp],
  });
}`}
      />
      <p>
        Routing decides where updates go. With decisions routed to Slack, a blocked action
        reaches the person as a Slack DM, while routine progress stays in the app. Slack&apos;s
        Events API needs its <code>url_verification</code> challenge answered and every
        request&apos;s signature checked, which <code>scripts/slack-events.ts</code> does before
        forwarding.
      </p>

      <h2 id="step-6">6. Specialist dots</h2>
      <p>
        A specialist dot is not a new definition. It is the same <code>dot</code>, created in the
        organisation&apos;s workspace for one well-defined responsibility, with its own name and
        its own Slack account and its own connected mailbox, so it acts under its own
        credentials rather than a person&apos;s:
      </p>
      <CodeBlock
        filename="lib/dot.ts (excerpt)"
        language="typescript"
        code={`export function specialistFor(org: string, specialist: Omit<Dot, "kind"> & { account?: AccountReference }) {
  const { account, ...dot } = specialist;
  const parsed = Dot.parse({ ...dot, kind: "specialist" });
  return {
    id: \`\${org}-\${parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}\`,
    workspaceId: org,
    name: parsed.name,
    description: \`Specialist dot for \${parsed.owner}: \${parsed.responsibilities.map((item) => item.job).join(" ")}\`,
    context: parsed,
    installations: [install(slackApp, undefined, { account: account ?? slackBot })],
  };
}`}
      />

      <h2 id="run">7. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-standing-agents verify

1. Pip (sam-dot), Sam's builder and the app conversation are seeded data; research runs every 2h there; the mailbox watch is connected
2. research read #feedback and the mailbox in code, kept notes and suggested: "CSV export times out on large reports: …"
   26 tools mounted, none that act (no send_email, open_draft_pr, merge_pr, change_password, Gmail send, post_to_slack), no mesh, no computer
   runs from spawn, background and new mail are read-only too
3. "ask": the Gmail send waited for approval; approved: "Sent the reply to dana@acme.test."
4. "block": merge_pr handed to Sam in Slack: "Over to you: Review PR #42 and merge it yourself."
   change_password with a rule of "allow" is still Sam's (built-in safety): …
5. "allow": open_draft_pr ran with no approval: "Opened draft PR #102: Stream large CSV exports."
   send_email on "allow" still asks before writing to an address that never wrote in
6. Slack DM from Sam joined "transmission:agent:sam-dot:slack"; answered there: "From the app: Billing questions go to Priya."
   a stranger's mention started nothing
7. new mail started a read-only run: "New mail from ken@umbrella.test about the CSV export; noted with the other reports."
8. on Pip's own computer: /workspace/feedback-this-week.md
9. started on Builder (sam-builder) over the mesh; back in the app: "The builder finished. Wrote /out/weekly-feedback.md: …"`}
      />
      <p>
        In step 2 the scripted model deliberately tries Gmail&apos;s send during research. The
        run&apos;s trace shows the tool does not exist there, and the list of available tools holds
        nothing that acts. <code>glove_foundry_transmit</code> stays mounted, but it only uses routes
        the dot&apos;s playbooks declare, and they declare none.
      </p>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`kuiper login
kuiper projects create dots && kuiper use dots
kuiper units create dots

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set SLACK_BOT_TOKEN=- GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- FOUNDRY_TOKEN=-
kuiper env set -u dots DOTS_DATA_DIR=/data \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}' \\
  'ANTHROPIC_API_KEY=\${{models.API_KEY}}' \\
  'ANTHROPIC_BASE_URL=\${{models.ANTHROPIC_BASE_URL}}' \\
  'SLACK_BOT_TOKEN=\${{secrets.SLACK_BOT_TOKEN}}' \\
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=\${{secrets.GOOGLE_CLIENT_SECRET}}' \\
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \\
  'GOOGLE_SERVICE_ACCOUNT_JSON=\${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}'

kuiper deploy --source . -u dots --wait
kuiper dashboard -u dots --enable                 # inspector login`}
      />
      <ul>
        <li><strong>The Slack forwarder</strong> runs as a second unit with <code>--start-command &quot;pnpm slack-events&quot;</code>. Its public URL is Slack&apos;s request URL, and it reaches Foundry at <code>{"${{dots.INTERNAL_URL}}"}</code>. The README has the commands.</li>
        <li><strong>State</strong> (dots, transcripts, memory, notes, accounts and tokens, the computers, schedules) is on the <code>/data</code> disk. New mail needs nothing public: the Gmail watch pulls its subscription from inside the unit.</li>
        <li><strong>The API and inspector</strong> are locked by <code>FOUNDRY_TOKEN</code>, which the Slack forwarder also uses. Set it before the first deploy: Foundry won&apos;t listen on a public address without an authorizer.</li>
        <li><strong>Calls</strong> need a public port for the call room, declared in a committed <code>kuiper.json</code>, and <code>OPENAI_API_KEY</code> as a secret, since the model gateway has no realtime route. The README has the steps.</li>
        <li><strong>A real computer.</strong> Mount a <Link href="/foundry/docs/kuiper#execution">Kuiper sandbox and browser</Link> with <code>glove-execution/kuiper</code> in place of the dot&apos;s and the builder&apos;s working environments.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Auto-review here is code over rules and recipients. Dots use a separate review model; you could put a <Link href="/docs/classifier">classifier</Link> or a second model call inside <code>reviewed()</code>.</li>
        <li>The computer is a Glove working environment until you swap in a Kuiper sandbox and browser, and you can&apos;t connect your own laptop.</li>
        <li>There is no monitor that pauses a dot on its own; you stop or redirect a run from the inspector.</li>
        <li>Dots connect to thousands of apps through plugins. Here there is one, Gmail; any app with a hosted MCP server is another file like it, and the Slack channel history is still a stand-in in <code>lib/sources.ts</code>.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://openai.com/index/introducing-dots/">Introducing dots</a>, OpenAI</li>
        <li><a href="https://help.openai.com/en/articles/20001529">Dots privacy, security and safety FAQs</a>, OpenAI Help Center</li>
        <li><a href="https://developers.google.com/workspace/gmail/api/guides/push">Gmail push notifications</a> and <a href="https://developers.google.com/workspace/gmail/api/reference/mcp">the Gmail MCP server</a>, Google</li>
        <li><a href="https://www.theneuron.ai/explainer-articles/openai-dots-hands-on-review-herman/">OpenAI Dots hands-on review: my first day with Herman</a>, The Neuron</li>
        <li><a href="https://flaviocopes.com/openai-dots/">A deep dive into OpenAI dots</a>, Flavio Copes</li>
      </ul>
    </article>
  );
}
