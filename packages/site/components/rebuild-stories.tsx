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
      viewBox="0 0 932 336"
      label="Every bot is an instance of one definition in the person's workspace: a new bot names itself with take_job, the Chief passes a bug to Bug Triage over the mesh, which passes the fix to Engineer, replies come back on their own, a group chat reaches two bots, skills are shared in the workspace, sending waits for approval, and a mention on X reaches the Chief"
      boxes={[
        { id: "maya", x: 16, y: 20, w: 110, h: 64, title: "Maya", sub: "the app" },
        { id: "x", x: 16, y: 256, w: 110, h: 64, title: "X", sub: "@crewbot …" },
        { id: "chief", x: 216, y: 110, w: 160, h: 110, title: "Chief", sub: "role: chief", tone: "harness" },
        { id: "triage", x: 486, y: 20, w: 150, h: 80, title: "Bug Triage", sub: "tickets app", tone: "harness" },
        { id: "engineer", x: 766, y: 20, w: 150, h: 80, title: "Engineer", sub: "no apps", tone: "harness" },
        { id: "workspace", x: 486, y: 138, w: 150, h: 70, title: "Workspace: maya", sub: "skills · one computer", tone: "system", dashed: true },
        { id: "sales", x: 486, y: 246, w: 150, h: 80, title: "Sales Outbound", sub: "was “New bot”", tone: "harness" },
        { id: "approval", x: 766, y: 246, w: 150, h: 80, title: "Approval", sub: "Maya says yes", tone: "system" },
      ]}
      edges={[
        { id: "ask", d: "M126,40 L256,40 L256,106", label: "asks", lx: 191, ly: 32 },
        { id: "tell", d: "M236,106 L236,68 L130,68", label: "tells", lx: 183, ly: 84 },
        { id: "mention", d: "M126,300 L256,300 L256,224", label: "mention", lx: 191, ly: 314 },
        { id: "ack", d: "M236,224 L236,272 L130,272", label: "reply_on_x", lx: 183, ly: 266 },
        { id: "send", d: "M376,125 L430,125 L430,50 L482,50", label: "mesh", lx: 403, ly: 118 },
        { id: "reply", d: "M482,80 L446,80 L446,145 L380,145", label: "reply", lx: 413, ly: 160 },
        { id: "group", d: "M376,185 L456,185 L456,276 L482,276", label: "@mention", lx: 416, ly: 178 },
        { id: "answer", d: "M482,306 L440,306 L440,205 L380,205", label: "answers", lx: 410, ly: 221 },
        { id: "fix", d: "M636,48 L762,48", label: "fix it", lx: 699, ly: 40 },
        { id: "fixed", d: "M762,80 L640,80", label: "fixed", lx: 701, ly: 96 },
        { id: "write", d: "M561,242 L561,212", label: "writes", lx: 569, ly: 230, anchor: "start" },
        { id: "shared", d: "M561,134 L561,104", label: "reads", lx: 569, ly: 122, anchor: "start" },
        { id: "gate", d: "M636,286 L762,286", label: "send_email", lx: 699, ly: 278 },
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
              &ldquo;New bot&rdquo; is now Sales Outbound. Nothing was deployed.
            </>
          ),
        },
        {
          lit: ["maya", "chief", "ask"],
          packet: { edge: "ask", label: "export crashes" },
          title: "Maya asks her Chief",
          text: (
            <>
              The Chief is a bot too: the same definition, with <code>role: &quot;chief&quot;</code>{" "}
              in its data. Its prompt, built from that data, tells it to run the others.
            </>
          ),
        },
        {
          lit: ["chief", "triage", "send"],
          packet: { edge: "send", label: "the bug" },
          title: "The Chief finds the right bot",
          text: (
            <>
              <code>glove_mesh_list_agents</code> lists the bots in Maya&apos;s workspace, with the
              names and jobs they gave themselves. <code>glove_mesh_send_message</code> to{" "}
              <code>maya-bot-2</code> starts a thread there and returns at once.
            </>
          ),
        },
        {
          lit: ["triage", "engineer", "fix"],
          packet: { edge: "fix", label: "ticket T-1" },
          title: "Bots hand work to bots",
          text: <>Bug Triage files the ticket and sends the fix to Engineer the same way. Any bot can message any other bot on the team.</>,
        },
        {
          lit: ["engineer", "triage", "chief", "fixed", "reply"],
          packet: { edge: "reply", label: "Fixed: …" },
          title: "Replies come back on their own",
          text: (
            <>
              Each bot&apos;s final answer goes back to the conversation that sent it the work, as a
              new turn. The chain unwinds without anyone checking in.
            </>
          ),
        },
        {
          lit: ["chief", "maya", "tell"],
          packet: { edge: "tell", label: "fixed" },
          title: "Maya reads it in one thread",
          text: <>The Chief passes on what matters in a sentence or two.</>,
        },
        {
          lit: ["chief", "sales", "triage", "group", "answer", "send"],
          packet: { edge: "group", label: "@Sales Outbound" },
          title: "A group chat is data too",
          text: (
            <>
              The Offsite crew chat is a conversation on the Chief whose <code>context</code> lists
              its members. Each @-mentioned bot gets its part over the mesh, and each answer is
              posted in the chat.
            </>
          ),
        },
        {
          lit: ["sales", "workspace", "triage", "write", "shared"],
          packet: { edge: "write", label: "save_skill" },
          title: "One skill library, one computer",
          text: (
            <>
              Maya describes her Monday signup sweep. <code>save_skill</code> waits for her review,
              then stores it in her workspace, where every bot can read it.{" "}
              <code>glove_foundry_schedule</code> runs it every Monday. The bots share one computer
              per workspace too.
            </>
          ),
        },
        {
          lit: ["sales", "approval", "gate"],
          packet: { edge: "gate", label: "intro to Dana" },
          title: "Anything that goes out waits",
          text: (
            <>
              <code>send_email</code> has <code>requiresPermission</code>, so Foundry holds the run
              with the exact email until Maya approves. <code>request_sign_in</code> works the same
              way: approving it is Maya signing in, and the bot never sees the password.
            </>
          ),
        },
        {
          lit: ["x", "chief", "mention", "ack"],
          packet: { edge: "mention", label: "@crewbot …" },
          title: "Tag the bot on X",
          text: (
            <>
              A transmission turns X&apos;s webhook into a typed mention. Only Chiefs get the
              playbook, and Maya&apos;s matches only her X user id. Her Chief replies on X in one
              line and does the work in her main thread.
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
        { id: "apps", x: 16, y: 210, w: 140, h: 64, title: "Inbox · calendar", sub: "connectors" },
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
        { id: "read", d: "M156,242 L300,242 L300,194", label: "read_inbox", lx: 228, ly: 236 },
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
          packet: { edge: "read", label: "3 new emails" },
          title: "It reads your apps",
          text: <>Connectors are tools. The credentials stay inside them; the agent gets results, not tokens.</>,
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
          text: <>A failed payment arrived since the last look. It notifies you once, saying what and why.</>,
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
              Asked to text your card number, it is refused by the guard, a Luhn check in code.
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
      label="A dot is shaped by its responsibility and custom rules, researches on a schedule with read-only tools, talks in the app and in Slack with one memory, sends every action through an auto-review that runs it, asks, or hands it off, and sends heavy jobs to a builder over the mesh"
      boxes={[
        { id: "brief", x: 16, y: 16, w: 150, h: 64, title: "Responsibility", sub: "job · sources · must not" },
        { id: "rules", x: 16, y: 113, w: 150, h: 64, title: "Custom rules", sub: "act · ask · hand off" },
        { id: "clock", x: 16, y: 210, w: 150, h: 64, title: "Schedule", sub: "research every 2h", tone: "system" },
        { id: "dot", x: 256, y: 100, w: 180, h: 90, title: "dot", sub: "one per job · one memory", tone: "harness" },
        { id: "channels", x: 526, y: 16, w: 150, h: 64, title: "App · Slack", sub: "a thread per channel", tone: "system" },
        { id: "review", x: 526, y: 113, w: 150, h: 64, title: "Auto-review", sub: "rules + safety", dashed: true },
        { id: "builder", x: 526, y: 210, w: 150, h: 64, title: "Builder", sub: "heavy jobs", tone: "harness" },
        { id: "person", x: 776, y: 16, w: 140, h: 64, title: "You", sub: "app or Slack" },
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
          title: "You give it a job, not a request",
          text: (
            <>
              A dot is an instance of one definition. Its responsibility (what to keep true, which
              sources to read, what must not happen yet) is instance context, and its prompt is built
              from it.
            </>
          ),
        },
        {
          lit: ["clock", "dot", "research"],
          packet: { edge: "research", label: "every 2h" },
          title: "Between conversations, it researches",
          text: (
            <>
              A schedule wakes it. On these runs the tool list holds only read-only tools: it reads
              its sources, keeps notes and may suggest one thing. Acting tools are not there to
              misuse.
            </>
          ),
        },
        {
          lit: ["person", "channels", "dot", "chat", "inbound"],
          packet: { edge: "chat", label: "Slack DM" },
          title: "It talks where you are",
          text: (
            <>
              The app and Slack are two conversations on the same instance, so each keeps its own
              history while memory is shared. Slack messages arrive through a transmission that
              only lets its owner in.
            </>
          ),
        },
        {
          lit: ["rules", "dot", "review", "context", "act"],
          packet: { edge: "act", label: "reply_to_customer" },
          title: "Before it acts, a review",
          text: (
            <>
              Every acting tool is wrapped. The wrapper reads your rule for that action, checks
              built-in safety, and checks the input, such as an email to someone you have never
              written to.
            </>
          ),
        },
        {
          lit: ["review", "outcome", "decide"],
          packet: { edge: "decide", label: "ask" },
          title: "It runs, asks, or hands it to you",
          text: (
            <>
              &ldquo;Act&rdquo; runs. &ldquo;Ask&rdquo; becomes a Foundry approval.
              &ldquo;Hand off&rdquo; does not run and tells you what to do. Changing a password is
              always yours, whatever the rules say.
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
          title: "Heavy jobs go to the builder",
          text: (
            <>
              The dot coordinates. It sends the build to the person&apos;s builder on the mesh,
              checks the reply, and reports. The builder has its own files and the web. Research
              runs get no mesh tools at all.
            </>
          ),
        },
      ]}
    />
  );
}

// ─── three shapes, side by side ──────────────────────────────────────────────

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

/** The three rebuilds as shapes: who you talk to, who works, what wakes them. */
export function RebuildShapes() {
  return (
    <figure className="dg-figure dg-wide">
      <div className="dg-scroll">
        <svg
          viewBox="0 0 932 300"
          role="img"
          className="dg-svg"
          aria-label="Three shapes. Grok Bot: you talk to a Chief, which passes work over the mesh to bots that are all instances of one definition. Claude Duet: one partner per person with its own clock and a computer it messages. OpenAI Dots: one agent per job, reached from several channels, researching on a schedule, with an auto-review in front of every action."
        >
          <defs>
            <marker id="rshape-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead" />
            </marker>
          </defs>

          <g className="tone-harness"><text x={156} y={22} textAnchor="middle" className="dg-group-label">Grok Bot · teammates</text></g>
          <Mini x={16} y={40} w={280} h={44} title="You" sub="app · @-mention on X" />
          <Arrow d="M156,84 L156,110" />
          <Mini x={76} y={112} w={160} h={50} title="Chief" sub="a bot with role: chief" tone="harness" />
          <Arrow d="M156,162 L156,200" label="mesh" lx={164} ly={186} anchor="start" />
          <Mini x={16} y={202} w={280} h={50} title="Bots, as data" sub="Sales Outbound · Bug Triage · Engineer" tone="harness" />
          <text x={156} y={284} textAnchor="middle" className="dg-sub">one definition, every bot an instance</text>

          <g className="tone-harness"><text x={466} y={22} textAnchor="middle" className="dg-group-label">Claude Duet · a partner</text></g>
          <Mini x={326} y={40} w={280} h={44} title="You" sub="one thread · chat or call" />
          <Arrow d="M466,84 L466,110" />
          <Mini x={386} y={112} w={160} h={50} title="Partner" sub="decides what matters" tone="harness" />
          <Mini x={326} y={202} w={130} h={50} title="Schedules" sub="brief · check-ins" tone="system" />
          <Mini x={476} y={202} w={130} h={50} title="Computer" sub="long jobs" tone="harness" />
          <Arrow d="M391,202 L420,166" label="wakes" lx={398} ly={180} anchor="end" />
          <Arrow d="M512,166 L541,198" label="mesh" lx={534} ly={180} anchor="start" />
          <text x={466} y={284} textAnchor="middle" className="dg-sub">one agent that reaches out first</text>

          <g className="tone-harness"><text x={776} y={22} textAnchor="middle" className="dg-group-label">OpenAI Dots · standing jobs</text></g>
          <Mini x={636} y={40} w={135} h={44} title="App" sub="thread" tone="system" />
          <Mini x={781} y={40} w={135} h={44} title="Slack" sub="thread" tone="system" />
          <Arrow d="M736,84 L756,110" />
          <Arrow d="M816,84 L796,110" />
          <Mini x={696} y={112} w={160} h={50} title="dot" sub="one responsibility" tone="harness" />
          <Mini x={636} y={202} w={135} h={50} title="Research" sub="read-only · scheduled" tone="system" />
          <Mini x={781} y={202} w={135} h={50} title="Auto-review" sub="act · ask · hand off" dashed />
          <Arrow d="M703,202 L730,166" />
          <Arrow d="M822,166 L849,198" />
          <text x={776} y={284} textAnchor="middle" className="dg-sub">one agent per job, many channels</text>
        </svg>
      </div>
      <figcaption>
        The same parts, arranged three ways. Grok Bot spreads work across bots a person makes as
        data. Claude Duet keeps one partner with its own clock. Dots give each job its own agent and
        put a review in front of every action.
      </figcaption>
    </figure>
  );
}
