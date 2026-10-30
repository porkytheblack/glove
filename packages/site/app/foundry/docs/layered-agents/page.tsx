import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DelegationStory } from "@/components/foundry-stories";

export const metadata = {
  title: "Layered agents",
  description:
    "Split an assistant into layers of sibling agents by how fast each must reply, what it must remember and how long it runs: an interactor that talks and remembers, and workers that do the work, with delegates.",
};

export default function LayeredAgentsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Design your system / Layered agents</span>
      <h1>Layered agents</h1>
      <p className="blog-lede">
        One agent that talks to a person, remembers them, writes code and browses the web
        gets slow and careless. Every tool and instruction it carries is read on every call,
        and the person waits while it works. Split it into layers instead: an agent that
        talks and remembers, and sibling agents that do the work and report back. In Foundry
        that split is one field, <code>delegates</code>.
      </p>

      <p>For workers owned by each parent instance, see <Link href="/foundry/docs/durable-subagents">durable subagents</Link>: identity, provisioning, inheritance, direct messages and event delivery. The <Link href="/foundry/docs/durable-subagents/realtime-example">realtime front and researcher walkthrough</Link> applies those primitives in a running application.</p>

      <h2 id="questions">Three questions decide the layers</h2>
      <p>
        Put two jobs in different agents when the answers to these questions differ. Then
        give each agent only the tools and access its job needs.
      </p>
      <table>
        <thead>
          <tr><th></th><th>Interactor (layer 1)</th><th>Worker (layer 2)</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>How fast must it reply?</strong></td><td>Now. A person is waiting, maybe on a call.</td><td>Minutes are fine. Nobody is watching it type.</td></tr>
          <tr><td><strong>What context must it keep?</strong></td><td>The person: who they are, what they like, what they are waiting on.</td><td>One task. A fresh conversation per delegation.</td></tr>
          <tr><td><strong>How long does it run?</strong></td><td>One turn, or one call.</td><td>As long as the task takes, across runs if it sleeps or asks.</td></tr>
          <tr><td><strong>What can it reach?</strong></td><td>Personal memory, the person, its delegates.</td><td>Its sandbox, browser or APIs, and a question back to the interactor.</td></tr>
          <tr><td><strong>Which model?</strong></td><td>Small and fast, or a speech-to-speech model.</td><td>Stronger and slower, chosen per job.</td></tr>
        </tbody>
      </table>
      <p>
        Long-running or scheduled work is still a worker: it can{" "}
        <Link href="/foundry/docs/automation#core-tools">sleep</Link> or be woken by a{" "}
        <Link href="/foundry/docs/automation#schedules">schedule</Link>, and its result comes
        back the same way.
      </p>

      <h2 id="pattern">The pattern</h2>
      <p>
        The interactor is the only agent the person talks to. It understands what they want,
        turns it into a task another agent can finish without having been in the room, and
        keeps talking. Workers do the task. When a worker is missing something, it asks the
        interactor, which answers from what it knows or asks the person. Step through it:
      </p>
      <DelegationStory />

      <h2 id="build">Build it</h2>
      <p>
        These files come from{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-layered-assistant">
          <code>examples/foundry-layered-assistant</code>
        </a>
        , which runs offline with <code>pnpm verify</code>. The interactor names its
        delegates by route:
      </p>
      <CodeBlock
        filename="agents/assistant/agent.ts"
        language="typescript"
        code={`import { composeAgent, defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { callModel, interactorModel } from "../../lib/models.js";
import { call, isCall } from "./call.js";
import personal from "./personal.memory.js";
import { interactorPrompt } from "./prompt.js";

/** Layer 1. This file only assembles; the prompt, memory and call live beside it. */
export default defineAgent({
  description: "Talks with the person, remembers them, and hands work to the coder and researcher",
  components: composeAgent(personal),

  model: (_agent, context) => (isCall(context) ? callModel() : interactorModel()),
  systemPrompt: (_agent, context) => interactorPrompt(isCall(context)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [personal],

  delegates: [
    { agent: "coder", description: "Writes and runs code in its own workspace. Takes minutes. Give it the whole task." },
    { agent: "researcher", description: "Reads the web and reports back with sources. Takes a minute or two." },
  ],

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});`}
      />
      <p>
        A worker is an ordinary definition. Nothing in it says who may delegate to it; it
        gets a task as its first message and its final reply is the result.
      </p>
      <CodeBlock
        filename="agents/coder/agent.ts"
        language="typescript"
        code={`import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { workerModel } from "../../lib/models.js";
import { coderPrompt } from "./prompt.js";
import { coderWorkspace } from "./workspace.js";

/** Layer 2. No memory of the person and no way to message them. */
export default defineAgent({
  description: "Writes and runs code in a sandboxed workspace",
  model: () => workerModel("coder"),
  systemPrompt: coderPrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  workingEnvironment: coderWorkspace,
  answerWaitMs: 120_000,   // wait this long in-run for an answer to glove_foundry_ask
});`}
      />
      <p>What <code>delegates</code> gives you:</p>
      <ul>
        <li>
          <code>glove_foundry_delegate({"{ to, task }"})</code> on the interactor. It returns a
          delegation id at once. Its description lists the delegates and what each is for, so
          write those descriptions for the model that has to choose.
        </li>
        <li>
          <code>glove_foundry_reply({"{ delegationId, message }"})</code> on the interactor, to
          answer a worker&apos;s question or send more instructions about a task.
        </li>
        <li>
          <code>glove_foundry_ask({"{ question }"})</code> on the worker, for the one thing it
          cannot decide alone.
        </li>
        <li>
          One worker instance per interactor instance and worker route
          (<code>maya.coder</code> for the instance <code>maya</code>), created on first use. It
          starts with a copy of the interactor instance&apos;s <code>context</code>, so a
          per-person id is there, and <code>delegatedBy</code> names who it works for.
        </li>
        <li>
          One conversation per delegation on that worker. Its id is the delegation id, and a
          follow-up on the same delegation continues it, files and all.
        </li>
      </ul>

      <h2 id="logic">Write the parts beside agent.ts</h2>
      <p>
        <code>agent.ts</code> is where a definition is assembled. The parts go in their own
        modules: the prompt is a function in <code>prompt.ts</code>, memory is a{" "}
        <code>*.memory.ts</code> file, the workspace and the call each have a file, and the
        model choice for every layer is in <code>lib/models.ts</code>. Each part can be read
        and tested on its own, and the definition stays a page you can take in at a glance.
        See <Link href="/foundry/docs/project-structure#assembly">Project structure</Link>.
      </p>
      <CodeBlock
        filename="tree"
        language="text"
        code={`agents/
  assistant/
    agent.ts              assembly: model per surface, memory, delegates, run
    prompt.ts             how the interactor talks and when it delegates
    personal.memory.ts    what it knows about the person (glove-memory on SQLite)
    call.ts               the voice call: room and greeting
  coder/
    agent.ts  prompt.ts  workspace.ts
  researcher/
    agent.ts  prompt.ts  workspace.ts      the workspace adds env:fetch
lib/
  models.ts               one model choice per layer`}
      />

      <h2 id="ask">When a worker needs to ask</h2>
      <p>
        A worker that guesses wastes the whole task. <code>glove_foundry_ask</code> sends one
        question to the conversation that delegated, where it arrives as a message:
      </p>
      <CodeBlock
        filename="what the interactor receives"
        language="text"
        code={`<delegation id="delegation_9f2c…" agent="coder" status="question">
Task: The user asked: Write me a slugify function, please.
The coder agent needs an answer to continue: Which language should the code be in?
If you already know the answer, reply with glove_foundry_reply. Otherwise ask the user, then reply.
</delegation>`}
      />
      <p>
        The interactor answers with <code>glove_foundry_reply</code>: straight away if memory or
        the conversation already has the answer, or after asking the person. Meanwhile the
        worker&apos;s ask waits in the same run for up to <code>answerWaitMs</code> (90 seconds by
        default), so a worker holding a browser session or a running sandbox keeps it and gets
        the answer as the tool&apos;s result. If no answer comes in time, the tool tells the
        worker to end its turn. An answer that still reaches that turn joins it like any
        update; otherwise the run finishes as suspended, and the answer later starts a new
        run in the same conversation. Give workers a durable store so that run has the
        history.
      </p>

      <h2 id="results">Where results go</h2>
      <p>
        A worker&apos;s final reply is the result. Foundry sends it, every question and any
        failure back to the conversation that delegated:
      </p>
      <ul>
        <li>
          <strong>To a run that is listening.</strong> A run can take updates itself with{" "}
          <code>ctx.onDelegationUpdate(handler)</code>. <Link href="/foundry/docs/voice">
          <code>voiceCall</code></Link> does, so a result that lands mid-call is spoken at the
          next pause.
        </li>
        <li>
          <strong>Into the turn that is still working.</strong> A run with delegates listens
          for as long as it lasts. An update that arrives while its turn is still calling
          tools joins at the next tool step, as a{" "}
          <Link href="/docs/runtime-context#events">Glove event</Link> that reads as the same{" "}
          <code>&lt;delegation&gt;</code> message, and is saved after the tool results. The
          open-delegations list stops showing it. Replies reach a working worker the same way.
        </li>
        <li>
          <strong>Otherwise, as a new turn.</strong> Updates the run did not read (they
          arrived during its final answer, or after it) go back to the runtime when the run
          ends. Once no run holds the conversation, they start one run with everything that
          arrived meanwhile, as <code>&lt;delegation&gt;</code> messages with{" "}
          <code>source.kind</code> <code>&quot;delegation&quot;</code>.
        </li>
      </ul>
      <p>
        While anything is open, the interactor&apos;s runtime context lists it (&ldquo;delegation_…
        (coder): working on …&rdquo;), so it can answer &ldquo;how is that going?&rdquo; without a
        tool call. A failed or cancelled worker run reports back as{" "}
        <code>status=&quot;failed&quot;</code>; a run cancelled by{" "}
        <Link href="/foundry/docs/approvals#steering">steering</Link> does not, because its
        replacement continues the task.
      </p>

      <h2 id="siblings">Siblings, not children</h2>
      <p>
        Delegates are named by route rather than imported. The interactor&apos;s process never
        loads a worker&apos;s code, so a fast voice agent does not start up carrying a sandbox
        SDK, and each agent&apos;s access is decided in its own definition. Pick the boundary by
        the job:
      </p>
      <table>
        <thead><tr><th>You want…</th><th>Use</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>A fast agent that hands off slow work and hears back</td><td><code>delegates</code></td><td>Separate process, instance and conversation per task. Results and questions come back.</td></tr>
          <tr><td>A bounded sub-task answered inside this turn</td><td><Link href="/foundry/docs/multi-agent#subagents"><code>defineSubagent</code></Link></td><td>Runs inside the parent&apos;s tool call; the parent waits for it.</td></tr>
          <tr><td>Start separate work and never hear back</td><td><Link href="/foundry/docs/multi-agent#spawn"><code>glove_foundry_spawn</code></Link></td><td>Fire and forget, with a run id in the trace.</td></tr>
          <tr><td>Peers that talk while both are running</td><td><Link href="/foundry/docs/multi-agent#mesh"><code>mesh</code></Link></td><td>Messages between live runs over your transport.</td></tr>
          <tr><td>Fan out from code you control</td><td><Link href="/foundry/docs/multi-agent#client-fan-out">the typed client</Link></td><td>Deterministic orchestration in a <code>run</code>.</td></tr>
        </tbody>
      </table>

      <h2 id="access">Keep access where it belongs</h2>
      <ul>
        <li><strong>The person stays with layer 1.</strong> Workers have no tool that reaches them; a question goes through the interactor, which decides whether to ask.</li>
        <li><strong>Memory stays with layer 1.</strong> Put personal memory on the interactor only. It passes on what a task needs, in the task.</li>
        <li><strong>Reach stays with the worker that needs it.</strong> The coder has a sandbox, the researcher has the web. Neither has the other&apos;s.</li>
        <li><strong>Approvals happen where the risk is.</strong> A worker&apos;s <code>requiresPermission</code> tool pauses on an <Link href="/foundry/docs/approvals">approval record</Link> like any other run.</li>
        <li><strong>Instance context is copied, so keep secrets out of it.</strong> Use it for ids; credentials belong in adapters and secrets.</li>
      </ul>

      <h2 id="how-it-works">How it works</h2>
      <p>
        A delegation is a conversation on the worker instance whose <code>context.delegation</code>{" "}
        holds the record. Foundry updates it as the task moves:
      </p>
      <CodeBlock
        filename="FoundryDelegation"
        language="typescript"
        code={`interface FoundryDelegation {
  id: string;                 // also the worker conversation's id
  to: string;                 // worker route, e.g. "coder"
  workerAgentId: string;      // e.g. "maya.coder"
  workspaceId: string;
  from: { definitionId: string; agentId: string; conversationId: string; runId: string };
  task: string;
  status: "working" | "waiting" | "completed" | "failed" | "cancelled";
  question?: string;          // while waiting
  result?: string;
  error?: string;
  undelivered?: "result" | "question" | "failed";   // owed to the delegating conversation
  pendingReplies?: string[];                         // owed to the worker
  createdAt: string;
  updatedAt: string;
}`}
      />
      <table>
        <thead><tr><th>Moment</th><th>What Foundry does</th><th>Event on the trace</th></tr></thead>
        <tbody>
          <tr><td><code>glove_foundry_delegate</code></td><td>Creates the worker instance if needed and the delegation conversation, then queues the worker run with the task wrapped in <code>&lt;delegated-task&gt;</code>.</td><td><code>delegation.started</code></td></tr>
          <tr><td><code>glove_foundry_ask</code></td><td>Marks the delegation <code>waiting</code> and delivers the question to the delegating conversation.</td><td><code>delegation.question</code></td></tr>
          <tr><td><code>glove_foundry_reply</code></td><td>Checks the delegation was started by this conversation, marks it <code>working</code>, and delivers the reply to the worker: into its waiting run, or as a new run.</td><td><code>delegation.replied</code></td></tr>
          <tr><td>Worker run completes</td><td>Unless it suspended (asleep or waiting for an answer), records the result and delivers it.</td><td><code>delegation.completed</code></td></tr>
          <tr><td>Worker run fails or is cancelled</td><td>Records the error and delivers a <code>failed</code> update.</td><td><code>delegation.failed</code>, <code>delegation.cancelled</code></td></tr>
          <tr><td>Any delivery</td><td>Into a listening run (<code>mode: &quot;live&quot;</code>) or a new run (<code>mode: &quot;run&quot;</code>). A run with delegates, open delegations or a task of its own listens while it lasts.</td><td><code>delegation.delivered</code></td></tr>
        </tbody>
      </table>
      <ul>
        <li>A run that asked and did not get an answer ends with <code>status: &quot;suspended&quot;</code> and <code>suspension: {"{ kind: \"question\", delegationId, question, commandId }"}</code>.</li>
        <li><code>runtime.listDelegations({"{ agentId?, conversationId?, status? }"})</code> lists delegations, newest first.</li>
        <li>In a resolver, <code>ctx.delegations</code> holds the open delegations this conversation started, and <code>ctx.delegation</code> is set when the run works on a delegated task.</li>
        <li>Delegating to a route that does not exist delivers a <code>failed</code> update rather than failing silently.</li>
        <li>An update or reply waiting for a busy conversation is recorded on the delegation (<code>undelivered</code>, <code>pendingReplies</code>) until it is handed over, so a restart (including the one <code>glove foundry dev</code> does on every save) hands it over when the runtime starts again. Use a durable data adapter for this to hold across processes.</li>
        <li>Delegations nest: a worker can have <code>delegates</code> of its own.</li>
      </ul>
    </article>
  );
}
