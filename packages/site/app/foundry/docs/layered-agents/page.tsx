import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { MeshStory } from "@/components/foundry-stories";

export const metadata = {
  title: "Layered agents",
  description:
    "Split an assistant into layers by how fast each must reply, what it must remember and how long it runs: an interactor that talks and remembers, and workers that do the work. Each is an instance in the person's workspace, and they message each other over the mesh Foundry hosts.",
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
        talks and remembers, and agents that do the work and report back. In Foundry each
        layer is an instance in the person&apos;s workspace, and they talk over the{" "}
        <Link href="/foundry/docs/multi-agent#mesh">mesh</Link> Foundry hosts.
      </p>

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
          <tr><td><strong>What context must it keep?</strong></td><td>The person: who they are, what they like, what they are waiting on.</td><td>One job. Each job is its own conversation.</td></tr>
          <tr><td><strong>How long does it run?</strong></td><td>One turn, or one call.</td><td>As long as the job takes, across runs if it sleeps or asks.</td></tr>
          <tr><td><strong>What can it reach?</strong></td><td>Personal memory, the person, its teammates on the mesh.</td><td>Its sandbox, browser or APIs, and a question back to whoever sent the job.</td></tr>
          <tr><td><strong>Which model?</strong></td><td>Small and fast, or a speech-to-speech model.</td><td>Stronger and slower, chosen per job.</td></tr>
        </tbody>
      </table>
      <p>
        Long-running or scheduled work is still a worker: it can{" "}
        <Link href="/foundry/docs/automation#core-tools">sleep</Link> or be woken by a{" "}
        <Link href="/foundry/docs/automation#schedules">schedule</Link>, and its reply comes
        back the same way.
      </p>

      <h2 id="pattern">The pattern</h2>
      <p>
        The interactor is the only agent the person talks to. It understands what they want,
        writes it as a message another agent can act on without having been in the room, and
        keeps talking. Workers do the job. When a worker is missing something, it asks the
        interactor, which answers from what it knows or asks the person. Step through it:
      </p>
      <MeshStory />

      <h2 id="build">Build it</h2>
      <p>
        These files come from{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-layered-assistant">
          <code>examples/foundry-layered-assistant</code>
        </a>
        , which runs offline with <code>pnpm verify</code>. The team is data: each person gets
        an assistant, a coder and a researcher, all in one workspace, so they see each other
        and nobody else&apos;s agents.
      </p>
      <CodeBlock
        filename="lib/team.ts"
        language="typescript"
        code={`export function teamFor(person: { id: string; name: string }) {
  const workspaceId = person.id;
  return {
    assistant: { id: person.id, workspaceId, name: "Iris", description: \`\${person.name}'s assistant\`, context: { name: person.name } },
    coder: { id: \`\${person.id}-coder\`, workspaceId, name: "Coder", description: "Writes and runs code in its own workspace. Takes minutes. Give it the whole task." },
    researcher: { id: \`\${person.id}-researcher\`, workspaceId, name: "Researcher", description: "Reads the web and reports back with sources. Takes a minute or two." },
  };
}`}
      />
      <p>
        The definitions only say what each kind of agent can be. The interactor turns on the
        mesh; it does not name its workers, because who is on the team is data. The worker&apos;s{" "}
        <code>description</code> is what the interactor reads when it lists the team, so write
        it for the model that has to choose.
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

  mesh: true,   // message the person's other agents by id; replies come back here

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});`}
      />
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
  mesh: { waitMs: 120_000 },   // a blocking question waits this long in-run
});`}
      />
      <p>
        The example seeds Maya&apos;s team with <code>defineAgentInstance</code>, which points
        at each imported definition. Anyone else is created over HTTP when they sign up, where
        the kind of agent is its route:
      </p>
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`const team = teamFor({ id: "maya", name: "Maya" });
const maya = defineAgentInstance(assistant, team.assistant);

export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [maya, defineAgentInstance(coder, team.coder), defineAgentInstance(researcher, team.researcher)],
  conversations: [createConversation(maya, { id: "maya-chat", title: "Chat with Maya" })],
});`}
      />
      <CodeBlock
        filename="scripts/onboard.ts"
        language="typescript"
        code={`const team = teamFor({ id: "ada", name: "Ada" });
await foundry.createAgent("assistant", team.assistant);
await foundry.createAgent("coder", team.coder);
await foundry.createAgent("researcher", team.researcher);`}
      />
      <p>What <code>mesh</code> gives an agent:</p>
      <ul>
        <li>
          <code>glove_mesh_list_agents({"{ name? }"})</code>: the agents it can message, with
          their ids, names and descriptions.
        </li>
        <li>
          <code>glove_mesh_send_message({"{ to, content, in_reply_to?, blocking? }"})</code>. A
          new message starts a thread and returns at once. <code>in_reply_to</code> answers a
          message in a thread. <code>blocking</code> waits in the run for the reply.
        </li>
        <li>
          <code>glove_mesh_broadcast({"{ content }"})</code>: one thread per agent it can message.
        </li>
        <li>
          <code>glove_mesh_acknowledge({"{ message_id, note? }"})</code>: tell a waiting agent its
          message arrived, without answering yet.
        </li>
        <li>
          A thread is a conversation on the recipient. Its id is the thread id, and a follow-up
          in the same thread continues it, files and all.
        </li>
      </ul>

      <h2 id="logic">Write the parts beside agent.ts</h2>
      <p>
        <code>agent.ts</code> is where a definition is assembled. The parts go in their own
        modules: the prompt is a function in <code>prompt.ts</code>, memory is a{" "}
        <code>*.memory.ts</code> file, the workspace and the call each have a file, the team
        is in <code>lib/team.ts</code>, and the model choice for every layer is in{" "}
        <code>lib/models.ts</code>. See{" "}
        <Link href="/foundry/docs/project-structure#assembly">Project structure</Link>.
      </p>
      <CodeBlock
        filename="tree"
        language="text"
        code={`agents/
  assistant/
    agent.ts              assembly: model per surface, memory, mesh, run
    prompt.ts             how the interactor talks and when it hands work off
    personal.memory.ts    what it knows about the person (glove-memory on SQLite)
    call.ts               the voice call: room and greeting
  coder/
    agent.ts  prompt.ts  workspace.ts
  researcher/
    agent.ts  prompt.ts  workspace.ts      the workspace adds env:fetch
lib/
  team.ts                 each person's agents, as data
  models.ts               one model choice per layer`}
      />

      <h2 id="ask">When a worker needs to ask</h2>
      <p>
        A worker that guesses wastes the whole job. It can message whoever sent the work, and
        the question arrives in the interactor&apos;s conversation:
      </p>
      <CodeBlock
        filename="what the interactor receives"
        language="text"
        code={`<mesh-message id="msg_41c…" thread="thread_9f2c…" from="maya-coder" name="Coder">
Which language should the code be in?
</mesh-message>
Coder (maya-coder) needs an answer to go on. If you know it, reply with glove_mesh_send_message to "maya-coder" with in_reply_to "msg_41c…". Otherwise ask the user first, then reply.`}
      />
      <p>
        The interactor answers straight away if memory or the conversation has the answer, or
        after asking the person. If the worker sent its question with{" "}
        <code>blocking: true</code>, its run waits for up to <code>waitMs</code> (90 seconds by
        default), so a worker holding a browser session or a running sandbox keeps it and gets
        the answer as the tool&apos;s result. If no answer comes in time, the tool tells the
        worker to end its turn; the run finishes as suspended, and the answer later starts a
        new run in the same conversation. Give workers a durable store so that run has the
        history.
      </p>

      <h2 id="results">Where replies go</h2>
      <p>
        When the worker&apos;s run finishes, its final answer is sent back on its own. Foundry
        delivers it, every message and any failure to the conversation that started the thread:
      </p>
      <ul>
        <li>
          <strong>To a run that is listening.</strong> A run can take messages itself with{" "}
          <code>ctx.onMeshMessage(handler)</code>. <Link href="/foundry/docs/voice">
          <code>voiceCall</code></Link> does, so a reply that lands mid-call is spoken at the
          next pause.
        </li>
        <li>
          <strong>Otherwise, as a new turn.</strong> Messages wait until no run holds the
          conversation, then start one run with everything that arrived meanwhile, as{" "}
          <code>&lt;mesh-message&gt;</code> messages with <code>source.kind</code>{" "}
          <code>&quot;mesh&quot;</code>. The final answer carries{" "}
          <code>status=&quot;replied&quot;</code>.
        </li>
      </ul>
      <p>
        While a thread is open, the interactor&apos;s runtime context lists it (&ldquo;Coder
        (maya-coder), thread …: working on …&rdquo;), so it can answer &ldquo;how is that
        going?&rdquo; without a tool call. A failed or cancelled worker run reports back as{" "}
        <code>status=&quot;failed&quot;</code>; a run cancelled by{" "}
        <Link href="/foundry/docs/approvals#steering">steering</Link> does not, because its
        replacement continues the job.
      </p>

      <h2 id="siblings">Peers by id, not imports</h2>
      <p>
        Agents reach each other by instance id. The interactor&apos;s process never loads a
        worker&apos;s code, so a fast voice agent does not start up carrying a sandbox SDK, and
        each agent&apos;s access is decided in its own definition. Pick the boundary by the job:
      </p>
      <table>
        <thead><tr><th>You want…</th><th>Use</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>A fast agent that hands off slow work and hears back</td><td><Link href="/foundry/docs/multi-agent#mesh"><code>mesh</code></Link></td><td>Separate instance, process and conversation per job. Replies and questions come back.</td></tr>
          <tr><td>A bounded sub-task answered inside this turn</td><td><Link href="/foundry/docs/multi-agent#subagents"><code>defineSubagent</code></Link></td><td>Runs inside the parent&apos;s tool call; the parent waits for it.</td></tr>
          <tr><td>Start separate work and never hear back</td><td><Link href="/foundry/docs/multi-agent#spawn"><code>glove_foundry_spawn</code></Link></td><td>Fire and forget, with a run id in the trace.</td></tr>
          <tr><td>Fan out from code you control</td><td><Link href="/foundry/docs/multi-agent#client-fan-out">the typed client</Link></td><td>Deterministic orchestration in a <code>run</code>.</td></tr>
        </tbody>
      </table>

      <h2 id="access">Keep access where it belongs</h2>
      <ul>
        <li><strong>The person stays with layer 1.</strong> Workers have no tool that reaches them; a question goes through the interactor, which decides whether to ask.</li>
        <li><strong>Memory stays with layer 1.</strong> Put personal memory on the interactor only. It passes on what a job needs, in the message.</li>
        <li><strong>Reach stays with the worker that needs it.</strong> The coder has a sandbox, the researcher has the web. Neither has the other&apos;s.</li>
        <li><strong>Who may talk to whom is data.</strong> Peers are the agents in the same workspace. <code>mesh.peers(self, peer)</code> narrows that from instance data; a worker with <code>peers: () =&gt; false</code> can still answer whoever messaged it, and nothing else.</li>
        <li><strong>Approvals happen where the risk is.</strong> A worker&apos;s <code>requiresPermission</code> tool pauses on an <Link href="/foundry/docs/approvals">approval record</Link> like any other run.</li>
      </ul>

      <h2 id="how-it-works">How it works</h2>
      <p>
        A thread is a conversation on the recipient whose <code>context.meshThread</code> holds
        the record. The conversation that started it keeps the thread ids in{" "}
        <code>context.meshThreads</code>. Foundry updates the record as the job moves:
      </p>
      <CodeBlock
        filename="FoundryMeshThread"
        language="typescript"
        code={`interface FoundryMeshThread {
  id: string;                 // also the recipient conversation's id
  workspaceId: string;
  from: { agentId: string; name: string; definitionId: string; conversationId: string; runId: string };
  to: { agentId: string; name: string; definitionId: string };
  subject: string;            // the first message, shortened
  status: "working" | "waiting" | "replied" | "failed" | "cancelled";
  messageIds: string[];       // so either side can reply to one
  question?: string;          // the recipient's open question, while waiting
  reply?: string;             // the recipient's last reply
  error?: string;
  undelivered?: FoundryMeshMessage[];   // owed to the starter's conversation
  pending?: FoundryMeshMessage[];       // owed to the recipient
  createdAt: string;
  updatedAt: string;
}`}
      />
      <table>
        <thead><tr><th>Moment</th><th>What Foundry does</th><th>Event on the trace</th></tr></thead>
        <tbody>
          <tr><td>A new message</td><td>Checks the recipient is a peer, creates the thread conversation on it, and starts a run there with the message.</td><td><code>mesh.thread.started</code></td></tr>
          <tr><td>A message in a thread</td><td>Marks the thread <code>waiting</code> (a question to the starter) or <code>working</code> (an answer or more work), and delivers it to the other side.</td><td><code>mesh.message.sent</code></td></tr>
          <tr><td>A message it may not send</td><td>Refuses it in the tool&apos;s result: an unknown agent, one outside the peers rule, or a reply to a message not in its threads.</td><td><code>mesh.refused</code></td></tr>
          <tr><td>The recipient&apos;s run completes</td><td>Unless it suspended (asleep or waiting for an answer), sends its final text back as a <code>reply</code>.</td><td><code>mesh.thread.replied</code></td></tr>
          <tr><td>The recipient&apos;s run fails or is cancelled</td><td>Records the error and sends a <code>failed</code> message.</td><td><code>mesh.thread.failed</code>, <code>mesh.thread.cancelled</code></td></tr>
          <tr><td>Any delivery</td><td>Into a listening run (<code>mode: &quot;live&quot;</code>) or a new run (<code>mode: &quot;run&quot;</code>).</td><td><code>mesh.delivered</code></td></tr>
        </tbody>
      </table>
      <ul>
        <li>A run whose blocking send got no reply in time ends with <code>status: &quot;suspended&quot;</code> and <code>suspension: {"{ kind: \"mesh\", commandId, threadId, messageId }"}</code>.</li>
        <li><code>runtime.listThreads({"{ agentId?, conversationId?, to?, status? }"})</code> lists threads.</li>
        <li>In a resolver, <code>ctx.threads</code> holds the open threads this conversation started, and <code>ctx.thread</code> is set when the run works on a thread another agent started.</li>
        <li><code>mesh.mount(ctx)</code> decides per run whether the tools are mounted, so a read-only run can have none.</li>
        <li>A message waiting for a busy conversation is recorded on the thread (<code>undelivered</code>, <code>pending</code>) until it is handed over, so a restart (including the one <code>glove foundry dev</code> does on every save) hands it over when the runtime starts again. Use a durable data adapter for this to hold across processes.</li>
        <li>Threads nest: a worker on the mesh can message agents of its own.</li>
      </ul>
    </article>
  );
}
