import { CodeBlock } from "@/components/code-block";

export default async function ContinuumPage() {
  return (
    <div className="docs-content">
      <h1>Continuum (Runtime Substrate)</h1>

      <p>
        <code>glove-continuum-signal</code> is the runtime substrate for
        agents that collaborate across time. It supervises Glove agents as
        node subprocesses, drives their lifecycle, and forwards their event
        streams upstream — the same way{" "}
        <a href="https://station.dterminal.net">station-signal</a> supervises
        background jobs. Two execution modes:
      </p>

      <ul>
        <li>
          <strong>Triggered (asynchronous)</strong> — agents are cold by
          default. An external force (<code>.trigger(input)</code>, a schedule
          fire, an inbound mesh message) wakes them. They resume their
          persistent store, run a turn, return, go cold. Each wakeup spawns a
          fresh subprocess.
        </li>
        <li>
          <strong>Concurrent (synchronous)</strong> — agents are warm in
          long-lived subprocesses. The runner keeps them alive and pushes
          notifications inline via <code>runner.notify(name, input)</code>;
          mid-loop pickup is immediate, no spawn latency.
        </li>
      </ul>

      <p>
        The substrate is <strong>not</strong> an inter-agent protocol. That&apos;s{" "}
        <a href="/docs/mesh"><code>glove-mesh</code></a>&apos;s job. Continuum
        gives mesh a stable per-agent identity, a persistent inbox-capable
        store, and a long-lived subprocess for warm agents — mesh runs
        entirely inside that subprocess against whatever transport the
        consumer&apos;s <code>MeshAdapter</code> provides.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-continuum-signal`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>When to use continuum</h2>

      <ul>
        <li>You want agents to keep state across many wakeups (continuity-of-context for triggered agents).</li>
        <li>You need multiple long-running agents in the same deployment, each with isolated subprocesses but observed centrally.</li>
        <li>You want to fire agent work from an HTTP handler, cron schedule, or webhook and have it picked up async — like a background job, but the job is a full Glove agent.</li>
        <li>You want mesh between agents on the same host without standing up an external broker — pair continuum with the example <code>FilesystemMeshAdapter</code>.</li>
      </ul>

      <p>
        For a single in-process agent in a Next.js handler, you don&apos;t need
        continuum — keep using{" "}
        <a href="/docs/getting-started"><code>createChatHandler</code></a>.
        Continuum earns its keep once you have a fleet.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The agent builder</h2>

      <p>
        Define agents the same way you define{" "}
        <a href="https://station.dterminal.net">station signals</a> — a fluent
        builder ending with <code>.factory(ctx =&gt; Glove)</code>. The
        builder forks into mode-specific shapes after{" "}
        <code>.triggered()</code> / <code>.concurrent()</code>, so{" "}
        <code>.retries()</code> / <code>.every()</code> /{" "}
        <code>.withInput()</code> are only available on triggered (a type
        error otherwise, not a runtime error).
      </p>

      <CodeBlock
        filename="agents/pizza-baker.ts"
        language="typescript"
        code={`import { agent, z } from "glove-continuum-signal";
import { Glove, Displaymanager } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { MyPersistentStore } from "../infra/store.js";

export const pizzaBaker = agent("pizza-baker")
  .input(z.object({ orderId: z.string() }))
  .output(z.object({ ready: z.boolean() }))
  .triggered()
  .timeout(60_000)
  .retries(2)
  .every("5m").withInput({ orderId: "tick" })
  .env({ OVEN: "hot" })
  .store((name) => new MyPersistentStore(\`./agents/\${name}.db\`))
  .onComplete(async (out, in_) => audit(out, in_))
  .factory(async (ctx) => {
    return new Glove({
      store: ctx.store ?? undefined,
      model: createAdapter({ provider: "anthropic" }),
      displayManager: new Displaymanager(),
      systemPrompt: "You bake pizzas.",
      compaction_config: { compaction_instructions: "Summarize the conversation so far." },
    })
      .fold(checkOrderTool)
      .build(ctx.store ?? undefined);
  });

// Elsewhere — fire-and-forget. Returns a run id immediately.
const runId = await pizzaBaker.trigger({ orderId: "abc-123" });`}
      />

      <p>
        For a concurrent (warm) agent, swap <code>.triggered()</code> for{" "}
        <code>.concurrent()</code>. Concurrent agents expose{" "}
        <code>.notify(input)</code> in addition to <code>.trigger(input)</code>
        — both enqueue a <code>kind: &quot;notify&quot;</code> run that routes
        to the warm subprocess.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The runner</h2>

      <p>
        <code>ContinuumRunner</code> discovers branded agents from{" "}
        <code>agentsDir</code> (or accepts explicit{" "}
        <code>registerAgent(a, filePath)</code> calls), pre-warms concurrent
        ones at start, supervises with a restart policy, dispatches due
        triggered/recurring runs from the adapter queue, and translates IPC
        envelopes from children back into adapter status updates. The parent
        runner is single source of truth for run status — children never
        write to the adapter directly.
      </p>

      <CodeBlock
        filename="runner.ts"
        language="typescript"
        code={`import {
  ContinuumRunner,
  MemoryAdapter,
  ConsoleSubscriber,
} from "glove-continuum-signal";

const runner = new ContinuumRunner({
  agentsDir: "./agents",                  // auto-discover *.ts / *.js exports
  adapter: new MemoryAdapter(),           // or your own ContinuumAdapter
  subscribers: [new ConsoleSubscriber()],
  pollIntervalMs: 1_000,
  maxConcurrent: 5,                       // triggered-run budget
  warmRestartPolicy: { maxRestarts: 5, backoffMs: 1_000 },
});

await runner.start();

// Triggered: spawn-per-wakeup. Returns a run id immediately.
const runId = await pizzaBaker.trigger({ orderId: "abc-123" });
const final = await runner.waitForRun(runId);

// Concurrent: routes to the warm subprocess inline.
const notifyId = await runner.notify("pizza-watcher", { event: "oven_ready" });
await runner.waitForRun(notifyId);

await runner.stop({ graceful: true, timeoutMs: 10_000 });`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Persistent stores</h2>

      <p>
        Triggered agents need a <code>StoreAdapter</code> that survives across
        subprocess wakeups, otherwise they lose conversation history every
        time. Configure one via <code>.store(name =&gt; …)</code>:
      </p>

      <CodeBlock
        filename="agents/persistent.ts"
        language="typescript"
        code={`agent("my-agent")
  .input(z.object({ /* ... */ }))
  .triggered()
  .store((name) => new SqliteStore({ dbPath: \`./agents/\${name}.db\` }))
  .factory(async (ctx) => new Glove({ store: ctx.store ?? undefined, /* ... */ }).build(ctx.store ?? undefined));`}
      />

      <p>
        Discovery emits a warning for triggered agents that omit{" "}
        <code>.store(...)</code>: they default to in-process{" "}
        <code>MemoryStore</code> which resets per-wakeup, defeating the
        substrate&apos;s purpose. Concurrent agents are typically fine with{" "}
        <code>MemoryStore</code> because their subprocess is long-lived —
        though you still want persistence if the runner can restart.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Mesh integration</h2>

      <p>
        Mesh is mounted per-agent inside the factory — the substrate exposes
        no special IPC machinery for it. Each agent supplies its own{" "}
        <code>MeshAdapter</code> (transport is the consumer&apos;s choice):
      </p>

      <CodeBlock
        filename="agents/watcher.ts"
        language="typescript"
        code={`import { mountMesh } from "glove-mesh";
import { makeRedisMeshAdapter } from "../infra/mesh.js";

agent("pizza-watcher")
  .input(z.object({ event: z.string() }))
  .concurrent()
  .store((name) => new MyInboxCapableStore(\`./agents/\${name}.db\`))
  .factory(async (ctx) => {
    const glove = new Glove({ store: ctx.store ?? undefined, /* ... */ }).build();

    await mountMesh(glove, {
      adapter: makeRedisMeshAdapter(ctx.name),
      identity: { id: ctx.name, name: ctx.name, description: "Watches for oven events." },
    });

    return glove;
  });`}
      />

      <p>
        <code>mountMesh</code> requires an inbox-capable store —{" "}
        <code>getInboxItems</code> / <code>addInboxItem</code> /{" "}
        <code>updateInboxItem</code> / <code>getResolvedInboxItems</code>.
        Glove&apos;s default <code>MemoryStore</code> already implements them;
        custom stores must too. <code>InMemoryMeshAdapter</code> from{" "}
        <code>glove-mesh</code> only works within a single process — for
        cross-subprocess agent-to-agent transport, pick a real adapter (Redis,
        NATS, HTTP webhooks, …) or use the example{" "}
        <code>FilesystemMeshAdapter</code> shipped in the package&apos;s tests.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Observability</h2>

      <p>
        <code>ContinuumSubscriber</code> exposes lifecycle callbacks
        (<code>onAgentDiscovered</code>, <code>onAgentSpawned</code>,{" "}
        <code>onAgentReady</code>, <code>onAgentTerminated</code>,{" "}
        <code>onAgentRestarted</code>, <code>onRunDispatched</code>,{" "}
        <code>onRunStarted</code>, <code>onRunCompleted</code>,{" "}
        <code>onRunFailed</code>, <code>onRunTimeout</code>,{" "}
        <code>onRunRetry</code>, <code>onRunCancelled</code>,{" "}
        <code>onRunSkipped</code>, <code>onRunRescheduled</code>,{" "}
        <code>onNotifyDelivered</code>, <code>onCompleteError</code>,{" "}
        <code>onLogOutput</code>) plus a single fat{" "}
        <code>onAgentEvent(envelope)</code> that forwards every Glove{" "}
        <code>SubscriberEvent</code> from any child subprocess upstream,
        wrapped with the agent identity.
      </p>

      <CodeBlock
        filename="subscribers.ts"
        language="typescript"
        code={`import type { ContinuumSubscriber } from "glove-continuum-signal";

const metrics: ContinuumSubscriber = {
  onRunCompleted: (e) => stats.inc("runs.completed", { agent: e.run.agentName }),
  onRunFailed:    (e) => stats.inc("runs.failed",    { agent: e.run.agentName }),
  onAgentEvent: (env) => {
    if (env.event_type === "tool_use") {
      stats.inc("tool_calls", { agent: env.agentName, tool: (env.data as any).name });
    }
  },
};

const runner = new ContinuumRunner({ subscribers: [metrics] });`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Trust model</h2>

      <ul>
        <li>
          A registered agent file is <code>await import()</code>-ed during
          discovery and runs in a subprocess with the parent&apos;s
          environment. <code>agentsDir</code> should never point at
          user-influenced content.
        </li>
        <li>
          As defense in depth, <code>NODE_OPTIONS</code>,{" "}
          <code>LD_PRELOAD</code>, <code>LD_LIBRARY_PATH</code>, and{" "}
          <code>DYLD_INSERT_LIBRARIES</code> are stripped from the parent
          env before forwarding, and an agent&apos;s <code>.env({"{...}"})</code>{" "}
          cannot override them.
        </li>
        <li>
          For warm concurrent subprocesses, the parent validates that{" "}
          <code>notify:*</code> envelope <code>runId</code>s belong to the
          sending subprocess (<code>pendingNotifies</code> ownership check) —
          a misbehaving warm child can&apos;t spoof another agent&apos;s run
          completion.
        </li>
        <li>
          Warm subprocesses get a per-name restart budget that resets after
          60s of post-<code>ready</code> stability, so a long-running
          deployment doesn&apos;t permanently lose its warm agents to
          occasional blips. Crash-loops still hit the budget and stop trying.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>How this differs from station-signal</h2>

      <p>
        Station treats each spawn as a stateless job; continuum treats each
        spawn as a wakeup of a stateful agent. The key deltas:
      </p>

      <ul>
        <li>
          <strong>Stores are first-class.</strong>{" "}
          <code>.store(name =&gt; StoreAdapter)</code> is a builder setter the
          runtime invokes per wakeup — the agent&apos;s context-of-continuity.
        </li>
        <li>
          <strong>Concurrent mode.</strong> Long-lived warm subprocesses
          receive <code>notify</code> IPC envelopes inline, no spawn cost per
          message. No equivalent in station-signal — signals are always
          spawn-per-run.
        </li>
        <li>
          <strong>Steps dropped.</strong> The Glove turn IS the unit of work;
          fine-grained observability lives on the forwarded subscriber event
          stream (<code>agent:event</code> IPC envelopes), not as relational{" "}
          <code>Step</code> rows.
        </li>
        <li>
          <strong>No adapter reconstruction in children.</strong> Since steps
          are dropped and the parent is single-source-of-truth for status,
          children never touch the adapter — no manifest forwarding needed.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Limitations (v1)</h2>

      <ul>
        <li>Single-runner only. Multi-runner warm-pool sharding and distributed claim leasing for recurring schedules are deferred to future wrapper packages.</li>
        <li><code>configure()</code> is a module-level singleton; multiple runners in one process race on it. Use <code>runner.notify()</code> when you need to address a specific runner&apos;s adapter.</li>
        <li>A stuck notify in a warm subprocess fails its own run on timeout but doesn&apos;t kill the subprocess. Subsequent notifies queue behind it. Restart the warm agent if you observe persistent starvation.</li>
        <li>Notify cancellation is best-effort — the parent flips status to <code>cancelled</code>, but the warm subprocess&apos;s promise chain keeps running. Plan around it for mutation-critical work.</li>
      </ul>
    </div>
  );
}
