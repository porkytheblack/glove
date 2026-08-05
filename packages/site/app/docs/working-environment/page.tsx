import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Working Environment",
  description:
    "A persistent, sandboxed virtual filesystem where an LLM agent writes scripts, runs them, inspects intermediates and produces artifacts.",
};

export default function WorkingEnvironmentPage() {
  return (
    <div className="docs-content">
      <h1>Working Environment</h1>

      <p>
        <code>glove-working-environment</code> gives a model a place to{" "}
        <strong>work</strong>: a small, fast, in-memory virtual filesystem where
        state accumulates across tool calls. It creates files, writes and
        persists scripts, runs them, captures outputs, generates intermediates,
        inspects them and iterates — the way a developer works — with no
        networking, no host filesystem access and no process spawning.
      </p>

      <p>
        The core has zero dependencies (Node builtins only). Heavy format
        libraries — PDF, xlsx, images, video — live in separate{" "}
        <code>glove-env-*</code> adapter packages you install only if you need
        them.
      </p>

      <h2 id="when">When to reach for it</h2>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Solves</th>
            <th>Shape</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a href="/docs/scratchpad">
                <code>glove-scratchpad</code>
              </a>
            </td>
            <td>One powerful executable over a resource catalog (SQL over tools)</td>
            <td>Stateless-per-call</td>
          </tr>
          <tr>
            <td>
              <code>glove-working-environment</code>
            </td>
            <td>A place where state accumulates — multi-file, multi-script, inspectable</td>
            <td>Persistent VFS + script execution</td>
          </tr>
          <tr>
            <td>
              <a href="/docs/glovebox">Glovebox</a>
            </td>
            <td>Tasks needing a real environment — real Node, real toolchains</td>
            <td>Full-fidelity container</td>
          </tr>
        </tbody>
      </table>

      <p>
        Design goals: <strong>context discipline</strong> (big data lives in
        files; tool output truncates with spillover to <code>/tmp</code>),{" "}
        <strong>security by construction</strong> (scripts run in a scope
        containing only the capabilities you inject — there is no{" "}
        <code>fetch</code> to block, it does not exist),{" "}
        <strong>one tree</strong> for inputs, scripts, intermediates, outputs
        and history, and a <strong>compounding library</strong> — scripts
        persist and compose, so the agent accumulates a documented toolkit of
        its own.
      </p>

      <p>
        Equally load-bearing non-goals: no networking (not configurable), no
        shell emulation, no bare <code>exec</code> tool (all execution goes
        through named, persistent scripts), no background execution.
      </p>

      <h2 id="quick-start">Quick start</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-working-environment
# plus whichever formats the agent handles
pnpm add glove-env-documents glove-env-spreadsheets`}
      />

      <CodeBlock
        filename="env.ts"
        language="typescript"
        code={`import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";

const env = await createWorkingEnvironment({
  stdlib: [documents(), spreadsheets()],
  limits: { runTimeoutMs: 30_000 },
});

// ── host-side doors — the model never sees these ──
await env.mount("./q3.xlsx", "/inbox/q3.xlsx");     // host path, bytes, or { text }

// ── model-facing: fold the closed verb set and prime the system prompt ──
mountWorkingEnvironment(agent, { env });

// … the agent works …

const deliverables = await env.export("/out/**");    // → [{ path, bytes }]
const snap = await env.snapshot();                   // serializable; persist anywhere`}
      />

      <p>
        <code>mountWorkingEnvironment</code> accepts any object with{" "}
        <code>fold()</code> — both <code>IGloveRunnable</code> and{" "}
        <code>IGloveBuilder</code> qualify structurally, so the package does not
        depend on <code>glove-core</code>.
      </p>

      <h2 id="the-tree">The tree</h2>

      <CodeBlock
        filename="the virtual filesystem"
        language="text"
        code={`/inbox    ← mounted inputs (convention)
/scripts  ← the agent's script library + generated .d.ts siblings
          ← (/scripts/lib for utility modules)
/skills   ← worked recipes, indexed by /skills/README.md (read-only)
/std      ← materialized adapter types and docs (read-only)
/tmp      ← intermediates and spilled outputs
/out      ← deliverables (what env.export targets by convention)
/.env     ← history.jsonl + file version store (read-only to the model)`}
      />

      <p>
        <code>/std</code> and <code>/skills</code> answer different questions.{" "}
        <code>/std/&lt;name&gt;/index.d.ts</code> is the reference — what a
        module exports, exactly. A <em>skill</em> is a worked recipe: here is a
        styled workbook, here is how you search a document too large to read.
        The distinction is not cosmetic — the most frequent measured failure was{" "}
        <strong>guessed imports</strong>, a model reaching for a remembered
        shape before reading a signature. A correct example in front of it beats
        a better error after the fact.
      </p>

      <h2 id="script-contract">The script contract</h2>

      <p>
        Every runnable script <strong>must</strong> default-export a function.
        There is no program-style fallback.
      </p>

      <CodeBlock
        filename="/scripts/csv_to_report.js"
        language="javascript"
        code={`/**
 * Converts a CSV in the VFS to a formatted report.
 * @param {{ input: string, format?: "a4" | "letter" }} args
 * @returns {Promise<{ output: string }>}
 */
export default async function csvToReport(args) {
  // …
  return { output: "/out/report.md" };
}`}
      />

      <p>
        Validation happens at <strong>write time</strong>, not first-run time:
        any mutation producing a <code>.js</code> under <code>/scripts</code>{" "}
        loads the module through the environment&apos;s resolver and fails the
        mutation with a guardrail message if the contract is not met. On success
        a sibling <code>.d.ts</code> is generated from{" "}
        <code>fn.toString()</code> plus the JSDoc block, so the model can learn
        a script&apos;s interface without reading its body. Those{" "}
        <code>.d.ts</code> files are derived artifacts — regenerated on every
        mutation, moved with <code>mv</code>, deleted with <code>rm</code>,
        never hand-edited.
      </p>

      <p>
        Imports are relative VFS paths (<code>./parse_invoice.js</code>),{" "}
        <code>env:*</code> modules, and dynamic <code>import()</code>. A bare
        specifier fails with a message listing the available <code>env:</code>{" "}
        modules; a circular import fails with the cycle path.
      </p>

      <h2 id="verbs">Model-facing verbs</h2>

      <p>The complete, closed set — everything the model does goes through these:</p>

      <table>
        <thead>
          <tr>
            <th>Verb</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>write_file(path, content, append?)</code>
            </td>
            <td>Parent dirs auto-created; scripts validated, <code>.d.ts</code> generated</td>
          </tr>
          <tr>
            <td>
              <code>edit_file(path, old_str, new_str)</code>
            </td>
            <td>str_replace semantics — exactly one match, or fail with the count</td>
          </tr>
          <tr>
            <td>
              <code>rm</code> / <code>mv</code> / <code>cp</code>
            </td>
            <td>Keep <code>.d.ts</code> siblings consistent; validate scripts at destinations</td>
          </tr>
          <tr>
            <td>
              <code>read_file(path, start_line?, end_line?)</code>
            </td>
            <td>Line-numbered, capped with an explicit tail; binary files refused</td>
          </tr>
          <tr>
            <td>
              <code>ls(path?, depth?)</code>
            </td>
            <td><code>/scripts</code> inlines JSDoc one-liners — the listing <em>is</em> the capability catalog</td>
          </tr>
          <tr>
            <td>
              <code>grep(pattern, path?, glob?, …)</code>
            </td>
            <td>Capped; also covers <code>/.env/history.jsonl</code></td>
          </tr>
          <tr>
            <td>
              <code>run_tests(path?)</code>
            </td>
            <td>Runs every <code>*.test.js</code> under a path</td>
          </tr>
          <tr>
            <td>
              <code>describe(path)</code>
            </td>
            <td>Routes to whichever adapter understands the format — magic bytes, not extension</td>
          </tr>
          <tr>
            <td>
              <code>run_script(path, args)</code>
            </td>
            <td>
              <code>await defaultExport(args)</code>; result + stdout/stderr; oversized
              output spills to <code>/tmp</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>undo(path)</code> / <code>redo(path)</code>
            </td>
            <td>Per-file linear undo, <code>rm</code> included</td>
          </tr>
          <tr>
            <td>
              <code>checkpoint(action, name?)</code>
            </td>
            <td>fork / restore / list / drop the WHOLE tree</td>
          </tr>
          <tr>
            <td>
              <code>history(path?, limit?)</code>
            </td>
            <td>Runs from <code>history.jsonl</code>, or a file&apos;s saved versions</td>
          </tr>
        </tbody>
      </table>

      <h2 id="stdlib">Stdlib adapters</h2>

      <p>
        An adapter bridges a real host library into the tree. The model
        experiences it as a typed importable module plus docs at{" "}
        <code>/std/&lt;name&gt;/</code> — and, where the adapter ships them,
        worked recipes under <code>/skills</code>.
      </p>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Module</th>
            <th>Gives the model</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>glove-env-documents</code>
            </td>
            <td>
              <code>env:documents</code>
            </td>
            <td>
              One document spec → PDF <em>and</em> DOCX; describe / merge /
              split / stamp; text extraction (PDF text needs the optional{" "}
              <code>pdfjs-dist</code> peer). Exports docx&apos;s own{" "}
              <code>Document</code>/<code>Packer</code>/<code>Paragraph</code>{" "}
              for anything the spec cannot express
            </td>
          </tr>
          <tr>
            <td>
              <code>glove-env-spreadsheets</code>
            </td>
            <td>
              <code>env:spreadsheets</code>
            </td>
            <td>
              Workbooks as plain-JSON records (formulas, rich text and dates
              flattened); write, append, CSV bridging. Exports exceljs&apos;s{" "}
              <code>Workbook</code> for styling, number formats and formulas
            </td>
          </tr>
          <tr>
            <td>
              <code>glove-env-images</code>
            </td>
            <td>
              <code>env:images</code>
            </td>
            <td>
              Describe an image without decoding it into context; resize,
              convert, crop, rotate, composite, contact sheets
            </td>
          </tr>
          <tr>
            <td>
              <code>glove-env-slides</code>
            </td>
            <td>
              <code>env:slides</code>
            </td>
            <td>
              PowerPoint decks from a spec, read back through an independent
              OOXML reader — outline, slide text, speaker notes
            </td>
          </tr>
          <tr>
            <td>
              <code>glove-env-archives</code>
            </td>
            <td>
              <code>env:archives</code>
            </td>
            <td>
              zip / tar / tar.gz in and out, with traversal- and bomb-safe
              extraction. No dependencies
            </td>
          </tr>
          <tr>
            <td>
              <code>glove-env-media</code>
            </td>
            <td>
              <code>env:media</code>
            </td>
            <td>
              Video and audio via ffmpeg — describe, thumbnail, frames, clip,
              concat, transcode, slideshow
            </td>
          </tr>
        </tbody>
      </table>

      <p>What the model then writes inside the sandbox:</p>

      <CodeBlock
        filename="/scripts/thumbnail_inbox.js"
        language="javascript"
        code={`import { glob } from 'env:fs';
import { describe, resize } from 'env:images';

/**
 * Thumbnails every image in /inbox.
 * @param {{ width?: number }} args
 */
export default async function main({ width = 320 }) {
  const paths = await glob('/inbox/**/*.{jpg,png}');
  for (const p of paths) {
    // Image bytes never leave the tree — describe answers "what am I holding"
    // in a few dozen tokens, and resize turns one path into another.
    await resize(p, \`/out/thumbs/\${p.split('/').pop()}\`, { width });
  }
  return { count: paths.length };
}`}
      />

      <h2 id="host-directory">Backing it with a real directory</h2>

      <p>
        A copy-on-write overlay over a host directory: reads fall through to
        disk, writes and deletes land in memory, and nothing on the host changes
        until you commit.
      </p>

      <CodeBlock
        filename="env.ts"
        language="typescript"
        code={`import { hostDirectory } from "glove-working-environment";

const disk = hostDirectory("./workspace");            // copy-on-write
const env = await createWorkingEnvironment({ filesystem: disk });

// … the agent reads the corpus directly and writes freely …

await disk.commit();                                  // or disk.discard()`}
      />

      <p>
        A directory of a thousand documents needs no <code>mount()</code> calls
        and no second copy in memory — and, more importantly,{" "}
        <strong>the agent cannot damage the source</strong>.{" "}
        <code>hostDirectory(dir, {"{ mode: \"readonly\" }"})</code> refuses every
        write outright. Containment is checked <em>after</em> symlink
        resolution, on the real path, for every access: a link out of the root —
        or a symlinked parent directory — is refused rather than followed.
      </p>

      <h2 id="checkpointing">Checkpointing and evaluation</h2>

      <p>
        The package makes the work possible and keeps it safe; it deliberately
        contains <strong>no agent loop</strong> and does not judge whether the
        work is <em>good</em>. Measured over 90 agent runs, 92% produced the
        artifact they were asked for and 54% were fully correct — the gap is
        judgment, not tooling.
      </p>

      <p>
        Closing it needs generate-and-evaluate with a critic, which belongs in
        the host — so everything a host needs is public:
      </p>

      <CodeBlock
        filename="critic-loop.ts"
        language="typescript"
        code={`const snap = await env.snapshot();                 // checkpoint
const artifacts = await env.export("/out/**");     // pull for judging

const verdict = await critic.processRequest(review(artifacts));

if (!verdict.ok) {
  await env.mount({ text: verdict.notes }, "/inbox/critique.md");  // feed it back
} else {
  // or rewind entirely
  const env2 = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) });
}`}
      />

      <p>
        <code>examples/analyst-desk</code> in the repo is a working reference
        for the evaluate half.
      </p>

      <h2 id="next">Related</h2>

      <ul>
        <li>
          <a href="/docs/code-execution">Code Execution</a> — the stateless
          sibling: one eval tool over a function catalog
        </li>
        <li>
          <a href="/docs/scratchpad">Scratchpad</a> — the same idea expressed as
          SQL over a resource catalog
        </li>
        <li>
          <a href="/docs/glovebox">Glovebox</a> — when the task needs a real
          toolchain rather than a sandbox
        </li>
      </ul>
    </div>
  );
}
