import Link from "next/link";
import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram, LayerStack } from "@/components/diagrams";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("every-harness-is-the-same-seven-parts")!;
export const metadata = postMetadata(post);

export default function SevenPartsPost() {
  return (
    <article className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        A coding agent, a personal assistant and a support desk look like three
        different products. Underneath, each one is the same seven parts in different
        proportions. Once you can see the parts, a new harness is mostly an assembly
        job, and most of the parts are already built.
      </p>

      <h2 id="what-a-harness-is">What a harness is</h2>
      <p>
        A model takes text and images in and gives text and tool calls back. That is all
        it does. It cannot run the tool it just asked for. It cannot remember yesterday,
        open a file, wait for someone to approve a refund, or notice that a ticket
        arrived at three in the morning.
      </p>
      <p>
        Everything that does those things is the harness. Claude Code is a harness.
        So is the support bot on your bank&apos;s website, and so is the assistant that
        texts you when your flight moves. They feel different because their harnesses
        are tuned for different jobs, not because they are made of different things.
      </p>
      <p>
        Here is one request going through a Glove harness:
      </p>

      <HarnessDiagram />

      <p>
        The person&apos;s message is saved. Context is assembled from what was saved,
        plus whatever is true right now. The model reads it and asks for tools. The
        tools run, and their results are saved. Then it goes round again, until the
        model answers instead of asking for another tool. Every harness you have used
        works this way, whether or not it says so.
      </p>

      <h2 id="the-seven-parts">The seven parts</h2>
      <p>
        Each part answers one question. Every harness has to answer all seven, even if
        the answer is &quot;not much&quot;.
      </p>
      <ol>
        <li>
          <strong>Loop: how does it act?</strong> Call the model, run the tools it asks
          for, feed back the results, stop when it answers. Then the details: retries, a
          turn limit, cancelling halfway, streaming text, counting tokens.
        </li>
        <li>
          <strong>Tools: what can it do?</strong> Every capability is a name, a
          description the model reads, a schema and a function. Search, refund, run a
          shell command, call another service.
        </li>
        <li>
          <strong>Context: what does it see?</strong> The instructions, the history,
          and the state of the world right now. Plus guidance it loads only when it
          needs it, and a way to keep a long session inside the window.
        </li>
        <li>
          <strong>State: what does it remember?</strong> The conversation, a plan, what
          it learned about this person, what it is still waiting on, what it is trying
          to finish.
        </li>
        <li>
          <strong>Workspace: where does it work?</strong> Files it can write and read
          back, code it can run, a browser, a container. A place where big data and
          finished artifacts live outside the context window.
        </li>
        <li>
          <strong>Surface: how do people reach it?</strong> A chat window, a terminal,
          a phone call, an API. And the way a tool shows a result or asks a question
          and waits for the answer.
        </li>
        <li>
          <strong>Team: who does it work with?</strong> A subagent that takes a
          narrow job with its own tools, or another agent it messages.
        </li>
      </ol>

      <h2 id="three-harnesses">Three harnesses, side by side</h2>
      <p>
        Put three very different products next to each other and fill in the parts.
      </p>
      <table>
        <thead>
          <tr><th>Part</th><th>Coding agent</th><th>Personal assistant</th><th>Support desk</th></tr>
        </thead>
        <tbody>
          <tr><td>Loop</td><td>Long, many tool calls per request</td><td>Short, a few calls per message</td><td>Short, but many at once</td></tr>
          <tr><td>Tools</td><td>Read, edit, run, search the repository</td><td>Calendar, email, web, reminders</td><td>Order lookup, refunds, ticket replies</td></tr>
          <tr><td>Context</td><td>Repository conventions, the current plan</td><td>Who you are, what is on today</td><td>Policy, the customer&apos;s account right now</td></tr>
          <tr><td>State</td><td>A task list, the session</td><td>Memory of you, pending reminders</td><td>Ticket history, the details collected so far</td></tr>
          <tr><td>Workspace</td><td>A sandboxed checkout and a shell</td><td>A browser, documents it writes</td><td>Usually none</td></tr>
          <tr><td>Surface</td><td>Terminal, editor, permission prompts</td><td>Telegram, email, voice notes</td><td>Chat widget, email, an approval queue</td></tr>
          <tr><td>Team</td><td>An explorer subagent, a reviewer</td><td>A research subagent</td><td>A triage classifier, a specialist per topic</td></tr>
        </tbody>
      </table>
      <p>
        The columns differ in proportion, not in kind. A coding agent spends its
        effort on the workspace and the loop. A personal assistant spends it on state
        and on acting at the right time. A support desk spends it on events arriving
        from outside and on people approving what it does.
      </p>
      <p>
        That is where the interesting work is. The rest, the loop, the tool plumbing,
        saving the conversation, keeping context fresh, showing a prompt and waiting,
        is the same in all three. It should not be written three times.
      </p>

      <h2 id="a-harness-you-know">Take apart one you already use</h2>
      <p>
        Try it on a coding agent in your terminal. Every piece you see maps to one part,
        and to one Glove primitive:
      </p>
      <table>
        <thead><tr><th>What you see</th><th>Part</th><th>The Glove primitive</th></tr></thead>
        <tbody>
          <tr><td>It keeps calling tools until the change is done</td><td>Loop</td><td><code>processRequest</code> on a built <code>Glove</code></td></tr>
          <tr><td>Read, edit, search and run commands</td><td>Tools</td><td><code>fold</code>, or one interpreter over many functions</td></tr>
          <tr><td>&quot;Allow this command?&quot;</td><td>Tools, surface</td><td><code>requiresPermission</code> and the display stack</td></tr>
          <tr><td>A project instructions file and skills it reads when relevant</td><td>Context</td><td>A stable system prompt and <code>useReadSkill</code></td></tr>
          <tr><td>A todo list that updates as it works</td><td>Context, state</td><td>The built-in <code>glove_update_tasks</code></td></tr>
          <tr><td>Long sessions that keep going after the window fills</td><td>Context</td><td><code>compaction_config</code></td></tr>
          <tr><td>Your checkout and a shell</td><td>Workspace</td><td><code>mountSandbox</code> or a working environment</td></tr>
          <tr><td>An explorer it sends off to search the codebase</td><td>Team</td><td><code>defineSubAgent</code></td></tr>
        </tbody>
      </table>
      <p>
        Nothing in that list is specific to coding. Swap the tools and the workspace and
        the same harness is a data analyst. Swap the surface for a phone call and it is a
        voice agent.
      </p>

      <h2 id="what-glove-gives-you">What Glove gives you for each part</h2>
      <p>
        Glove is built as one primitive per part, so the shape of the framework is the
        shape of the problem. The smallest harness is a loop and one tool:
      </p>
      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { Glove, Displaymanager } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { z } from "zod";

const agent = new Glove({
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You help a team ship releases. Use tools for facts.",
  compaction_config: { compaction_instructions: "Summarise the release work so far." },
})
  .fold({
    name: "list_merged_changes",
    description: "List pull requests merged since a date, newest first.",
    inputSchema: z.object({ since: z.string().describe("ISO date") }),
    async do({ since }) {
      // mergedSince is your own lookup: GitHub, a database, a file.
      return { status: "success", data: await mergedSince(since) };
    },
  })
  .build();

const result = await agent.processRequest("What shipped since Monday?");`}
      />
      <p>
        That is already a full loop with validated input, retries, a turn limit,
        compaction and a store. Each other part is one more call on the same agent:
      </p>
      <ul>
        <li><strong>Surface.</strong> A tool calls <code>display.pushAndWait(…)</code> to show a confirmation and resume with the answer. <code>glove-react</code> renders it; <code>glove-voice</code> speaks it.</li>
        <li><strong>Context.</strong> <code>agent.addContextProvider(() =&gt; currentState())</code> puts live state after the history on every model call, without touching the system prompt.</li>
        <li><strong>State.</strong> Any <code>StoreAdapter</code> keeps the conversation, tasks and inbox. <code>glove-memory</code> adds what the agent learns; forms and goals track what it is trying to get done.</li>
        <li><strong>Workspace.</strong> <code>mountWorkingEnvironment</code> gives it files and scripts; <code>mountJs</code> gives it an interpreter; <code>mountBrowser</code> and <code>mountSandbox</code> give it a browser and a container.</li>
        <li><strong>Team.</strong> <code>agent.defineSubAgent(…)</code> registers a child agent the model can call like any tool.</li>
      </ul>
      <p>
        None of these replace the loop or the model. They all attach to the agent you
        already have. That is a deliberate rule: capability packages mount onto an agent,
        they never wrap it.
      </p>

      <h2 id="from-harness-to-system">When a harness becomes a system</h2>
      <p>
        A harness serves the person in front of it. The moment there is more than one
        person, or work has to happen with nobody in the chat, five new questions show
        up. Glove Foundry answers them:
      </p>
      <ul>
        <li><strong>Identity: whose agent is this?</strong> One definition in code, many instances in data, each with its own conversations, context and installed tools.</li>
        <li><strong>Time: when does it act?</strong> Schedules, sleep and spawn are tools the agent calls itself, backed by durable records.</li>
        <li><strong>Arrival: what wakes it up?</strong> Transmissions turn Slack, email or a webhook into typed events; playbooks route them, and can create the agent that handles them.</li>
        <li><strong>Oversight: who keeps it in check?</strong> A gated tool becomes an expiring approval record; running work can be steered; an inspector shows every call.</li>
        <li><strong>Access: how does other software call it?</strong> A typed client, REST, an async run API and OpenAI-compatible endpoints.</li>
      </ul>
      <p>
        These are not features you add to a harness. They are what turns harnesses into
        a service. Teams that skip Foundry tend to build them anyway, one table and one
        cron job at a time.
      </p>

      <h2 id="from-system-to-production">When a system meets production</h2>
      <p>
        A system still has to run somewhere. That brings the last four questions, and
        Kuiper answers them:
      </p>
      <ul>
        <li><strong>Run: where does it run?</strong> Kuiper detects a Foundry app and deploys it with no Dockerfile.</li>
        <li><strong>Keep: where does state live?</strong> A <code>/data</code> disk for Foundry&apos;s data and transcripts, managed databases, and sealed secrets.</li>
        <li><strong>Reach: what does it reach?</strong> One model gateway in front of your own provider keys, real browsers, sandboxes and email addresses.</li>
        <li><strong>Watch: how do you see it?</strong> Logs, the agent&apos;s runs read into the dashboard, every model call, usage and budgets.</li>
      </ul>

      <LayerStack />

      <h2 id="why-it-matters">Why the model matters</h2>
      <p>
        The most expensive mistake we see is not a bug. It is a part that already
        existed, built again by hand. A job queue for &quot;remind me tomorrow&quot;
        when the agent could schedule itself. A system prompt rebuilt every turn to
        include the current cart, which also throws away the prompt cache. An approvals
        table with its own pause and resume. Fifty tool definitions where one
        interpreter would do. Each one works, and each one is code someone now owns.
      </p>
      <p>
        Coding agents make the same mistake faster. Ask one to &quot;add reminders&quot;
        and it will happily write a scheduler. It does not know the primitive exists
        unless something tells it.
      </p>
      <p>
        So the docs now start from the parts. Before you build anything, find the part
        it belongs to and check what is already there.
      </p>

      <div className="blog-note">
        <strong>Where to go next.</strong>{" "}
        <Link href="/docs/first-principles">First principles</Link> covers the model in
        full. The <Link href="/docs/primitives">primitives map</Link> lists every
        primitive by part, with what people build when they don&apos;t know it exists.{" "}
        <Link href="/docs/build/loop">Build it up</Link> takes one agent from a single
        tool to production in eight steps, and the{" "}
        <Link href="/docs/harnesses">harness blueprints</Link> show whole harnesses as
        bills of primitives.
      </div>
    </article>
  );
}
