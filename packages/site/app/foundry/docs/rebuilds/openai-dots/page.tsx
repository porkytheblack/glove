import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { StandingAgentStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild OpenAI Dots",
  description:
    "Build standing agents like OpenAI's Dots with Glove Foundry and deploy them on Kuiper: an instance per responsibility, read-only research on a schedule, an auto-review with custom rules before every action, the same agent in the app and Slack, and a builder reached over the mesh for heavy jobs.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-standing-agents";

export default function OpenAIDotsRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / OpenAI Dots</span>
      <h1>Rebuild OpenAI Dots</h1>
      <p className="blog-lede">
        OpenAI&apos;s Dots are agents you give a standing job rather than a request. A dot keeps
        working on it between conversations, researches with tools that can only read, and checks
        every action against your rules before it runs. You reach the same dot in ChatGPT or in
        Slack. This page builds the same shape in Foundry and deploys it on Kuiper.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from launch coverage and early guides (sources at the end).
          It is not affiliated with or endorsed by OpenAI, and it is not how Dots are built. The
          code is in <a href={EXAMPLE}>examples/foundry-standing-agents</a>, and{" "}
          <code>pnpm verify</code> runs all of it offline.
        </p>
      </div>

      <h2 id="what">What Dots do</h2>
      <ul>
        <li>A dot keeps a responsibility: what should stay true or get done, which sources to read, what deserves your attention, and what it must not do yet.</li>
        <li>When you aren&apos;t working with it, it researches: reads your apps, keeps private notes, and may bring a suggestion or question. Those research tools can&apos;t send, change or control anything.</li>
        <li>Before certain actions run, an auto-review checks them against your instructions, Custom Rules and safety requirements. The action runs, goes to you for approval, or is handed to you.</li>
        <li>Custom Rules have four levels: take action without asking, take action when you say so, ask before taking action, and hand off to you. Some tasks, such as changing a password, always stay with you.</li>
        <li>The same dot works in ChatGPT and in Slack. Each channel keeps its own history, but what it learns in one is used in the other.</li>
        <li>It coordinates more than it works: heavy jobs go to another agent, and it checks the result and reports back.</li>
      </ul>

      <h2 id="flow">How a dot works</h2>
      <StandingAgentStory />

      <h2 id="map">Each feature, as a Foundry primitive</h2>
      <table>
        <thead><tr><th>Dots</th><th>Foundry</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>A dot with a responsibility</td><td>An instance of one <code>dot</code> definition; the responsibility, rules and routing are its context</td><td><code>lib/dot.ts</code></td></tr>
          <tr><td>Works between conversations</td><td>A <code>research</code> schedule every 2 hours</td><td><code>agents/dot/research.ts</code></td></tr>
          <tr><td>Research is read-only</td><td>The <code>tools</code> resolver returns only read tools when the run was not started by the person</td><td><code>agents/dot/tools.ts</code></td></tr>
          <tr><td>Auto-review and Custom Rules</td><td>A wrapper around every acting tool: a hand-off, a refusal, <code>requiresPermission</code>, or a plain run</td><td><code>lib/auto-review.ts</code></td></tr>
          <tr><td>Safety rules beat your rules</td><td>A built-in hand-off list checked before the rules</td><td><code>lib/auto-review.ts</code></td></tr>
          <tr><td>ChatGPT and Slack</td><td>Two conversations on one instance, keyed <code>app</code> and <code>slack</code>; Slack through a transmission and a playbook</td><td><code>agents/dot/transmissions/</code></td></tr>
          <tr><td>Learning carries across channels</td><td>One <code>defineMemory</code> namespace per instance</td><td><code>lib/memory.ts</code></td></tr>
          <tr><td>Hands off heavy work</td><td>A <code>Builder</code> instance in the person&apos;s workspace, with its own working environment, reached over the mesh</td><td><code>lib/dot.ts</code>, <code>agents/builder/</code></td></tr>
        </tbody>
      </table>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Tools that change at runtime", "Permission gates", "Approvals", "Schedules", "Memory", "Transmissions", "Applications and connections", "Playbooks", "Foundry mesh", "Working environment", "Request authorization", "Model gateway", "Persistent disk"]}
        write={["The responsibility and rules for each dot", "The read tools for your sources", "The acting tools and what each hands off", "The Slack events forwarder"]}
      />

      <h2 id="step-1">1. A dot is an instance with a job</h2>
      <p>
        There is one <code>dot</code> definition. Each dot is an instance, and its context is the
        brief: the job, the sources, what deserves attention, what it must not do, its rules and
        where to send updates. The prompt is built from it. A person&apos;s dots and their
        builder share a workspace, so they can reach each other on the mesh and nobody else
        can.
      </p>
      <CodeBlock
        filename="scripts/verify.ts (creating Sam's feedback dot)"
        language="typescript"
        code={`const feedback = dotFor("sam", {
  name: "feedback",
  owner: "Sam",
  responsibility: {
    job: "Track product feedback from #feedback and the support inbox, and group the reports.",
    sources: ["#feedback", "support inbox"],
    attention: "A problem several people report, or anything that blocks a customer.",
    mustNot: "Reply to anyone.",
  },
  rules: { reply_to_customer: "ask", open_draft_pr: "on-request", merge_pr: "hand-off" },
  routing: { progress: "app", decisions: "slack" },
  slackUserId: "U0SAM",
});
await runtime.createAgent("dot", feedback);                  // workspace "sam"
await runtime.createAgent("builder", builderFor("sam"));     // "sam-builder", named Builder`}
      />
      <CodeBlock
        filename="agents/dot/agent.ts"
        language="typescript"
        code={`export default defineAgent({
  description: "Keeps one responsibility between conversations: reads its sources and acts within its rules",
  components: composeAgent(slackApp, person),

  model: dotModel,
  systemPrompt: async (_agent, ctx) => dotPrompt(await currentDot(ctx), ctx),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [person],

  tools: (_agent, ctx) => dotTools(ctx),
  schedules: [research],
  playbooks: (_agent, ctx) => slackPlaybooks(ctx),
  // Heavy jobs go to the person's builder over the mesh. Runs on the dot's own
  // time only read, so they get no mesh tools.
  mesh: {
    peers: (_self, peer) => peer.definitionId === "builder",
    mount: (ctx) => !readOnly(ctx.request),
  },

  accountSessions: {
    identifier: "slack-bot-token",
    withSession: (_request, use) => use({ token: process.env.SLACK_BOT_TOKEN || OFFLINE_SLACK_TOKEN }),
  },
});`}
      />

      <h2 id="step-2">2. Read-only research</h2>
      <p>
        The research schedule wakes the dot every two hours. What makes the run safe is not an
        instruction in the prompt but the tool list: tools resolve per run, and a run the person
        did not start gets only the read tools. The acting tools are absent, not refused.
      </p>
      <CodeBlock
        filename="agents/dot/research.ts"
        language="typescript"
        code={`export const research = defineSchedule({
  name: "research",
  timing: { kind: "every", interval: "2h" },
  message: "Research time. Nobody is waiting on you. Read each of your sources, keep what you find in your notes with keep_note, and bring at most one suggestion or question with suggest. …",
});

/** Runs the person started: from the app, or by messaging the dot in Slack. */
export function startedByPerson(request: FoundryRequest): boolean {
  return request.source?.kind === "direct" || request.source?.kind === "transmission";
}

/** Runs on the dot's own time: the schedule, wake-ups, and work it spawned for itself. */
export function readOnly(request: FoundryRequest): boolean {
  return !(startedByPerson(request) || request.source?.kind === "mesh");   // the builder's reply may act
}`}
      />
      <CodeBlock
        filename="agents/dot/tools.ts"
        language="typescript"
        code={`export async function dotTools(ctx: AgentAssemblyContext): Promise<GloveFoldArgs<any>[]> {
  const read = researchTools(ctx.agentId);           // read_channel, read_email, read_notes, keep_note, suggest
  if (readOnly(ctx.request)) return read;
  const dot = await currentDot(ctx);
  const review = { owner: dot.owner, rules: dot.rules, personStarted: startedByPerson(ctx.request), … };
  return [...read, ...actionsFor(ctx.agentId).map((action) => reviewed(action, review))];
}`}
      />
      <p>
        The check is on every source but the person&apos;s own, not only on{" "}
        <code>&quot;activation&quot;</code>. A research run still has Foundry&apos;s{" "}
        <code>glove_foundry_spawn</code>, and a spawned run&apos;s source is{" "}
        <code>&quot;spawn&quot;</code>; checking only for activations would let research start
        a run that can act.
      </p>

      <h2 id="step-3">3. Auto-review and Custom Rules</h2>
      <p>
        Every acting tool passes through one wrapper before it is mounted, so the dot never sees
        an unreviewed version. Built-in safety comes first, then your rule for that action, then a
        check of the input itself:
      </p>
      <CodeBlock
        filename="lib/auto-review.ts"
        language="typescript"
        code={`export const ALWAYS_HANDED_OFF: ReadonlySet<string> = new Set(["change_password"]);

export function levelFor(name: string, rules: Readonly<Record<string, Level>>): Level {
  if (ALWAYS_HANDED_OFF.has(name)) return "hand-off";
  return rules[name] ?? "ask";
}

export function reviewed<I>(action: Action<I>, review: Review): GloveFoldArgs<I> {
  const { recipient, handOff, ...tool } = action;
  const level = levelFor(action.name, review.rules);

  if (level === "hand-off") {
    return { ...tool, do: async (input) => notRun(action.name, "hand-off", \`It stays with \${review.owner}. \${handOff(input)} \${review.tellPerson}\`) };
  }
  if (level === "on-request" && !review.personStarted) {
    return { ...tool, do: async () => notRun(action.name, "on-request", \`It runs only when \${review.owner} asks for it.\`) };
  }
  // Writing to someone the dot doesn't know always asks, even on "act".
  const unknownRecipient = (input: I) =>
    recipient !== undefined && !review.contacts.includes(recipient(input).trim().toLowerCase());
  return { ...tool, requiresPermission: level === "ask" ? true : unknownRecipient };
}`}
      />
      <table>
        <thead><tr><th>Level</th><th>What happens</th></tr></thead>
        <tbody>
          <tr><td><code>act</code></td><td>Runs, unless it writes to an address that never wrote in; then it asks.</td></tr>
          <tr><td><code>on-request</code></td><td>Runs only on a run the person started.</td></tr>
          <tr><td><code>ask</code></td><td><code>requiresPermission: true</code>. Foundry records the exact input and holds the run for an <Link href="/foundry/docs/approvals">approval</Link>.</td></tr>
          <tr><td><code>hand-off</code></td><td>Never runs. The dot is told what to hand the person, and where.</td></tr>
        </tbody>
      </table>
      <p>
        An action with no rule asks. Each tool&apos;s description includes its level, so the model
        knows before it tries.
      </p>

      <h2 id="step-4">4. The app and Slack, one memory</h2>
      <p>
        Each channel is a conversation on the same instance, created with a{" "}
        <code>conversationKey</code> of <code>app</code> or <code>slack</code>. Slack messages
        arrive through a transmission; a playbook per dot matches only its owner&apos;s Slack user
        id, and the forwarder fires the route with <code>conversationKey: &quot;slack&quot;</code>,
        so they join the dot&apos;s Slack conversation. The transcripts stay separate. Memory is
        one namespace per instance, so what Sam says in the app is known in Slack.
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
        Routing decides where updates go. With decisions routed to Slack, a hand-off reaches the
        person as a Slack DM, while routine progress stays in the app. Slack&apos;s Events API needs
        its <code>url_verification</code> challenge answered and every request&apos;s signature
        checked, which <code>scripts/slack-events.ts</code> does before forwarding.
      </p>

      <h2 id="step-5">5. A builder for heavy jobs</h2>
      <p>
        Each person has one builder, an instance of the <code>builder</code> definition in their
        workspace, with its own working environment and the web. The dot finds it with{" "}
        <code>glove_mesh_list_agents</code> and sends it the whole job with{" "}
        <code>glove_mesh_send_message</code>. The builder&apos;s final reply comes back to the
        conversation that asked, and the dot checks it and reports. The <code>peers</code> rule
        lets dots see only the builder, and the builder&apos;s own rule (<code>peers: () =&gt; false</code>)
        lets it answer the dot that asked and no one else. On research runs <code>mount</code>{" "}
        returns false, so the dot has no mesh tools at all.
      </p>
      <CodeBlock
        filename="lib/dot.ts (excerpt)"
        language="typescript"
        code={`export function builderFor(ownerId: string) {
  return {
    id: \`\${ownerId}-builder\`,
    workspaceId: ownerId,
    name: "Builder",
    description: "Builds reports and code on its own computer. Takes minutes. Give it the whole task.",
  };
}`}
      />

      <h2 id="run">6. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-standing-agents verify

1. dot "sam-feedback" created; research runs every 2h in the app conversation
2. research run kept notes and suggested: "CSV export times out on large reports: 4 reports this week …"
   22 tools mounted, none that act (no reply_to_customer, send_email, open_draft_pr, merge_pr, change_password, post_to_slack, mesh)
   runs from spawn and background are read-only too
3. reply_to_customer waited for approval; approved: "Sent the reply to dana@acme.test."
4. merge_pr handed off, in Slack: "Over to you: Review PR #42 and merge it yourself."
   change_password with rule "act" still handed off: …
5. open_draft_pr ran when Sam asked: "Opened draft PR #102: Stream large CSV exports."
   unasked, it does not run; send_email on "act" asks for an unknown recipient
6. Slack DM from Sam joined "transmission:agent:sam-feedback:slack"; answered there: "From the app: Billing questions go to Priya."
   a stranger's mention started nothing
7. sent to Builder (sam-builder) on the mesh; back in the app: "The builder finished. Wrote /out/weekly-feedback.md: …"

Standing agents verified: research, auto-review, rules, channels, shared memory, the builder on the mesh.`}
      />
      <p>
        In step 2 the scripted model deliberately tries <code>reply_to_customer</code> during
        research. The run&apos;s trace shows the tool does not exist there, and the list of
        available tools holds nothing that acts.
      </p>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`kuiper login
kuiper projects create dots && kuiper use dots
kuiper units create dots

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set SLACK_BOT_TOKEN=-
kuiper env set -u dots DOTS_DATA_DIR=/data \\
  'ANTHROPIC_API_KEY=\${{models.API_KEY}}' \\
  'ANTHROPIC_BASE_URL=\${{models.ANTHROPIC_BASE_URL}}' \\
  'SLACK_BOT_TOKEN=\${{secrets.SLACK_BOT_TOKEN}}'

kuiper deploy --source . -u dots --wait
kuiper dashboard -u dots --enable                 # inspector login`}
      />
      <ul>
        <li><strong>The Slack forwarder</strong> runs as a second unit with <code>--start-command &quot;pnpm slack-events&quot;</code>. Its public URL is Slack&apos;s request URL, and it reaches Foundry at <code>{"${{dots.INTERNAL_URL}}"}</code>. The README has the commands.</li>
        <li><strong>State</strong> (transcripts, memory, notes, the builder&apos;s files, schedules) is on the <code>/data</code> disk.</li>
        <li><strong>The builder</strong> can run real code in a <Link href="/foundry/docs/kuiper#services">Kuiper sandbox</Link> instead of a working environment.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Auto-review here is code over rules and recipients. Dots use a separate model for the review; you could put a <Link href="/docs/classifier">classifier</Link> or a second model call inside <code>reviewed()</code>.</li>
        <li>There is no &ldquo;take over&rdquo; of the dot&apos;s computer.</li>
        <li>A recurring schedule fires with the instance as it was when the schedule was armed, so the example reads the instance fresh in its resolvers. That is tracked in porkytheblack/glove#199.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://openai.com/index/introducing-dots/">Introducing dots</a>, OpenAI</li>
        <li><a href="https://flaviocopes.com/openai-dots/">A deep dive into OpenAI dots</a>, Flavio Copes</li>
        <li><a href="https://www.macrumors.com/2026/09/29/openai-launches-dots/">OpenAI launches always-on &lsquo;Dots&rsquo; agents</a>, MacRumors</li>
        <li><a href="https://thenewstack.io/openai-dots-gpt6-agents/">OpenAI Dots and GPT-6 agents</a>, The New Stack</li>
        <li><a href="https://www.all-ai.de/news/news26top/claude-duet-openai-dot-grok-bot">Claude Duet, OpenAI dot and Grok Bot compared</a>, all-ai.de</li>
      </ul>
    </article>
  );
}
