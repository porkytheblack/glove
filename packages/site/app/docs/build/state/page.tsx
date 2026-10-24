import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/state";
export const metadata = docsMetadata(HREF);

export default function BuildStatePage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Make it remember</h1>
      <p className="blog-lede">
        State is everything that outlives one model call. A harness needs four kinds:
        the conversation itself, work waiting on something outside, what it has
        learned, and what it is trying to finish. Glove has a primitive for each, and
        they all sit behind adapters you can point at your own storage.
      </p>

      <HarnessDiagram highlight="state" />

      <h2 id="store">The conversation: a store</h2>
      <p>
        Every Glove has a <code>StoreAdapter</code>. It holds the messages, token and
        turn counts, and optionally tasks, permission decisions, inbox items and child
        stores for subagents. <code>MemoryStore</code> implements all of it in memory.
        For a store that survives a restart, implement the interface over your
        database, or extend <code>MemoryStore</code> and write through to disk:
      </p>
      <CodeBlock
        filename="the StoreAdapter contract (abridged)"
        language="typescript"
        code={`interface StoreAdapter {
  identifier: string
  getMessages(): Promise<Message[]>
  appendMessages(msgs: Message[]): Promise<void>
  getTokenCount(): Promise<number>
  addTokens(tokens: TokenConsumptionCounter): Promise<void>
  getTurnCount(): Promise<number>
  incrementTurn(): Promise<void>
  resetCounters(): Promise<void>

  // Optional. Implement them and the matching feature switches on.
  getTasks?(); addTasks?(); updateTask?()                       // → glove_update_tasks
  getPermission?(); setPermission?()                            // → requiresPermission
  getInboxItems?(); addInboxItem?(); updateInboxItem?(); getResolvedInboxItems?()  // → inbox
  createSubAgentStore?(namespace, durable?)                     // → subagents with their own history
}`}
      />
      <p>
        <code>glove foundry init</code> generates <code>lib/file-store.ts</code>, a
        complete file-backed store built exactly this way; copy it for a single-host
        app. Several hosts need a database-backed store. In{" "}
        <Link href="/docs/build/system">step 7</Link>, Foundry asks you for one store
        per conversation and calls it for you.
      </p>

      <h2 id="inbox">Work that finishes later: the inbox</h2>
      <p>
        &quot;Tag the release once CI is green&quot; can&apos;t finish now. With a
        store that supports the inbox, the agent gets{" "}
        <code>glove_post_to_inbox</code>: it posts the request (blocking or not) and
        moves on. Anything (a webhook handler, a job, another agent) resolves it
        later, and the result is injected at the start of the next request:
      </p>
      <CodeBlock
        filename="ci-webhook.ts"
        language="typescript"
        code={`// The agent earlier called glove_post_to_inbox({ tag: "ci", request: "Tell me when main is green", blocking: true })
const pending = (await store.getInboxItems!()).filter((i) => i.tag === "ci" && i.status === "pending");
for (const item of pending) {
  await store.updateInboxItem!(item.id, {
    status: "resolved",
    response: "main is green at 9f3c2a1",
    resolved_at: new Date().toISOString(),
  });
}
// Then run a turn so the agent sees it, e.g. agent.processRequest("CI finished.")`}
      />
      <p>
        While a blocking item is pending, every model call is reminded that it may not
        act on the missing result. That is the whole protocol; there is no polling to
        write. <Link href="/docs/mesh">Mesh</Link> delivers messages between agents
        through this same inbox, and Kuiper&apos;s email tools use it to wait for
        replies.
      </p>

      <h2 id="memory">What it learns: glove-memory</h2>
      <p>
        <code>glove-memory</code> splits memory into what each kind is for: an{" "}
        <strong>entity</strong> graph (people, projects, how they relate), an{" "}
        <strong>episodic</strong> timeline (what happened when), a{" "}
        <strong>resource</strong> filesystem (documents the agent files), and{" "}
        <strong>pinned context</strong> (standing facts every turn should see). Each is
        an adapter with reader and curator tool sets, and every write carries
        provenance. The release assistant pins the team&apos;s conventions:
      </p>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import { MemorySchema } from "glove-memory";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { useContext } from "glove-memory/tools";

const memory = createSqliteMemoryAdapters({
  file: "./.data/memory.db",          // a durable file, Node 22.13+
  namespace: "team:acme/release",     // trusted ownership key, never model input
  schema: new MemorySchema(),
});

// glove_context_set / _get / _update / _unset, and every pinned entry
// delivered as runtime context before each model call (step 3's seam).
useContext(agent, memory.context);`}
      />
      <p>
        Now &quot;we never ship on Fridays&quot; becomes a pinned entry the agent sees
        on every call, including next week. For recall over people and history, don&apos;t
        hang every memory tool on the main agent: give a{" "}
        <Link href="/docs/build/team">subagent</Link> the reader tools and let the main
        agent ask it. <Link href="/docs/memory">Memory</Link> explains why.
      </p>

      <h2 id="objectives">What it is trying to finish: facts, forms and goals</h2>
      <p>Pick the smallest primitive that fits what you need to collect:</p>
      <table>
        <thead><tr><th>You need…</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td>Every argument now, from the model</td><td>A plain tool</td></tr>
          <tr><td>Standing information on every turn</td><td>Pinned context: <code>useContext</code></td></tr>
          <tr><td>Details people mention early, reused later</td><td>Facts: <code>useFacts</code> → <code>record_fact</code></td></tr>
          <tr><td>A specific set of validated answers, maybe in steps, then an action</td><td>Forms: <code>defineForm</code> + <code>useFormRunner</code></td></tr>
          <tr><td>Exact input or a final confirm that must not pass through the model</td><td>A display-stack form: <code>pushAndWait</code></td></tr>
          <tr><td>Obligations across the whole conversation</td><td>Goals: <code>useGoalRunner</code></td></tr>
        </tbody>
      </table>
      <p>
        Forms and goals show their live state through runtime context, so the agent
        never loses track of what is left, however much the person wanders.{" "}
        <Link href="/docs/goal-oriented-agents">Goal-oriented agents</Link> builds one
        end to end.
      </p>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["state"]} />

      <h2 id="next">Next</h2>
      <p>
        The assistant remembers the team. To draft real release notes it needs to
        read diffs, run scripts and produce files. In{" "}
        <Link href="/docs/build/workspace">step 5</Link> it gets a workspace.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
