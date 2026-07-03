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
const statGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "0.9rem",
  margin: "2rem 0",
};
const statTileStyle: React.CSSProperties = {
  border: "1px solid var(--border-subtle)",
  borderRadius: "12px",
  background: "var(--bg-elevated)",
  padding: "1.25rem 1.35rem",
};
const statNumStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: "1.5rem",
  fontWeight: 500,
  color: "var(--accent)",
  letterSpacing: "-0.02em",
  marginBottom: "0.5rem",
};
const statLabelStyle: React.CSSProperties = {
  fontSize: "0.82rem",
  color: "var(--text-tertiary)",
  lineHeight: 1.55,
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
      <h1>Database Emulator</h1>

      <p>
        <code>glove-scratchpad</code> exposes an agent&apos;s capabilities as a{" "}
        <strong>relational database it queries with a single{" "}
        <code>execute_sql</code> tool</strong>. Instead of loading dozens of tool
        definitions into the context window, the model writes SQL — which it knows
        fluently, at every model size — to discover, invoke, and compose
        capabilities.
      </p>

      <p>
        The idea: <strong>resources become tables</strong>. A resource is an
        entity / data type — <code>github_pr</code>, <code>linear_issue</code>,{" "}
        <code>emails</code>, <code>time</code>, <code>images</code> — and its CRUD
        verbs map to (possibly different) underlying tools. The model never sees
        the plumbing; it sees a schema and writes queries against it.
      </p>

      <CodeBlock
        code={`-- discover what you can do
SELECT table_name FROM information_schema.tables;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks';

-- invoke a tool by querying its table; push arguments through WHERE
SELECT id, name FROM tasks WHERE due_date = (SELECT tomorrow FROM time);

-- compose across services in one statement — no intermediate rows in context
INSERT INTO notion_page (title, body)
SELECT title, body FROM github_pr WHERE merged = true AND base = 'main';

-- stage an outbound effect, preview it, then commit (or roll back — a dry run)
BEGIN;
INSERT INTO emails (to_addr, subject, body) VALUES ('a@b.com', 'hi', 'yo');
COMMIT;`}
        language="sql"
      />

      <p>
        It is, at heart, a <strong>SQL interpreter</strong>: every statement is
        parsed and inspected <em>before</em> any tool runs. That buys discovery
        (<code>information_schema</code>), composition (joins /{" "}
        <code>INSERT … SELECT</code>), preview (<code>EXPLAIN</code>,
        transactions), and a real security surface (a syntax tree you can reject)
        — for free, because the database solved them decades ago.
      </p>

      <div style={calloutStyle}>
        Runnable, no-API-key tour of every property below:{" "}
        <code>pnpm scratchpad:db</code> (drives <code>Database.execute</code>{" "}
        directly so the transcript is deterministic).
      </div>

      {/* ================================================================== */}
      {/* BENCHMARK                                                          */}
      {/* ================================================================== */}
      <h2 id="benchmark">Benchmark: tools-as-SQL, measured</h2>

      <p>
        The obvious question is whether this actually pays off, or just moves
        the complexity around. So we built an{" "}
        <strong>agentic A/B benchmark</strong>: ten in-process MCP servers
        mirroring a real product team&apos;s stack — GitHub, Linear, Email,
        Slack, Notion, Jira, Sentry, PagerDuty, Calendar, Filesystem, {" "}
        <strong>32 tools over one deterministic, cross-linked seed world</strong>{" "}
        — run through the real <code>glove-core</code> agent loop twice per
        model: once with all 32 tools folded directly (<em>baseline</em>), once
        with a single <code>execute_sql</code> over the same capabilities as
        tables (<em>scratchpad</em>). Runs are graded deterministically; writes
        are graded on the real side-effect outbox, which can&apos;t be faked.
      </p>

      <div style={statGridStyle}>
        <div style={statTileStyle}>
          <div style={statNumStyle}>21/21</div>
          <div style={statLabelStyle}>
            scratchpad vs <strong style={{ color: "var(--text-secondary)" }}>16/21</strong>{" "}
            baseline on the OSS frontier — even frontier models miscount long
            tool-result lists
          </div>
        </div>
        <div style={statTileStyle}>
          <div style={statNumStyle}>74% → 100%</div>
          <div style={statLabelStyle}>
            weak-model pass rate across five rounds of hardening — spirals 6 → 0,
            median tool calls 6 → 2
          </div>
        </div>
        <div style={statTileStyle}>
          <div style={statNumStyle}>up to 1731×</div>
          <div style={statLabelStyle}>
            less context than paging results back verbatim — the scratchpad
            holds a flat ~22&nbsp;KB while the naive payload grows linearly
          </div>
        </div>
      </div>

      <p>
        Three findings fell out. <strong>(1)</strong> The scratchpad always cut
        peak context 2–4× — 32 schemas never enter the window and only selected
        rows do — but the first pass was a tradeoff, not a blowout: weak models
        spiralled in the open SQL surface (74% pass, six 30-turn runaways).{" "}
        <strong>(2)</strong> Nearly every weak-model failure traced to a{" "}
        <em>platform</em> gap, not a model limit — most damningly, places where
        the engine <strong>silently mis-answered where Postgres would error</strong>.
        Five rounds of fixes (engine bugs, prompt discipline, SQL-discoverable
        metadata, read-your-writes, Postgres parity) took the same five budget
        models from <strong>74% → 100%</strong> with zero spirals.{" "}
        <strong>(3)</strong> At production scale — 40 servers, 367 tools, ~95%
        noise — the tool-folding baseline <strong>inverts</strong>: it becomes
        the <em>least</em> accurate arm at 12× the context and ~6× the cost,
        while the scratchpad&apos;s footprint is statistically unchanged.
      </p>

      <p>
        The context win is a property of the data, not the model. Measured
        deterministically (no API key) — asking one cross-service question as
        the world grows:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>rows / service</th>
            <th>naive (est. tokens)</th>
            <th>scratchpad (est. tokens)</th>
            <th>reduction</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>100</td><td>20.3k</td><td>5.6k</td><td><code>3.6×</code></td></tr>
          <tr><td>1,000</td><td>202.8k</td><td>5.8k</td><td><code>35.0×</code></td></tr>
          <tr><td>5,000</td><td>1.01M</td><td>5.8k</td><td><code>174.5×</code></td></tr>
          <tr><td>20,000</td><td>4.06M</td><td>5.8k</td><td><code>696.1×</code></td></tr>
          <tr><td>50,000</td><td>10.14M</td><td>5.9k</td><td><code>1731.2×</code></td></tr>
        </tbody>
      </table>

      <p>
        The transferable lesson is a design stance:{" "}
        <strong>
          the scratchpad only works if it behaves like the database the model
          already knows
        </strong>
        . Every place it silently deviated from Postgres muscle-memory was a
        place a weak model failed; every fix that made truth cheaper to see —
        command tags, read-your-writes, loud errors, in-band discovery — bought
        more capability than any prompt instruction. The full study, with all
        transcripts, figures, and the v1→v5 hardening arc, is in the repo:{" "}
        <a
          href="https://github.com/porkytheblack/glove/blob/main/examples/scratchpad-bench/PAPER.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          The Scratchpad Is a Database
        </a>
        .
      </p>

      {/* ================================================================== */}
      {/* INSTALL                                                            */}
      {/* ================================================================== */}
      <h2 id="install">Install</h2>

      <CodeBlock
        code={`pnpm add glove-scratchpad
# zero runtime dependencies — the query engine (glove-sql) is bundled.

# OPTIONAL — a full Postgres dialect (WASM) instead of the bundled subset:
pnpm add @electric-sql/pglite
# OPTIONAL — bridge MCP servers in as tables:
pnpm add glove-mcp`}
        language="sh"
      />

      {/* ================================================================== */}
      {/* QUICK START                                                        */}
      {/* ================================================================== */}
      <h2 id="quick-start">Quick start</h2>

      <CodeBlock
        code={`import { Database, resourceFromTool, defineResource, mountDatabase } from "glove-scratchpad";

const db = await Database.create({ policy: { writes: true } });

// A read-only tool → a one-row \`time\` table.
db.register(resourceFromTool(getTimeTool, {
  name: "time", volatility: "stable",
  columns: [{ name: "now", type: "timestamptz" }, { name: "tomorrow", type: "text" }],
}));

// A search tool → a \`web\` table whose required \`query\` column is a pushed-down argument.
db.register(resourceFromTool(searchTool, {
  name: "web", volatility: "volatile",
  columns: [{ name: "title", type: "text" }, { name: "url", type: "text" }],
}));

// Fold the single tool + prime the model to discover → invoke → act → stage.
mountDatabase(agent, { db });`}
        language="ts"
      />

      <p>
        Now the agent works entirely in SQL through <code>execute_sql</code> (and{" "}
        <code>explain_sql</code>).
      </p>

      {/* ================================================================== */}
      {/* RESOURCES                                                          */}
      {/* ================================================================== */}
      <h2 id="resources">Resources as tables</h2>

      <p>
        A resource is an entity with columns and any subset of CRUD verbs, each
        wired independently. <code>defineResource</code> is the explicit contract;{" "}
        <code>resourceFromTool</code> is the convenience for the single-verb case.
      </p>

      <CodeBlock
        code={`const githubPr = defineResource({
  name: "github_pr",
  volatility: "stable",
  columns: [
    { name: "number", type: "bigint", requiredKey: true },  // an API argument
    { name: "title", type: "text" },
    { name: "merged", type: "boolean" },
  ],
  select: (b) => listPrs({ number: b.one("number") }),       // SELECT  → a list/get tool
  insert: (rows) => createPr(rows[0]),                       // INSERT  → a create tool
  update: (set, b) => updatePr(b.one("number"), set),        // UPDATE  → an update tool
  delete: (b) => closePr(b.one("number")),                   // DELETE  → a close tool
});`}
        language="ts"
      />

      <p>
        A read-only <code>time</code> has only <code>select</code>; an{" "}
        <code>emails</code> (send) is <code>insert</code>-only; an{" "}
        <code>images</code> generator is a <code>select</code>-shaped but{" "}
        <strong>volatile</strong> function-as-relation (
        <code>SELECT url FROM images WHERE prompt = &apos;…&apos;</code> —{" "}
        <code>prompt</code> is an argument). Verb presence is the capability gate:
        SELECTing a write-only resource, or writing one with no writer, is a clear
        error.
      </p>

      <h3>Volatility</h3>
      <p>
        Every resource declares Postgres&apos;s <code>immutable | stable |
        volatile</code>. It governs caching and protects effectful tools from
        being called the wrong number of times.
      </p>
      <PropTable
        headers={["Volatility", "Cached", "For"]}
        rows={[
          ["immutable", "database lifetime", "Pure lookups."],
          ["stable", "within one execute", "Turn-stable reads (e.g. time)."],
          [
            "volatile",
            "never",
            "Effectful / nondeterministic reads & all writes. Invoked exactly once per statement.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* HOW A QUERY RUNS                                                    */}
      {/* ================================================================== */}
      <h2 id="pipeline">How a query runs</h2>

      <p>
        The query engine (<code>glove-sql</code>) is synchronous; resources are
        async and effectful. So <code>Database.execute</code> can&apos;t hook
        resolution inside the engine — it <strong>pre-resolves</strong>:
      </p>

      <ol>
        <li>
          <strong>Parse</strong> the SQL (the same parser the engine executes —
          one grammar).
        </li>
        <li>
          <strong>Gate</strong> it: a statement-kind whitelist, read-only by
          default, <code>CREATE</code>/<code>DROP</code> refused, multi-statement
          only as a <code>BEGIN … COMMIT/ROLLBACK</code> script.
        </li>
        <li>
          <strong>Collect</strong> every relation referenced (FROM, JOINs,
          subqueries, CTE bodies, <code>INSERT … SELECT</code> source) and
          classify each as a resource or not.
        </li>
        <li>
          <strong>Push down</strong> the <code>WHERE</code> / <code>JOIN-ON</code>{" "}
          equalities scoped to each resource — these are <em>arguments</em>, not
          just filters; a missing required key is a clear error.
        </li>
        <li>
          <strong>Resolve</strong> each resource exactly once,{" "}
          <strong>materialize</strong> its rows into the engine,{" "}
          <strong>run</strong> the now-synchronous query, then{" "}
          <strong>tear down</strong> the ephemeral tables.
        </li>
      </ol>

      <p>
        Resolving once, up front, is what makes the volatility guarantee hold: the
        engine evaluates FROM-resolution lazily and repeatedly (once per
        correlated-subquery row), so an inline async hook would invoke an
        effectful tool N times. Pre-resolution invokes it once.
      </p>

      {/* ================================================================== */}
      {/* DISCOVERY                                                          */}
      {/* ================================================================== */}
      <h2 id="discovery">Discovery is information_schema</h2>

      <p>
        There is no separate discovery step. Resources are advertised in{" "}
        <code>information_schema.tables</code> / <code>.columns</code>{" "}
        (engine-agnostically, via a catalog callback), so the agent lands in an
        unfamiliar database, lists its tables, inspects the relevant ones, and
        figures out its own capabilities — exactly how SQL has always done
        progressive disclosure.
      </p>

      {/* ================================================================== */}
      {/* TRANSACTIONS                                                        */}
      {/* ================================================================== */}
      <h2 id="transactions">Transactions = preview &amp; staging</h2>

      <p>
        A write against a resource is a side-effecting tool call. Inside a
        transaction it is <strong>staged</strong>, not fired — recorded with the
        exact resolver + arguments it will invoke. <code>db.preview()</code> (and
        the <code>staged</code> field on the result) is the approval surface;{" "}
        <code>COMMIT</code> fires the staged writes in order;{" "}
        <code>ROLLBACK</code> discards them — a true dry run. Writes are off unless
        the database is created with <code>policy: {`{ writes: true }`}</code>.
      </p>

      <CodeBlock
        code={`await db.execute(\`BEGIN\`);
const staged = await db.execute(
  \`INSERT INTO notion_page (title) SELECT title FROM github_pr WHERE merged = true\`,
);
staged.staged;            // → the writes about to fire (preview them)
await db.execute(\`COMMIT\`);   // fires in order   (or ROLLBACK to discard)`}
        language="ts"
      />

      <h3>EXPLAIN</h3>
      <p>
        <code>db.explain(sql)</code> (and the <code>explain_sql</code> tool, and{" "}
        <code>EXPLAIN &lt;stmt&gt;</code> through <code>execute_sql</code>) runs the
        pre-pass only — <strong>no resolver calls</strong> — and reports which
        resources a statement will hit, each one&apos;s volatility, read/write
        access, and the arguments it resolved. Explaining a{" "}
        <code>generate_image</code> query costs nothing.
      </p>

      {/* ================================================================== */}
      {/* MCP                                                                */}
      {/* ================================================================== */}
      <h2 id="mcp">MCP servers → tables</h2>

      <p>
        Most MCP tools are CRUD over some resource type, so decompose a server
        into resources and give each a table. <code>glove-mcp</code> is an optional
        peer dependency.
      </p>

      <CodeBlock
        code={`import { connectMcp } from "glove-mcp";
import { mountMcpDatabase } from "glove-scratchpad/mcp";

const conn = await connectMcp({ namespace: "github", url });
await mountMcpDatabase(db, conn, {
  table: (t) => t.name === "list_pull_requests"
    ? { name: "github_pr", op: "select", volatility: "stable",
        columns: [{ name: "title", type: "text" }, { name: "merged", type: "boolean" }],
        rows: (d) => JSON.parse(d as string) }
    : null,                       // skip the rest, or map them too
});
// → INSERT INTO linear_issue SELECT … FROM github_pr WHERE merged = true
//   composes two servers in one statement.`}
        language="ts"
      />

      <p>
        A read tool (<code>readOnlyHint</code>) defaults to a <code>select</code>{" "}
        resource; others default to a volatile <code>insert</code>. Declare{" "}
        <code>columns</code> (and a <code>rows</code> extractor) via{" "}
        <code>table(tool)</code> to make a server&apos;s data genuinely queryable.
      </p>

      {/* ================================================================== */}
      {/* BACKENDS                                                           */}
      {/* ================================================================== */}
      <h2 id="backends">Backends</h2>

      <p>
        The manipulation surface is a defined Postgres subset; the backend behind
        it is swappable (<code>ScratchpadBackend</code>).
      </p>

      <PropTable
        headers={["Backend", "Import", "When"]}
        rows={[
          ["glove-sql (default)", "bundled", "Zero-dependency pure-JS Postgres subset. Covers the SQL agents write."],
          ["PgliteBackend", "glove-scratchpad/pglite", "Embedded Postgres (WASM) for a full dialect. Optional peer."],
          ["Bring your own", "ScratchpadBackend", "Real Postgres / SQLite / a remote service."],
        ]}
      />

      {/* ================================================================== */}
      {/* API                                                                */}
      {/* ================================================================== */}
      <h2 id="api">API</h2>

      <CodeBlock
        code={`const db = await Database.create({ policy?: { writes }, backend?, actor? });
db.register(resource);                  // or registerAll([...])
await db.execute(sql, { params?, limit?, allowWrites?, signal? });
//   → { rows, truncated, touched, staged?, committed?, message? }
await db.explain(sql, { params? });     // → { statementKind, readOnly, relations, staged? }
db.preview();                           // staged writes in the open transaction
mountDatabase(glove, { db, prime?, explain?, allowWrites? });`}
        language="ts"
      />

      {/* ================================================================== */}
      {/* LIMITS                                                             */}
      {/* ================================================================== */}
      <h2 id="limits">What this is not</h2>

      <ul>
        <li>
          <strong>Effectful relations are volatile.</strong> The interpreter
          carries a volatility model so the engine can&apos;t call them the wrong
          number of times — but you own declaring volatility correctly.
        </li>
        <li>
          <strong>Atomic conditional composition doesn&apos;t reduce.</strong>{" "}
          Branching where the next tool depends on a prior tool&apos;s output,
          inside one statement, is imperative-vs-declarative — punt it to the
          agent loop (query, look, query again).
        </li>
        <li>
          <strong>Tables are live views, not stored data.</strong> Rate limits,
          pagination, and partial failure when one service times out mid-
          <code>JOIN</code> are yours to handle in the resolver.
        </li>
      </ul>

      {/* ================================================================== */}
      {/* RELATED                                                            */}
      {/* ================================================================== */}
      <h2 id="related">Related</h2>
      <p>
        The query engine lives in <code>glove-sql</code> — a standalone,
        zero-dependency Postgres-subset engine you can use on its own.
      </p>
    </div>
  );
}
