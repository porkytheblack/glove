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

      <h2 id="shared-tree">One tree, several consumers</h2>
      <p>
        <code>filesystem</code> takes any <a href="/docs/vfs"><code>glove-vfs</code></a>{" "}
        tree, and the same tree can back a <code>glove-memory</code> resource store
        and a REPL session at the same time. That matters most in Foundry, where an
        instance already owns memory, an environment and often a REPL: without a
        shared tree each one keeps its own copy and the agent cannot file what it
        just made.
      </p>
      <CodeBlock filename="agents/maker/workbench.ts" language="typescript" code={`import { mountFs, inMemoryFs, cachedRemote, withAccess, withMeta } from "glove-vfs";
import { vfsResources } from "glove-vfs/resources";
import { fsFns } from "glove-vfs/fns";

export function makerTree(instanceId: string) {
  return withAccess(
    withMeta(mountFs([
      { at: "/",       fs: inMemoryFs() },
      { at: "/memory", fs: await cachedRemote(store, { prefix: \`instances/\${instanceId}/\` }) },
    ]), { lexical: true }),
    { rules: [{ path: "/corpus", access: "read", note: "curated upstream" }] },
  );
}`} />
      <p>
        Pass it as the working environment&apos;s <code>filesystem</code>, hand{" "}
        <code>vfsResources(tree, {"{ schema, root: \"/memory\" }"})</code> to the
        instance&apos;s resource curator, and <code>fsFns(tree)</code> to the REPL
        session. A script&apos;s output is a memory resource at the same path,
        immediately.
      </p>
      <p>
        Access policy is enforced on the <strong>filesystem</strong>, not per
        surface, so one rule binds the model&apos;s verbs, a script&apos;s{" "}
        <code>env:fs</code> calls, REPL functions and host handles alike — and it
        governs metadata too, so a fenced subtree does not leak through a summary
        or a semantic hit. Mount only the per-instance prefix: the tree is the
        tenancy boundary, and a shared prefix is a cross-instance read.
      </p>
      <p>
        Foundry closes the environment after each run, so persist with{" "}
        <code>snapshot()</code> and restore with <code>fromSnapshot()</code>. Both
        unwrap the layer stack first, so the metadata index survives the round
        trip rather than coming back empty with the bytes intact.
      </p>

      <h2 id="http-secrets">HTTP and credentials</h2>
      <p>
        Put <code>fetchFiles()</code> and <code>secret()</code> in the working
        environment options&apos; <code>stdlib</code>. Supply the owning instance&apos;s
        host store and narrow origin/credential grants. The native transport blocks
        non-public DNS/IP destinations unless the host grants an exact private origin;
        custom transports must implement equivalent protections.
      </p>
      <p>
        Foundry closes its environment after each run. Re-supply the same scoped
        persistent store on the next run: VFS snapshots contain neither secret
        values nor network policy. Default memory stores are ephemeral. See the
        {" "}<a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-working-environment/HTTP-AND-SECRETS.md">HTTP and secrets guide</a>
        {" "}for setup, script recipes and cancellation behavior.
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
          <tr><td><code>glove-env-fetch</code></td><td>HTTP calls and VFS downloads/uploads with host policy, DNS/IP checks and scoped credentials.</td></tr>
          <tr><td><code>glove-env-secret</code></td><td>Host-backed key metadata and references; explicit reveal/write opt-ins and pluggable persistence.</td></tr>
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
