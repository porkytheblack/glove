import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint, SystemDiagram } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses/workforce");

export default function WorkforceHarnessPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprint</span>
      <h1>Multi-agent workforce</h1>
      <p className="blog-lede">
        A workforce is many harnesses working on one outcome: a lead that splits the work,
        specialists that each own a part, and a record of who is doing what. The hard parts are
        not the agents. They are starting the right agents when work arrives, handing results
        between runs that do not overlap in time, and seeing what happened afterwards. Foundry
        has a primitive for each, so the workforce is mostly prompts and definitions.
      </p>

      <Blueprint
        uses={[
          "Agent loop",
          "Model adapters",
          "Tools",
          "Runtime context providers",
          "Store",
          "Virtual filesystem",
          "Working environment",
          "Subagents",
          "Mesh",
          "Definitions",
          "Instances",
          "Conversations",
          "Shared work",
          "Data adapters",
          "Schedules",
          "Spawn and background",
          "Playbooks",
          "Subscriptions",
          "Approvals",
          "Steering",
          "Inspector and WebChat",
          "Event stream",
          "Typed client",
          "Zero-config deploys",
          "Persistent disk",
          "Managed databases and buckets",
          "Model gateway",
          "Agent inspection",
          "Usage and budgets",
        ]}
        write={[
          "One definition per role, each with its own prompt and the fewest tools that role needs",
          "The lead's prompt: who exists, how work is handed out, what done looks like",
          "An inboxes resolver that hands each result to the conversation waiting for it",
          "A mesh transport (Redis, NATS…) if peers must talk while both are running",
        ]}
      />

      <h2 id="pick-the-boundary">Pick the smallest boundary for each hand-off</h2>
      <p>
        Most multi-agent designs fail by using one mechanism for everything. Each hand-off in a
        workforce has a shape, and Foundry has a primitive for each shape:
      </p>
      <table>
        <thead>
          <tr><th>The hand-off</th><th>Use</th><th>The result comes back</th></tr>
        </thead>
        <tbody>
          <tr><td>A bounded sub-task the lead waits for, with fewer tools</td><td><code>defineSubagent</code></td><td>As the lead&apos;s tool result, in the same run</td></tr>
          <tr><td>Separate durable work that should run on its own</td><td><code>glove_foundry_spawn</code></td><td>Through the shared inbox, a task or a workspace entry</td></tr>
          <tr><td>Peers that must talk while both are working</td><td><code>mesh</code></td><td>In the receiver&apos;s inbox, on its next turn</td></tr>
          <tr><td>A result that may outlive any one run</td><td>Workspace entries, tasks, the shared inbox</td><td>Whenever someone reads it</td></tr>
          <tr><td>Work arriving from outside should start a team</td><td>A playbook subscription</td><td>Provisioned instances, each with a run</td></tr>
          <tr><td>Fan-out and fan-in that your code controls</td><td>The typed client</td><td><code>handle.wait()</code></td></tr>
        </tbody>
      </table>

      <h2 id="how-it-fits">How it fits together</h2>
      <p>
        A brief arrives through a transmission. A subscription matches it and provisions a lead
        instance for that brief (<code>provisioning: {"{ mode: \"per-thread\" }"}</code>), so two
        briefs never share a lead. The lead&apos;s first run writes a plan as tasks with{" "}
        <code>glove_foundry_tasks</code>, then calls <code>glove_foundry_spawn</code> once per
        specialist: a researcher and a writer, each a new instance with its own conversation,
        queued at once. The lead&apos;s run ends; it does not wait.
      </p>
      <p>
        The researcher saves its findings to a file and posts a shared inbox item addressed to
        the lead&apos;s conversation with the path, not the body. When the lead runs next (on the
        writer&apos;s report, or on a schedule that checks progress), its <code>inboxes</code>{" "}
        resolver loads the items posted to it and Glove injects them into that turn. Tasks move from{" "}
        <code>open</code> to <code>completed</code> as each part lands. Anything that publishes
        is permission-gated, so the final step waits on an approval. The inspector shows the
        whole tree: the arrival, the provisioned lead, every spawned run, each model and tool
        call, and the approval.
      </p>
      <SystemDiagram caption="A workforce is the system layer used many times over: one arrival provisions a lead, the lead's runs spawn specialists, and every run's events land in one inspector." />

      <h2 id="skeleton">Skeleton</h2>
      <CodeBlock
        filename="agents/"
        language="text"
        code={`lead/agent.ts                       plans, spawns specialists, assembles, publishes (gated)
lead/subscriptions/brief.subscription.ts   one lead per incoming brief
researcher/agent.ts                 sources and numbers; writes files, reports by shared inbox
writer/agent.ts                     drafts from the researcher's files`}
      />
      <CodeBlock
        filename="agents/lead/agent.ts"
        language="typescript"
        code={`import type { InboxItem } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { defineAgent, defineSubagent } from "glove-foundry";
import { Effect } from "effect";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js";
import { publish } from "../../lib/publish.js"; // your code: where finished work goes

export default defineAgent({
  description: "Leads one brief: plans it, hands out the parts, assembles the result",
  model: () => createAdapter({ provider: "anthropic", model: "claude-sonnet-5-5" }),
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: (_agent, ctx) => \`You lead the team for one brief (conversation \${ctx.conversationId}).
1. Write the plan as tasks with glove_foundry_tasks.
2. Start specialists with glove_foundry_spawn: definitionId "researcher" for sources and numbers,
   "writer" for drafts. Give each the conversation id above so it can report back.
3. Specialists post results to the shared inbox as file paths. Never paste documents.
4. When every task is completed, assemble and call publish.\`,
  // Hand each shared-inbox item posted to this conversation to the model, once.
  // glove_foundry_shared_inbox "post" creates items as "pending".
  inboxes: async (_agent, ctx) => {
    const items = await Effect.runPromise(ctx.data.listInboxItems(ctx.workspaceId));
    const ready = items.filter((item) => item.conversationId === ctx.conversationId && item.status === "pending");
    for (const item of ready) {
      await Effect.runPromise(ctx.data.putInboxItem({ ...item, status: "dismissed", updatedAt: new Date().toISOString() }));
    }
    return ready.map((item): InboxItem => ({
      id: item.id,
      tag: item.topic,
      request: \`Result: \${item.topic}\`,
      response: JSON.stringify(item.payload).slice(0, 4_000),
      status: "resolved",
      blocking: false,
      created_at: item.createdAt,
      resolved_at: item.updatedAt,
    }));
  },
  tools: [
    {
      name: "publish",
      description: "Publish the finished deliverable.",
      inputSchema: z.object({ path: z.string() }),
      requiresPermission: true, // a person signs off in the inspector or your UI
      async do({ path }) {
        return { status: "success" as const, data: await publish(path) };
      },
    },
  ],
  subagents: [
    defineSubagent({
      name: "editor",
      description: "Review a draft for gaps and contradictions. Read-only; returns notes.",
      systemPrompt: "Review the draft you are given. Return a short list of concrete problems.",
    }),
  ],
});`}
      />
      <p>
        A specialist reports back with the same built-in tools every Foundry agent has. Its
        prompt tells it to finish with{" "}
        <code>glove_foundry_shared_inbox({"{ action: \"post\", topic, payload, conversationId }"})</code>{" "}
        addressed to the lead&apos;s conversation, and to mark its task completed with{" "}
        <code>glove_foundry_tasks</code>. The subscription that starts a lead per brief follows the{" "}
        <Link href="/foundry/docs/automation#subscriptions">urgent-ticket example</Link> with{" "}
        <code>provisioning: {"{ mode: \"per-thread\" }"}</code>.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          Each Foundry run is its own process, so an in-memory mesh cannot connect two runs.
          When peers must talk while both are running, give the <code>mesh</code> field a
          transport-backed adapter, or build the whole team inside one run as{" "}
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-braind-storm">
            braind-storm
          </a>{" "}
          does. Files several instances share need a shared backend too: give each working
          environment the same <code>cachedRemote</code> VFS over a bucket.
        </p>
      </div>

      <h2 id="dont-build">What not to build</h2>
      <ul>
        <li>
          <strong>An orchestrator service that creates agents for incoming work.</strong>{" "}
          <Link href="/foundry/docs/automation#subscriptions">Subscriptions</Link> provision zero,
          one or many instances per event, atomically and idempotently.
        </li>
        <li>
          <strong>A job queue between agents.</strong>{" "}
          <Link href="/foundry/docs/multi-agent#spawn"><code>glove_foundry_spawn</code></Link>{" "}
          queues a durable run on another instance and returns at once.
        </li>
        <li>
          <strong>Coordination tables.</strong>{" "}
          <Link href="/foundry/docs/conversations#workspace">Workspace entries, tasks and the shared inbox</Link>{" "}
          are already persisted, and <code>compareAndSetWorkspaceEntry</code> gives you an atomic
          claim so only one agent takes a job.
        </li>
        <li>
          <strong>A message bus for live peers.</strong> <Link href="/docs/mesh">Mesh</Link>{" "}
          delivers into inboxes, with blocking sends and acknowledgements, over a transport you
          supply.
        </li>
        <li>
          <strong>A dashboard to see what the team did.</strong> The{" "}
          <Link href="/foundry/docs/observability">inspector</Link> correlates every run by
          definition, instance, conversation and run, and{" "}
          <Link href="/foundry/docs/approvals#steering">steering</Link> redirects work in place.
        </li>
      </ul>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <ol>
        <li>
          Deploy the Foundry app as one unit. Every definition and instance runs inside it; Kuiper
          keeps one replica of a unit with a volume, which is what one runtime per data store
          needs (two runtimes on one store would both fire its schedules).
        </li>
        <li>
          Keep the data adapter, transcripts and memory on <code>/data</code>. When the team&apos;s
          files outgrow the volume or must be shared, put them in a{" "}
          <a href="https://kuiper.sh/docs/databases/">Kuiper bucket</a> behind a{" "}
          <code>cachedRemote</code> VFS; its credentials arrive as variables.
        </li>
        <li>
          Route every role&apos;s model through the gateway. <code>kuiper models usage --by unit</code>{" "}
          shows what the workforce costs, and a{" "}
          <a href="https://kuiper.sh/docs/budgets/">budget</a> can notify or block before it
          surprises you.
        </li>
        <li>
          Watch it from the project&apos;s Agents page: instances, runs and failures for every
          definition, read from the app&apos;s own API.
        </li>
      </ol>
      <p>
        Full walkthrough: <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>.
      </p>

      <h2 id="further">Go further</h2>
      <ul>
        <li>
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-braind-storm">
            examples/foundry-braind-storm
          </a>
          : a brand workforce of five agents over mesh, with a shared working environment, image
          generation, parallel campaigns and a live observatory.
        </li>
        <li>
          Build the parts one at a time: <Link href="/docs/build/team">split the work</Link>,{" "}
          <Link href="/docs/build/system">make it a system</Link>.
        </li>
        <li>
          Reference: <Link href="/foundry/docs/multi-agent">Multi-agent systems</Link>,{" "}
          <Link href="/foundry/docs/conversations">Conversations &amp; shared work</Link>,{" "}
          <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>,{" "}
          <Link href="/docs/mesh">Mesh</Link>.
        </li>
      </ul>
    </article>
  );
}
