import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/team";
export const metadata = docsMetadata(HREF);

export default function BuildTeamPage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Split the work</h1>
      <p className="blog-lede">
        One agent with every tool and every instruction gets slower and less careful
        as it grows. Splitting it gives each agent its own context, tools and model.
        Glove has two shapes for this: a <strong>subagent</strong>, which the parent
        calls like a tool and waits for, and <strong>mesh</strong>, where peers send
        each other messages.
      </p>

      <HarnessDiagram highlight="team" />

      <h2 id="subagent">A subagent is a tool</h2>
      <p>
        The release assistant should not grade its own release notes. A reviewer with
        a fresh context, read-only tools and a cheaper model does it better:
      </p>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import { Glove, Displaymanager, type GloveFoldArgs } from "glove-core";

// Defined once, given to both agents: least privilege by construction.
const listMergedChanges: GloveFoldArgs<{ since: string }> = { /* the tool from step 1 */ };

agent.defineSubAgent({
  name: "reviewer",
  description: "Checks draft release notes against what actually merged. Read-only.",
  async factory({ parentStore }) {
    const store = await parentStore.createSubAgentStore!("reviewer");
    return new Glove({
      store,
      model: createAdapter({ provider: "anthropic", model: "claude-haiku-3-5-20241022" }),
      displayManager: new Displaymanager(),
      systemPrompt:
        "You review release notes. Every line must match a merged pull request. " +
        "Reply with the problems you found, or 'OK'.",
      compaction_config: { compaction_instructions: "Summarise the review." },
    })
      .fold(listMergedChanges)
      .build();
  },
});`}
      />
      <p>
        Defining a subagent registers <code>glove_invoke_subagent</code> on the
        parent, with the list of subagents in its description. The model decides when
        to call it (a user typing <code>@reviewer</code> nudges it) and passes a task.
        The factory builds the child, the child runs to completion, and its final
        answer comes back as the tool result. The parent&apos;s subscribers see the
        child&apos;s events between <code>subagent_invoked</code> and{" "}
        <code>subagent_completed</code>, so a UI can show the review happening. Pass{" "}
        <code>durable: true</code> to <code>createSubAgentStore</code> and the child
        keeps its history across calls.
      </p>
      <p>Common subagents worth splitting out:</p>
      <ul>
        <li><strong>Memory readers.</strong> One per retrieval task, each with only the memory tools it needs; the main agent stays small.</li>
        <li><strong>Explorers.</strong> Search a codebase or the web with a big context, return a short answer.</li>
        <li><strong>Reviewers and critics.</strong> Fresh eyes, read-only tools.</li>
        <li><strong>Discovery.</strong> <code>glove-mcp</code>&apos;s server discovery is a subagent; so is a classifier-backed triage step.</li>
      </ul>

      <h2 id="mesh">Peers: mesh</h2>
      <p>
        When two agents run independently (the release assistant and an on-call agent,
        say) neither should block on the other. <code>mountMesh</code> gives each agent{" "}
        <code>glove_mesh_send_message</code>, <code>_broadcast</code>,{" "}
        <code>_list_agents</code> and <code>_acknowledge</code>. A message lands in the
        recipient&apos;s <Link href="/docs/build/state#inbox">inbox</Link> and reaches
        it on its next turn, exactly like any other resolved inbox item.
      </p>
      <CodeBlock
        filename="agents.ts"
        language="typescript"
        code={`import { mountMesh } from "glove-mesh";
import { InMemoryMeshAdapter, MeshNetwork } from "glove-mesh/in-memory";

const network = new MeshNetwork();   // in-process; bring your own transport for real deployments

await mountMesh(release, {
  adapter: new InMemoryMeshAdapter(network, "release"),
  identity: { id: "release", name: "Release assistant", description: "Drafts and ships releases." },
});
await mountMesh(oncall, {
  adapter: new InMemoryMeshAdapter(network, "oncall"),
  identity: { id: "oncall", name: "On-call", description: "Watches production health." },
});`}
      />
      <p>
        The <code>MeshAdapter</code> is the transport: implement it over Redis, NATS
        or your database to run agents in different processes.{" "}
        <Link href="/docs/continuum">Continuum</Link> supervises agents as
        subprocesses, cold per wake-up or warm, and pairs with mesh for talking.
        Mesh has no authentication of its own; sender ids are whatever the transport
        says they are.
      </p>

      <h2 id="which">Which one?</h2>
      <table>
        <thead><tr><th>You want…</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td>To delegate a task and use the answer in this turn</td><td>A subagent</td></tr>
          <tr><td>To tell another agent something, or ask without waiting</td><td>Mesh</td></tr>
          <tr><td>Agents that run as separate, supervised processes</td><td>Continuum (+ mesh)</td></tr>
          <tr><td>A durable agent per customer to start another&apos;s run, or a schedule</td><td>Foundry: spawn, calls and shared work, in <Link href="/docs/build/system">step 7</Link></td></tr>
        </tbody>
      </table>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["team"]} />

      <h2 id="next">Next</h2>
      <p>
        That is the whole harness: loop, tools, surface, context, state, workspace and
        a team. So far it is one agent for one team, running in one process. In{" "}
        <Link href="/docs/build/system">step 7</Link> it becomes a system: one
        definition, an instance per team, conversations, a weekly schedule, a Slack
        channel and an approval before anything is published.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
