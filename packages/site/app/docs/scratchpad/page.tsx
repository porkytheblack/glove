import { CodeBlock } from "@/components/code-block";

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  minWidth: "540px",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontFamily: "var(--mono)",
  whiteSpace: "nowrap",
};
const thDescStyle: React.CSSProperties = {
  ...thStyle,
  fontFamily: undefined,
  whiteSpace: "normal",
};
const headRowStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
};
const bodyRowStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border-subtle)",
};
const propCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const typeCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const descCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  whiteSpace: "normal",
  minWidth: "200px",
};
const calloutStyle: React.CSSProperties = {
  borderLeft: "2px solid var(--accent)",
  padding: "0.25rem 1.25rem",
  margin: "1.5rem 0",
  color: "var(--text-secondary)",
};

function PropTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: [string, string, string][];
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headRowStyle}>
            {headers.map((h, i) => (
              <th key={h} style={i < 2 ? thStyle : thDescStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, desc]) => (
            <tr key={prop + type} style={bodyRowStyle}>
              <td style={propCell}>{prop}</td>
              <td style={typeCell}>{type}</td>
              <td style={descCell}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ScratchpadPage() {
  return (
    <div className="docs-content">
      <h1>The Scratchpad Computer</h1>

      <p>
        <code>glove-scratchpad</code> is a substrate-independent architecture
        for context-efficient multi-agent workflows. The context savings usually
        credited to &quot;code execution for MCP&quot; come from two mechanisms
        that have nothing to do with a Linux shell:{" "}
        <strong>interface disclosure</strong> (don&apos;t load every tool schema
        at once) and <strong>result containment</strong> (don&apos;t round-trip
        intermediate tool <em>results</em> through the model). Neither needs a
        terminal or a VM.
      </p>

      <p>
        This package delivers the second mechanism with{" "}
        <strong>handles + deterministic SQL transforms over a durable store</strong>.
        A tool&apos;s full result is written into the store and only a{" "}
        <strong>stub</strong> — reference + descriptor + &quot;read more&quot; —
        crosses back into the model&apos;s context. Agents then narrow{" "}
        <strong>deterministically in SQL</strong>, pass <strong>references</strong>{" "}
        (not payloads) downstream, and <strong>materialize</strong> real values
        only at the last mile. The manipulation surface is a <strong>defined
        Postgres subset</strong> (the standard); the backend behind it is
        swappable — and the default backend is zero-dependency pure JS, so there
        is no shell and no VM anywhere in the loop.
      </p>

      <CodeBlock
        code={`naive (full payload in context):        142,354 b
scratchpad (stub + stub + last mile):     3,789 b   →  37.6× less`}
        language="text"
      />

      <p>
        Reproduce with <code>pnpm scratchpad:demo</code> (no API key, no
        database, no dependencies). This is an <em>illustrative single-payload</em>{" "}
        figure — one ~500-row result narrowed once and read at a 10-row last
        mile; the factor scales with selectivity and the read budget, not a
        benchmarked average.
      </p>

      {/* ================================================================== */}
      {/* INSTALL                                                            */}
      {/* ================================================================== */}
      <h2 id="install">Install</h2>

      <p>
        One package, zero runtime dependencies. The PGlite backend is the only
        thing that needs anything extra, and it&apos;s opt-in.
      </p>

      <CodeBlock
        code={`pnpm add glove-scratchpad
# that's it — the default backend is pure JS with zero runtime dependencies.

# OPTIONAL — only if you want the PGlite (WASM Postgres) backend instead:
pnpm add @electric-sql/pglite`}
        language="sh"
      />

      {/* ================================================================== */}
      {/* QUICK START                                                        */}
      {/* ================================================================== */}
      <h2 id="quick-start">Quick start</h2>

      <p>Three pieces wire the Scratchpad into a running agent:</p>

      <ol>
        <li>
          <strong>One durable store</strong> per unit of work, behind the
          Postgres-subset contract — <code>Scratchpad.create(backend)</code>.
        </li>
        <li>
          <strong>Containment</strong> — wrap a chunky tool so its payload lands
          in the store and only a stub reaches context.
        </li>
        <li>
          <strong>The surface</strong> — <code>mountScratchpad</code> folds the
          manipulation tools and the restraint priming.
        </li>
      </ol>

      <CodeBlock
        code={`import { Scratchpad, MemoryBackend, mountScratchpad, storeAndTruncate } from "glove-scratchpad";

// 1. One durable store per unit of work, behind the Postgres-subset contract.
const sp = await Scratchpad.create(await MemoryBackend.create());

// 2. Contain a chunky tool's result: payload → store, stub → context.
agent.fold(storeAndTruncate(bigTool, { scratchpad: sp }));

// 3. Give the agent the manipulation surface + restraint priming.
mountScratchpad(agent, { scratchpad: sp });`}
        language="ts"
      />

      <p>
        Now the agent works the data through <code>scratchpad_describe</code> →{" "}
        <code>scratchpad_query</code> → <code>scratchpad_materialize</code>{" "}
        instead of reading the whole payload back into context.
      </p>

      {/* ================================================================== */}
      {/* RESULT CONTAINMENT                                                 */}
      {/* ================================================================== */}
      <h2 id="result-containment">Result containment</h2>

      <p>
        <code>storeAndTruncate</code> is generic over any Glove tool (
        <code>GloveFoldArgs</code>), not coupled to MCP. It runs the wrapped
        tool, ingests a successful payload into the store, and returns a compact
        stub as the model-facing <code>data</code> while preserving the original
        payload on <code>renderData</code> (client-only). Storing is a{" "}
        <strong>side effect of a tool returning</strong>, never an agent action —
        the adapter owns ingestion, key allocation, normalization, and lifecycle.
      </p>

      <CodeBlock
        code={`import { storeAndTruncate } from "glove-scratchpad";

agent.fold(
  storeAndTruncate(bigTool, {
    scratchpad: sp,
    minBytes: 1024,                 // only contain results above this size
    onContain: (e) => report(e),    // { tool, ref, rowCount, bytesContained, bytesEmitted }
  }),
);

// Compose it with glove-mcp's per-tool bridge:
import { bridgeMcpTool } from "glove-mcp";
agent.fold(storeAndTruncate(bridgeMcpTool(conn, tool, serverMode), { scratchpad: sp }));`}
        language="ts"
      />

      <h3>The descriptor economy</h3>

      <p>
        A reference does <strong>not</strong> resolve to a blob. It resolves to a{" "}
        <code>{`{ value, schema, preview, provenance }`}</code> descriptor:
        columns + types, row count, a bounded preview, child-table layout, and
        provenance. Agents plan against this and touch values only by a
        deliberate <code>materialize</code>. The descriptor is the real
        interface — rich enough to plan without peeking, so agents don&apos;t
        materialize <em>defensively</em>. On ingest the JSON value is normalized
        once: scalars become typed columns, nested arrays become child tables
        joined on <code>_parent = _rid</code>, and anything deeper drops into a{" "}
        <code>jsonb</code> column reachable in place via <code>-&gt;</code> /{" "}
        <code>-&gt;&gt;</code>.
      </p>

      {/* ================================================================== */}
      {/* SURFACE TOOLS                                                      */}
      {/* ================================================================== */}
      <h2 id="surface-tools">The surface tools &amp; priming</h2>

      <p>
        <code>mountScratchpad(glove, {`{ scratchpad, actor?, defaultLimit?, prime? }`})</code>{" "}
        folds four tools and prepends <code>SCRATCHPAD_PREAMBLE</code> (unless{" "}
        <code>prime: false</code>). The priming sets the disposition; the return
        shape — a rich descriptor up front, the payload one deliberate step
        behind a handle — makes it hold. The cheap, obvious move is to reason
        over the descriptor.
      </p>

      <PropTable
        headers={["Tool", "Returns", "What it does"]}
        rows={[
          [
            "scratchpad_describe",
            "Descriptor",
            "Columns + types, row count, bounded preview, child-table layout, provenance — the planning interface for a reference.",
          ],
          [
            "scratchpad_query",
            "stub | rows",
            "Narrow in SQL. With a store target it runs CREATE TABLE AS and returns a stub for the new reference (narrow → store → narrow again); a read-only SELECT / WITH returns bounded rows.",
          ],
          [
            "scratchpad_materialize",
            "rows",
            "The only path that pulls real values into context. Bounded by limit, paged by offset — the deliberate last mile.",
          ],
          [
            "scratchpad_list",
            "summaries",
            "Record summaries for every reference in the store (no previews).",
          ],
        ]}
      />

      <p>
        <strong>Reading is universal; restraint is the default.</strong> Every
        subagent <em>can</em> materialize — there is no transparent
        materialization, so every value entering context is an explicit,
        budgeted load, and all subagents are primed to defer that load to the
        last mile. The underlying <code>Scratchpad</code> methods (
        <code>ingest</code>, <code>describe</code>, <code>query</code>,{" "}
        <code>materialize</code>, <code>list</code>, <code>drop</code>,{" "}
        <code>snapshot</code>) are available directly when you orchestrate
        outside the tool surface.
      </p>

      {/* ================================================================== */}
      {/* MCP INTEGRATION                                                    */}
      {/* ================================================================== */}
      <h2 id="mcp">MCP integration</h2>

      <p>
        The per-tool primitive composes with <code>bridgeMcpTool</code>, but in
        practice you want every tool a bridged server exposes contained at once.
        The <code>glove-scratchpad/mcp</code> subpath runs the{" "}
        <code>listTools → bridge → contain → fold</code> loop for you.{" "}
        <code>glove-mcp</code> is an <strong>optional peer dependency</strong> —
        installing <code>glove-scratchpad</code> doesn&apos;t pull it in; the
        subpath resolves only once you&apos;ve added <code>glove-mcp</code>{" "}
        yourself (exactly like <code>glove-scratchpad/pglite</code> and{" "}
        <code>@electric-sql/pglite</code>).
      </p>

      <CodeBlock
        code={`import { connectMcp } from "glove-mcp";
import { mountContainedMcp, createContainmentReporter } from "glove-scratchpad/mcp";

const conn = await connectMcp({ namespace: "crm", url });
const reporter = createContainmentReporter();

await mountContainedMcp(agent, conn, {
  scratchpad: sp,
  onContain: reporter.onContain,            // optional telemetry
  shouldContain: (t) => t.name !== "ping",  // opt small / control tools out
});
// …the agent now sees crm__* tools whose big results land in the scratchpad.
console.log(reporter.format());
// → "5 call(s) · 163.4 KB contained → 5.5 KB emitted (30.0× less)"`}
        language="ts"
      />

      <p>
        <code>containMcpTools(conn, opts)</code> returns the tools unfolded if
        you&apos;d rather place them on a subagent or a graph node. For a non-MCP
        catalogue, the MCP-agnostic <code>containTools</code> /{" "}
        <code>mountContainedTools</code> (from the barrel) do the same batch
        wrap.
      </p>

      <h3>Scaling to 10+ providers (interface disclosure + containment)</h3>

      <p>
        <code>mountContainedMcp</code> is right when you have a handful of
        connections you always want loaded. With a large catalogue — 10, 20
        providers — folding every tool up front bloats the model&apos;s tool list
        and defeats the point. That&apos;s <em>interface</em> bloat, and the
        answer is <strong>discovery</strong>: load nothing up front and let the
        agent discover and activate providers on demand via{" "}
        <code>glove-mcp</code>&apos;s <code>discovermcp</code> subagent.{" "}
        <code>containingWrap</code> makes that discovery containment-aware, so the
        two mechanisms a &quot;code execution environment for MCP&quot; needs run
        together.
      </p>

      <CodeBlock
        code={`import { mountMcp } from "glove-mcp";                 // catalogue + discovery
import { containingWrap, createContainmentReporter } from "glove-scratchpad/mcp";

const reporter = createContainmentReporter();
await mountMcp(agent, {
  adapter,                                            // per-conversation active-state + tokens
  entries,                                            // the FULL 10+ provider catalogue
  wrapTool: containingWrap(sp, { onContain: reporter.onContain }),
});
// The agent starts with ZERO provider tools. It calls discovermcp to activate
// only the providers a task needs; each activated tool's result is contained in
// the scratchpad. Interface disclosure + result containment, together.`}
        language="ts"
      />

      <p>
        <code>wrapTool</code> is a general <code>glove-mcp</code> seam (
        <code>(tool, entry) =&gt; tool</code>); <code>containingWrap</code> is the
        containment implementation of it. The provenance <code>actor</code>{" "}
        defaults to each provider&apos;s catalogue id, so events and descriptors
        record which provider produced what — essential when a single answer
        joins data across many of them.
      </p>

      {/* ================================================================== */}
      {/* OBSERVABILITY                                                      */}
      {/* ================================================================== */}
      <h2 id="observability">Observability</h2>

      <p>
        <code>onContain</code> is containment-specific —{" "}
        <code>createContainmentReporter()</code> aggregates{" "}
        <code>{`{ tool, ref, rowCount, bytesContained, bytesEmitted }`}</code> per
        call into <code>.report()</code> / <code>.format()</code> /{" "}
        <code>.reset()</code>. For full observability over the datapath — every{" "}
        <code>ingest</code>, <code>query</code>, <code>materialize</code>,{" "}
        <code>drop</code>, <code>snapshot</code>, and <code>error</code> —
        subscribe to the scratchpad&apos;s event stream, modelled on
        glove-core&apos;s <code>SubscriberAdapter</code>.
      </p>

      <CodeBlock
        code={`import { createScratchpadStats } from "glove-scratchpad";

const off = sp.subscribe({
  record(ev) {
    if (ev.type === "materialize") console.log("last-mile read:", ev.returned, "rows");
    if (ev.type === "error") console.warn("scratchpad", ev.op, "failed:", ev.message);
  },
});

// …or drop in the ready-made tally:
const stats = createScratchpadStats();
sp.subscribe(stats.subscriber);
// later: stats.format()
// → "5 ingest(s) (163.4 KB) · 1 query · 2 materialize(s) (9 rows) · 0 errors"`}
        language="ts"
      />

      <p>
        <code>materialize</code> is the event to watch — it&apos;s the only one
        where real values cross back into the model&apos;s context.{" "}
        <code>subscribe</code> returns an unsubscribe function; subscribers are
        runtime-only (never serialised), so after a <code>restore</code> you
        re-subscribe. A throwing subscriber can never break the store.
      </p>

      <h3>Token consumption</h3>

      <p>
        The events carry the byte sizes of what crosses the model boundary (
        <code>ingest.bytes</code> = payload contained,{" "}
        <code>ingest.stubBytes</code> = the stub emitted,{" "}
        <code>materialize.bytes</code> / <code>query.bytes</code> = rows read
        into context), so <code>createConsumptionTracker()</code> can track
        tokens kept <em>out</em> of context by containment versus tokens spent
        reading data back <em>in</em>.
      </p>

      <CodeBlock
        code={`import { createConsumptionTracker } from "glove-scratchpad";

const consumption = createConsumptionTracker();   // optional: (bytes) => tokens
sp.subscribe(consumption.subscriber);
// …after the run:
console.log(consumption.format());
// → "~3.3k tokens into context · ~41.8k contained (12.8× budget)"

const r = consumption.report();
// { tokensIntoContext, tokensContained, reductionFactor,
//   byOp: { stubs, materializes, queryReads }, bytesIntoContext, bytesContained }`}
        language="ts"
      />

      <p>
        Tokens are estimated from serialised bytes via a{" "}
        <code>tokensForBytes</code> function (default ~4 bytes/token); pass your
        model&apos;s ratio — or a tokenizer-backed estimate — for a tighter
        number. <code>byOp</code> splits the in-context tokens between the stubs
        that replaced contained payloads, the deliberate last-mile{" "}
        <code>materialize</code>s, and read-mode <code>query</code>s, so you can
        see exactly where your context budget goes.
      </p>

      {/* ================================================================== */}
      {/* STORABLE & RESUMABLE                                               */}
      {/* ================================================================== */}
      <h2 id="storable">Storable &amp; resumable</h2>

      <p>
        A scratchpad is a value: <code>snapshot()</code> serialises the whole
        store to bytes and a backend reconstructs from them (
        <code>MemoryBackend.create({`{ load }`})</code>) — computation as a value
        you can tear down and resume. The package turns that into the same
        BYO-adapter pattern glove uses everywhere: a <code>ScratchpadStore</code>{" "}
        you implement over your DB / KV / object store, plus persist / restore /
        auto-persist helpers.
      </p>

      <CodeBlock
        code={`import { autoPersistScratchpad, restoreScratchpad, Scratchpad, MemoryBackend } from "glove-scratchpad";
import { FsScratchpadStore } from "glove-scratchpad/persist-fs";

const store = new FsScratchpadStore("./.scratchpads");   // or your DB-backed ScratchpadStore

// First run — snapshot after each mutation (debounced), no explicit checkpoints.
const sp = await Scratchpad.create(await MemoryBackend.create());
const stopPersist = autoPersistScratchpad(sp, { store, key: sessionId });
// …on conversation end:
await stopPersist();   // unsubscribe + flush

// Resuming the SAME session later:
const resumed =
  (await restoreScratchpad({ store, key: sessionId }))
  ?? (await Scratchpad.create(await MemoryBackend.create()));   // fresh if none saved`}
        language="ts"
      />

      <PropTable
        headers={["Helper", "Signature", "Purpose"]}
        rows={[
          [
            "ScratchpadStore",
            "{ save, load, delete }",
            "The BYO adapter contract — save(key, bytes), load(key), delete(key). MemoryScratchpadStore (dev/tests) and FsScratchpadStore ship.",
          ],
          [
            "FsScratchpadStore",
            "glove-scratchpad/persist-fs",
            "Node-only file store with atomic temp+rename writes, mode 0600.",
          ],
          [
            "persistScratchpad",
            "(sp, store, key)",
            "Explicit snapshot + save.",
          ],
          [
            "restoreScratchpad",
            "({ store, key, backend? })",
            "Rebuild a scratchpad from a saved snapshot, or null if absent. backend defaults to MemoryBackend; pass it for PGlite / your own.",
          ],
          [
            "autoPersistScratchpad",
            "(sp, { store, key, debounceMs? })",
            "Event-driven debounced save on every mutation (ingest / stored query / drop). Returns a stop function that unsubscribes and flushes.",
          ],
        ]}
      />

      <p>
        Why this composes with glove: the references an agent knows live in its{" "}
        <strong>message history</strong> (the stubs in tool results, persisted by
        glove&apos;s <code>StoreAdapter</code>). Persist the scratchpad snapshot
        under the <strong>same key</strong> (the session id) and a resumed
        conversation finds both its messages <em>and</em> the data those
        references resolve to — a long, multi-provider run survives a restart
        intact.
      </p>

      {/* ================================================================== */}
      {/* SUBAGENT GRAPHS & WORKFLOWS                                        */}
      {/* ================================================================== */}
      <h2 id="graphs">Subagent graphs &amp; workflows</h2>

      <p>
        <code>glove-scratchpad/graph</code> turns a{" "}
        <strong>plain, schema-validated object</strong> into a wired
        multi-subagent topology. The object is the contract — subagents, their
        prompts, the tool slice each one sees (interface disclosure), and the
        edges between them. <code>buildScratchpadGraph</code> does the
        construction the definition implies: it validates the shape, builds each
        runnable via your <code>createAgent</code> factory, folds its tool slice
        from the registry, and mounts the scratchpad surface stamping{" "}
        <code>actor = spec.name</code> so provenance records who produced what.
      </p>

      <CodeBlock
        code={`import { buildScratchpadGraph, type GraphDef } from "glove-scratchpad/graph";

const def: GraphDef = {
  name: "triage",
  entry: "planner",
  subagents: [
    {
      name: "planner",
      prompt: "Plan the triage. Narrow in SQL; hand a reference to the reader.",
      tools: ["issues__search"],          // its capability slice (interface disclosure)
    },
    { name: "reader", prompt: "Read the narrowed reference and write the summary.", defaultLimit: 20 },
  ],
  edges: [{ from: "planner", to: "reader", when: "after narrowing" }],
};

const graph = await buildScratchpadGraph(def, {
  scratchpad: sp,
  tools: { issues__search: searchTool },  // registry the slices are drawn from
  createAgent: (spec) =>
    new Glove({ model, displayManager, systemPrompt: spec.prompt }).build(),
});`}
        language="ts"
      />

      <p>
        The Zod schema (<code>graphSchema</code>) is the source of truth and the
        TS types are inferred from it, so a definition that type-checks is one
        that validates at runtime. Use <code>parseGraphDef(obj)</code> to
        validate without building. <code>runScratchpadGraph</code> then executes
        the wired graph to an answer — starting at the entry subagent it walks
        the edges in dependency order, threading each node&apos;s output to its
        downstream neighbours and letting every node work the{" "}
        <strong>shared scratchpad</strong> as it goes. Only the objective, short
        upstream notes, and the list of references that exist ride in the handoff
        — never the data.
      </p>

      <CodeBlock
        code={`import { runScratchpadGraph } from "glove-scratchpad/graph";

const { answer, resolved, steps, refs } = await runScratchpadGraph(graph, {
  objective: "How many open issues are there, by priority?",
});`}
        language="ts"
      />

      <h3>As one tool the agent drives</h3>

      <p>
        Most of the time you don&apos;t want to author the graph in code — you
        want the agent to. <code>mountWorkflow</code> folds a{" "}
        <strong>single</strong> tool, <code>workflow_run</code>, that builds{" "}
        <em>and</em> runs a workflow in one call: the model hands it the
        definition + an objective, and it constructs the subagents and runs them
        to a resolved answer.
      </p>

      <CodeBlock
        code={`import { mountWorkflow } from "glove-scratchpad/graph";

mountWorkflow(agent, {
  scratchpad: sp,
  tools: { issues__search: searchTool },     // the slices subagents may draw from
  createAgent: (spec) =>                      // you own construction…
    new Glove({ model, displayManager, systemPrompt: spec.prompt }).build(),
});
// …the model now calls, in one shot:
//   workflow_run({ entry, subagents, edges, objective })
// → { answer, resolved, refs, topology, steps }`}
        language="ts"
      />

      <p>
        (<code>workflowTool(opts)</code> returns it unmounted;{" "}
        <code>buildAndRunScratchpadGraph(def, {`{ …, objective }`})</code> is the
        programmatic equivalent.) Routing is dependency-ordered (a DAG): each
        reachable node runs once after its predecessors, with a{" "}
        <code>maxSteps</code> guard for cycles. Conditional routing — acting on an
        edge&apos;s <code>when</code> — is a deliberate non-goal for now; edges
        are unconditional handoffs. See <code>pnpm scratchpad:graph</code>{" "}
        (construction) and <code>pnpm scratchpad:workflow</code> (create → run →
        answer) for no-API-key walkthroughs.
      </p>

      {/* ================================================================== */}
      {/* BACKENDS                                                           */}
      {/* ================================================================== */}
      <h2 id="backends">Backends</h2>

      <p>
        The Scratchpad emits a <strong>defined Postgres subset</strong> and never
        knows what is backing it — the dialect is the standard; the backend is an
        implementation detail. Every backend satisfies the same{" "}
        <code>ScratchpadBackend</code> contract (<code>query</code>,{" "}
        <code>exec</code>, <code>dump</code>, <code>close</code>), so the same{" "}
        <code>Scratchpad</code> code path runs unchanged on any of them.
      </p>

      <PropTable
        headers={["Backend", "Import", "When"]}
        rows={[
          [
            "MemoryBackend",
            "glove-scratchpad (default)",
            "Zero-dep, pure-JS Postgres-subset engine (the glove-sql package, re-exported; also on /memory). Tables built at runtime from ingested data, no fixed schema. Snapshots to compact JSON. The default.",
          ],
          [
            "PgliteBackend",
            "glove-scratchpad/pglite",
            "Real embedded Postgres (WASM) — full dialect, real jsonb, a serializable data dir. @electric-sql/pglite is an optional peer; reach for it when you need SQL beyond the emulated subset.",
          ],
          [
            "ScratchpadBackend",
            "(your impl)",
            "Bring your own over anything that speaks the subset — real Postgres over a pool, SQLite, a remote service.",
          ],
        ]}
      />

      <CodeBlock
        code={`import { Scratchpad, MemoryBackend } from "glove-scratchpad";   // MemoryBackend also on /memory
const sp = await Scratchpad.create(await MemoryBackend.create());

// …or the WASM Postgres backend (requires @electric-sql/pglite):
import { PgliteBackend } from "glove-scratchpad/pglite";
const pg = await Scratchpad.create(await PgliteBackend.create());`}
        language="ts"
      />

      <div style={calloutStyle}>
        <p>
          The default backend is the <code>glove-sql</code> engine — a
          zero-dependency, pure-JS Postgres-subset engine (tokenizer →
          recursive-descent parser → evaluator) covering the SQL agents actually
          write: joins, <code>GROUP BY</code> / <code>HAVING</code> with
          aggregates, <code>FILTER (WHERE …)</code>, CTEs, set operations,
          correlated subqueries, window functions, and jsonb access. Anything
          outside the subset throws a clear error rather than silently
          mis-answering. See the <a href="/docs/sql">SQL engine docs</a> for the
          full coverage table.
        </p>
      </div>

      {/* ================================================================== */}
      {/* RELATED                                                            */}
      {/* ================================================================== */}
      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/sql">SQL Engine</a> — the zero-dep Postgres-subset
          engine behind <code>MemoryBackend</code>.
        </li>
        <li>
          <a href="/docs/mcp">MCP Integration</a> — bridged servers, the{" "}
          <code>discovermcp</code> subagent, and the <code>wrapTool</code> seam{" "}
          <code>containingWrap</code> plugs into.
        </li>
        <li>
          <a href="/docs/concepts">Core Concepts</a> — Tools, Adapters,
          Subagents, and the Display Stack the Scratchpad builds on.
        </li>
      </ul>
    </div>
  );
}
