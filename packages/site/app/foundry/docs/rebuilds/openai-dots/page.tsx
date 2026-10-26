import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { StandingAgentStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild OpenAI Dots",
  description:
    "Build always-on agents like OpenAI's dots with Glove Foundry and deploy them on Kuiper: a dot you name holding your ongoing responsibilities, read-only proactive research, follow-ups that act, Custom Rules (act without asking, act when asked, ask first, hand off) checked by an auto-review, a monitor that pauses the dot, its own computer, the same dot in the app, Slack and on a call, and specialist dots as instances with their own identity.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-standing-agents";

export default function OpenAIDotsRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / OpenAI Dots</span>
      <h1>Rebuild OpenAI Dots</h1>
      <p className="blog-lede">
        OpenAI&apos;s dots are always-on ChatGPT agents that get to know what matters to you and
        keep working on it. OpenAI launched them at DevDay on 29 September 2026, running on GPT-6
        Astra. For now each person gets one dot, which they name and which gets a handle like
        @pip-dot; more dots and teams of dots are planned. A dot has its own cloud computer,
        researches in the background with tools that can only read, and checks sensitive actions
        against your rules before they run. You reach it in ChatGPT, in Slack, in Teams or on a
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
        <li><strong>A dot you name.</strong> You start with one primary dot, give it a name and make it your own. Its memory is the current chat, your ChatGPT memory and its own notes, shared across channels, and it works on several projects without separate threads.</li>
        <li><strong>A coordinator.</strong> It splits work across background agents, hands coding to Codex and long deliverables to ChatGPT Work, checks the results and reports back.</li>
        <li><strong>Proactive research.</strong> When you aren&apos;t working with it, it looks for ways to help using your connected apps, with tools restricted to read-only: they can&apos;t send messages, change app content, or control the browser or computer.</li>
        <li><strong>Triggers.</strong> Follow-ups it schedules for itself, fixed schedules with a time zone and notification rules, and event triggers where the connected app supports them.</li>
        <li><strong>Its own computer.</strong> A cloud computer and browser of its own, which you can open to inspect its work. Saved passwords are used without exposing them to the model.</li>
        <li><strong>Custom Rules and auto-review.</strong> You set, per action, which it acts on without asking, which it acts on only when you ask, which it asks about first, and which it hands off to you. Auto-review checks sensitive actions, such as sending email, before they run, and you can&apos;t switch it off. Password changes and money transfers are always handed to you; permanent deletion, software installs and saved-card purchases always need your approval. Safety monitoring can pause or stop a dot, and stopping doesn&apos;t undo actions already taken.</li>
        <li><strong>Where you work.</strong> ChatGPT on desktop, web and mobile, Slack (DMs and channel mentions) and Teams, and voice calls. Activity View shows its progress, files and pending requests, and lets you redirect or pause it.</li>
        <li><strong>Specialist dots.</strong> In an enterprise preview, IT provisions dots with their own identity, credentials and system access for one role, such as invoicing or support.</li>
      </ul>

      <h2 id="flow">How a dot works</h2>
      <StandingAgentStory />

      <h2 id="map">Each feature, as a Foundry primitive</h2>
      <table>
        <thead><tr><th>Dots</th><th>Foundry</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>A dot you name</td><td>An instance of one <code>dot</code> definition; its name, responsibilities, rules and routing are its data</td><td><code>lib/dot.ts</code></td></tr>
          <tr><td>Ongoing responsibilities</td><td>A list on the instance; research reads every one&apos;s sources</td><td><code>lib/dot.ts</code></td></tr>
          <tr><td>Proactive research, read-only</td><td>A <code>research</code> schedule every 2 hours. On read-only runs (research, new mail, work the dot started that isn&apos;t a follow-up, and every run of a paused dot), the <code>tools</code> resolver returns only read tools, the Gmail app mounts only its reads, and the mesh, the computer and the tools that start runs aren&apos;t mounted</td><td><code>agents/dot/</code></td></tr>
          <tr><td>Triggers</td><td><code>glove_foundry_schedule</code> with <code>every</code>, <code>at</code>, or <code>cron</code> and a time zone. On a run that may act, what the dot schedules or spawns is stamped <code>followUp: true</code> and acts under your rules. New mail is an event trigger that here only reads</td><td><code>agents/dot/research.ts</code></td></tr>
          <tr><td>Works in your apps</td><td>A Gmail app installed with the mailbox the dot works from: Google&apos;s MCP server for reads (in code), the Gmail transmission for sending, a connection for new mail</td><td><code>agents/dot/apps/gmail.app.ts</code></td></tr>
          <tr><td>Memory: the chat, ChatGPT memory, its own notes</td><td>The conversation; the person&apos;s account memory (one namespace per workspace) under the dot&apos;s own (one per instance), shared by every channel; and <code>keep_note</code>, one file per dot</td><td><code>lib/memory.ts</code>, <code>lib/sources.ts</code></td></tr>
          <tr><td>Custom Rules and auto-review</td><td>A wrapper around every acting tool and around Gmail&apos;s send: a hand-off, <code>requiresPermission</code>, or a plain run. &ldquo;Act when asked&rdquo; asks unless the person started the run</td><td><code>lib/auto-review.ts</code>, <code>agents/dot/tools.ts</code></td></tr>
          <tr><td>Built-in safety</td><td>Two lists checked before the rules: <code>change_password</code> and <code>transfer_money</code> are always yours; <code>delete_permanently</code>, <code>install_software</code> and <code>buy_with_saved_card</code> always ask first</td><td><code>lib/auto-review.ts</code></td></tr>
          <tr><td>Safety monitoring</td><td>A run hook that pauses the dot after three hand-offs or denials in a row</td><td><code>lib/monitor.ts</code></td></tr>
          <tr><td>Its own computer</td><td>A working environment saved per dot with <code>foundryDataEnvironmentPersistence</code></td><td><code>agents/dot/workspace.ts</code></td></tr>
          <tr><td>ChatGPT, Slack, a call</td><td>Conversations on one instance, keyed <code>app</code> and <code>slack</code>; Slack through a transmission and a playbook; <code>voiceCall</code> for calls. Teams isn&apos;t built here</td><td><code>agents/dot/</code></td></tr>
          <tr><td>Coordinator (background agents, Codex)</td><td>Runs of the dot started with <code>glove_foundry_spawn</code>, and the person&apos;s <code>Builder</code>, reached over the mesh</td><td><code>agents/dot/research.ts</code>, <code>agents/builder/</code></td></tr>
          <tr><td>Activity View</td><td>The inspector: runs, mesh threads, pending approvals, and <Link href="/foundry/docs/approvals#steering">steering</Link> to redirect a run; <code>paused</code> on the dot to pause it</td><td>built in, <code>lib/dot.ts</code></td></tr>
          <tr><td>Specialist dots (enterprise preview)</td><td>The same definition, an instance in the organisation&apos;s workspace with its own name, Slack account and connected mailbox</td><td><code>specialistFor</code> in <code>lib/dot.ts</code></td></tr>
        </tbody>
      </table>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Tools that change at runtime", "Subscribers", "Installable capabilities", "MCP servers", "Code as the tool surface", "Permission gates", "Approvals", "Schedules", "Spawn and background", "Memory", "Working environment", "Transmissions", "Applications and connections", "Playbooks", "Foundry mesh", "Voice calls", "Request authorization", "Model gateway", "Persistent disk"]}
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
  // Gmail's send under auto-review, and follow-ups; gone on read-only runs.
  configure: (agent, ctx) => configureDot(agent, ctx),

  // Its own computer, but not on read-only runs.
  workingEnvironment: async (_agent, ctx) => (readOnly(ctx.request, await currentDot(ctx)) ? undefined : dotComputer),

  // Coding jobs start on the person's builder over the mesh. Research runs get
  // no mesh tools; a paused dot loses them in configureDot.
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

  // The monitor pauses the dot after hand-offs and denials in a row.
  run: (agent, ctx) => (isCall(ctx) ? call(agent, ctx) : monitored(agent, ctx, reviewedTools(), () => ctx.defaultRun())),
});`}
      />

      <h2 id="step-2">2. Research that only reads, follow-ups that act</h2>
      <p>
        The research schedule wakes the dot every two hours to read the sources of every
        responsibility. What makes the run safe is not an instruction in the prompt but what is
        mounted: tools, the Gmail app&apos;s tools, the mesh and the computer all resolve per run,
        and a read-only run gets only reads. Nothing that acts is there. New mail is a read-only
        run, because mail comes from anyone, and so is every run of a paused dot.
      </p>
      <CodeBlock
        filename="agents/dot/research.ts (excerpt)"
        language="typescript"
        code={`/** Runs the person started: from the app, or by messaging the dot in Slack (only its owner gets in). New mail does not count. */
export function startedByPerson(request: FoundryRequest): boolean {
  if (request.source?.kind === "direct") return true;
  return request.source?.kind === "transmission" && request.source.provider === slackMessages.id;
}

/** A run the dot started on a run that could act. Transmissions never count, whatever their payload says. */
export function followUp(request: FoundryRequest): boolean {
  const kind = request.source?.kind;
  return (kind === "activation" || kind === "spawn" || kind === "background")
    && (request.payload as { followUp?: unknown } | null | undefined)?.followUp === true;
}

/** Runs that only read: research, wake-ups, new mail, and every run of a paused dot. */
export function readOnly(request: FoundryRequest, dot?: { readonly paused?: unknown }): boolean {
  if (dot?.paused === true) return true;
  return !(startedByPerson(request) || followUp(request) || request.source?.kind === "mesh");
}`}
      />
      <CodeBlock
        filename="agents/dot/tools.ts (excerpt)"
        language="typescript"
        code={`export async function dotTools(ctx: Context): Promise<GloveFoldArgs<any>[]> {
  const read = researchTools(ctx.agentId);           // read_channel, read_notes, keep_note, suggest
  const dot = await currentDot(ctx);
  if (readOnly(ctx.request, dot)) return read;
  const review = reviewOf(dot, [], ctx.request);
  return [...read, ...actionsFor(ctx.agentId).map((action) => reviewed(action, review))];
}

// agents/dot/apps/gmail.app.ts: on read-only runs, only the mailbox's reads mount.
tools: (tool, ctx) => (readOnly(ctx.request) && !tool.readOnly && !reads.includes(tool.name) ? "hide" : policy(tool, ctx)),`}
      />
      <p>
        The dot also follows up. You ask it to check back tomorrow, or set a schedule for every
        Monday at 9:00 in your time zone, and it calls <code>glove_foundry_schedule</code>, which
        takes <code>every</code>, <code>at</code>, or <code>cron</code> with a time zone. To split
        work it starts runs of itself with <code>glove_foundry_spawn</code>. On a run that may act,
        the dot&apos;s <code>configure</code> wraps these tools so what they start carries{" "}
        <code>followUp: true</code>; Foundry passes the payload on, and <code>readOnly</code> lets
        those runs act under your Custom Rules. On a read-only run the tools are gone and schedules
        can only be listed, so research can&apos;t start a run that acts or change one. And no run
        can change what a schedule carries, so nothing can stamp the research schedule to make
        research act:
      </p>
      <CodeBlock
        filename="agents/dot/research.ts (excerpt)"
        language="typescript"
        code={`export function followUps(agent: IGloveRunnable, agentId: string, acts: boolean): void {
  if (!acts) {
    for (const name of STARTS_RUNS) aroundTool(agent, name, () => undefined);
    // …and glove_foundry_schedules becomes a tool that only lists.
    return;
  }
  for (const name of STARTS_RUNS) {
    aroundTool(agent, name, ({ run, ...tool }) => ({
      ...tool,
      do: (input: Record<string, unknown>, _display, _glove, signal) => run({
        ...input,
        ...(name === "glove_foundry_spawn" && !input.agentId && !input.definitionId ? { agentId } : {}),
        payload: { followUp: true, ...(input.payload !== undefined ? { payload: input.payload } : {}) },
      }, signal),
    }));
  }
  // An update never changes what a schedule carries, so no run can stamp the
  // research schedule and make research act.
  aroundTool(agent, "glove_foundry_schedules", ({ run, ...tool }) => ({
    ...tool,
    do: (input: Record<string, unknown>, _display, _glove, signal) => {
      const { payload: _payload, ...kept } = input;
      return run(kept, signal);
    },
  }));
}`}
      />
      <p>
        The check is on every source, not only on <code>&quot;activation&quot;</code>: a spawned
        run&apos;s source is <code>&quot;spawn&quot;</code>, and a transmission can&apos;t claim to
        be a follow-up. New mail is the event trigger here, and it only reads.
      </p>

      <h2 id="step-3">3. Custom Rules and auto-review</h2>
      <p>
        Every acting tool passes through one wrapper before it is mounted, so the dot never sees
        an unreviewed version. Built-in safety comes first, then your Custom Rule for that action,
        then who started the run, then a check of the input against your instructions:
      </p>
      <CodeBlock
        filename="lib/auto-review.ts (excerpt)"
        language="typescript"
        code={`/** Always handed to the person. */
export const ALWAYS_YOURS: ReadonlySet<string> = new Set(["change_password", "transfer_money"]);
/** Never below "ask first". */
export const ALWAYS_ASKS: ReadonlySet<string> = new Set(["delete_permanently", "install_software", "buy_with_saved_card"]);

export function levelFor(name: string, rules: Readonly<Record<string, Level>>): Level {
  if (ALWAYS_YOURS.has(name)) return "block";
  const level = rules[name] ?? "ask";
  return ALWAYS_ASKS.has(name) && (level === "allow" || level === "when_asked") ? "ask" : level;
}

export function reviewed<I>(action: Action<I>, review: Review): GloveFoldArgs<I> {
  const { recipient, handOff, rule = action.name, ...tool } = action;
  const level = levelFor(rule, review.rules);
  const described = { ...tool, description: \`\${tool.description} Rule: \${ruleLabel(rule, review.rules)}.\` };

  if (level === "block") {
    return {
      ...described,
      do: async (input) => notRun(rule, \`It stays with \${review.owner}. \${handOff(input)} \${review.tellPerson}\`),
    };
  }
  const asks = level === "ask" || (level === "when_asked" && !review.askedByPerson);
  // The instruction check: writing to someone the person never heard from always asks.
  const unknownRecipient = (input: I) =>
    recipient !== undefined && !review.contacts.includes(recipient(input).trim().toLowerCase());
  return {
    ...described,
    requiresPermission: asks ? true : unknownRecipient,
  };
}`}
      />
      <table>
        <thead><tr><th>Rule</th><th>What happens</th></tr></thead>
        <tbody>
          <tr><td><code>allow</code> (act without asking)</td><td>Runs on its own, unless it would write to an address that never wrote in; then it asks.</td></tr>
          <tr><td><code>when_asked</code> (act when asked)</td><td>Runs on its own on a run the person started, from the app or Slack. On a follow-up, research or the builder&apos;s reply, it asks. The recipient check still applies.</td></tr>
          <tr><td><code>ask</code> (ask first)</td><td><code>requiresPermission: true</code>. Foundry records the exact input and holds the run for an <Link href="/foundry/docs/approvals">approval</Link>.</td></tr>
          <tr><td><code>block</code> (hand off to you)</td><td>Never runs. The dot is told what to hand the person, and where to tell them.</td></tr>
          <tr><td>Built-in safety</td><td><code>ALWAYS_YOURS</code> is handed off and <code>ALWAYS_ASKS</code> never goes below ask first, whatever the rule says. Of these, only <code>change_password</code> is an action here; the sets apply to any action registered under those names.</td></tr>
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
        code={`export async function reviewSends(agent: IGloveRunnable, ctx: Context, dot: ParsedDot): Promise<void> {
  if (readOnly(ctx.request, dot)) return aroundTool(agent, sendTool(), () => undefined);   // read-only runs can't send
  const review = reviewOf(dot, await knownContacts(agent), ctx.request);   // who wrote in, via gmail.search_threads
  aroundTool(agent, sendTool(), (send) => reviewed<Send>({
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

      <p>
        A monitor watches how reviewed actions end. It wraps every run in the definition&apos;s{" "}
        <code>run</code> hook, with a subscriber on the dot&apos;s tool results: an action that
        ran resets the count, and a hand-off or a denied approval adds one. After three in a row it sets <code>paused</code> on the dot. Every run of
        a paused dot only reads, its prompt says so, and the person resumes it with{" "}
        <code>configureAgent</code>. As with dots, pausing doesn&apos;t undo actions already taken.
      </p>
      <CodeBlock
        filename="lib/monitor.ts (excerpt)"
        language="typescript"
        code={`  for (const outcome of ended) streak = outcome === "ran" ? 0 : streak + 1;
  if (streak >= PAUSE_AFTER) {
    const instance = await storedInstance(ctx);
    await Effect.runPromise(ctx.data.putAgent({
      ...instance,
      context: { ...instance.context, paused: true },
      updatedAt: new Date().toISOString(),
    }));
    streak = 0;
  }`}
      />

      <h2 id="step-4">4. Its own computer</h2>
      <p>
        The dot works on a computer of its own: a working environment with files, scripts and
        the public web, saved per dot by Foundry&apos;s data adapter. Read-only runs don&apos;t
        get it. Like a dot, it coordinates: it splits work across runs of its own with{" "}
        <code>glove_foundry_spawn</code>, which act under the same rules, hands coding jobs to the
        person&apos;s builder over the mesh, the way a dot hands them to Codex, and checks the
        builder&apos;s reply, which comes back to the conversation that asked, before it reports.
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
        Teams isn&apos;t built here; it would be a second transmission and forwarder like
        Slack&apos;s. A call is{" "}
        <Link href="/foundry/docs/voice"><code>voiceCall</code></Link> over the same assembled dot.
      </p>
      <p>
        The transcripts stay separate, and memory is shared. As with dots, it has three parts: the
        current conversation, the person&apos;s account memory, and the dot&apos;s own. The account
        memory is one namespace per workspace, which the dot reads but can&apos;t change; its own
        memory is one namespace per instance, layered on top, so what Sam says in the app is known
        in Slack. Its notes file (<code>keep_note</code>) sits beside them.
      </p>
      <CodeBlock
        filename="lib/memory.ts (excerpt)"
        language="typescript"
        code={`export function instanceMemory(description: string) {
  return defineMemory({
    description,
    context: {
      adapter: ({ workspaceId, agentId }) =>
        Effect.sync(() => layerContext([
          { name: "account", adapter: accountMemory(workspaceId), access: "read" },
          { name: "dot", adapter: pinned(\`\${workspaceId}/\${agentId}\`), access: "write" },
        ])),
    },
  });
}`}
      />
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
        Routing, this example&apos;s choice, decides where updates go. With decisions routed to
        Slack, a hand-off reaches the person as a Slack DM, while routine progress stays in the
        app. Slack&apos;s Events API needs its <code>url_verification</code> challenge answered and
        every request&apos;s signature checked, which <code>scripts/slack-events.ts</code> does
        before forwarding. The forwarder passes only DMs and mentions, so, as with dots, adding the
        bot to a channel doesn&apos;t make it watch the channel. Reading a channel is a read-only
        tool, <code>read_channel</code>, through Slack read access.
      </p>

      <h2 id="step-6">6. Specialist dots</h2>
      <p>
        In the product, specialist dots are an enterprise preview: IT provisions them with their
        own identity, credentials and system access. Here a specialist dot is not a new
        definition. It is the same <code>dot</code>, created in the organisation&apos;s workspace
        for one well-defined responsibility, with its own name, its own Slack account and its own
        connected mailbox, so it acts under its own credentials rather than a person&apos;s:
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
   23 tools mounted, none that act (no send_email, open_draft_pr, merge_pr, change_password, Gmail send, post_to_slack), no mesh, no computer, no schedule or spawn
   runs from schedules, spawn and background are read-only unless they are follow-ups; new mail always is
3. "ask": the Gmail send waited for approval; approved: "Sent the reply to dana@acme.test."
4. "block": merge_pr handed to Sam in Slack: "Over to you: Review PR #42 and merge it yourself."
   change_password with a rule of "allow" is still Sam's (built-in safety): …
5. "allow": open_draft_pr ran with no approval: "Opened draft PR #101: Stream large CSV exports."
   send_email on "allow" still asks before writing to an address that never wrote in
6. Slack DM from Sam joined "transmission:agent:sam-dot:slack"; answered there: "From the app: Billing questions go to Priya."
   a stranger's mention started nothing
7. new mail started a read-only run: "New mail from ken@umbrella.test about the CSV export; noted with the other reports."
8. on Pip's own computer: /workspace/feedback-this-week.md
9. started on Builder (sam-builder) over the mesh; back in the app: "The builder finished. Wrote /out/weekly-feedback.md: …"
10. a follow-up Sam set, every Monday at 9:00 in his time zone: "Set: every Monday at 9:00 New York time, I'll open a draft PR for the week's export fixes."
    open_draft_pr on "when_asked": no approval when Sam asks; on the follow-up's run it asked first, and Sam denied it
11. a denial and two hand-offs in a row paused Pip; asked for a draft PR, the tool wasn't there
    Sam resumes it with configureAgent; the draft PRs already opened stay open`}
      />
      <p>
        In step 2 the scripted model deliberately tries Gmail&apos;s send during research. The
        run&apos;s trace shows the tool does not exist there, and the list of available tools holds
        nothing that acts and nothing that starts a run. <code>glove_foundry_transmit</code> stays
        mounted, but it only uses routes the dot&apos;s playbooks declare, and they declare none.
        Step 10 starts the follow-up&apos;s run the way its schedule would, with the
        schedule&apos;s payload.
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
        <li>Dots run their own auto-review, which you can&apos;t switch off; here it is code over rules and recipients. You could put a <Link href="/docs/classifier">classifier</Link> or a second model call inside <code>reviewed()</code>.</li>
        <li>The computer is a Glove working environment until you swap in a Kuiper sandbox and browser, and you can&apos;t connect your own laptop.</li>
        <li>Here the dot&apos;s notes are a file you can read and edit, and its memory changes entry by entry. A dot&apos;s notes can&apos;t be viewed or edited one by one, and deleting the dot is the only reset.</li>
        <li>The monitor here counts hand-offs and denials in a row and only pauses; you stop a single run from the inspector.</li>
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
