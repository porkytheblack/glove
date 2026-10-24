import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocCards } from "@/components/doc-cards";
import {
  HarnessDiagram,
  LayerStack,
  PartQuestions,
  ProductionDiagram,
  SystemDiagram,
} from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/first-principles");

const shapes: { part: string; href: string; coding: string; personal: string; support: string; voice: string }[] = [
  { part: "Loop", href: "#harness", coding: "Long tool chains, many turns per request", personal: "Short turns, often started by a timer", support: "One run per ticket event", voice: "A fast model that never blocks on tools" },
  { part: "Tools", href: "/docs/primitives#tools", coding: "Read, edit, run, search, git", personal: "Calendar, mail, web, reminders", support: "Tickets, customer records, refunds", voice: "Lookups and bookings" },
  { part: "Context", href: "/docs/primitives#context", coding: "Repository guides as skills, the task list", personal: "What it knows about you, today's agenda", support: "The customer, the policy, the ticket", voice: "The form being filled, said out loud" },
  { part: "State", href: "/docs/primitives#state", coding: "The session transcript and plan", personal: "Memory of you, pending reminders", support: "Ticket history, facts already given", voice: "Answers so far, goals still open" },
  { part: "Workspace", href: "/docs/primitives#workspace", coding: "A sandbox with the repository", personal: "A browser, documents it writes", support: "Usually none: tools reach the helpdesk", voice: "None: a worker agent does the heavy lifting" },
  { part: "Surface", href: "/docs/primitives#surface", coding: "Terminal or IDE, permission prompts", personal: "Telegram, email, a web app", support: "The ticket thread, an approvals queue", voice: "Speech, sometimes a face" },
  { part: "Team", href: "/docs/primitives#team", coding: "A reviewer or explorer subagent", personal: "A research subagent", support: "A specialist, or a person", voice: "A worker behind the voice" },
];

export default function FirstPrinciplesPage() {
  return (
    <article className="docs-content">
      <h1>First principles</h1>
      <p className="blog-lede">
        An agent is a model inside a harness. A coding agent, a personal assistant, a
        support desk and a voice concierge look nothing alike from the outside, and they
        are built from the same parts. Glove gives you a primitive for each part.
        Learn the parts once and every harness becomes an assembly job, not a rewrite.
      </p>

      <LayerStack />

      <p>
        This page builds that picture from the bottom. First the harness: the seven
        parts every agent needs and how they connect. Then the system: what changes
        when there are many agents that act on their own time. Then production: what a
        system needs to stay up. Each part links to the{" "}
        <Link href="/docs/primitives">primitives map</Link>, which lists exactly what
        already exists for it.
      </p>

      <h2 id="harness">The harness</h2>
      <p>
        A model does one thing. It takes a list of messages and the tools it may use,
        and returns text, tool calls, or both. Everything else (running those tools,
        deciding what the model sees next time, keeping what happened, letting a person
        in) is the harness. Written out, every harness is this loop:
      </p>
      <CodeBlock
        filename="every harness, in pseudocode"
        language="typescript"
        code={`save(userMessage)
while (true) {
  const input = systemPrompt + history() + liveState()   // context
  const reply = await model(input, tools)                // loop
  save(reply)                                             // state
  if (!reply.toolCalls) return reply.text                 // surface
  for (const call of reply.toolCalls) {
    validate(call)                                        // tools
    if (needsPermission(call)) await ask(person)          // surface
    save(await run(call))                                 // workspace, team
  }
  if (tooLong(history())) compact()                       // context
}`}
      />
      <p>
        Every line is a decision. Where does history live? What counts as live state,
        and does adding it break the prompt cache? How do you ask a person and wait
        without blocking the server? What does &quot;run&quot; mean when the tool is a
        whole other agent? Glove turns each decision into a primitive you configure
        instead of code you write. The seven parts are the seven questions:
      </p>
      <PartQuestions layer="harness" />
      <p>
        Here is how they connect in glove-core, for one request. The cycle in the
        middle is <code>Agent.ask</code>: the message is saved, context is assembled
        from what is saved, the model asks for tools, the results are saved, and the
        cycle repeats until the model answers without asking for a tool.
      </p>
      <HarnessDiagram />

      <h3 id="same-parts">The same parts, in different shapes</h3>
      <p>
        What makes harnesses different is the shape each part takes, not which parts
        they have. Read this table down a column and you have a design; read it across
        a row and you see that the primitive is the same.
      </p>
      <table>
        <thead>
          <tr><th>Part</th><th>Coding agent</th><th>Personal assistant</th><th>Support desk</th><th>Voice concierge</th></tr>
        </thead>
        <tbody>
          {shapes.map((row) => (
            <tr key={row.part}>
              <td><Link href={row.href}>{row.part}</Link></td>
              <td>{row.coding}</td>
              <td>{row.personal}</td>
              <td>{row.support}</td>
              <td>{row.voice}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The <Link href="/docs/harnesses">harness blueprints</Link> work through each
        column in full: the primitives it uses, what you write yourself, and how it
        deploys.
      </p>

      <h2 id="system">The system</h2>
      <p>
        A single harness answers when spoken to. A product needs more: one agent per
        customer, each with its own history; work that happens tomorrow; a Slack
        message or a webhook that wakes the right agent (or creates it); a person who
        approves the refund before it goes out; other software that calls the agent
        over HTTP. These are five more questions, and{" "}
        <Link href="/foundry/docs">Glove Foundry</Link> answers them:
      </p>
      <PartQuestions layer="system" />
      <p>
        Foundry keeps one rule that explains most of its design.{" "}
        <strong>Definitions are code, instances are data.</strong> An agent definition
        (<code>agents/support/agent.ts</code>) says what an agent of that kind can
        assemble, and every field may be a function of the instance, the conversation
        and the incoming message. An instance is a persisted record: its id, its
        context, the capabilities installed on it, its playbooks. Every run reloads
        the instance and assembles a fresh Glove harness from the definition, in its
        own process. So a customer&apos;s agent can gain a tool by installing it, with
        no deploy.
      </p>
      <SystemDiagram />

      <h2 id="production">Production</h2>
      <p>
        A system that works on your laptop still has to run somewhere. It needs to stay
        up and restart cleanly, and its state has to survive a redeploy. It needs keys
        for model providers, browsers and sandboxes it can trust with untrusted pages
        and code, and an email address. Someone has to see what it did last night and
        what that cost. <a href="https://kuiper.sh">Kuiper</a> is a deployment platform
        built for exactly this: it detects a Foundry folder and deploys it with no
        Dockerfile, the way Vercel deploys a Next.js app.
      </p>
      <PartQuestions layer="production" />
      <ProductionDiagram />

      <h2 id="principles">The rules the primitives follow</h2>
      <p>
        Glove&apos;s packages were written to a handful of rules. Knowing them lets you
        guess an API before you look it up, and tells you where your own code belongs.
      </p>
      <ol>
        <li>
          <strong>The model reaches everything through tools.</strong> A subagent is a
          tool (<code>glove_invoke_subagent</code>). An MCP server&apos;s operations
          become tools. A browser is a tool that runs a script
          (<code>execute_browser</code>). In Foundry, an outbound Slack reply is a tool
          generated from a transmission. If you can describe it as a tool, every other
          primitive (permissions, approvals, summaries, tracing) already applies to it.
        </li>
        <li>
          <strong>Every boundary is an adapter.</strong> Models, stores, display
          managers, subscribers, memory stores, mesh transports, filesystem backends,
          sandbox backends and Foundry&apos;s data layer are interfaces. Glove ships a
          reference implementation of each; production swaps in yours without touching
          agent code.
        </li>
        <li>
          <strong>Capabilities mount; they don&apos;t wrap.</strong> Packages attach
          to an agent you already built (<code>mountMcp(glove, …)</code>,{" "}
          <code>useFormRunner(glove, …)</code>, <code>mountBrowser(glove, …)</code>)
          and never replace its model or loop. So they compose: a voice agent with
          memory, a sandbox and an MCP server is four mounts on one Glove.
        </li>
        <li>
          <strong>Live state goes at the tail, not in the prompt.</strong> The system
          prompt and saved history are a stable prefix, which providers can cache.
          Current state (the open form, the goal checklist, pinned facts, the latest
          screenshot) arrives through context providers just before each model call
          and is never saved to history.
        </li>
        <li>
          <strong>Work happens in files and code, not in context.</strong> Large data
          lives in a virtual filesystem or a REPL binding; the model writes a program
          that reads, filters and computes, and only the answer comes back. That is how
          one tool replaces fifty and how a 40 MB spreadsheet never enters the window.
        </li>
        <li>
          <strong>Asking a person is a primitive.</strong> In an app,{" "}
          <code>pushAndWait</code> suspends a tool until the user answers. In Foundry, a
          permission-gated tool becomes an expiring approval record anyone with access
          can resolve. Neither needs a pause/resume protocol of your own.
        </li>
        <li>
          <strong>Credentials never reach the model.</strong> Foundry stores account
          references, not secrets; adapters you own resolve them at call time. On
          Kuiper, provider keys stay at the gateway and units get a scoped gateway key.
        </li>
      </ol>

      <h2 id="where-next">Where to go next</h2>
      <DocCards
        cards={[
          { href: "/docs/primitives", kicker: "Look it up", title: "Primitives map", desc: "Every primitive for every part, with what people build by hand when they don't know it exists." },
          { href: "/docs/build/loop", kicker: "Learn by building", title: "Build it up, layer by layer", desc: "Eight steps from one tool to a deployed Foundry system. Each step adds one part." },
          { href: "/docs/harnesses", kicker: "Assemble", title: "Harness blueprints", desc: "Coding, personal, support, voice, research and multi-agent harnesses as bills of primitives." },
        ]}
      />
    </article>
  );
}
