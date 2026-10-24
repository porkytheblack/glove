import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/workspace";
export const metadata = docsMetadata(HREF);

export default function BuildWorkspacePage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Give it a workspace</h1>
      <p className="blog-lede">
        Past a handful of tools, adding another tool for every operation stops
        working. The model has to read every definition on every call, and each step
        of a multi-step job costs a round-trip. A workspace gives the agent somewhere
        to keep files and run code instead. It writes one program that reads, loops
        and decides, and only the answer comes back to the conversation.
      </p>

      <HarnessDiagram highlight="workspace" />

      <h2 id="choose">Pick the surface by the work</h2>
      <table>
        <thead><tr><th>The work looks like…</th><th>Give it</th><th>Package</th></tr></thead>
        <tbody>
          <tr><td>A few well-defined actions</td><td>Plain tools</td><td><code>glove-core</code></td></tr>
          <tr><td>Many operations, chained with logic in between</td><td>One code tool over a function catalogue</td><td><code>glove-js</code> · <code>glove-python</code> · <code>glove-lisp</code></td></tr>
          <tr><td>Lots of read-only data to filter and join</td><td>Capabilities as SQL tables</td><td><code>glove-scratchpad</code></td></tr>
          <tr><td>Building files over many steps: drafts, data, documents</td><td>A working environment: files, scripts, checkpoints</td><td><code>glove-working-environment</code></td></tr>
          <tr><td>Third-party services that already speak MCP</td><td>Mounted MCP servers</td><td><code>glove-mcp</code></td></tr>
          <tr><td>The real web, or real code in a real OS</td><td>A browser or a sandbox</td><td><code>glove-execution</code></td></tr>
        </tbody>
      </table>
      <p>These combine. The release assistant uses three of them.</p>

      <h2 id="repl">One tool instead of fifty: a REPL</h2>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import { JsSession, defineFn, mountJs } from "glove-js";
import { z } from "zod";

const session = JsSession.create();
session.register(defineFn({
  name: "git__merged",
  description: "Pull requests merged since a date.",
  input: z.object({ since: z.string() }),
  readOnlyHint: true,
  handler: ({ since }) => git.merged(String(since)),        // your Git client
}));
session.register(defineFn({
  name: "git__diffstat",
  description: "Files and line counts changed by a pull request.",
  input: z.object({ number: z.number() }),
  readOnlyHint: true,
  handler: ({ number }) => git.diffstat(Number(number)),
}));

mountJs(agent, { session });`}
      />
      <p>
        The agent now has <code>execute_js</code> plus discovery: it can search the
        catalogue and describe a function before calling it. To size a release it
        writes one program (fetch the merged PRs, get each diffstat, total the lines,
        keep the five largest) and gets back five rows instead of fifty tool results.
        Bindings persist for the session, so the next program can use what the last
        one computed. The interpreter has no network, filesystem or process access
        beyond the functions you registered. Python and Lisp work the same way.
      </p>

      <h2 id="files">Files that persist: the working environment</h2>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";

const env = await createWorkingEnvironment({ stdlib: [documents()] });
await env.mount({ text: changelogTemplate }, "/inbox/changelog-template.md");
mountWorkingEnvironment(agent, { env });

// … after the run, collect what it produced:
const files = await env.export("/out/**");`}
      />
      <p>
        The agent gets a closed set of verbs over a virtual filesystem:{" "}
        <code>write_file</code>, <code>edit_file</code>, <code>read_file</code>,{" "}
        <code>ls</code>, <code>grep</code>, <code>run_script</code>,{" "}
        <code>checkpoint</code>, <code>undo</code> and more. Scripts are named files
        that run in worker threads and can import only what you inject (here{" "}
        <code>env:documents</code>, so it can write the notes as a PDF or DOCX). Big
        data stays in files; only what the agent reads enters context. Other
        adapters add spreadsheets, slides, images, media, archives, HTTP with a
        domain policy, and a renderer so the agent can look at its own output. The
        tree is a <Link href="/docs/vfs">glove-vfs</Link> filesystem: back it with a
        directory or object storage to make it outlive the process.
      </p>

      <h2 id="mcp">Services that speak MCP</h2>
      <p>
        <code>mountMcp(agent, {"{ adapter, entries }"})</code> takes a catalogue of
        servers your app supports and an adapter that remembers which are active and
        resolves their tokens. The agent gets each active server&apos;s tools, plus a
        discovery subagent that can find and switch on another server mid-conversation.
        Your adapter keeps the tokens; the model never sees them. See{" "}
        <Link href="/docs/mcp">MCP</Link>.
      </p>

      <h2 id="execution">The real web and real machines</h2>
      <p>
        <code>mountBrowser(agent, {"{ adapter }"})</code> and{" "}
        <code>mountSandbox(agent, {"{ adapter }"})</code> from{" "}
        <code>glove-execution</code> add <code>execute_browser</code> and{" "}
        <code>execute_sandbox</code>: the same script-the-whole-step idea, over a
        browser session or a persistent container. Screenshots reach the model as
        images on its next call. Station is the first backend; in Foundry, one
        managed Station can host both. On Kuiper, browsers and sandboxes are services
        your unit already has a key for. See{" "}
        <Link href="/docs/execution">browsers and sandboxes</Link> and the{" "}
        <Link href="/docs/harnesses/coding">coding agent blueprint</Link>.
      </p>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["workspace"]} />

      <h2 id="next">Next</h2>
      <p>
        One agent is now doing everything: reading code, drafting, checking and
        publishing. In <Link href="/docs/build/team">step 6</Link> we split it: a
        reviewer subagent with read-only tools checks the notes before anything
        ships.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
