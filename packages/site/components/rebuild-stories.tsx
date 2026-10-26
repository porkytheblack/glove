// Step-through pictures for the rebuilds (/foundry/docs/rebuilds/*): how work
// moves through each system. Colours follow the docs: mint for agents (Glove),
// blue for what Foundry runs around them, grey for the outside world and the
// code you write.

import { FlowStory } from "./flow-story";

// ─── Grok Bot: one bot definition, every bot in data ─────────────────────────

export function CrewStory() {
  return (
    <FlowStory
      id="rgb"
      viewBox="0 0 936 352"
      label="Four sibling bots, all instances of one definition in Maya's workspace: a new bot names itself with take_job, a bot asks for an app and her account goes on every bot, Maya writes to Bug Triage directly, it hands the fix to Engineer over the mesh and the answer comes back, a group chat with no host reaches only the bots she mentions, skills are shared in the workspace, sending waits for approval, and new mail wakes each bot whose routine asks for it"
      boxes={[
        { id: "group", x: 16, y: 16, w: 170, h: 56, title: "Offsite crew", sub: "group chat · no host", tone: "system", dashed: true },
        { id: "maya", x: 258, y: 16, w: 170, h: 56, title: "Maya", sub: "the app" },
        { id: "sales", x: 16, y: 140, w: 170, h: 72, title: "Sales Outbound", sub: "was “New bot”", tone: "harness" },
        { id: "triage", x: 258, y: 140, w: 170, h: 72, title: "Bug Triage", sub: "routine: new mail", tone: "harness" },
        { id: "engineer", x: 500, y: 140, w: 170, h: 72, title: "Engineer", sub: "fixes on a branch", tone: "harness" },
        { id: "inbox", x: 742, y: 140, w: 170, h: 72, title: "Inbox Manager", sub: "routine: new mail", tone: "harness" },
        { id: "workspace", x: 16, y: 284, w: 400, h: 56, title: "Workspace: maya", sub: "accounts · skills · one computer", tone: "system", dashed: true },
        { id: "approval", x: 500, y: 284, w: 170, h: 56, title: "Approval", sub: "Maya says yes", tone: "system" },
        { id: "apps", x: 742, y: 284, w: 170, h: 56, title: "Her apps", sub: "Gmail · Linear" },
      ]}
      edges={[
        { id: "posts", d: "M258,44 L190,44", label: "posts", lx: 224, ly: 36 },
        { id: "m-sales", d: "M101,72 L101,136", label: "@mention", lx: 109, ly: 108, anchor: "start" },
        { id: "m-triage", d: "M186,60 L222,60 L222,118 L300,118 L300,136", label: "@mention", lx: 228, ly: 112, anchor: "start" },
        { id: "direct", d: "M390,72 L390,136", label: "writes to", lx: 398, ly: 108, anchor: "start" },
        { id: "tells", d: "M340,136 L340,76", label: "tells", lx: 334, ly: 92, anchor: "end" },
        { id: "fix", d: "M428,164 L496,164", label: "fix it", lx: 462, ly: 156 },
        { id: "fixed", d: "M496,196 L432,196", label: "fixed", lx: 464, ly: 212 },
        { id: "write", d: "M101,212 L101,280", label: "writes", lx: 109, ly: 250, anchor: "start" },
        { id: "connect", d: "M400,212 L400,240 L585,240 L585,280", label: "connect_app", lx: 492, ly: 234 },
        { id: "gate", d: "M160,212 L160,258 L540,258 L540,280", label: "Gmail send", lx: 300, ly: 252 },
        { id: "mail-inbox", d: "M827,284 L827,216", label: "new mail", lx: 835, ly: 254, anchor: "start" },
        { id: "mail-triage", d: "M912,312 L926,312 L926,124 L410,124 L410,136", label: "new mail", lx: 668, ly: 118 },
      ]}
      steps={[
        {
          lit: ["sales", "workspace", "write"],
          packet: { edge: "write", label: "take_job" },
          title: "A new bot names itself",
          text: (
            <>
              Maya makes a bot: one <code>createAgent</code> call with no name or job. It asks what
              she wants it around for. She says overnight outbound, so it calls{" "}
              <code>take_job</code>, which writes a name and a description to its own instance.
              &ldquo;New bot&rdquo; is now Sales Outbound, with her connected apps. Nothing was deployed.
            </>
          ),
        },
        {
          lit: ["triage", "workspace", "approval", "connect"],
          packet: { edge: "connect", label: "Linear" },
          title: "Apps belong to Maya, not to a bot",
          text: (
            <>
              Bug Triage needs Linear, so it asks with <code>connect_app</code>. Maya signs in to
              Linear once; her account is saved in your store and the Linear app is installed with
              it on every one of her bots.
            </>
          ),
        },
        {
          lit: ["maya", "triage", "direct"],
          packet: { edge: "direct", label: "export crashes" },
          title: "Maya writes to the bot whose job it is",
          text: (
            <>
              The bots are siblings: one definition, different data, and nothing routing between
              them. Maya writes to Bug Triage in its own chat. That message is what starts it.
            </>
          ),
        },
        {
          lit: ["triage", "engineer", "fix"],
          packet: { edge: "fix", label: "ENG-1" },
          title: "Siblings hand work to each other",
          text: (
            <>
              Bug Triage files the issue in Linear (Maya always allows that), finds Engineer with{" "}
              <code>glove_mesh_list_agents</code> and hands it the fix with{" "}
              <code>glove_mesh_send_message</code>. That handoff is what starts Engineer.
            </>
          ),
        },
        {
          lit: ["engineer", "triage", "fixed"],
          packet: { edge: "fixed", label: "Patched" },
          title: "Answers come back on their own",
          text: (
            <>
              Engineer&apos;s final answer goes back to the conversation that sent it the work, as a
              new turn. Nobody checks in.
            </>
          ),
        },
        {
          lit: ["triage", "maya", "tells"],
          packet: { edge: "tells", label: "fixed" },
          title: "Bug Triage tells Maya",
          text: <>In its own chat, in a sentence or two: filed as ENG-1, fixed on a branch, with a test.</>,
        },
        {
          lit: ["maya", "group", "sales", "triage", "posts", "m-sales", "m-triage"],
          packet: { edge: "m-sales", label: "@Sales Outbound" },
          title: "A group chat has no host",
          text: (
            <>
              Each member keeps its own conversation for the Offsite crew chat, and the app shows
              them merged. Maya&apos;s message goes to the bots it @-mentions, so Sales Outbound and
              Bug Triage answer and Inbox Manager, not mentioned, stays quiet. @everyone, or no
              mention at all, reaches every member.
            </>
          ),
        },
        {
          lit: ["sales", "workspace", "write"],
          packet: { edge: "write", label: "save_skill" },
          title: "One skill library, routines per bot",
          text: (
            <>
              Maya describes her Monday signup sweep. <code>save_skill</code> waits for her review,
              then stores it in her workspace for every bot. The routine belongs to Sales Outbound:
              a schedule it sets with <code>glove_foundry_schedule</code>. A routine after an event
              is data on the bot, written by <code>add_routine</code>.
            </>
          ),
        },
        {
          lit: ["sales", "approval", "gate"],
          packet: { edge: "gate", label: "intro to Dana" },
          title: "Anything that goes out waits",
          text: (
            <>
              Sales Outbound finds the signups with <code>gmail.search_threads</code> in code, then
              calls the Gmail send. Foundry holds the run with the exact email until Maya approves,
              then delivers it from her address in its own process. <code>request_sign_in</code>{" "}
              works the same way: approving it is Maya signing in, and the bot never sees the
              password.
            </>
          ),
        },
        {
          lit: ["apps", "inbox", "triage", "mail-inbox", "mail-triage"],
          packet: { edge: "mail-inbox", label: "Lena: pricing?" },
          title: "New mail wakes the bots whose routines ask",
          text: (
            <>
              The Gmail app&apos;s connection watches Maya&apos;s inbox and passes each new message in.
              Inbox Manager and Bug Triage each have a routine on new mail, so both wake, each in
              its own chat: Bug Triage passes (not a bug), and Inbox Manager replies in Lena&apos;s
              thread once Maya approves.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── One connected app: reads, sends and events through a Foundry app ────────

export function ConnectedAppStory() {
  return (
    <FlowStory
      id="rca"
      viewBox="0 0 932 300"
      label="A connected app has three parts, all opened with the person's account: reads go to the provider's MCP server from code, sends wait for approval and Foundry delivers them to the provider's API, and new mail arrives through a connection and a playbook"
      boxes={[
        { id: "bot", x: 16, y: 110, w: 150, h: 80, title: "A bot", sub: "Maya's", tone: "harness" },
        { id: "mcp", x: 330, y: 16, w: 200, h: 64, title: "gmail app · mcp", sub: "reads, drafts", tone: "system" },
        { id: "outbound", x: 330, y: 118, w: 200, h: 64, title: "gmail app · outbound", sub: "send, after approval", tone: "system" },
        { id: "connection", x: 330, y: 220, w: 200, h: 64, title: "gmail app · connection", sub: "gmail-watch", tone: "system" },
        { id: "server", x: 620, y: 16, w: 140, h: 64, title: "Gmail MCP server", sub: "Google" },
        { id: "api", x: 620, y: 118, w: 140, h: 64, title: "Gmail API", sub: "messages.send" },
        { id: "push", x: 620, y: 220, w: 140, h: 64, title: "Gmail push", sub: "Pub/Sub" },
        { id: "sessions", x: 792, y: 118, w: 124, h: 64, title: "accountSessions", sub: "your tokens", dashed: true },
      ]}
      edges={[
        { id: "read", d: "M166,130 L214,130 L214,48 L326,48", label: "in code", lx: 270, ly: 40 },
        { id: "call", d: "M530,48 L616,48", label: "bearer", lx: 573, ly: 40 },
        { id: "send", d: "M166,150 L326,150", label: "send", lx: 246, ly: 144 },
        { id: "deliver", d: "M530,150 L616,150", label: "delivers", lx: 573, ly: 144 },
        { id: "token", d: "M792,150 L764,150" },
        { id: "notify", d: "M616,252 L534,252", label: "watch", lx: 575, ly: 246 },
        { id: "event", d: "M326,262 L91,262 L91,194", label: "new mail", lx: 208, ly: 278 },
      ]}
      steps={[
        {
          lit: ["bot", "mcp", "server", "read", "call"],
          packet: { edge: "read", label: "search_threads" },
          title: "Reads run in code",
          text: (
            <>
              The app&apos;s MCP server is opened with the installation&apos;s account. Its reads are
              functions in the bot&apos;s REPL, grouped under the app, so one program can search,
              read and filter, and only the answer comes back into context.
            </>
          ),
        },
        {
          lit: ["bot", "outbound", "api", "send", "deliver"],
          packet: { edge: "send", label: "email to Dana" },
          title: "Sends wait, then Foundry delivers",
          text: (
            <>
              Google&apos;s server has no send, and a send should not run inside the agent anyway.
              The transmission&apos;s send tool waits for Maya to approve the exact email; Foundry
              then delivers it in its own process, for a bot whose binding grants it.
            </>
          ),
        },
        {
          lit: ["push", "connection", "bot", "notify", "event"],
          packet: { edge: "notify", label: "historyId" },
          title: "New mail comes in",
          text: (
            <>
              Foundry runs the connection once per connected account. It renews{" "}
              <code>users.watch</code>, pulls Gmail&apos;s notifications, reads what arrived with{" "}
              <code>history.list</code> and passes each message in; a playbook decides which bot
              hears it.
            </>
          ),
        },
        {
          lit: ["mcp", "outbound", "connection", "sessions", "token"],
          title: "One account, one boundary",
          text: (
            <>
              All three parts ask <code>accountSessions</code> for an operation on Maya&apos;s
              account: <code>mcp:connect</code>, <code>gmail:send</code>, <code>gmail:watch</code>.
              Her tokens stay in your store and are refreshed there. Foundry never holds them.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── Claude Duet: one partner, its own clock, one thread ─────────────────────

export function PartnerStory() {
  return (
    <FlowStory
      id="rcd"
      viewBox="0 0 932 290"
      label="Schedules wake the partner in one thread; it reads the person's apps, notifies their phone through a guard only when something needs them, waits for approval before paying, refuses to send card numbers, and hands long jobs to its computer over the mesh"
      boxes={[
        { id: "clock", x: 16, y: 16, w: 140, h: 64, title: "Schedules", sub: "07:30 · every 3h", tone: "system" },
        { id: "person", x: 16, y: 113, w: 140, h: 64, title: "You", sub: "chat or call" },
        { id: "apps", x: 16, y: 210, w: 140, h: 64, title: "Gmail · Calendar", sub: "connected apps" },
        { id: "partner", x: 246, y: 100, w: 190, h: 90, title: "Partner", sub: "one thread · memory", tone: "harness" },
        { id: "guard", x: 526, y: 16, w: 140, h: 64, title: "Guard", sub: "your code", dashed: true },
        { id: "approval", x: 526, y: 113, w: 140, h: 64, title: "Approval", sub: "send · pay · sign", tone: "system" },
        { id: "computer", x: 526, y: 210, w: 140, h: 64, title: "Computer", sub: "files · web", tone: "harness" },
        { id: "phone", x: 776, y: 16, w: 140, h: 64, title: "Your phone", sub: "push" },
        { id: "world", x: 776, y: 113, w: 140, h: 64, title: "The world", sub: "payments, messages" },
      ]}
      edges={[
        { id: "wake", d: "M156,48 L300,48 L300,96", label: "wakes it", lx: 228, ly: 42 },
        { id: "talk", d: "M156,135 L242,135", label: "asks", lx: 199, ly: 129 },
        { id: "read", d: "M156,242 L300,242 L300,194", label: "reads · new mail", lx: 228, ly: 236 },
        { id: "notify", d: "M380,96 L380,48 L522,48", label: "notify_person", lx: 451, ly: 42 },
        { id: "push", d: "M666,48 L772,48", label: "allowed", lx: 719, ly: 42 },
        { id: "act", d: "M436,145 L522,145", label: "pay_invoice", lx: 479, ly: 139 },
        { id: "approved", d: "M666,145 L772,145", label: "approved", lx: 719, ly: 139 },
        { id: "handoff", d: "M380,194 L380,242 L522,242", label: "mesh", lx: 451, ly: 236 },
        { id: "done", d: "M522,262 L340,262 L340,194", label: "reply", lx: 431, ly: 278 },
      ]}
      steps={[
        {
          lit: ["clock", "partner", "wake"],
          packet: { edge: "wake", label: "morning-brief" },
          title: "07:30: the morning brief",
          text: (
            <>
              A schedule in the person&apos;s time zone starts a run in their one thread. Nobody
              opened the app.
            </>
          ),
        },
        {
          lit: ["apps", "partner", "read"],
          packet: { edge: "read", label: "inbox + calendar" },
          title: "It reads your apps",
          text: (
            <>
              Gmail and Calendar are apps installed with your accounts. The brief reads both in one
              program, <code>gmail.search_threads</code> and <code>calendar.list_events</code>, through
              Google&apos;s MCP servers. Your tokens stay in your store; the agent gets results.
            </>
          ),
        },
        {
          lit: ["partner", "guard", "phone", "notify", "push"],
          packet: { edge: "notify", label: "Morning brief" },
          title: "One brief to your phone",
          text: (
            <>
              <code>notify_person</code> is the only way to your phone, and everything it sends
              passes the guard first.
            </>
          ),
        },
        {
          lit: ["clock", "partner", "wake"],
          packet: { edge: "wake", label: "check-in" },
          title: "Every few hours, a quiet look",
          text: (
            <>
              A check-in that finds nothing new sends nothing. The run ends with{" "}
              <code>(nothing new)</code> and your phone stays quiet.
            </>
          ),
        },
        {
          lit: ["apps", "partner", "read", "notify", "guard", "push", "phone"],
          packet: { edge: "read", label: "payment failed" },
          title: "Something needs you",
          text: <>A failed payment lands in your Gmail, and the app&apos;s connection passes it into the thread at once. It notifies you once, saying what and why; mail that can wait gets nothing.</>,
        },
        {
          lit: ["person", "partner", "talk"],
          packet: { edge: "talk", label: "pay it" },
          title: "You answer in the same thread",
          text: <>The brief, the check-ins and your reply are all one conversation, so it knows what &ldquo;it&rdquo; is.</>,
        },
        {
          lit: ["partner", "approval", "world", "act", "approved"],
          packet: { edge: "act", label: "$240 to Acme" },
          title: "Paying waits for your yes",
          text: (
            <>
              <code>pay_invoice</code> has <code>requiresPermission</code>. Foundry records the exact
              payment and holds the run; it pays only after you approve.
            </>
          ),
        },
        {
          lit: ["partner", "guard", "notify"],
          packet: { edge: "notify", label: "4242 4242 …" },
          title: "Some things never leave",
          text: (
            <>
              Asked to email your card number, it is refused by the guard, a Luhn check in code around Gmail&apos;s send.
              Because the guard would refuse it, you are not asked to approve it either.
            </>
          ),
        },
        {
          lit: ["partner", "computer", "handoff", "done"],
          packet: { edge: "handoff", label: "build dashboard" },
          title: "Long jobs go to its computer",
          text: (
            <>
              The computer is another agent in the person&apos;s workspace, with its own saved files
              and the web. The partner messages it on the mesh, and its reply comes back to the
              thread as a new turn.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── OpenAI Dots: standing agents with a responsibility ──────────────────────

export function StandingAgentStory() {
  return (
    <FlowStory
      id="rod"
      viewBox="0 0 932 290"
      label="A dot the person names holds their responsibilities and Custom Rules, researches on a schedule with read-only tools, talks in the app, Slack or a call with one memory, works on its own computer, sends every action through an auto-review that allows it, asks, or hands it to the person, and starts coding jobs on a builder over the mesh"
      boxes={[
        { id: "brief", x: 16, y: 16, w: 150, h: 64, title: "Responsibilities", sub: "jobs · sources · must not" },
        { id: "rules", x: 16, y: 113, w: 150, h: 64, title: "Custom Rules", sub: "allow · ask · block" },
        { id: "clock", x: 16, y: 210, w: 150, h: 64, title: "Schedule", sub: "research every 2h", tone: "system" },
        { id: "dot", x: 256, y: 100, w: 180, h: 90, title: "Pip", sub: "Sam's dot · its own computer", tone: "harness" },
        { id: "channels", x: 526, y: 16, w: 150, h: 64, title: "App · Slack · call", sub: "a thread per channel", tone: "system" },
        { id: "review", x: 526, y: 113, w: 150, h: 64, title: "Auto-review", sub: "rules + safety", dashed: true },
        { id: "builder", x: 526, y: 210, w: 150, h: 64, title: "Builder", sub: "coding jobs", tone: "harness" },
        { id: "person", x: 776, y: 16, w: 140, h: 64, title: "You", sub: "app · Slack · call" },
        { id: "outcome", x: 776, y: 113, w: 140, h: 64, title: "Outcome", sub: "runs · asks · yours", tone: "system" },
      ]}
      edges={[
        { id: "shapes", d: "M166,48 L310,48 L310,96", label: "prompt", lx: 238, ly: 42 },
        { id: "context", d: "M166,145 L252,145", label: "context", lx: 209, ly: 139 },
        { id: "research", d: "M166,242 L310,242 L310,194", label: "read-only run", lx: 238, ly: 236 },
        { id: "chat", d: "M772,40 L680,40", label: "message", lx: 726, ly: 34 },
        { id: "inbound", d: "M522,48 L400,48 L400,96", label: "same dot", lx: 461, ly: 42 },
        { id: "act", d: "M436,145 L522,145", label: "act?", lx: 479, ly: 139 },
        { id: "decide", d: "M676,145 L772,145", label: "decide", lx: 724, ly: 139 },
        { id: "update", d: "M680,64 L772,64", label: "update", lx: 726, ly: 80 },
        { id: "handoff", d: "M380,194 L380,242 L522,242", label: "mesh", lx: 451, ly: 236 },
        { id: "result", d: "M522,262 L340,262 L340,194", label: "reply", lx: 431, ly: 278 },
      ]}
      steps={[
        {
          lit: ["brief", "dot", "shapes"],
          packet: { edge: "shapes", label: "track feedback" },
          title: "You name it and give it responsibilities",
          text: (
            <>
              Sam&apos;s primary dot is an instance of one definition, and he named it Pip. Its
              ongoing responsibilities (what to keep true, which sources to read, what must not
              happen yet) are instance data, and its prompt is built from them.
            </>
          ),
        },
        {
          lit: ["clock", "dot", "research"],
          packet: { edge: "research", label: "every 2h" },
          title: "Between conversations, it researches",
          text: (
            <>
              A schedule wakes it for proactive research, and new mail wakes it too. On these runs it
              gets only reads: #feedback, and the mailbox through the Gmail app in code. It keeps
              notes and may suggest one thing. Acting tools, Gmail&apos;s send, the mesh and its
              computer are not there to misuse.
            </>
          ),
        },
        {
          lit: ["person", "channels", "dot", "chat", "inbound"],
          packet: { edge: "chat", label: "Slack DM" },
          title: "It talks where you are",
          text: (
            <>
              The app, Slack and a call are conversations on the same instance, so each keeps its
              own history while memory is shared. Slack messages arrive through a transmission
              that only lets its owner in.
            </>
          ),
        },
        {
          lit: ["rules", "dot", "review", "context", "act"],
          packet: { edge: "act", label: "Gmail send" },
          title: "Before it acts, a review",
          text: (
            <>
              Every acting tool is wrapped, and so is the Gmail app&apos;s send. The auto-review reads
              your Custom Rule for that action, checks built-in safety, and checks the input against
              your instructions, such as an email to someone who never wrote in to the mailbox.
            </>
          ),
        },
        {
          lit: ["review", "outcome", "decide"],
          packet: { edge: "decide", label: "ask" },
          title: "It runs, asks, or hands it to you",
          text: (
            <>
              &ldquo;Allow&rdquo; runs. &ldquo;Ask&rdquo; becomes a Foundry approval.
              &ldquo;Block&rdquo; does not run and tells you what to do yourself. Changing a password
              is always yours, whatever the rules say.
            </>
          ),
        },
        {
          lit: ["dot", "channels", "person", "update", "inbound"],
          packet: { edge: "update", label: "decision" },
          title: "Updates go where you route them",
          text: <>Routine progress can go to the app and decisions to Slack, set per dot.</>,
        },
        {
          lit: ["dot", "builder", "handoff", "result"],
          packet: { edge: "handoff", label: "weekly report" },
          title: "Coding jobs start on the builder",
          text: (
            <>
              Pip works on its own computer, and starts bigger coding jobs on Sam&apos;s builder
              over the mesh, the way a dot starts a task in Codex. It checks the reply and
              reports. Research runs get no mesh tools at all.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── Meta Muse: one agent, two places, a browser behind a Sentinel ───────────

export function MuseStory() {
  return (
    <FlowStory
      id="rmm"
      viewBox="0 0 936 344"
      label="Rosa reaches one Muse in the app and on WhatsApp; it reads her apps in code at the access she chose; it drives its own browser on Kuiper, where every request passes the Sentinel, which allows reading a page, blocks a hidden instruction to send her email address elsewhere and asks her before booking; when the site wants her signed in, she gets the browser's live view and signs in herself; sending and paying wait for her; and every tool call is written to its log"
      boxes={[
        { id: "app", x: 16, y: 16, w: 170, h: 56, title: "Rosa", sub: "the Muse app" },
        { id: "whatsapp", x: 16, y: 136, w: 170, h: 56, title: "WhatsApp", sub: "her number only" },
        { id: "log", x: 16, y: 272, w: 170, h: 56, title: "The log", sub: "done · planned", tone: "system", dashed: true },
        { id: "muse", x: 268, y: 120, w: 180, h: 88, title: "Muse", sub: "one per person · one memory", tone: "harness" },
        { id: "approval", x: 268, y: 272, w: 180, h: 56, title: "Approval", sub: "Rosa says yes", tone: "system" },
        { id: "apps", x: 530, y: 16, w: 170, h: 56, title: "Her apps", sub: "read, or read and act" },
        { id: "computer", x: 530, y: 136, w: 170, h: 56, title: "Its browser", sub: "real Chrome on Kuiper", tone: "harness" },
        { id: "vault", x: 530, y: 272, w: 170, h: 56, title: "Live view", sub: "Rosa signs in herself", dashed: true },
        { id: "web", x: 762, y: 16, w: 158, h: 56, title: "The web", sub: "sites" },
        { id: "sentinel", x: 762, y: 136, w: 158, h: 56, title: "Sentinel", sub: "allow · ask · block", tone: "system" },
      ]}
      edges={[
        { id: "ask", d: "M186,44 L300,44 L300,116", label: "asks", lx: 243, ly: 36 },
        { id: "wa-in", d: "M186,152 L264,152", label: "messages", lx: 225, ly: 144 },
        { id: "wa-out", d: "M264,184 L190,184", label: "answers", lx: 227, ly: 200 },
        { id: "read", d: "M420,116 L420,44 L526,44", label: "reads in code", lx: 473, ly: 36 },
        { id: "run", d: "M448,164 L526,164", label: "drives", lx: 487, ly: 156 },
        { id: "request", d: "M700,164 L758,164", label: "request", lx: 731, ly: 156 },
        { id: "out", d: "M841,136 L841,76", label: "allowed", lx: 849, ly: 110, anchor: "start" },
        { id: "login", d: "M615,196 L615,268", label: "handOff", lx: 623, ly: 240, anchor: "start" },
        { id: "gate", d: "M358,208 L358,268", label: "send · buy · ask", lx: 366, ly: 244, anchor: "start" },
        { id: "logged", d: "M300,208 L300,240 L101,240 L101,268", label: "every tool call", lx: 200, ly: 234, dashed: true },
      ]}
      steps={[
        {
          lit: ["app", "whatsapp", "muse", "ask", "wa-in", "wa-out"],
          packet: { edge: "wa-in", label: "Priya is vegetarian" },
          title: "One Muse, two places",
          text: (
            <>
              Rosa&apos;s Muse is one instance with two conversations, <code>app</code> and{" "}
              <code>whatsapp</code>, and one memory. What she says on WhatsApp it knows in the app.
              WhatsApp is a Foundry app: her messages come in on Muse&apos;s number, and answers go
              out on a route that only reaches her.
            </>
          ),
        },
        {
          lit: ["muse", "apps", "read"],
          packet: { edge: "read", label: "calendar.list_events" },
          title: "Her apps, at the access she chose",
          text: (
            <>
              Gmail and Calendar are Foundry apps installed with her accounts. Muse reads them in
              code, one program for both. Gmail is read only, so the app hides every write and Muse
              has no send tool at all, until she gives it send access: one write to the
              installation, no deploy.
            </>
          ),
        },
        {
          lit: ["muse", "computer", "run"],
          packet: { edge: "run", label: "execute_browser" },
          title: "Its own browser",
          text: (
            <>
              To book dinner it drives its own browser, a real Chrome on Kuiper that lasts between
              runs, in one script: open the page, read it, fill the form, click, check the result.
            </>
          ),
        },
        {
          lit: ["computer", "sentinel", "web", "request", "out"],
          packet: { edge: "request", label: "GET bistro-luna" },
          title: "Every request passes the Sentinel",
          text: (
            <>
              The browser&apos;s guard calls the Sentinel for every request the browser makes,
              outside the page and outside Muse&apos;s model. Reading the restaurant&apos;s page
              plainly serves what Rosa asked, so it loads.
            </>
          ),
        },
        {
          lit: ["computer", "sentinel", "request"],
          packet: { edge: "request", label: "collect.example?email=…" },
          title: "A page can't talk the Sentinel round",
          text: (
            <>
              The page hides an instruction to send Rosa&apos;s email address to another site. Even
              if Muse followed it, the Sentinel never read the page: it sees a request carrying an
              email address to a site she never allowed, and blocks it.
            </>
          ),
        },
        {
          lit: ["sentinel", "muse", "approval", "gate"],
          packet: { edge: "gate", label: "request_access" },
          title: "The Sentinel asks Rosa",
          text: (
            <>
              Booking posts a form to a site she hasn&apos;t allowed, so the Sentinel says ask. Muse calls{" "}
              <code>request_access</code>, which waits for Rosa only because the Sentinel asked. Her
              yes adds the site to her list; nothing else can.
            </>
          ),
        },
        {
          lit: ["computer", "vault", "login"],
          packet: { edge: "login", label: "handOff" },
          title: "She signs in herself",
          text: (
            <>
              The site wants her signed in. Muse calls <code>browser.handOff</code>, and host code
              sends Rosa Kuiper&apos;s live view of the browser on WhatsApp. She signs in there; Muse
              never sees the link or her password, and her profile keeps the login for next time.
            </>
          ),
        },
        {
          lit: ["muse", "approval", "gate"],
          packet: { edge: "gate", label: "buy $23.40" },
          title: "Sending and paying wait for her",
          text: (
            <>
              Gmail&apos;s send asks for each email; <code>buy</code> asks for each purchase. Then host
              code types a one-time card into the checkout, in a tab Muse never sees. Muse sees the
              last four digits.
            </>
          ),
        },
        {
          lit: ["muse", "log", "logged"],
          packet: { edge: "logged", label: "buy · success" },
          title: "A log it can't leave anything out of",
          text: (
            <>
              A subscriber writes every tool call from Foundry&apos;s side of the run, the Sentinel
              writes every decision, and the browser&apos;s host code writes each hand-off. What Muse plans comes from Foundry too: its schedules,
              like the fare it checks every six hours, and the approvals waiting on Rosa.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── four shapes, side by side ───────────────────────────────────────────────

function Mini({ x, y, w, h, title, sub, tone = "neutral", dashed }: {
  x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: "harness" | "system" | "neutral"; dashed?: boolean;
}) {
  return (
    <g className={`dg-box tone-${tone}${dashed ? " dashed" : ""}`}>
      <rect x={x} y={y} width={w} height={h} rx={8} />
      <text x={x + w / 2} y={sub ? y + h / 2 - 3 : y + h / 2 + 5} textAnchor="middle" className="dg-title">{title}</text>
      {sub && <text x={x + w / 2} y={y + h / 2 + 15} textAnchor="middle" className="dg-sub">{sub}</text>}
    </g>
  );
}

function Arrow({ d, label, lx, ly, anchor = "middle", dashed }: { d: string; label?: string; lx?: number; ly?: number; anchor?: "start" | "middle" | "end"; dashed?: boolean }) {
  return (
    <g className={`dg-edge${dashed ? " dashed" : ""}`}>
      <path d={d} fill="none" markerEnd="url(#rshape-arrow)" />
      {label && <text x={lx} y={ly} textAnchor={anchor} className="dg-label">{label}</text>}
    </g>
  );
}

/** The four rebuilds as shapes: who you talk to, who works, what wakes them. */
export function RebuildShapes() {
  return (
    <figure className="dg-figure dg-wide">
      <div className="dg-scroll">
        <svg
          viewBox="0 0 936 300"
          role="img"
          className="dg-svg"
          aria-label="Four shapes. Grok Bot: sibling bots, all instances of one definition, each started by a message, a mention, a handoff over the mesh or its own routine. Claude Duet: one partner per person with its own clock and a computer it messages. OpenAI Dots: one dot per person that they name, reached from several channels, researching on a schedule, with an auto-review in front of every action. Meta Muse: one agent per person, in the app and on WhatsApp, with a browser of its own whose every request passes a separate Sentinel."
        >
          <defs>
            <marker id="rshape-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead" />
            </marker>
          </defs>

          <g className="tone-harness"><text x={120} y={22} textAnchor="middle" className="dg-group-label">Grok Bot · teammates</text></g>
          <Mini x={16} y={40} w={208} h={44} title="You" sub="chat · group chat" />
          <Arrow d="M120,84 L120,110" label="writes · @mentions" lx={128} ly={101} anchor="start" />
          <Mini x={16} y={112} w={208} h={50} title="Sibling bots" sub="one definition, data each" tone="harness" />
          <Mini x={16} y={202} w={100} h={50} title="Routines" sub="schedule, mail" tone="system" />
          <Mini x={124} y={202} w={100} h={50} title="Handoffs" sub="over the mesh" tone="harness" />
          <Arrow d="M66,202 L66,166" label="wakes" lx={58} ly={186} anchor="end" />
          <Arrow d="M174,166 L174,198" />
          <text x={120} y={284} textAnchor="middle" className="dg-sub">no bot above the others</text>

          <g className="tone-harness"><text x={352} y={22} textAnchor="middle" className="dg-group-label">Claude Duet · a partner</text></g>
          <Mini x={248} y={40} w={208} h={44} title="You" sub="one thread · chat or call" />
          <Arrow d="M352,84 L352,110" />
          <Mini x={272} y={112} w={160} h={50} title="Partner" sub="decides what matters" tone="harness" />
          <Mini x={248} y={202} w={100} h={50} title="Schedules" sub="brief, check-ins" tone="system" />
          <Mini x={356} y={202} w={100} h={50} title="Computer" sub="long jobs" tone="harness" />
          <Arrow d="M298,202 L318,166" label="wakes" lx={300} ly={182} anchor="end" />
          <Arrow d="M386,166 L406,198" label="mesh" lx={402} ly={180} anchor="start" />
          <text x={352} y={284} textAnchor="middle" className="dg-sub">reaches out first</text>

          <g className="tone-harness"><text x={584} y={22} textAnchor="middle" className="dg-group-label">OpenAI Dots · your dot</text></g>
          <Mini x={480} y={40} w={100} h={44} title="App" sub="thread" tone="system" />
          <Mini x={588} y={40} w={100} h={44} title="Slack" sub="thread" tone="system" />
          <Arrow d="M550,84 L566,110" />
          <Arrow d="M618,84 L602,110" />
          <Mini x={504} y={112} w={160} h={50} title="Pip" sub="named · responsibilities" tone="harness" />
          <Mini x={480} y={202} w={100} h={50} title="Research" sub="read-only" tone="system" />
          <Mini x={588} y={202} w={100} h={50} title="Auto-review" sub="allow·ask·block" dashed />
          <Arrow d="M530,202 L550,166" />
          <Arrow d="M618,166 L638,198" />
          <text x={584} y={284} textAnchor="middle" className="dg-sub">one dot you name</text>

          <g className="tone-harness"><text x={816} y={22} textAnchor="middle" className="dg-group-label">Meta Muse · does the work</text></g>
          <Mini x={712} y={40} w={100} h={44} title="App" sub="chat" tone="system" />
          <Mini x={820} y={40} w={100} h={44} title="WhatsApp" sub="chat" tone="system" />
          <Arrow d="M782,84 L798,110" />
          <Arrow d="M850,84 L834,110" />
          <Mini x={736} y={112} w={160} h={50} title="Muse" sub="your apps, your access" tone="harness" />
          <Mini x={712} y={202} w={96} h={50} title="Browser" sub="on Kuiper" tone="harness" />
          <Mini x={824} y={202} w={96} h={50} title="Sentinel" sub="what leaves" dashed />
          <Arrow d="M776,166 L766,198" />
          <Arrow d="M808,227 L821,227" />
          <text x={816} y={284} textAnchor="middle" className="dg-sub">a guard it can&apos;t talk round</text>
        </svg>
      </div>
      <figcaption>
        The same parts, arranged four ways. Grok Bot spreads work across sibling bots a person
        makes as data. Claude Duet keeps one partner with its own clock. A dot holds its
        person&apos;s responsibilities and puts a review in front of every action. Muse does the
        work in a browser of its own, behind a Sentinel that decides what leaves it.
      </figcaption>
    </figure>
  );
}
