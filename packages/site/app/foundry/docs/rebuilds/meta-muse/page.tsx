import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { MuseStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Meta Muse",
  description:
    "Build a personal agent like Meta's Muse with Glove Foundry and deploy it on Kuiper: one agent per person in the app and on WhatsApp, connected apps at the access the person chooses, a computer of its own whose every request passes a separate Sentinel, logins it uses but never sees, one-time cards, approvals, long work, forgetting, and a log of what it did and plans.",
};

const EXAMPLE = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-personal-agent";

export default function MetaMuseRebuildPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Rebuilds / Meta Muse</span>
      <h1>Rebuild Meta Muse</h1>
      <p className="blog-lede">
        Meta&apos;s Muse is a personal agent that does the work rather than answering: it sends the
        email, books the table, fills the form and pays, on a computer of its own, and keeps going
        after you close the app. You talk to it in its app or on WhatsApp. A separate Sentinel
        decides what may leave its computer. This page builds the same shape in Foundry and
        deploys it on Kuiper.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from Meta&apos;s announcement and a hands-on review (sources
          at the end). It is not affiliated with or endorsed by Meta, and it is not how Muse is
          built. The code is in <a href={EXAMPLE}>examples/foundry-personal-agent</a>, and{" "}
          <code>pnpm verify</code> runs a day of it offline, against local servers and sample
          sites.
        </p>
      </div>

      <h2 id="what">What Muse does</h2>
      <ul>
        <li><strong>You message it like a person</strong>, in the Muse app or directly in WhatsApp.</li>
        <li><strong>It works across your apps</strong> (Gmail, Google Calendar and others), and you choose what each may do: for mail, only read it, or also send it. You can change access or disconnect a service any time.</li>
        <li><strong>It has a computer of its own</strong>, Muse Secure VM, with a browser you can watch. It fills forms and can negotiate for you.</li>
        <li><strong>A Sentinel guards that computer.</strong> It runs on the same machine, isolated from Muse, and nothing Muse does reaches the internet unless the Sentinel approves it. The Sentinel asks you when it needs your input.</li>
        <li><strong>It never sees your passwords.</strong> Logins sit in a vault it can use but not read. It pays through Link with a one-time card, so your card number stays hidden.</li>
        <li><strong>It checks with you</strong> before sensitive actions, such as sending an email or making a purchase.</li>
        <li><strong>It keeps working</strong> after you close the app and comes back when something changes or it needs your OK.</li>
        <li><strong>It remembers what matters</strong> and makes suggestions, and it keeps a complete log of everything it has done and plans to do.</li>
      </ul>

      <h2 id="flow">How work moves</h2>
      <MuseStory />

      <h2 id="map">Each feature, as a Foundry primitive</h2>
      <table>
        <thead><tr><th>Meta Muse</th><th>Foundry</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>One Muse, in the app and on WhatsApp</td><td>One instance per person; conversations <code>app</code> and <code>whatsapp</code>; one memory</td><td><code>lib/people.ts</code></td></tr>
          <tr><td>WhatsApp</td><td>A Foundry app with a transmission each way; a playbook per person filtered to their number</td><td><code>agents/muse/apps/whatsapp.app.ts</code></td></tr>
          <tr><td>Choose what each app may do</td><td>The installation&apos;s <code>config.access</code>: the app&apos;s tool policy hides writes, the send binding is off</td><td><code>lib/connect.ts</code>, <code>lib/mcp-servers.ts</code></td></tr>
          <tr><td>Its own computer</td><td>A working environment per instance, saved by Foundry</td><td><code>agents/muse/vm.ts</code></td></tr>
          <tr><td>The Sentinel</td><td><code>env:fetch</code>&apos;s <code>authorize</code> hook, with rules in code and its own model from <code>glove-classifier</code></td><td><code>agents/muse/sentinel.ts</code></td></tr>
          <tr><td>The Sentinel asks you</td><td><code>request_access</code>, which waits for approval only when the Sentinel said ask</td><td><code>agents/muse/sentinel.ts</code></td></tr>
          <tr><td>Logins it can&apos;t read</td><td>A vault as the environment&apos;s secret store; <code>credential: &quot;name&quot;</code> in <code>env:fetch</code></td><td><code>lib/vault.ts</code></td></tr>
          <tr><td>Asks before sending or buying</td><td>Gmail&apos;s send and <code>buy</code> have <code>requiresPermission</code></td><td><code>agents/muse/tools.ts</code></td></tr>
          <tr><td>One-time cards</td><td><code>buy</code> gets a single-use card inside the tool</td><td><code>lib/payments.ts</code></td></tr>
          <tr><td>Keeps working, comes back when something changes</td><td><code>glove_foundry_schedule</code> and <code>glove_foundry_sleep</code>; new mail through the Gmail watch</td><td><code>agents/muse/playbook.ts</code></td></tr>
          <tr><td>Remembers, and forgets when told</td><td><code>defineMemory</code>; <code>glove_context_set</code> and <code>glove_context_unset</code></td><td><code>agents/muse/muse.memory.ts</code></td></tr>
          <tr><td>A log of what it did and plans</td><td>A subscriber and the Sentinel write what it did; schedules and pending approvals are its plans</td><td><code>lib/activity.ts</code></td></tr>
        </tbody>
      </table>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Installable capabilities", "Applications and connections", "MCP servers", "Transmissions", "Playbooks", "Code as the tool surface", "Working environment", "Classifiers", "Permission gates", "Approvals", "Memory", "Subscribers", "Schedule management", "Request authorization", "Model gateway", "Persistent disk", "Kuiper sandboxes", "Kuiper browsers"]}
        write={["Your account store, OAuth callback and the person's vault", "The Sentinel's rules", "The payment provider and the WhatsApp webhook", "The scripted model and sample sites for offline runs"]}
      />

      <h2 id="step-1">1. One Muse per person, in two places</h2>
      <p>
        Each person gets one Muse in their own workspace. Who they are, their WhatsApp number and
        the sites they have allowed are its data. It has two conversations and one memory, so
        what Rosa says on WhatsApp it knows in the app:
      </p>
      <CodeBlock
        filename="lib/people.ts"
        language="typescript"
        code={`export function museFor(person: Person): CreateAgentInstanceOptions {
  return {
    id: \`\${person.id}-muse\`,
    workspaceId: person.id,
    name: "Muse",
    description: \`\${person.name}'s personal agent\`,
    context: { name: person.name, phone: person.phone, sentinel: { allowed: [], blocked: [] } },
  };
}

export function channel(museId: string, key: "app" | "whatsapp"): CreateConversationOptions {
  return { id: \`\${museId}-\${key}\`, title: key === "app" ? "Muse" : "WhatsApp", context: { conversationKey: key } };
}`}
      />
      <p>
        WhatsApp is a Foundry app with a transmission each way. Everyone messages Muse&apos;s one
        number, so every message arrives on one shared route, and each person&apos;s playbook only
        takes messages from their own number. Answers go out on a route made for that person:
        its config fixes the recipient, so Muse can answer its person on WhatsApp but cannot
        message anyone else there.
      </p>
      <CodeBlock
        filename="agents/muse/playbook.ts (excerpt)"
        language="typescript"
        code={`export function whatsappFrom(agentId: string, person: { id: string; phone: string }) {
  return composePlaybook({
    name: "whatsapp",
    transmission: whatsapp,
    match: { event: message, routes: [whatsappIn], predicate: { definition: fromPerson, parameters: { phone: person.phone } } },
    directives: [{ action: answer, instruction: "Answer on WhatsApp with the WhatsApp send tool. Keep it short, like a text." }],
    applications: [whatsappApp],
    outbound: [{ route: whatsappFor(agentId, person).out, application: whatsappApp }],
  });
}`}
      />
      <p>
        Meta posts messages to a webhook and wants a verify-token handshake and a signature on
        every delivery. <code>scripts/whatsapp-webhook.ts</code> does both and forwards each text
        message to Foundry&apos;s <code>whatsapp-in</code> route, the same way the Dots rebuild
        forwards Slack.
      </p>

      <h2 id="step-2">2. Apps at the access she chooses</h2>
      <p>
        Gmail and Calendar are <Link href="/foundry/docs/applications#people-connect">Foundry apps
        installed with her accounts</Link>, as in the other rebuilds: Google&apos;s MCP servers for
        reads, which Muse calls in code, the Gmail transmission for sending, and a watch for new
        mail. What Muse adds is the access she picks for each app, kept on the installation:
      </p>
      <CodeBlock
        filename="lib/mcp-servers.ts (excerpt)"
        language="typescript"
        code={`export function byAccess(policy: { reads: string[]; free?: string[] }) {
  return (tool, { config }) => {
    if (tool.readOnly || policy.reads.includes(tool.name)) return "allow";
    if (config.access === "read") return "hide";                 // Muse never sees it
    return policy.free?.includes(tool.name) || config.alwaysAllow.includes(tool.name) ? "allow" : "ask";
  };
}`}
      />
      <p>
        Gmail&apos;s send tool comes from its transmission, not the MCP server, so read access
        removes it in <code>configure</code> too, and the send binding is off, so Foundry would
        refuse the delivery anyway. Changing access is a write, and so is disconnecting:
      </p>
      <CodeBlock
        filename="lib/connect.ts (excerpt)"
        language="typescript"
        code={`export async function setAccess(foundry, agentId, account, access: "read" | "act") {
  await foundry.install(agentId, installationFor(account, access));                           // the tools she allows
  if (account.app === "gmail") await foundry.putBinding(sendBinding(agentId, account.id, access === "act"));  // the right to send
}`}
      />

      <h2 id="step-3">3. Its own computer</h2>
      <p>
        Muse&apos;s computer is a working environment saved per instance: files and scripts that
        last, and the web through <code>env:fetch</code>. Its options are built per run, from the
        person, so the Sentinel and their logins come with it:
      </p>
      <CodeBlock
        filename="agents/muse/vm.ts"
        language="typescript"
        code={`export const vm = defineWorkingEnvironment({
  options: async ({ assembly }) => {
    const vault = vaultFor(assembly.workspaceId);
    const logins = await loginsOf(assembly.workspaceId);
    return {
      stdlib: [
        secret({ store: vault }),                       // names and references, never values
        fetchFiles({
          authorize: sentinelFor(assembly).authorize,   // every request and redirect
          secretStore: vault,
          credentials: Object.fromEntries(Object.entries(logins).map(([name, login]) => [name, {
            origins: [login.origin],                    // sent to that site only
            headers: { Authorization: { ref: secretRef(name), prefix: "Bearer " } },
          }])),
        }),
      ],
    };
  },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
});`}
      />

      <h2 id="step-4">4. The Sentinel</h2>
      <p>
        <code>env:fetch</code> calls <code>authorize</code> for every request and every redirect,
        outside the sandbox, before anything leaves. The Sentinel behind it is kept apart from
        Muse on purpose. It never sees Muse&apos;s conversation, its reasoning or the pages it
        read, so a page that tells Muse what to do cannot talk the Sentinel round. It sees the
        request, what the person asked for in this run, and the sites they allowed:
      </p>
      <CodeBlock
        filename="agents/muse/sentinel.ts (excerpt)"
        language="typescript"
        code={`async decide(url: URL, method: string): Promise<Decision> {
  const rules = await this.rules();                                 // read fresh: she may have just allowed a site
  const personal = personalDataIn(url);
  const decided = rules.blocked.includes(url.host) ? { verdict: "block", reason: "you blocked this site" }
    : personal && !rules.allowed.includes(url.host) ? { verdict: "block", reason: \`it would send \${personal} to a site you haven't allowed\` }
    : rules.allowed.includes(url.host) ? { verdict: "allow", reason: "you allowed this site" }
    : await judge(method, url, this.asked(), rules);                // its own model: allow, ask or block
  await logActivity({ person: this.ctx.workspaceId, kind: "sentinel", what: \`\${method} \${url.host}\${url.pathname}\`, outcome: decided.verdict });
  return decided;
}`}
      />
      <p>
        <code>judge</code> is a separate small model answering one typed question through{" "}
        <code>llmClassifier</code> from <Link href="/docs/classifier">glove-classifier</Link>. A
        doubtful &ldquo;allow&rdquo; becomes &ldquo;ask&rdquo;. Without a key, reads pass and writes
        ask.
      </p>
      <p>
        <code>env:fetch</code> tells the script only that a request was blocked, never why. So
        when one is stopped, Muse calls <code>request_access</code>. It reads what the Sentinel
        decided in this run: a blocked request stays blocked and nobody is asked; an
        &ldquo;ask&rdquo; waits for Rosa&apos;s approval, and her yes is the only thing that adds a
        site to her list.
      </p>
      <CodeBlock
        filename="agents/muse/sentinel.ts (excerpt)"
        language="typescript"
        code={`requiresPermission: (input) => sentinel.decisionFor(hostOf(input.site))?.verdict === "ask",`}
      />

      <h2 id="step-5">5. Logins it never sees</h2>
      <p>
        Rosa adds a login in your app: a name, the site and the token. A script uses it by name,
        and <code>env:fetch</code> adds the header on that site&apos;s origin only. Scripts can list
        logins and get references, but <code>get()</code> stays off, so the value never enters the
        sandbox or Muse&apos;s context. <code>request_login</code> asks her to add one; Muse never
        asks for a password in chat.
      </p>
      <CodeBlock
        filename="a script Muse writes"
        language="javascript"
        code={`import { request } from 'env:fetch';
export default async function main() {
  return request('https://bistro-luna.example/api/reservations', {
    method: 'POST',
    json: { party: 4, time: 'Friday 19:00' },
    credential: 'bistro-luna',          // her login, added outside the sandbox
    output: '/tmp/booking.json',
  });
}`}
      />

      <h2 id="step-6">6. Sending and paying wait for her</h2>
      <p>
        Gmail&apos;s send asks for each email. <code>buy</code> asks for each purchase, then pays
        with a one-time card made for that merchant and amount. Meta uses Link by Stripe; any
        provider of single-use virtual cards fits. The card number stays inside the tool:
      </p>
      <CodeBlock
        filename="agents/muse/tools.ts (excerpt)"
        language="typescript"
        code={`{
  name: "buy",
  description: "Pay for something the person asked for. You never see a card …",
  inputSchema: z.object({ merchant: z.string(), items: z.array(z.string()).min(1), amountCents: z.number().int().positive() }),
  requiresPermission: true,
  async do(purchase) {
    const receipt = await pay(ctx.workspaceId, purchase);     // one-time card, used once, here
    return { status: "success", data: { paid: true, card: \`one-time card ending \${receipt.cardLast4}\` } };
  },
}`}
      />

      <h2 id="step-7">7. Long work, news and forgetting</h2>
      <ul>
        <li><strong>It keeps going.</strong> Asked to watch a train fare, Muse sets its own check with <code>glove_foundry_schedule</code> every six hours and messages Rosa on WhatsApp when the price drops. The schedule is Foundry&apos;s, so it survives restarts and shows up in the log as a plan.</li>
        <li><strong>News comes to her.</strong> The Gmail watch passes new mail into the app conversation. When Leo asks to move dinner, Muse tells Rosa on WhatsApp and offers to change the booking.</li>
        <li><strong>It forgets when told.</strong> Facts live in Glove memory as context entries. <code>glove_context_set</code> keeps one; <code>glove_context_unset</code> removes it, and the next answer no longer knows.</li>
      </ul>

      <h2 id="step-8">8. A log it can&apos;t leave anything out of</h2>
      <p>
        If the model wrote its own log, it could leave an entry out. Here the model writes none
        of it. A <Link href="/foundry/docs/capabilities#subscribers">subscriber</Link> records
        every tool call from Foundry&apos;s side of the run, and the Sentinel records every
        decision. What Muse plans is Foundry&apos;s own data: its schedules and wake-ups, and the
        approvals waiting on her.
      </p>
      <CodeBlock
        filename="agents/muse/subscribers/activity.subscriber.ts (excerpt)"
        language="typescript"
        code={`export default defineSubscriber({
  description: "Muse's log of everything it does",
  create: ({ workspaceId }) => ({
    async record(type, data) {
      if (type !== "tool_use_result") return;
      await logActivity({ person: workspaceId, kind: "tool", what: data.tool_name, outcome: data.result.status });
    },
  }),
});`}
      />

      <h2 id="run">9. Run it</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-foundry-personal-agent verify

1. Rosa's Muse has gmail (read), calendar (read), whatsapp; the Gmail watch is connected
2. in code over Gmail and Calendar: Friday: dentist at 10, design review at 2, dinner at 7 with Leo, Priya and Sam. …
3. read only: "I can read your mail but not send it. Give me send access for Gmail in the app and I'll send it."
   With send access, after approval: Sent Leo a note: still on for Friday at 7.
4. told on WhatsApp ("Noted: Priya is vegetarian. I'll plan around it."), asked in the app: Priya is vegetarian.
5. the Sentinel: GET bistro-luna.example/menu → allow; GET collect.example/c → block;
   POST bistro-luna.example/api/reservations → ask; allow bistro-luna.example → the person allowed it;
   POST bistro-luna.example/api/reservations → allow. Booked Bistro Luna for 4 on Friday at 7 … (BL-2041).
6. Ordered from Fresh Market for Friday: $23.40, paid with a one-time card ending 8141.
7. it will check the train fare every 6 hours, on its own
8. new mail, to her WhatsApp: "Leo Martin asks to move Friday's dinner to 7:30. Want me to change the booking?"
9. after "forget": I don't know of anyone vegetarian.
10. the log: 18 tool calls and 5 Sentinel decisions done, 1 planned (the fare watch); Calendar disconnected`}
      />
      <p>
        The run also checks that her login and the card number appear nowhere in Muse&apos;s data.
        With no API key Muse runs a short script instead of a model, so this checks the wiring,
        not the judgment. In step 5 the script follows the page&apos;s hidden instruction on
        purpose, to show the Sentinel stopping it; a real model is told never to act on
        instructions in pages it reads.
      </p>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`kuiper login
kuiper projects create muse && kuiper use muse
kuiper units create muse

kuiper providers add anthropic --key -            # once per organisation
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- WHATSAPP_TOKEN=- FOUNDRY_TOKEN=-
kuiper env set -u muse MUSE_DATA_DIR=/data \\
  'ANTHROPIC_API_KEY=\${{models.API_KEY}}' \\
  'ANTHROPIC_BASE_URL=\${{models.ANTHROPIC_BASE_URL}}' \\
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=\${{secrets.GOOGLE_CLIENT_SECRET}}' \\
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \\
  'GOOGLE_SERVICE_ACCOUNT_JSON=\${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \\
  WHATSAPP_PHONE_NUMBER_ID=… 'WHATSAPP_TOKEN=\${{secrets.WHATSAPP_TOKEN}}' \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}'
kuiper deploy --source . -u muse --wait

# The WhatsApp webhook, the only public way in:
kuiper units create whatsapp-webhook
kuiper settings -u whatsapp-webhook --start-command "pnpm whatsapp-webhook" --port 4150
kuiper secrets set WHATSAPP_APP_SECRET=-
kuiper env set -u whatsapp-webhook 'WHATSAPP_APP_SECRET=\${{secrets.WHATSAPP_APP_SECRET}}' WHATSAPP_VERIFY_TOKEN=… \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}' 'FOUNDRY_URL=\${{muse.INTERNAL_URL}}'
kuiper deploy --source . -u whatsapp-webhook --wait`}
      />
      <ul>
        <li><strong>State</strong> (Muses, conversations, memory, accounts and tokens, the vault, the Sentinel&apos;s lists, the log and each computer) sits on the <code>/data</code> disk and survives redeploys.</li>
        <li><strong>Models</strong>, Muse&apos;s and the Sentinel&apos;s, go through Kuiper&apos;s model gateway.</li>
        <li><strong>New mail needs nothing public.</strong> The Gmail watch pulls from inside the unit. WhatsApp needs the webhook unit, which reaches Foundry over the private address.</li>
        <li><strong>A real computer.</strong> Swap <code>agents/muse/vm.ts</code> for a <Link href="/foundry/docs/kuiper#services">Kuiper sandbox and browser</Link> per person, and keep the Sentinel in front: route the browser through a proxy that asks it, as <code>env:fetch</code> does here.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Muse browses in a real browser you can watch. Here the web is <code>env:fetch</code> from scripts until you swap in a Kuiper browser, and the Sentinel sees requests, not page actions.</li>
        <li>Meta&apos;s Sentinel is an agent on the same machine that can ask you directly. Here it judges one request at a time, and its question reaches you through Muse&apos;s <code>request_access</code>. Only your approval changes what is allowed.</li>
        <li>Purchases go through <code>buy</code> with a provider&apos;s one-time card, not through a checkout page in the browser.</li>
        <li>There is no Instagram connector and no AI glasses.</li>
      </ul>

      <h2 id="sources">Sources</h2>
      <ul>
        <li><a href="https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/">Introducing Muse</a>, Meta</li>
        <li><a href="https://www.eesel.ai/blog/meta-muse-agent-review">Meta Muse review</a>, eesel</li>
        <li><a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started">WhatsApp Cloud API: get started</a>, Meta for Developers</li>
      </ul>
    </article>
  );
}
