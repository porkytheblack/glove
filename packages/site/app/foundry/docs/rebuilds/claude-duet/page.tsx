import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { PartnerStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Claude Duet",
  description:
    "Build a proactive partner like Anthropic's Claude Duet with Glove Foundry and deploy it on Kuiper: one thread, a morning brief and quiet check-ins built from the person's preferences, approvals before it sends, pays, signs or deletes, things it never does, a two-tier guard on everything outbound, and its own computer over the mesh.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-proactive-partner";

export default function ClaudeDuetRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / Claude Duet</span>
      <h1>Rebuild Claude Duet</h1>
      <p className="blog-lede">
        Anthropic&apos;s Claude Duet is one agent that reaches out before you ask. It sends a brief
        each morning, checks in through the day, and messages you only about what you said you
        want to hear about. Everything happens in one thread, it asks before it sends, pays,
        signs or deletes, and some things it will not do at all. This page builds the same shape
        in Foundry and deploys it on Kuiper.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from Anthropic&apos;s article and launch coverage (sources
          at the end). It is not affiliated with or endorsed by Anthropic, and it is not how Claude Duet is built. The code
          is in <a href={EXAMPLE}>examples/foundry-proactive-partner</a>, and{" "}
          <code>pnpm verify</code> runs a whole day of it offline.
        </p>
      </div>

      <h2 id="what">What Claude Duet does</h2>
      <ul>
        <li>A morning brief and check-ins through the day. You choose what you hear about and how often.</li>
        <li>It flags problems you didn&apos;t ask about, such as a client call that clashes with a flight.</li>
        <li>One ongoing thread rather than separate chats. You hand it work by text or voice.</li>
        <li>Its own virtual machine with a browser, so your devices can be off while it works. It tells you when a background task finishes or needs your review.</li>
        <li>Your memory, skills and connected apps carry over from your Claude account, with over 6,000 connectors and plugins.</li>
        <li>It asks before sending messages, making payments, signing documents or deleting files. Some things, such as trading securities or moving money between accounts, it will not do even with your approval.</li>
        <li>It never sees your passwords. A classifier always rejects card numbers and government ID numbers, and shares health or financial details only when you explicitly ask.</li>
      </ul>

      <h2 id="flow">A day, step by step</h2>
      <PartnerStory />

      <h2 id="map">Each feature, as a Foundry primitive</h2>
      <table>
        <thead><tr><th>Claude Duet</th><th>Foundry</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>You choose what you hear and how often</td><td><code>preferences</code> on the partner instance: brief time, check-in hours, what to hear about</td><td><code>lib/onboarding.ts</code></td></tr>
          <tr><td>Morning brief and check-ins</td><td><code>defineSchedule</code> crons built from those preferences, in the person&apos;s time zone</td><td><code>agents/partner/schedules.ts</code></td></tr>
          <tr><td>Quiet unless it matters</td><td><code>notify_person</code>, the one way to the phone</td><td><code>agents/partner/notify.ts</code></td></tr>
          <tr><td>One thread</td><td>One instance and one conversation per person; schedules attach to it</td><td><code>lib/onboarding.ts</code></td></tr>
          <tr><td>Text or voice</td><td><code>voiceCall</code> over the same assembled agent</td><td><code>agents/partner/call.ts</code></td></tr>
          <tr><td>Its own computer</td><td>A <code>Computer</code> instance in the person&apos;s workspace, reached over the mesh</td><td><code>agents/computer/</code></td></tr>
          <tr><td>Asks before acting</td><td><code>requiresPermission</code> on send, pay, sign and delete</td><td><code>agents/partner/actions.ts</code></td></tr>
          <tr><td>Off limits even with approval</td><td>No tool exists for it</td><td><code>agents/partner/actions.ts</code></td></tr>
          <tr><td>Card and ID numbers never leave; health and money only when asked</td><td>A strict tier in code, a sensitive tier from <code>glove-classifier</code></td><td><code>lib/guard.ts</code></td></tr>
          <tr><td>Never sees passwords</td><td>Connectors hold credentials; the agent gets tools, not tokens</td><td><code>lib/connectors.ts</code></td></tr>
        </tbody>
      </table>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Schedules", "Memory", "Content skills", "Permission gates", "Approvals", "Classifiers", "Foundry mesh", "Working environment", "Voice calls", "Request authorization", "Model gateway", "Persistent disk", "Kuiper inbox", "Kuiper sandboxes"]}
        write={["The connectors to your person's apps", "Where a person's partner, computer and preferences are created", "Where notifications go", "The guard's rules"]}
      />

      <h2 id="step-1">1. One partner per person, as data</h2>
      <p>
        Each person gets a workspace with two agents in it: their partner and the computer it
        works on. Their name, time zone and preferences are the partner&apos;s data, and the
        thread&apos;s id comes from the person, so there is never a second one.
      </p>
      <CodeBlock
        filename="lib/onboarding.ts"
        language="typescript"
        code={`export const DEFAULT_PREFERENCES: Preferences = {
  briefAt: "07:30",
  checkInHours: [10, 13, 16, 19],
  hearAbout: ["payments due or failed", "documents to sign", "clients waiting on a reply", "calendar clashes"],
};

export function partnerFor(person: Person, preferences: Preferences = DEFAULT_PREFERENCES) {
  return {
    id: person.id,
    workspaceId: person.id,
    name: "Partner",
    description: \`\${person.name}'s partner: looks after their inbox, calendar and errands.\`,
    context: { name: person.name, timezone: person.timezone, preferences },
  };
}

export function computerFor(person: Pick<Person, "id">) {
  return { id: \`\${person.id}-computer\`, workspaceId: person.id, name: "Computer", description: "The partner's own computer, with files and the web. …" };
}

export const threadFor = (person: Pick<Person, "id">) => ({ id: \`\${person.id}-thread\`, workspaceId: person.id, title: "Partner" });`}
      />
      <p>
        The example seeds Ada&apos;s account with <code>defineAgentInstance</code>, and{" "}
        <code>scripts/onboard.ts</code> creates the same records for anyone else:
      </p>
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`const ada = defineAgentInstance(partner, partnerFor(DEMO_PERSON));

export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [ada, defineAgentInstance(computer, computerFor(DEMO_PERSON))],
  conversations: [createConversation(ada, threadFor(DEMO_PERSON))],
});`}
      />
      <p>The definition only says what a partner can be. Every part it names lives beside it:</p>
      <CodeBlock
        filename="agents/partner/agent.ts"
        language="typescript"
        code={`export default defineAgent({
  description: "Looks after one person's inbox, calendar and errands, and reaches out before they ask",
  components: composeAgent(personal),

  model: (_agent, context) => (isCall(context) ? callModel() : partnerModel()),
  systemPrompt: (_agent, context) => partnerPrompt(context.agentInstance.context, isCall(context)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [personal],

  tools: (_agent, ctx) => [...connectorTools, ...actionTools(ctx), notifyTool],
  schedules: (_agent, { agentInstance }) => partnerSchedules(agentInstance.context),
  configure: async (agent) => {
    useReadSkill(agent, await loadSkills());
  },

  mesh: true,   // long jobs go to its computer, another agent in the workspace

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});`}
      />

      <h2 id="step-2">2. Its own clock, from the person&apos;s preferences</h2>
      <p>
        Schedules are what make it proactive. They resolve per instance, from its data, so each
        person&apos;s brief follows their time zone and the times they chose. Foundry stores them
        on the first run and attaches them to the conversation that run was in: the person&apos;s
        one thread.
      </p>
      <CodeBlock
        filename="agents/partner/schedules.ts"
        language="typescript"
        code={`export function partnerSchedules(context: Readonly<Record<string, unknown>>) {
  const timezone = String(context.timezone ?? "UTC");
  const preferences = (context.preferences ?? DEFAULT_PREFERENCES) as Preferences;
  const [hour = "7", minute = "30"] = preferences.briefAt.split(":");
  return [
    defineSchedule({
      name: "morning-brief",
      timing: { kind: "cron", expression: \`\${Number(minute)} \${Number(hour)} * * *\`, timezone },
      message: "Morning brief. Read the inbox and today's calendar, then send one short brief with notify_person: what needs them today, in order, and any clash you can fix. …",
    }),
    defineSchedule({
      name: "check-in",
      timing: { kind: "cron", expression: \`0 \${preferences.checkInHours.join(",")} * * *\`, timezone },
      message: "Check-in. Read the inbox. If something they want to hear about needs them before the next check-in, notify_person once … Otherwise do not notify, and reply exactly: (nothing new)",
    }),
  ];
}`}
      />
      <p>
        When the person changes a preference, your app calls <code>configureAgent</code> with the
        new context, and the next run moves the schedule. The brief also looks for problems
        nobody asked about: with a 16:00 flight and a 16:30 client call in the calendar, it
        offers to move the call.
      </p>

      <h2 id="step-3">3. Quiet unless it matters</h2>
      <p>
        The partner reaches the person in one way only, and the prompt says when to use it. Every
        check-in still writes to the thread, but only <code>notify_person</code> reaches the phone:
      </p>
      <CodeBlock
        filename="agents/partner/notify.ts"
        language="typescript"
        code={`export const notifyTool: GloveFoldArgs<any> = {
  name: "notify_person",
  description: "Send the person a push notification. Use it only when something needs them.",
  inputSchema: z.object({ title: z.string().max(80), body: z.string().max(600) }),
  async do(note) {
    // It goes to the person themselves, so only the strict tier applies.
    if (strictlyBlocked(\`\${note.title}\\n\${note.body}\`)) {
      return { status: "error", data: null, message: "Blocked: card and ID numbers never go to a phone." };
    }
    if (process.env.PUSH_URL) {
      await fetch(process.env.PUSH_URL, { method: "POST", headers: { title: note.title }, body: note.body });
    }
    await record({ kind: "notification", ...note });
    return { status: "success", data: { notified: true } };
  },
};`}
      />
      <p>
        <code>read_inbox</code> returns each email once, so a check-in sees only what arrived since
        the last look. The model decides what is urgent; like Duet, it can misjudge, and mail that
        lands between check-ins waits for the next one.
      </p>

      <h2 id="step-4">4. Ask before acting, and never do some things</h2>
      <p>
        Sending, paying, signing and deleting are tools with <code>requiresPermission</code>.
        Foundry records the exact input, holds the run and resumes it when the person answers.
        The function form decides per call: a message the guard will refuse is not worth asking
        about.
      </p>
      <CodeBlock
        filename="agents/partner/actions.ts"
        language="typescript"
        code={`{
  name: "send_message",
  inputSchema: z.object({ to: z.string(), via: z.enum(["text", "email"]), text: z.string().min(1) }),
  // A message the guard will refuse is not worth asking about.
  requiresPermission: ({ text }) => !strictlyBlocked(text),
  async do(message) {
    // The person's own words, when they started this run, tell the guard what they asked for.
    const reason = await blockedBecause(message.text, ctx.request.source?.kind === "direct" ? ctx.messageText : undefined);
    if (reason) return blocked(reason);
    await record({ kind: "message", ...message });
    return { status: "success", data: { sent: true, to: message.to } };
  },
},
{
  name: "pay_invoice",
  inputSchema: z.object({ invoiceId: z.string(), payee: z.string(), amount: z.number().positive(), currency: z.string().default("USD") }),
  requiresPermission: true,
  async do(payment) { /* your payments provider */ },
},`}
      />
      <p>
        Trading securities and moving money between accounts are off limits even with
        approval. The simplest way to make sure an agent never does something is to give it no
        tool for it, and to say so in the prompt so it can tell the person plainly.
      </p>

      <h2 id="step-5">5. A guard on everything outbound, in two tiers</h2>
      <p>
        The strict tier is code, so it is sure and free: card numbers (a Luhn check) and
        government ID numbers never leave, whoever asked. The sensitive tier needs judgment, so
        it uses a classifier from <Link href="/docs/classifier">glove-classifier</Link> (with{" "}
        <code>TYPESAFE_API_KEY</code>): health and money details leave only when the person
        explicitly asked to share them in this message.
      </p>
      <CodeBlock
        filename="lib/guard.ts"
        language="typescript"
        code={`export function strictlyBlocked(text: string): boolean {
  return Boolean(cardNumberIn(text) || governmentIdIn(text));
}

export async function blockedBecause(text: string, request?: string): Promise<string | undefined> {
  if (cardNumberIn(text)) return "it contains a payment card number";
  if (governmentIdIn(text)) return "it contains a government ID number";
  if (!classifier) return undefined;
  const { answers } = await classifier.classify({
    state: { message: text, request: request ?? "" },
    questions: {
      sensitive: noul("Does the message share someone's health details or personal finances?"),
      asked: noul("Did the request explicitly ask to share those details in this message?"),
    },
  });
  return answers.sensitive.noul > 0.8 && answers.asked.noul < 0.5
    ? "it shares health or money details they did not ask to share"
    : undefined;
}`}
      />

      <h2 id="step-6">6. Its own computer, and your voice</h2>
      <p>
        Long jobs go to the person&apos;s <code>Computer</code>, another agent in their workspace
        with its own files and the web. The partner finds it with{" "}
        <code>glove_mesh_list_agents</code> and sends it the job with{" "}
        <code>glove_mesh_send_message</code>, then keeps talking. The computer&apos;s reply comes
        back to the thread as a new turn, and the partner tells the person it is done with{" "}
        <code>notify_person</code>. Its working environment is saved per person, so what it built
        last week is still there.
      </p>
      <p>
        Voice is the same agent on a call. <code>voiceCall</code> runs a speech-to-speech session
        over the assembled partner, so the call has the same memory and the same computer. Tools
        that need approval stay off the call. See{" "}
        <Link href="/foundry/docs/voice">Voice agents</Link>.
      </p>
      <CodeBlock
        filename="agents/partner/call.ts"
        language="typescript"
        code={`export const call = voiceCall({
  room: (context) => {
    const { call: room } = callRequest.parse(context.request.payload);
    return webSocketRoom({ port: room.port, token: room.token, agentName: "Partner" });
  },
  greeting: "The person just called. Greet them by name in one short sentence and ask what they need.",
});`}
      />

      <h2 id="run">7. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-proactive-partner verify

on Ada's clock: morning brief 07:30, check-ins 10:00, 13:00, 16:00, 19:00 (America/New_York)
pushed: "Morning brief"
check-in: (nothing new), no notification
pushed: "Payment failed: INV-88"
waiting for approval: pay_invoice
in Ada's thread: Paid INV-88: $240 to Acme Hosting.
in Ada's thread: I won't send card numbers, even to Sam. I can send him the hotel's booking link instead.
in Ada's thread: Done: Built dashboard.html: October invoices by vendor, $3,410 total, one overdue (INV-88). …
in Ada's thread: I can't move money between accounts, even with your approval. That one is yours to do in your bank's app.
brief moved to 08:15 (15 8 * * *)

Partner verified: brief, quiet and urgent check-ins, approval, guard, computer over the mesh, off-limits, preferences as data.`}
      />
      <p>
        The script fires each schedule the way its activation would: a run in the thread with{" "}
        <code>source: {"{ kind: \"activation\" }"}</code>. With no API key the partner runs a short
        script instead of a model, so this checks the wiring, not the judgment.
      </p>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`kuiper login
kuiper projects create partner && kuiper use partner
kuiper units create partner

kuiper providers add anthropic --key -            # once per organisation
kuiper env set -u partner PARTNER_DATA_DIR=/data \\
  'ANTHROPIC_API_KEY=\${{models.API_KEY}}' \\
  'ANTHROPIC_BASE_URL=\${{models.ANTHROPIC_BASE_URL}}' \\
  PUSH_URL=https://ntfy.sh/…

kuiper deploy --source . -u partner --wait
kuiper dashboard -u partner --enable              # inspector login`}
      />
      <ul>
        <li><strong>Schedules</strong> are stored on the <code>/data</code> disk with everything else, so the brief and check-ins survive restarts and redeploys.</li>
        <li><strong>Email.</strong> Give the partner its own address with <code>kuiper inbox create</code> and point <code>read_inbox</code> at it with <code>inboxTools</code> from <code>@kuiper-sh/inbox/glove</code>.</li>
        <li><strong>The computer.</strong> Swap <code>agents/computer/workspace.ts</code> for a Kuiper sandbox and browser per person, so a sign-in carries over. See <Link href="/foundry/docs/kuiper#services">Foundry on Kuiper</Link>.</li>
        <li><strong>Usage.</strong> Background runs cost tokens like any other. Kuiper&apos;s usage page shows them per unit, and a budget can cap them.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Connectors here are two sample tools over fixtures. Real ones are yours to write, or an MCP server per app.</li>
        <li>The computer is a Glove working environment with the web, not a full desktop browser, until you swap in a Kuiper browser.</li>
        <li>Notifications go to an ntfy-style endpoint. A real app would send its own push.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://claude.com/resources/articles/claude-duet">Claude Duet</a>, Anthropic</li>
        <li><a href="https://www.macrumors.com/2026/10/21/anthropic-claude-duet/">Anthropic launches Claude Duet, a proactive AI agent</a>, MacRumors</li>
        <li><a href="https://iphoneincanada.ca/2026/10/21/claude-duet-proactive-ai-agent-app">Claude Duet is Anthropic&apos;s answer to Muse, Grok Bot and OpenAI Dots</a>, iPhone in Canada</li>
        <li><a href="https://www.all-ai.de/news/news26top/claude-duet-openai-dot-grok-bot">Claude Duet, OpenAI dot and Grok Bot compared</a>, all-ai.de</li>
      </ul>
    </article>
  );
}
