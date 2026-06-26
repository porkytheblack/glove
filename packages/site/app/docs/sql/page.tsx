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

export default function SqlPage() {
  return (
    <div className="docs-content">
      <h1>SQL Engine (glove-sql)</h1>

      <p>
        <code>glove-sql</code> is a zero-dependency, pure-JS Postgres-subset
        SQL engine. Tables are built at runtime from whatever data you ingest —
        there is no fixed schema — and a small engine (tokenizer →
        recursive-descent parser → evaluator) runs a defined subset of Postgres
        over them. The whole store serialises to bytes and back (
        <code>&quot;computation as a value&quot;</code>), with none of a real
        database&apos;s data-dir overhead.
      </p>

      <p>
        It is the default backend for{" "}
        <a href="/docs/scratchpad">glove-scratchpad</a>, extracted into its own
        package so the SQL surface can be tested and grown independently. A
        consumer can also bring its own backend (real Postgres, SQLite, PGlite)
        that speaks the same subset.
      </p>

      {/* ================================================================== */}
      {/* QUICK START                                                        */}
      {/* ================================================================== */}
      <h2 id="quick-start">Quick start</h2>

      <p>Install the package:</p>

      <CodeBlock code={`pnpm add glove-sql`} language="sh" />

      <p>
        Create a backend, run DDL and DML, then query with <code>$n</code>{" "}
        parameters. Window functions, CTEs, joins, and the rest of the subset
        behave as you&apos;d expect from Postgres:
      </p>

      <CodeBlock
        code={`import { MemoryBackend } from "glove-sql";

const db = await MemoryBackend.create();
await db.exec(\`CREATE TABLE "t" ("id" bigint, "name" text, "score" double precision)\`);
await db.query(\`INSERT INTO "t" VALUES ($1,$2,$3),($4,$5,$6)\`, [1, "Ada", 9.5, 2, "Linus", 8.0]);

const { rows } = await db.query(
  \`SELECT name, ROW_NUMBER() OVER (ORDER BY score DESC) AS rank FROM "t"\`,
);
// → [{ name: "Ada", rank: 1 }, { name: "Linus", rank: 2 }]

const bytes = await db.dump();                      // serialise…
const restored = await MemoryBackend.create({ load: bytes }); // …and restore`}
        language="ts"
      />

      <p>
        <code>dump()</code> serialises the entire store to a{" "}
        <code>Uint8Array</code>; <code>create({`{ load }`})</code> rebuilds it.
        The same engine state moves across processes, workers, or a network as a
        plain byte array — computation as a value, with no data-dir to manage.
      </p>

      {/* ================================================================== */}
      {/* COVERAGE                                                           */}
      {/* ================================================================== */}
      <h2 id="coverage">What it covers</h2>

      <p>
        The engine speaks a defined Postgres subset. Each area below is exercised
        by the package&apos;s test suite:
      </p>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr style={headRowStyle}>
              <th style={thStyle}>Area</th>
              <th style={thDescStyle}>Supported</th>
            </tr>
          </thead>
          <tbody>
            <tr style={bodyRowStyle}>
              <td style={propCell}>DDL</td>
              <td style={descCell}>
                <code>CREATE TABLE [IF NOT EXISTS]</code>,{" "}
                <code>CREATE TABLE … AS &lt;select&gt;</code>,{" "}
                <code>DROP TABLE [IF EXISTS] … [CASCADE]</code>
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>DML</td>
              <td style={descCell}>
                <code>INSERT … VALUES (…), (…)</code>,{" "}
                <code>DELETE … [WHERE …]</code> (with <code>$n</code> params)
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Joins</td>
              <td style={descCell}>
                <code>INNER</code> / <code>LEFT</code> / <code>RIGHT</code> /{" "}
                <code>FULL</code> / <code>CROSS</code>
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Clauses</td>
              <td style={descCell}>
                <code>WHERE</code>, <code>GROUP BY</code>, <code>HAVING</code>,{" "}
                <code>ORDER BY</code>, <code>LIMIT</code>, <code>OFFSET</code>{" "}
                (ORDER / GROUP by alias or ordinal), <code>WITH</code> (CTEs)
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Set ops</td>
              <td style={descCell}>
                <code>UNION</code> / <code>UNION ALL</code> /{" "}
                <code>INTERSECT</code> / <code>EXCEPT</code>
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Subqueries</td>
              <td style={descCell}>
                scalar <code>(SELECT …)</code>, <code>IN (SELECT …)</code>,{" "}
                <code>EXISTS</code> / <code>NOT EXISTS</code> — including
                correlated
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Expressions</td>
              <td style={descCell}>
                <code>CASE</code>, <code>BETWEEN</code>, <code>IN</code>,{" "}
                <code>IS [NOT] NULL</code>, <code>CAST(x AS t)</code> /{" "}
                <code>::t</code>, jsonb <code>-&gt;</code> / <code>-&gt;&gt;</code>
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Aggregates</td>
              <td style={descCell}>
                <code>count</code> / <code>sum</code> / <code>avg</code> /{" "}
                <code>min</code> / <code>max</code>, with{" "}
                <code>FILTER (WHERE …)</code> and <code>DISTINCT</code>
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Windows</td>
              <td style={descCell}>
                <code>row_number</code>, <code>rank</code>,{" "}
                <code>dense_rank</code>, aggregate{" "}
                <code>OVER (PARTITION BY … ORDER BY …)</code>, <code>lag</code> /{" "}
                <code>lead</code>, <code>first_value</code>
              </td>
            </tr>
            <tr style={bodyRowStyle}>
              <td style={propCell}>Functions</td>
              <td style={descCell}>
                <code>coalesce</code>, <code>nullif</code>, <code>round</code>,{" "}
                <code>floor</code>, <code>ceil</code>, <code>abs</code>,{" "}
                <code>sqrt</code>, <code>power</code>, <code>mod</code>,{" "}
                <code>greatest</code>, <code>least</code>, <code>lower</code>,{" "}
                <code>upper</code>, <code>length</code>, <code>trim</code>,{" "}
                <code>substr</code>, <code>replace</code>, <code>concat</code>,{" "}
                <code>strpos</code>, …
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Anything outside the subset throws a clear error rather than silently
        mis-answering — you get an exception, <strong>never a wrong answer</strong>.
        For the long tail (recursive CTEs, <code>GROUPING SETS</code>,{" "}
        <code>DISTINCT ON</code>, explicit window frames, …),{" "}
        <code>PgliteBackend</code> (<code>glove-scratchpad/pglite</code>) — a real
        Postgres compiled to WASM that implements the same <code>SqlBackend</code>{" "}
        contract — is the escape hatch. Swap the backend and keep the rest of your
        code unchanged.
      </p>

      {/* ================================================================== */}
      {/* API                                                                */}
      {/* ================================================================== */}
      <h2 id="api">API</h2>

      <p>
        The surface is two interfaces and one class.{" "}
        <code>SqlBackend</code> is the minimal contract an embedded engine
        exposes; <code>SqlResult</code> is what a query returns (rows plus the
        output field names, in order); <code>MemoryBackend</code> is the
        zero-dependency pure-JS implementation.
      </p>

      <CodeBlock
        code={`interface SqlResult {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
}

interface SqlBackend {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  exec(sql: string): Promise<void>;
  dump(): Promise<Uint8Array>;
  close(): Promise<void>;
}

interface MemoryBackendOptions {
  load?: Uint8Array;
}

class MemoryBackend implements SqlBackend {
  static create(opts?: MemoryBackendOptions): Promise<MemoryBackend>;
}`}
        language="ts"
      />

      <PropTable
        headers={["Member", "Signature", "Purpose"]}
        rows={[
          [
            "query",
            "(sql, params?) => Promise<SqlResult>",
            "Run a parameterised query; $1, $2, … placeholders bind positionally from params.",
          ],
          [
            "exec",
            "(sql) => Promise<void>",
            "Run one or more statements with no result rows (DDL / batched DML).",
          ],
          [
            "dump",
            "() => Promise<Uint8Array>",
            "Serialise the entire backing state to bytes — computation as a value.",
          ],
          [
            "close",
            "() => Promise<void>",
            "Release any resources held by the backend.",
          ],
          [
            "MemoryBackend.create",
            "(opts?) => Promise<MemoryBackend>",
            "Construct the engine. Pass { load } to restore from bytes produced by a prior dump().",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* LIMITATIONS                                                        */}
      {/* ================================================================== */}
      <h2 id="limitations">Known limitations</h2>

      <p>
        The engine&apos;s correctness is tracked by an adversarial audit (
        <code>AUDIT.md</code> in the package). Two limitations are won&apos;t-fix
        by design, both rooted in value-level type erasure:
      </p>

      <ul>
        <li>
          <strong>Integer division returns a float.</strong> The engine erases
          the int-vs-float distinction at the value level, so it can&apos;t
          replicate Postgres&apos;s <code>int / int → int</code> truncation.
        </li>
        <li>
          <strong>
            <code>SUM</code> over bigint loses precision above 2^53.
          </strong>{" "}
          Values are JS <code>number</code>s, so large-magnitude bigint sums
          drift past the safe-integer boundary.
        </li>
      </ul>

      <p>
        Beyond these, the audit tracks a graded backlog of follow-ups (set-op
        precedence, <code>ORDER BY … NULLS FIRST/LAST</code>,{" "}
        <code>string_agg</code> / <code>array_agg</code>,{" "}
        <code>JOIN … USING (col)</code>, window frame clauses, …) under{" "}
        <strong>High</strong> / <strong>Medium</strong> / <strong>Low</strong>{" "}
        headings. See <code>AUDIT.md</code> for the full list; the fixed items
        are pinned by the regression suite{" "}
        <code>tests/sql-fixes.test.ts</code> (
        <code>pnpm --filter glove-sql test</code>).
      </p>
    </div>
  );
}
