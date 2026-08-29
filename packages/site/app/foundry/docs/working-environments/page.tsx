import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Working environments" };

export default function WorkingEnvironmentsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Give agents a world / 07</span>
      <h1>Working environments</h1>
      <p className="blog-lede">
        Mount a durable virtual filesystem and a request-scoped REPL when an agent needs
        to research, compute, write code, make documents, generate media, inspect its
        output, and pass real artifacts to another agent.
      </p>

      <h2 id="vfs">Mount the VFS</h2>
      <CodeBlock filename="agents/maker/workbench.ts" language="typescript" code={`export const makerWorkspace = defineWorkingEnvironment({
  options: ({ assembly }) => ({
    limits: {
      maxVfsBytes: 64 * 1024 * 1024,
      maxFileBytes: 12 * 1024 * 1024,
    },
    execution: {
      onProgress: (event) => assembly.controls.emit({
        type: "maker.workspace.progress",
        data: event,
      }),
    },
    onVerb: (event) => assembly.controls.emit({
      type: "maker.workspace.verb",
      data: event,
    }),
  }),
});`} />
      <p>
        <code>glove-working-environment</code> owns the sandbox, VFS, script runner,
        limits, and model-facing verbs. Foundry owns instance- and message-aware mounting,
        correlation, persistence boundaries, and inspection.
      </p>

      <h2 id="repl">Build the REPL for this request</h2>
      <CodeBlock filename="agents/maker/workbench.ts" language="typescript" code={`export function makerRepl(actor: string, brief: Brief) {
  const session = JsSession.create({ actor });
  session.register(defineFn({
    name: "brief__current",
    description: "Read the current campaign brief",
    input: z.object({}),
    readOnlyHint: true,
    handler: () => brief,
  }));
  return defineRepl({
    language: "javascript",
    session,
    mount: { frame: "repl", discovery: "auto" },
  });
}`} />
      <p>
        The next message may expose different functions. This is intentional: the REPL
        becomes a small task-specific computer, not a permanent catalog of every API.
      </p>

      <h2 id="adapters">Add artifact capabilities</h2>
      <table>
        <thead><tr><th>Package</th><th>Capability</th></tr></thead>
        <tbody>
          <tr><td><code>glove-env-documents</code></td><td>Read and create PDFs and Word documents, extract DOCX images, and handle scanned documents through render and OCR.</td></tr>
          <tr><td><code>glove-env-spreadsheets</code></td><td>Build and inspect workbooks with paged, structured access.</td></tr>
          <tr><td><code>glove-env-slides</code></td><td>Create and read presentation decks.</td></tr>
          <tr><td><code>glove-env-images</code> + <code>glove-image</code></td><td>Inspect, generate, edit, assemble, and review images with recorded lineage.</td></tr>
          <tr><td><code>glove-env-media</code> + <code>glove-env-motion</code></td><td>Inspect and transform audio/video or render deterministic motion scenes.</td></tr>
          <tr><td><code>glove-env-render</code> + <code>glove-env-ocr</code></td><td>Render artifacts to images, look at the result, and recover text from scans.</td></tr>
        </tbody>
      </table>

      <h2 id="skills">Load skills into the environment</h2>
      <p>
        A skill can install instructions, scripts, templates, and adapter requirements
        into the mounted environment. Resolve skills from the current instance and
        message just like tools. Keep third-party skill code reviewable and pin the
        source revision used by a production instance.
      </p>

      <h2 id="persistence">Choose persistence deliberately</h2>
      <p>
        The in-memory adapter is for development. Production workbenches need durable
        backing, size limits, read-only zones, egress policy, and an artifact export
        strategy. Mount shared paths read-only when several agents consume the same
        source material; write new work into agent- or conversation-owned paths.
      </p>
    </article>
  );
}
