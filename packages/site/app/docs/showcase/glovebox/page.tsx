import { CodeBlock } from "@/components/code-block";

export default async function GloveboxShowcasePage() {
  return (
    <div className="docs-content">
      <h1>Build a PDF-Extraction Glovebox</h1>

      <p>
        In this tutorial you will package a PDF-extraction agent as a
        Glovebox — a sandboxed, network-addressable Glove runtime that
        ships with <code>pdftk</code>, <code>pandoc</code>, and{" "}
        <code>pdftotext</code> baked in. The host process never touches a
        PDF; it hands a file to the box, the agent does the work in
        isolation, and the host gets back extracted text plus a structured
        outline.
      </p>

      <p>
        This is the most compelling use of Glovebox: factor out an
        environment that would be painful to install on every web server,
        run it once behind a stable WebSocket endpoint, and let your host
        app talk to it through the regular client SDK. The agent inside the
        box is an ordinary Glove agent — same builder, same tools, same
        subscribers.
      </p>

      <p>
        <strong>Prerequisites:</strong> read{" "}
        <a href="/docs/glovebox">Glovebox</a> for the surface area, and{" "}
        <a href="/docs/server-side">Server-Side Agents</a> for the kind of
        agent you wrap. The example sources live at{" "}
        <code>examples/glovebox-pdf-extractor/</code>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        A box that takes a single PDF on <code>/input</code> and returns
        two artefacts: <code>extracted.txt</code> (the body text) and{" "}
        <code>outline.json</code> (page-numbered headings). The agent
        decides which CLI to invoke based on the document — pure text PDFs
        go through <code>pdftotext</code>, scans get a fallback path
        through <code>pdftk</code> + <code>pandoc</code>. Both binaries
        ship in <code>glovebox/docs:1.2</code>, so no extra packages are
        needed.
      </p>

      <ol>
        <li>
          The host serialises a PDF as a <code>FileRef</code> (inline below
          1MB, otherwise wrapped through client storage)
        </li>
        <li>
          The kit materialises it onto <code>/input/document.pdf</code>{" "}
          before invoking the agent
        </li>
        <li>
          The agent calls <code>extract_text</code>, which shells out to{" "}
          <code>pdftotext</code> and writes <code>/output/extracted.txt</code>
        </li>
        <li>
          The agent calls <code>extract_outline</code>, which uses{" "}
          <code>pdftk</code> to dump bookmarks and writes{" "}
          <code>/output/outline.json</code>
        </li>
        <li>
          The kit lists <code>/output</code>, applies the outputs policy,
          and ships back a <code>complete</code> message with the resolved{" "}
          <code>FileRef</code>s
        </li>
      </ol>

      {/* ------------------------------------------------------------------ */}
      <h2>1. The agent</h2>

      <p>
        The agent is a plain Glove runnable. Two tools, an Anthropic
        adapter, an in-memory store, and the standard{" "}
        <code>Displaymanager</code>. Nothing here knows about Glovebox yet.
      </p>

      <CodeBlock
        filename="examples/glovebox-pdf-extractor/agent.ts"
        language="typescript"
        code={`import { Glove, Displaymanager, createAdapter } from "glove-core";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import z from "zod";

const run = promisify(exec);

class MemoryStore {
  identifier = "pdf";
  private msgs: any[] = [];
  private tokens = 0;
  private turns = 0;
  async getMessages() { return this.msgs; }
  async appendMessages(m: any[]) { this.msgs.push(...m); }
  async getTokenCount() { return this.tokens; }
  async addTokens(n: number) { this.tokens += n; }
  async getTurnCount() { return this.turns; }
  async incrementTurn() { this.turns++; }
  async resetCounters() { this.tokens = 0; this.turns = 0; }
}

export const agent = new Glove({
  store: new MemoryStore(),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4.5", stream: true }),
  displayManager: new Displaymanager(),
  serverMode: true,
  systemPrompt:
    "You extract structured data from PDFs. The user uploads one PDF " +
    "to /input. Use extract_text for the body and extract_outline for " +
    "the table of contents. Always write results into /output and " +
    "summarise what you produced in one paragraph.",
  compaction_config: { compaction_instructions: "Summarise extraction findings." },
})
  .fold({
    name: "extract_text",
    description: "Run pdftotext on a PDF in /input. Writes plain text to /output/<name>.txt.",
    inputSchema: z.object({
      file: z.string().describe("Filename inside /input, e.g. 'document.pdf'."),
      outputName: z.string().describe("Output filename, e.g. 'extracted.txt'."),
    }),
    async do(input) {
      const src = path.join("/input", input.file);
      const dest = path.join("/output", input.outputName);
      await run(\`pdftotext -layout '\${src}' '\${dest}'\`);
      return { status: "success", data: \`Wrote \${dest}\` };
    },
  })
  .fold({
    name: "extract_outline",
    description: "Dump the PDF's bookmark tree as JSON via pdftk and write it to /output.",
    inputSchema: z.object({
      file: z.string(),
      outputName: z.string(),
    }),
    async do(input) {
      const src = path.join("/input", input.file);
      const dest = path.join("/output", input.outputName);
      const { stdout } = await run(\`pdftk '\${src}' dump_data_utf8\`);
      const headings = stdout
        .split("\\n")
        .filter((l) => l.startsWith("BookmarkTitle:") || l.startsWith("BookmarkPageNumber:"));
      const outline: { title: string; page: number }[] = [];
      for (let i = 0; i < headings.length; i += 2) {
        const title = headings[i]?.replace("BookmarkTitle: ", "") ?? "";
        const page = Number(headings[i + 1]?.replace("BookmarkPageNumber: ", "") ?? "0");
        outline.push({ title, page });
      }
      await writeFile(dest, JSON.stringify(outline, null, 2));
      return { status: "success", data: \`Wrote \${dest} (\${outline.length} entries).\` };
    },
  })
  .build();`}
      />

      <p>
        Notice the agent uses <code>serverMode: true</code> and never
        touches the display manager. This is the headless shape — no
        permission gating, no UI checkpoints, just tools that read files
        and write files. The <code>Displaymanager</code> is still required
        by <code>GloveConfig</code> but stays empty.
      </p>

      <p>
        The tools deliberately reach paths through <code>/input</code> and{" "}
        <code>/output</code>. Those mounts come from the default{" "}
        <code>fs</code> map the wrap config inherits — read-only inputs,
        writable outputs, and a writable <code>/work</code> if the agent
        ever wants scratch space.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>2. The wrap config</h2>

      <p>
        <code>glovebox.wrap</code> turns the runnable into a deployable
        app. The base image carries every binary the tools call out to, so
        the <code>packages</code> map stays empty.
      </p>

      <CodeBlock
        filename="examples/glovebox-pdf-extractor/glovebox.ts"
        language="typescript"
        code={`import { glovebox, rule, composite } from "glovebox";
import { agent } from "./agent";

export default glovebox.wrap(agent, {
  name: "pdf-extractor",
  version: "0.1.0",
  base: "glovebox/docs",
  env: {
    ANTHROPIC_API_KEY: { required: true, secret: true },
  },
  storage: {
    // Inputs default to url-then-inline; explicit here for clarity.
    inputs: composite([rule.url(), rule.inline()]),
    // Small extracts inline, anything larger stays on the box for an hour.
    outputs: composite([
      rule.inline({ below: "256KB" }),
      rule.localServer({ ttl: "1h" }),
    ]),
  },
  limits: { cpu: "1", memory: "1Gi", timeout: "2m" },
});`}
      />

      <p>
        This is everything the build CLI needs. The default <code>fs</code>{" "}
        layout is fine; the kit&apos;s injected <code>environment</code>{" "}
        and <code>workspace</code> skills will appear automatically and
        the <code>/output</code> hook gives the agent an escape hatch if a
        tool ever writes outside <code>/output</code> and still wants the
        file shipped back.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>3. Build it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm exec glovebox build ./glovebox.ts
# ✓ Resolved base image: ghcr.io/porkytheblack/glovebox/docs:1.2
# ✓ Resolved packages (0 apt, 0 pip, 0 npm)
# ✓ Generated Dockerfile
# ✓ Generated nixpacks.toml
# ✓ Generated server bundle
# ✓ Generated auth key (fingerprint: 9f3a…b1c2)
# ✓ Wrote dist/`}
      />

      <p>
        The <code>dist/</code> directory is now self-contained — a{" "}
        <code>Dockerfile</code> that <code>FROM</code>s{" "}
        <code>ghcr.io/porkytheblack/glovebox/docs:1.2</code>, an esbuild
        bundle of the agent + the kit, the manifest, and a single-use auth
        key. Running it is a docker invocation away.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`docker build -t pdf-extractor dist/
GLOVEBOX_KEY=$(cat dist/glovebox.key) docker run \\
  -p 8080:8080 \\
  -e GLOVEBOX_KEY \\
  -e ANTHROPIC_API_KEY \\
  pdf-extractor`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>4. Call it from the host</h2>

      <p>
        The host script is a thin <code>GloveboxClient</code> wrapper. It
        reads a PDF off disk, hands it to the box as a named input, streams
        deltas as the agent works, and writes the extracted artefacts to
        the local filesystem when the prompt completes.
      </p>

      <CodeBlock
        filename="examples/glovebox-pdf-extractor/extract.ts"
        language="typescript"
        code={`import { GloveboxClient } from "glovebox-client";
import { readFile, writeFile } from "node:fs/promises";

const client = GloveboxClient.make({
  endpoints: {
    pdf: {
      url: process.env.PDF_BOX_URL ?? "ws://localhost:8080",
      key: process.env.PDF_BOX_KEY!,
    },
  },
});

async function extract(localPath: string) {
  const box = client.box("pdf");
  const bytes = await readFile(localPath);

  const result = box.prompt(
    "Extract the body text and the table of contents from /input/document.pdf. " +
    "Write extracted.txt and outline.json into /output.",
    {
      files: {
        "document.pdf": { mime: "application/pdf", bytes },
      },
    },
  );

  // Stream subscriber events as the agent works.
  for await (const ev of result.events) {
    if (ev.event_type === "tool_use") {
      const e = ev.data as { name: string; input: unknown };
      console.log(\`[tool] \${e.name}\`);
    } else if (ev.event_type === "text_delta") {
      process.stdout.write((ev.data as { text: string }).text);
    }
  }

  const summary = await result.message;
  console.log(\`\\n--\\n\${summary}\`);

  // Pull each output through the configured ClientStorage.
  await writeFile("./extracted.txt", await result.read("extracted.txt"));
  await writeFile("./outline.json", await result.read("outline.json"));
}

await extract(process.argv[2]!);
await client.close();`}
      />

      <p>
        <code>box.prompt(...)</code> returns immediately. The async
        iterables (<code>events</code>, <code>display</code>) drain as
        messages arrive on the WebSocket; the promises (<code>message</code>,{" "}
        <code>outputs</code>) settle when the kit sends{" "}
        <code>complete</code>. <code>result.read(name)</code> dispatches
        through <code>ClientStorage</code> — inline refs decode in place,
        <code>server</code> refs hit <code>GET /files/:id</code> with the
        bearer token. The host code never has to know which adapter the
        kit picked; the policy decides on the box side.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>5. What the kit injected</h2>

      <p>
        Everything ran on top of four extensions the kit folded onto the
        agent at boot — without touching the agent source.
      </p>

      <ul>
        <li>
          The <code>environment</code> skill let the model ask
          &quot;what&apos;s installed?&quot; mid-turn (it returns the
          manifest spec — base image, fs layout, packages, limits).
        </li>
        <li>
          The <code>workspace</code> skill listed <code>/input</code>{" "}
          dynamically so the model could verify the upload landed before
          shelling out.
        </li>
        <li>
          The <code>/output</code> hook would have caught any path the
          agent wanted shipped from outside <code>/output</code> — both
          tools here write inside that mount, so it stays unused.
        </li>
        <li>
          The <code>/clear-workspace</code> hook is available if you turn
          this into a long-lived box that processes many PDFs in
          sequence; sending <code>/clear-workspace</code> between turns
          empties <code>/work</code>.
        </li>
      </ul>

      <p>
        On boot the kit also prepended an environment block to the
        existing system prompt — the agent now knows it is running in a
        glovebox, what version, what fs mounts exist, and what the limits
        are, before any user prompt arrives.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Where each piece runs</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Where it runs</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>agent.ts</code> + tools</td>
            <td>Inside the container</td>
            <td>Calls <code>pdftotext</code> / <code>pdftk</code>; needs the docs base image.</td>
          </tr>
          <tr>
            <td><code>glovebox.ts</code> (wrap)</td>
            <td>Build step only</td>
            <td>Resolved at <code>glovebox build</code>; the runtime reads its config from the bundle.</td>
          </tr>
          <tr>
            <td><code>startGlovebox</code> (kit)</td>
            <td>Inside the container</td>
            <td>HTTP + WS endpoint, storage adapters, file routes, injections.</td>
          </tr>
          <tr>
            <td><code>extract.ts</code> (client)</td>
            <td>Host machine / worker / CI</td>
            <td>Holds the PDF, drives the prompt, writes the extracted artefacts to disk.</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/glovebox">Glovebox reference</a> — full
          authoring + protocol surface
        </li>
        <li>
          <a href="/docs/server-side">Server-Side Agents</a> — the
          headless agent shape the box wraps
        </li>
        <li>
          <a href="/docs/extensions">Hooks, Skills &amp; Mentions</a> —
          how the kit&apos;s injections compose with your own
        </li>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent</a> —
          the in-process counterpart, where the tools live next to the UI
        </li>
      </ul>
    </div>
  );
}
