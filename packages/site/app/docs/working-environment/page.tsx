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
const warnStyle: React.CSSProperties = {
  ...calloutStyle,
  borderLeftColor: "var(--warn, #e4b879)",
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

export default function WorkingEnvironmentPage() {
  return (
    <div className="docs-content">
      <h1>Working Environment</h1>

      <p>
        <code>glove-working-environment</code> gives an agent{" "}
        <strong>a filesystem and a script runtime</strong> instead of a fixed menu
        of tools. The model does not pick from a list of document actions — it
        writes code against your files, saves that code, and runs it again next
        time.
      </p>

      <p>
        Where <a href="/docs/scratchpad">the database emulator</a> is a
        stateless-per-call REPL, this is a place where state{" "}
        <strong>accumulates</strong>. A tool call ends when it returns. A script
        stays.
      </p>

      <CodeBlock
        code={`import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";

const env = await createWorkingEnvironment({
  stdlib: [documents(), spreadsheets()],
  limits: { runTimeoutMs: 60_000 },
});

// Structural — no glove-core dependency in the package.
mountWorkingEnvironment(agent, { env });

await env.mount("./report.pdf", "/inbox/report.pdf");   // door in
const files = await env.export("/out/**");              // door out`}
        language="typescript"
      />

      <div style={calloutStyle}>
        A full working app is in <code>examples/document-desk</code>: chat on the
        left, the code the agent is writing on the right, and the filesystem you
        are both working in behind a button.
      </div>

      {/* ================================================================== */}
      {/* TREE                                                               */}
      {/* ================================================================== */}
      <h2 id="tree">The tree</h2>

      <p>
        One sandboxed, in-memory virtual filesystem holds inputs, scripts,
        intermediates, outputs, docs and history. Nothing in a script can reach
        the network, the host filesystem, or a process — not by policy, but by
        construction: scripts execute in a{" "}
        <code>vm</code> context whose scope contains only what the host injected.
      </p>

      <PropTable
        headers={["Path", "Written by", "What it is"]}
        rows={[
          ["/inbox", "host", "Inputs you mounted. The model's starting point."],
          ["/scripts", "model", "Its persistent library. Each .js gets a generated .d.ts sibling; `ls /scripts` is the capability catalogue."],
          ["/skills", "environment", "Worked recipes, materialised at startup. Read-only."],
          ["/std", "environment", "One directory per module — its types and README. Read-only."],
          ["/tmp", "model", "Intermediates and spilled run output."],
          ["/out", "model", "Deliverables. This is what the host exports."],
          ["/.env", "environment", "Orientation and bookkeeping."],
        ]}
      />

      <p>
        The model-facing surface is a closed verb set:{" "}
        <code>write_file</code>, <code>edit_file</code>, <code>read_file</code>,{" "}
        <code>ls</code>, <code>grep</code>, <code>describe</code>,{" "}
        <code>rm</code>, <code>mv</code>, <code>cp</code>,{" "}
        <code>run_script</code>, <code>run_tests</code>,{" "}
        <code>checkpoint</code>, <code>undo</code>, <code>redo</code>,{" "}
        <code>history</code>. Every script is validated at write time — it must{" "}
        <code>export default async function (args)</code>, and its imports must
        resolve — so a broken script is caught before a run is spent on it.
      </p>

      <p>
        Scripts run in <strong>worker threads</strong>. That is not an
        optimisation: <code>worker.terminate()</code> is the only mechanism that
        stops a compute-bound script regardless of what it is doing, which is what
        makes the wall-clock limit real rather than advisory.
      </p>

      {/* ================================================================== */}
      {/* ROUTES                                                             */}
      {/* ================================================================== */}
      <h2 id="routes">Three routes to expose a library</h2>

      <p>
        This is the decision to get right. The <em>shape</em> of the library picks
        the route — and the wrong route fails quietly rather than loudly.
      </p>

      <PropTable
        headers={["Library shape", "Route", "Call style"]}
        rows={[
          ["Does I/O — reads or writes files, calls out", "defineAdapter", "async"],
          ["Stateful builder — new X(), chained mutation, terminal save", "defineBuilder / defineBuilders", "async"],
          ["Pure computation — no I/O, no state", "definePureModule", "synchronous"],
        ]}
      />

      <h3>Pure computation → <code>definePureModule</code></h3>

      <p>
        Adapter calls cross a thread, so every adapter binding is asynchronous.
        That is right for I/O and silently wrong for a library whose whole idiom is
        synchronous.
      </p>

      <div style={warnStyle}>
        Through an async binding, <code>sumBy(rows, &apos;n&apos;)</code> without{" "}
        <code>await</code> returns a stringified promise — and{" "}
        <strong>the run reports success</strong>. Inside a synchronous callback,{" "}
        <code>keys.map(k =&gt; camelCase(k))</code>, there is no correct spelling
        at all.
      </div>

      <p>
        <code>definePureModule</code> imports the package{" "}
        <strong>inside the worker</strong> and binds it directly into the vm
        context, so calls never leave the thread and stay synchronous. Sync is the
        forgiving direction: <code>await</code> on a plain value is a no-op, while
        a missed <code>await</code> on a promise is silent garbage.
      </p>

      <CodeBlock
        code={`import { definePureModule } from "glove-working-environment";

definePureModule({
  name: "lodash",
  from: "lodash",
  description: "Lodash utilities for shaping data.",
  pick: ["groupBy", "sumBy", "orderBy", "uniqBy", "camelCase", "cloneDeep"],
})

// …and the model writes ordinary lodash, with no wrong syntax available:
//   import { groupBy, sumBy } from 'env:lodash';
//   const byRegion = groupBy(rows, 'region');
//   const total = sumBy(rows, r => r.revenue);`}
        language="typescript"
      />

      <p>
        That is the entire integration. No bundling step, no hand-written types, no
        VFS bytes. Generated at creation:{" "}
        <code>/std/&lt;name&gt;/index.d.ts</code> with accurate{" "}
        <strong>synchronous</strong> declarations, and a README carrying the exact
        import line.
      </p>

      <div style={warnStyle}>
        <strong><code>pick</code> is the sandbox boundary, not a convenience.</strong>{" "}
        Picked functions run in the worker&apos;s realm, outside the vm. Never pick a
        string-to-code member — <code>_.template</code> compiles with{" "}
        <code>Function(source)</code>, which is arbitrary code execution outside the
        sandbox. Prototype members are refused at definition time; every other name
        is verified against the real module when the environment is created, so a
        typo fails there rather than as <code>undefined</code> in a script.
      </div>

      <h3>Builder APIs → <code>defineBuilder</code></h3>

      <p>
        A builder API cannot be deep-copied across a thread — a{" "}
        <code>Proxy</code> whose behaviour lives in its traps has no own keys, so a
        copy of it is <code>{"{}"}</code>. Instead the calls are{" "}
        <strong>recorded</strong> in-context as a flat op list and replayed
        host-side when a terminal call fires. Chained calls, property reads and
        passing one node into another all survive.
      </p>

      <p>
        This is how <code>glove-env-slides</code> and{" "}
        <code>glove-env-spreadsheets</code> expose pptxgenjs and exceljs{" "}
        <em>unchanged</em> — the model writes the library&apos;s real API, the one
        it already knows from training.
      </p>

      {/* ================================================================== */}
      {/* ADAPTERS                                                           */}
      {/* ================================================================== */}
      <h2 id="adapters">Format adapters</h2>

      <p>
        The core is zero-dependency. Heavy format libraries ship as separate{" "}
        <code>glove-env-*</code> packages, each mounting as one{" "}
        <code>env:</code> module. Mount as many as the work needs.
      </p>

      <PropTable
        headers={["Package", "Module", "What the agent gets"]}
        rows={[
          ["glove-env-documents", "env:documents", "PDF and DOCX from one spec; merge, split, stamp, extract text. Full docx API via builder."],
          ["glove-env-spreadsheets", "env:spreadsheets", ".xlsx as plain-JSON records with paging; CSV both ways; the exceljs Workbook for styling."],
          ["glove-env-images", "env:images", "resize, convert, crop, rotate, composite, contact sheets — without decoding pixels into context."],
          ["glove-env-slides", "env:slides", ".pptx generation and read-back; the pptxgenjs builder API unchanged."],
          ["glove-env-archives", "env:archives", "zip, tar, tar.gz both directions. No dependencies — node:zlib only."],
          ["glove-env-media", "env:media", "audio/video via bundled ffmpeg — describe, thumbnail, frames, clip, transcode."],
        ]}
      />

      <p>
        Every one of them leads with <code>describe(path)</code>: a summary of a
        file that costs a few dozen tokens and never pulls the bytes into the
        context window. It is the orientation verb, and the environment routes the
        generic <code>describe</code> to whichever module recognises the format by
        its magic bytes.
      </p>

      {/* ================================================================== */}
      {/* AUTHORING                                                          */}
      {/* ================================================================== */}
      <h2 id="authoring">Authoring your own</h2>

      <CodeBlock
        code={`import { defineAdapter } from "glove-working-environment";

export const invoices = () =>
  defineAdapter({
    name: "invoices",
    description: "Read and reconcile invoices from the billing system.",
    types: \`export function fetch(id: string): Promise<Invoice>;\`,
    docs: "# env:invoices\\n\\nWorked examples go here.",
    skills: [{ name: "reconcile", summary: "…", body: "…" }],
    create(vfs, ctx) {
      return {
        async fetch(id: string) { /* … */ },
      };
    },
  });`}
        language="typescript"
      />

      <p>
        <code>create</code> is the capability boundary, and it is called{" "}
        <strong>twice</strong> — once read-only, to validate scripts at write time
        without letting that validation perform side effects. Every function it
        exposes is wrapped so failures read{" "}
        <code>env:&lt;name&gt;.&lt;fn&gt;: …</code>, and arguments arrive
        deep-copied as host-realm values.
      </p>

      <p>
        Test with <code>glove-working-environment/testing</code>.{" "}
        <code>createAdapterTestEnv(adapter)</code> returns{" "}
        <code>{"{ env, fs, script(), runScript(), audit() }"}</code>, and{" "}
        <strong>
          <code>audit()</code> fails the build when your <code>types</code> and
          the real bindings disagree in either direction
        </strong>{" "}
        — a declared function that does not exist, or an undeclared one that does.
      </p>

      {/* ================================================================== */}
      {/* NEXT.JS                                                            */}
      {/* ================================================================== */}
      <h2 id="nextjs">Hosting it in Next.js</h2>

      <p>
        The agent must run <strong>server-side</strong>. This is the inverse of the
        usual <a href="/docs/react">glove-react</a> arrangement:{" "}
        <code>createChatHandler</code> is a model proxy for tools that execute in
        the browser, and these tools cannot. Run{" "}
        <code>processRequest</code> in a route and forward the agent&apos;s own
        event stream as SSE.
      </p>

      <p>Two bundler traps, both of which surface far from their cause:</p>

      <CodeBlock
        code={`// next.config.ts
const EXTERNAL = [
  "glove-working-environment",
  "glove-env-documents",
  "glove-env-spreadsheets",
  "glove-env-images",
  "glove-env-slides",
  "glove-env-archives",
  "sharp",
];

const nextConfig: NextConfig = {
  // 1. The worker pool locates its entry relative to its own module URL.
  //    Bundled, that URL points into a Next chunk and the worker is not
  //    beside it — failing at the first run_script, not at build time.
  serverExternalPackages: EXTERNAL,

  // 2. MONOREPO ONLY. Next matches the list above against the RESOLVED path,
  //    and resolves with symlinks:true hardcoded. A pnpm workspace link
  //    resolves to ../../packages/<name> — no node_modules segment, no match,
  //    bundled anyway. Symptom: "Can't resolve './worker-dev.mjs'".
  webpack: (config, { isServer }) => {
    if (!isServer) return config;
    const existing = Array.isArray(config.externals) ? config.externals : [];
    config.externals = [
      ({ request }, callback) =>
        request && EXTERNAL.some((p) => request === p || request.startsWith(\`\${p}/\`))
          ? callback(undefined, \`module \${request}\`)
          : callback(),
      ...existing,
    ];
    return config;
  },
};`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* MEASURED                                                           */}
      {/* ================================================================== */}
      <h2 id="measured">What makes models succeed</h2>

      <p>
        Measured over 90 runs — five document/data scenarios, three open models,
        six repetitions each — with programmatic checks and a strong-model judge.
        The harness is <code>examples/analyst-desk</code>.
      </p>

      <div style={statGridStyle}>
        <div style={statTileStyle}>
          <div style={statNumStyle}>92%</div>
          <div style={statLabelStyle}>produced a deliverable</div>
        </div>
        <div style={statTileStyle}>
          <div style={statNumStyle}>64%</div>
          <div style={statLabelStyle}>≥80% of the facts correct</div>
        </div>
        <div style={statTileStyle}>
          <div style={statNumStyle}>54%</div>
          <div style={statLabelStyle}>fully correct, every check</div>
        </div>
        <div style={statTileStyle}>
          <div style={statNumStyle}>15/18</div>
          <div style={statLabelStyle}>on the scenario needing a real library API — the highest in the suite</div>
        </div>
      </div>

      <p>
        Three findings worth carrying into your own build:
      </p>

      <p>
        <strong>Guessed imports are the number one failure.</strong> Not misused
        APIs — misremembered import lines. That is why{" "}
        <code>/skills/imports.md</code> exists, why the environment corrects wrong
        import names at <em>write</em> time rather than at run time, and why your
        system prompt should point at <code>/skills/README.md</code> first.
      </p>

      <p>
        <strong>Exposing the real library beat a simplified wrapper.</strong> The
        scenario that required the genuine pptxgenjs surface scored highest of all
        five. A model already knows these libraries; a bespoke wrapper throws that
        knowledge away and asks it to learn yours.
      </p>

      <p>
        <strong>Never let a large document into the context window.</strong> An
        80-page report is roughly 200KB of text against an 8KB response cap.
        Extract to a file and <code>grep</code> it — searching is not an
        optimisation here, it is the only thing that works.
      </p>

      {/* ================================================================== */}
      {/* LIMITS                                                             */}
      {/* ================================================================== */}
      <h2 id="limits">What this is not</h2>

      <p>
        It is not a container. Scripts cannot reach the network, the host
        filesystem or a process, but a picked pure-module function runs in the
        worker&apos;s realm — the <code>pick</code> allowlist is doing real
        security work, and a string-to-code member defeats it.
      </p>

      <p>
        It is not a generate-and-evaluate loop. The environment gives the model a
        place to work and honest errors when it gets something wrong; deciding
        whether the output is <em>good</em>, and retrying if not, is the host&apos;s
        job.
      </p>

      <p>
        The filesystem is in-memory by default, so it is host heap, per
        environment. A host running many agents in one process must size{" "}
        <code>limits.maxBytes</code> accordingly and call{" "}
        <code>env.close()</code> when a session ends to release its worker
        threads.
      </p>

      {/* ================================================================== */}
      {/* RELATED                                                            */}
      {/* ================================================================== */}
      <h2 id="related">Related</h2>
      <p>
        For a stateless-per-call surface over a fixed set of capabilities, see{" "}
        <a href="/docs/scratchpad">the database emulator</a> — same goal (one tool
        instead of dozens), different trade: SQL over resources rather than a
        filesystem the model builds on.
      </p>
    </div>
  );
}
