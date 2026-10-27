import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint } from "@/components/diagrams";
import { MuseStory } from "@/components/rebuild-stories";

export const metadata = {
  title: "Rebuild Meta Muse",
  description:
    "Build a personal agent like Meta's Muse with Glove Foundry and deploy it on Kuiper: one agent per person in the app and on WhatsApp, with the name and style they give it, connected apps at the access the person chooses, a real browser of its own on Kuiper whose every request passes a separate Sentinel, sign-ins the person does in a live view, one-time cards typed in by host code, approvals, plans, long work, suggestions, forgetting, and a log of what it did and plans.",
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
        decides what may leave its computer. This page builds the same shape in Foundry, with a
        real browser for each person on Kuiper, and deploys it there.
      </p>
      <p>
        Meta Superintelligence Labs announced Muse on 8 September 2026; it runs on Meta&apos;s
        Muse Spark model. Here Muse runs on Claude Sonnet 5.5 and the Sentinel on Claude Haiku
        5.5, through Kuiper&apos;s model gateway once deployed.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          An independent example built from Meta&apos;s announcement and a hands-on review (sources
          at the end). It is not affiliated with or endorsed by Meta, and it is not how Muse is
          built. The code is in <a href={EXAMPLE}>examples/foundry-personal-agent</a>, and{" "}
          <code>pnpm verify</code> runs a day of it offline, against local servers, a local
          stand-in for Kuiper&apos;s browser API and sample sites.
        </p>
      </div>

      <h2 id="what">What Muse does</h2>
      <ul>
        <li><strong>You message it like a person</strong>, in the Muse app or directly in WhatsApp. You set its name, avatar and communication style.</li>
        <li><strong>It connects to your email, calendar and banks</strong> (through Plaid), and to partners such as Shopify, Walmart and Instacart. Read and write access are granted separately for each app.</li>
        <li><strong>It has a computer of its own</strong>, Muse Secure VM: a dedicated, isolated cloud VM with a browser you can watch. It fills forms and can negotiate for you.</li>
        <li><strong>A Sentinel guards that computer.</strong> It runs on the same machine, isolated from Muse, and nothing Muse does reaches the internet unless the Sentinel approves it. The Sentinel asks you when needed.</li>
        <li><strong>It can&apos;t see your passwords or payment methods.</strong> Credentials for the services you connect are stored in its VM; reusing your logins through 1Password is &ldquo;coming soon&rdquo;. It checks out with Stripe&apos;s Link, whose agent wallet issues single-use cards, so your real card number stays hidden.</li>
        <li><strong>It checks with you</strong> before sending an email or buying something.</li>
        <li><strong>It plans.</strong> It turns a goal into a personal plan, and keeps working after you close the app, coming back when something changes or it needs your OK.</li>
        <li><strong>It remembers what matters</strong> and suggests things unprompted, forgets what you tell it to, and keeps a complete log of everything it has done and plans to do.</li>
      </ul>

      <h2 id="flow">How work moves</h2>
      <MuseStory />

      <h2 id="map">Each feature, as a Foundry primitive</h2>
      <table>
        <thead><tr><th>Meta Muse</th><th>Foundry</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>One Muse, in the app and on WhatsApp</td><td>One instance per person; conversations <code>app</code> and <code>whatsapp</code>; one memory</td><td><code>lib/people.ts</code></td></tr>
          <tr><td>Its name, avatar and style</td><td>The instance&apos;s name and <code>context.persona</code>, from the person; the prompt reads them</td><td><code>lib/people.ts</code>, <code>agents/muse/prompt.ts</code></td></tr>
          <tr><td>WhatsApp</td><td>A Foundry app with a transmission each way; a playbook per person filtered to their number</td><td><code>agents/muse/apps/whatsapp.app.ts</code></td></tr>
          <tr><td>Read and write access per app</td><td>The installation&apos;s <code>config.access</code>: the app&apos;s tool policy hides writes, the send binding is off</td><td><code>lib/connect.ts</code>, <code>lib/mcp-servers.ts</code></td></tr>
          <tr><td>Its own computer, with a browser you can watch</td><td>A real Chrome per person on Kuiper, mounted with <code>glove-execution/kuiper</code>, kept between runs, recorded; its view-only live view kept for her app</td><td><code>agents/muse/browser.ts</code></td></tr>
          <tr><td>The Sentinel</td><td>The browser&apos;s guard, on every request it makes, with rules in code and its own model from <code>glove-classifier</code>; reading a site and sending to it are separate grants</td><td><code>agents/muse/sentinel.ts</code></td></tr>
          <tr><td>The Sentinel asks you</td><td><code>request_access</code>, which waits for approval only when the Sentinel said ask</td><td><code>agents/muse/sentinel.ts</code></td></tr>
          <tr><td>It can&apos;t see your passwords</td><td><code>browser.handOff</code> sends her Kuiper&apos;s live view; she signs in, and her browser profile keeps the login</td><td><code>agents/muse/browser.ts</code></td></tr>
          <tr><td>Asks before sending or buying</td><td>Gmail&apos;s send and <code>buy</code> have <code>requiresPermission</code></td><td><code>agents/muse/tools.ts</code></td></tr>
          <tr><td>Single-use cards from Link</td><td><code>buy</code> gets a one-time card, and host code types it into the checkout in a tab Muse never sees</td><td><code>lib/payments.ts</code></td></tr>
          <tr><td>Turns a goal into a plan</td><td><Link href="/foundry/docs/guidance">Goals</Link> at instance scope, one goal per plan, one item per step</td><td><code>lib/memory.ts</code></td></tr>
          <tr><td>Keeps working, comes back when something changes</td><td><code>glove_foundry_schedule</code> and <code>glove_foundry_sleep</code>; new mail through the Gmail watch</td><td><code>agents/muse/playbook.ts</code></td></tr>
          <tr><td>Remembers, suggests, and forgets when told</td><td><code>defineMemory</code>; a daily <code>suggest</code> schedule; <code>glove_context_set</code> and <code>glove_context_unset</code></td><td><code>agents/muse/agent.ts</code>, <code>agents/muse/muse.memory.ts</code></td></tr>
          <tr><td>A log of what it did and plans</td><td>A subscriber, the Sentinel and the browser&apos;s host code write what it did; schedules, open plan steps and pending approvals are its plans</td><td><code>lib/activity.ts</code></td></tr>
        </tbody>
      </table>

      <Blueprint
        uses={["Definitions", "Instances", "Conversations", "Installable capabilities", "Applications and connections", "MCP servers", "Transmissions", "Playbooks", "Code as the tool surface", "Browsers", "Classifiers", "Permission gates", "Approvals", "Memory", "Goals", "Subscribers", "Schedules", "Schedule management", "Request authorization", "Model gateway", "Persistent disk", "Kuiper browsers"]}
        write={["Your account store and OAuth callback", "The Sentinel's rules", "The card issuer and the WhatsApp webhook", "The scripted model, and a stand-in for Kuiper's browser API with sample sites, for offline runs"]}
      />

      <h2 id="step-1">1. One Muse per person, in two places</h2>
      <p>
        Each person gets one Muse in their own workspace. The name they give it, who they are,
        their WhatsApp number, how they want it to talk and the sites they have allowed are its
        data. The prompt says <code>{"You are ${name}"}</code> and adds their style, the way the Dots
        rebuild names each dot. It has two conversations and one memory, so what Rosa says on
        WhatsApp it knows in the app:
      </p>
      <CodeBlock
        filename="lib/people.ts"
        language="typescript"
        code={`export function museFor(person: Person): CreateAgentInstanceOptions {
  return {
    id: museId(person.id),
    workspaceId: person.id,
    name: person.agentName ?? "Muse",
    description: \`\${person.name}'s personal agent\`,
    context: {
      name: person.name,
      phone: person.phone,
      persona: { avatar: person.avatar, style: person.style },   // your app shows the avatar
      sentinel: { read: [], write: [], blocked: [] },
    },
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
        every delivery. The web app&apos;s <code>/webhooks/whatsapp</code> route does both
        (<code>lib/whatsapp-webhook.ts</code>) and forwards each text message to Foundry&apos;s
        <code>whatsapp-in</code> route on loopback, in the same unit.
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

      <h2 id="step-3">3. Its own browser on Kuiper</h2>
      <p>
        Muse&apos;s browser is a real Chrome from <Link href="/foundry/docs/kuiper#services">Kuiper</Link>,
        mounted in <code>configure</code> with <code>kuiperBrowser</code> from{" "}
        <code>glove-execution/kuiper</code> and <code>kuiper.browsers</code> from{" "}
        <code>@kuiper-sh/sdk</code>. Muse drives it with <code>execute_browser</code>, one script
        for a whole errand. A Kuiper session belongs to the project, not the process, so the
        instance keeps two IDs as data, her profile and the session in use, and the next run
        reconnects to the same browser. It also keeps the session&apos;s view-only live view for
        her app&apos;s Watch link; the prompt never reads it. Muse&apos;s tabs add{" "}
        <code>MuseRebuild/1.0 (+…)</code> to the browser&apos;s own user agent, so sites can
        tell an agent is there; put your agent&apos;s name in <code>AGENT_TOKEN</code>:
      </p>
      <CodeBlock
        filename="agents/muse/browser.ts (excerpt)"
        language="typescript"
        code={`export function mountMuseBrowser(agent: IGloveRunnable, ctx: FoundryExecutionContext) {
  const gateway = kuiper();                                   // @kuiper-sh/sdk; no key, no browser
  if (!gateway) return;
  const saved = browserOf(ctx.agentInstance.context);         // { profileId, sessionId }
  const adapter = kuiperBrowser({
    browsers: gateway.browsers,
    sessionIds: saved.sessionId ? [saved.sessionId] : [],     // the browser it kept
    session: {
      profileId: saved.profileId, persistProfile: true,        // her logins, saved when it closes
      inactivityTimeout: 10 * 60_000,
      kuiper: { onInactive: "hibernate", record: true },       // sleeps when idle; recorded for a replay
    },
    cleanup: "keep",
    guard: sentinelFor(ctx).guard,                            // every request it makes
    connect: async (url) => {                                 // its tabs say they are an agent
      const browser = await chromium.connectOverCDP(url);
      await identify(browser);                                // the real user agent + AGENT_TOKEN
      return browser;
    },
    onHandOff: (handOff) => sendLiveView(ctx, handOff),       // to her on WhatsApp, never to Muse
    onOpen: (session) => remember(ctx, {
      sessionId: session.id, profileId: session.profileId,
      watchUrl: session.debugUrl,                             // view-only, for her app's Watch link
    }),
  });
  let close = () => adapter.close();
  ctx.onCleanup(() => close());
  const mounted = mountBrowser(agent, { adapter });
  close = () => mounted.close();
}`}
      />
      <p>
        A script Muse writes for the booking. The browser&apos;s requests go through the Sentinel
        as it runs:
      </p>
      <CodeBlock
        filename="execute_browser"
        language="javascript"
        code={`const b = browser.sessions()[0] ?? browser.open({});
browser.navigate({ sessionId: b.id, url: "https://bistro-luna.example/reserve" });
browser.interact({ sessionId: b.id, command: { op: "fill", target: { by: "label", value: "Party size" }, value: "4" } });
browser.interact({ sessionId: b.id, command: { op: "fill", target: { by: "label", value: "Time" }, value: "Friday 19:00" } });
const sent = browser.interact({ sessionId: b.id, command: { op: "click", target: { by: "role", role: "button", name: "Book" } } });
const page = browser.observe({ sessionId: b.id, mode: "text" });
({ url: sent.url, blocked: sent.blocked, page: page.content })`}
      />

      <h2 id="step-4">4. The Sentinel</h2>
      <p>
        <code>glove-execution/kuiper</code> calls the guard for every request the browser makes
        while Muse is connected, outside the page and outside Muse&apos;s model, before it leaves.
        A page loading, and anything that could write, gets a decision; a page&apos;s images and
        scripts only get the quick checks. The Sentinel behind it is kept apart from Muse on
        purpose. It never sees Muse&apos;s conversation, its reasoning or the pages it read, so a
        page that tells Muse what to do cannot talk the Sentinel round. It sees the request, what
        the person asked for in this run, and the sites they allowed:
      </p>
      <CodeBlock
        filename="agents/muse/sentinel.ts (excerpt)"
        language="typescript"
        code={`readonly guard = async ({ url, method, resourceType, navigation }: KuiperBrowserRequest) => {
  const writes = method !== "GET" && method !== "HEAD" || resourceType === "websocket";
  if (navigation || writes) return (await this.decide(url, resourceType === "websocket" ? "WEBSOCKET" : method)).verdict === "allow";
  return this.quickCheck(url, method);                                // blocked sites, personal data in the URL
};

async decide(url: URL, method: string): Promise<Decision> {
  const rules = await this.rules();                                   // { read, write, blocked }, by host
  const personal = personalDataIn(url);
  const decided = rules.blocked.includes(url.host) ? { verdict: "block", reason: "you blocked this site" }
    : personal && !rules.write.includes(url.host) ? { verdict: "block", reason: \`it would send \${personal} to a site you haven't allowed\` }
    : granted(rules, url.host, method) ? { verdict: "allow", reason: "you allowed this" }  // GET and HEAD need read; the rest need write
    : await judge(method, url, this.asked(), rules);                  // its own model: allow, ask or block
  await logActivity({ person: this.ctx.workspaceId, kind: "sentinel", what: \`\${method} \${url.host}\${url.pathname}\`, outcome: decided.verdict });
  return decided;
}`}
      />
      <p>
        <code>judge</code> is a separate small model answering one typed question through{" "}
        <code>llmClassifier</code> from <Link href="/docs/classifier">glove-classifier</Link>. A
        doubtful &ldquo;allow&rdquo; becomes &ldquo;ask&rdquo;. Without a model, reads pass and
        writes ask.
      </p>
      <p>
        A blocked page load fails with <code>blocked</code>, and a blocked form post shows in the
        click&apos;s result. The script learns that something was blocked, never why. So Muse calls{" "}
        <code>request_access</code>. It reads what the Sentinel decided in this run: a blocked
        request stays blocked and nobody is asked; an &ldquo;ask&rdquo; waits for Rosa&apos;s
        approval, and her yes is the only thing that adds a site. The approval says what it
        adds, reading the site or sending to it, and that must match what was stopped. Letting
        Muse read a site doesn&apos;t let it post there, and the Sentinel&apos;s model never lets a
        send through to a site without a write grant: that asks Rosa.
      </p>
      <CodeBlock
        filename="agents/muse/sentinel.ts (excerpt)"
        language="typescript"
        code={`requiresPermission: (input) => sentinel.decisionFor(hostOf(input.site))?.verdict === "ask",`}
      />

      <h2 id="step-5">5. She signs in herself</h2>
      <p>
        When a site wants Rosa signed in, or shows a CAPTCHA she chooses to do, Muse calls{" "}
        <code>browser.handOff</code> and stops.
        Host code sends her Kuiper&apos;s live view of that browser on WhatsApp, a link that takes
        clicks and keys, so the link never enters Muse&apos;s context. She signs in there; Muse
        never sees her password. The cookies stay in the browser, which waits (and hibernates
        if she takes a while). When she says she&apos;s done, the next run reconnects to the same
        session and books. When Muse closes it, her profile keeps the login for next time.
      </p>
      <p>
        Amazon barred Meta&apos;s Muse, saying it didn&apos;t identify itself. Here, when a site
        turns agents away, Muse stops and tells the person. Its prompt says: &ldquo;If a site
        says it doesn&apos;t allow automated agents, stop and tell Rosa; don&apos;t look for another
        way.&rdquo;
      </p>
      <CodeBlock
        filename="agents/muse/browser.ts (excerpt)"
        language="typescript"
        code={`async function sendLiveView(ctx, handOff: KuiperHandOff) {
  const name = ctx.agentInstance.name ?? "Muse";
  const text = \`\${name} needs you for one step: \${handOff.reason}. This link opens \${name}'s browser for you (it is yours only): \${handOff.url}\`;
  await sendText(process.env.WHATSAPP_TOKEN, { phoneNumberId, to: ctx.agentInstance.context.phone, text });
}`}
      />

      <h2 id="step-6">6. Sending and paying wait for her</h2>
      <p>
        Gmail&apos;s send asks for each email. <code>buy</code> asks for each purchase, with the
        checkout open in Muse&apos;s browser. Then it gets a one-time card for that merchant and
        amount, and host code types it into the checkout in a new tab and submits it. The tab
        closes, so no page Muse can look at, now or by going back, holds the number. The
        Sentinel lets that checkout through for this run only. Muse checks out with Stripe&apos;s
        Link, whose agent wallet issues single-use cards; here any issuer of single-use virtual
        cards fits:
      </p>
      <CodeBlock
        filename="agents/muse/tools.ts (excerpt)"
        language="typescript"
        code={`{
  name: "buy",
  requiresPermission: true,
  async do({ sessionId, ...purchase }) {
    const card = await issuer().issue(ctx.workspaceId, purchase);   // one charge, one merchant, one amount
    sentinelFor(ctx).purchaseAt(purchase.site);                     // she approved paying here
    const answered = await payAtCheckout(kuiper().browsers, sessionId, purchase, card);
    return { status: "success", data: { submitted: true, card: \`one-time card ending \${card.number.slice(-4)}\`, page: answered.page } };
  },
}`}
      />

      <h2 id="step-7">7. Plans, long work, suggestions and forgetting</h2>
      <ul>
        <li><strong>A goal becomes a plan.</strong> Plans are Foundry <Link href="/foundry/docs/guidance">goals</Link> at instance scope, so a plan made on WhatsApp is the same plan in the app: one goal per plan, one item per step. Asked to get Rosa ready for a half marathon, Muse starts a plan with <code>glove_goal_start</code>; it marks steps done with <code>glove_goal_update</code> and revises the plan when things change.</li>
        <li><strong>It keeps going.</strong> Asked to watch a train fare, Muse sets its own check with <code>glove_foundry_schedule</code> every six hours and messages Rosa on WhatsApp when the price drops. The schedule is Foundry&apos;s, so it survives restarts and shows up in the log as a plan.</li>
        <li><strong>News comes to her.</strong> The Gmail watch passes new mail into the app conversation. When Leo asks to move dinner, Muse tells Rosa on WhatsApp and offers to change the booking.</li>
        <li><strong>It suggests.</strong> Its prompt asks it to suggest something it remembers when that would help, and a daily <code>suggest</code> schedule on the instance runs a short pass over what it knows and its plans.</li>
        <li><strong>It forgets when told.</strong> Facts live in Glove memory as context entries. <code>glove_context_set</code> keeps one; <code>glove_context_unset</code> removes it, and the next answer no longer knows. Forgetting removes the fact from memory, and the log never held it: for memory tools it records only that memory changed. The messages where it came up stay: in the conversation, and what Muse sent in the log.</li>
      </ul>

      <h2 id="step-8">8. A log it can&apos;t leave anything out of</h2>
      <p>
        If the model wrote its own log, it could leave an entry out. Here the model writes none
        of it. A <Link href="/foundry/docs/capabilities#subscribers">subscriber</Link> records
        every tool call from Foundry&apos;s side of the run, the Sentinel records every decision,
        and the browser&apos;s host code records each browser it opens and each hand-off. What
        Muse plans is Foundry&apos;s own data: its schedules and wake-ups, the open steps of its
        plans, and the approvals waiting on her.
      </p>
      <CodeBlock
        filename="agents/muse/subscribers/activity.subscriber.ts (excerpt)"
        language="typescript"
        code={`export default defineSubscriber({
  description: "Muse's log of everything it does",
  create: ({ workspaceId }) => {
    const inputs = new Map();
    return {
      async record(type, data) {
        if (type === "tool_use") return void inputs.set(data.id, data.input);
        if (type !== "tool_use_result") return;
        const memory = data.tool_name.startsWith("glove_context_");    // a fact she has it forget stays out
        await logActivity({ person: workspaceId, kind: "tool", what: data.tool_name, outcome: data.result.status,
          detail: memory ? "memory changed" : JSON.stringify(inputs.get(data.call_id)) });
      },
    };
  },
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
5. the Sentinel: GET bistro-luna.example/ → allow; GET collect.example/c → block; GET bistro-luna.example/reserve → allow;
   POST bistro-luna.example/reserve → ask; allow sending to bistro-luna.example → the person allowed it; … POST bistro-luna.example/reserve → allow.
   She signed in in the live view. Booked Bistro Luna for 4 on Friday at 7 … (BL-2041). Her profile keeps the login.
   Her app could watch it; sites saw "MuseRebuild/1.0"; a read grant doesn't let it post.
6. Ordered from Fresh Market for Friday: $23.40 (FM-5521), paid with a one-time card ending 5363.
7. Here's the plan: register, three runs a week in your calendar, new shoes, travel to the start. I'll work through it with you.
   And it will check the train fare every 6 hours, on its own
8. new mail, to her WhatsApp: "Leo Martin asks to move Friday's dinner to 7:30. Want me to change the booking?"
9. after "forget": I don't know of anyone vegetarian.
10. the log: 23 tool calls, 12 Sentinel decisions and 3 browser events done, 6 planned (the fare watch, the daily suggestions,
    the plan's steps); Calendar disconnected`}
      />
      <p>
        Each browser in the run is a Chromium on your machine behind a stand-in for Kuiper&apos;s
        browser API, so <code>@kuiper-sh/sdk</code> and <code>glove-execution/kuiper</code> run
        unchanged. The run also checks that her password and the card number appear nowhere in
        Muse&apos;s data, the live view link only in the WhatsApp message to her, and the log
        nothing of what she had it forget. With no key
        Muse runs a short script instead of a model, so this checks the wiring, not the judgment. In step 5 the script follows the page&apos;s hidden instruction on
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
kuiper secrets set GOOGLE_CLIENT_SECRET=- GOOGLE_SERVICE_ACCOUNT_JSON=- FOUNDRY_TOKEN=- WEB_SESSION_SECRET=-
kuiper secrets set WHATSAPP_TOKEN=- WHATSAPP_APP_SECRET=- WHATSAPP_VERIFY_TOKEN=-
kuiper env set -u muse MUSE_DATA_DIR=/data \\
  'WEB_SESSION_SECRET=\${{secrets.WEB_SESSION_SECRET}}' WEB_URL=https://… \\
  'KUIPER_GATEWAY_KEY=\${{models.API_KEY}}' \\
  'BROWSERS_URL=\${{browsers.BASE_URL}}' \\
  GOOGLE_CLIENT_ID=… 'GOOGLE_CLIENT_SECRET=\${{secrets.GOOGLE_CLIENT_SECRET}}' \\
  GMAIL_PUBSUB_TOPIC=… GMAIL_PUBSUB_SUBSCRIPTION=… \\
  'GOOGLE_SERVICE_ACCOUNT_JSON=\${{secrets.GOOGLE_SERVICE_ACCOUNT_JSON}}' \\
  WHATSAPP_PHONE_NUMBER_ID=… 'WHATSAPP_TOKEN=\${{secrets.WHATSAPP_TOKEN}}' \\
  'WHATSAPP_APP_SECRET=\${{secrets.WHATSAPP_APP_SECRET}}' \\
  'WHATSAPP_VERIFY_TOKEN=\${{secrets.WHATSAPP_VERIFY_TOKEN}}' \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}'
kuiper deploy --source . -u muse --wait

# Register <WEB_URL>/webhooks/whatsapp with Meta.`}
      />
      <ul>
        <li><strong>One key, two services.</strong> The two references give the unit one gateway key for models and browsers. <code>@kuiper-sh/sdk</code> reads it for Muse&apos;s and the Sentinel&apos;s models and for each person&apos;s browser.</li>
        <li><strong>State</strong> (Muses, conversations, memory and plans, accounts and tokens, the Sentinel&apos;s lists, the log and each person&apos;s browser IDs) sits on the <code>/data</code> disk and survives redeploys. The browsers and profiles are Kuiper&apos;s: a redeploy reconnects to them.</li>
        <li><strong>One unit, one public port.</strong> The web app takes port 3000 and Foundry runs beside it on loopback. Meta&apos;s webhook is a route of the web app, and the Gmail watch pulls from inside the unit, so nothing else is public.</li>
      </ul>

      <h2 id="differences">Where it differs</h2>
      <ul>
        <li>Meta gives each person a dedicated VM. Here everyone&apos;s Muse shares one Foundry unit and its <code>/data</code> disk, with memory and the log kept per person; only the browser and its profile are each person&apos;s own.</li>
        <li>Muse&apos;s VM is more than a browser. Here the browser is the whole computer; to run code too, add a Kuiper sandbox with <code>kuiperSandbox</code> from <code>glove-execution/kuiper</code>.</li>
        <li>In Muse, nothing reaches the internet unless the Sentinel approves. Here the Sentinel guards the browser only; app reads and sends go through Foundry&apos;s apps, held to the access she chose and to approvals.</li>
        <li>The Sentinel sees what the browser sends while Muse is connected. Redirects follow the request it allowed, and while Rosa has the live view the browser is hers.</li>
        <li>Meta&apos;s Sentinel is an agent on the same machine that asks you when needed. Here it judges one request at a time, and its question reaches you through Muse&apos;s <code>request_access</code>. Only your approval changes what is allowed.</li>
        <li>You can change an app&apos;s access or disconnect it at any time here (<code>setAccess</code>, <code>disconnect</code>); both are writes, not deploys.</li>
        <li>The checkout&apos;s card fields are found by their standard autocomplete names; a checkout that keeps them in its payment provider&apos;s frame needs that frame here.</li>
        <li>
          This rebuild doesn&apos;t have Muse Charm, Realtime Avatar, phone calling, bank access
          through Plaid or an agent email address. Meta&apos;s glasses support is still rolling out.
          <ul>
            <li>Phone calls: Muse calls businesses for you (in testing). Foundry&apos;s <Link href="/foundry/docs/voice"><code>voiceCall</code></Link> over a phone provider could, opening by saying it is an AI agent calling for the person.</li>
            <li>Its own email address: a Kuiper inbox with a tagged address per person could carry it as a Foundry app.</li>
          </ul>
        </li>
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
