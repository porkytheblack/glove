import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint, HarnessDiagram } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses/research");

export default function ResearchHarnessPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprint</span>
      <h1>Research &amp; documents</h1>
      <p className="blog-lede">
        A research harness reads sources, computes over data and hands back finished work: a
        report as a PDF, a model as a spreadsheet, a deck. Its weight is in the workspace. Instead
        of a menu of document tools, the model gets a filesystem, a script runtime and a standard
        library, and it writes code against your files. Big data stays in files and variables;
        only the answer reaches the context window. Before it hands anything over, it renders
        its own output and looks at it.
      </p>

      <Blueprint
        uses={[
          "Agent loop",
          "Model adapters",
          "Tools",
          "Code as the tool surface",
          "Compaction",
          "Content skills",
          "Store",
          "Virtual filesystem",
          "Working environment",
          "Format adapters",
          "Display stack",
          "Subagents",
          "Definitions",
          "Conversations",
          "Data adapters",
          "Spawn and background",
          "Zero-config deploys",
          "Persistent disk",
          "Model gateway",
        ]}
        write={[
          "The system prompt: what good work looks like for your readers",
          "Functions over your data sources (registered with defineFn), if the REPL is used",
          "A vision adapter: one describe({ bytes, mediaType, prompt }) function",
          "Delivery: what happens when the agent presents a file",
        ]}
      />

      <h2 id="how-it-fits">How it fits together</h2>
      <p>
        Someone uploads a spreadsheet of quarterly sales and asks for a two-page brief with a
        chart. The host mounts the file into the working environment&apos;s <code>/inbox</code>.
        The model starts from the tree: <code>ls /skills</code> shows worked recipes with the exact
        import line for each module, and <code>/std</code> documents the adapters you registered.
      </p>
      <p>
        It writes a script, <code>/scripts/summarise.ts</code>, that imports{" "}
        <code>env:spreadsheets</code>, reads the sheet as plain records and computes the numbers.
        <code>run_script</code> executes it in a worker thread with no network or host access, and
        a large result spills to a file rather than flooding the context. A second script builds
        the brief with <code>env:documents</code> and writes <code>/out/brief.pdf</code>. Then the
        model calls <code>view_image</code> on page 2, sees that the table runs off the page,
        fixes the script and runs it again. <code>checkpoint</code> and <code>undo</code> cover
        anything it wants to roll back. Finally it calls <code>present</code> on the PDF and your
        host delivers it.
      </p>
      <p>
        The scripts remain. The next request (&ldquo;same brief for Q3&rdquo;) reuses{" "}
        <code>summarise.ts</code>, and in Foundry the whole tree is snapshotted between runs, so
        the agent&apos;s script library becomes accumulated capability rather than lost context.
      </p>
      <HarnessDiagram
        highlight="workspace"
        caption="A research harness does its work in the workspace: tools act on files and scripts, and only small results return through the loop."
      />

      <h2 id="skeleton">Skeleton</h2>
      <p>
        The core of{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/document-desk">
          examples/document-desk
        </a>
        , which runs this server-side behind a Next.js app.
      </p>
      <CodeBlock
        filename="analyst.ts"
        language="typescript"
        code={`import { Displaymanager, Glove, MemoryStore, createAdapter } from "glove-core";
import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";
import { slides } from "glove-env-slides";
import { render } from "glove-env-render";
import { fetchFiles } from "glove-env-fetch";
import { visionAdapter } from "./vision.js"; // your code: { describe({ bytes, mediaType, prompt }) }
import { deliver } from "./deliver.js"; // your code: email it, upload it, stream it to the UI

export async function createAnalyst(sessionId: string) {
  const env = await createWorkingEnvironment({
    stdlib: [
      documents(), // env:documents: PDF and DOCX from one spec; extract text
      spreadsheets(), // env:spreadsheets: workbooks as plain records
      slides(), // env:slides: decks in and out
      render(), // env:render: pages to PNG, so the agent can look at its output
      fetchFiles({ allowedDomains: ["data.worldbank.org", "*.ons.gov.uk"] }), // env:fetch, host policy
    ],
    vision: visionAdapter(), // adds view_image
    onPresent: ({ name, bytes }) => deliver(sessionId, name, bytes), // adds present
  });

  const agent = new Glove({
    store: new MemoryStore(\`analyst:\${sessionId}\`),
    model: createAdapter({ provider: "anthropic", model: "claude-sonnet-5-5" }),
    displayManager: new Displaymanager(),
    systemPrompt: "You are an analyst. Work in files and scripts. Check every deliverable with view_image before you present it.",
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Keep the request, the files produced in /out, and what each script in /scripts does.",
    },
  }).build();

  mountWorkingEnvironment(agent, { env }); // the verbs, plus a preamble describing the tree
  return { agent, env };
}`}
      />
      <p>
        When the sources are APIs rather than files, add a REPL. Each function you register
        becomes callable from one <code>execute_js</code> tool, so the model can loop, filter and
        join in a single program instead of a tool call per row:
      </p>
      <CodeBlock
        filename="analyst.ts (continued)"
        language="typescript"
        code={`import { JsSession, defineFn, mountJs } from "glove-js";
import { z } from "zod";

const session = JsSession.create();
session.register(defineFn({
  name: "stats__series",
  description: "Monthly values of one indicator for one country.",
  input: z.object({ indicator: z.string(), country: z.string() }),
  readOnlyHint: true,
  handler: (args) => statsApi.series(args as { indicator: string; country: string }), // your client
}));
mountJs(agent, { session }); // execute_js + discovery tools, and a prompt preamble`}
      />

      <h3 id="foundry">In Foundry</h3>
      <p>
        The same environment becomes an agent field. With a persistence adapter, Foundry restores
        the tree at the start of every run and snapshots it before cleanup, so{" "}
        <code>/scripts</code> and <code>/out</code> survive between messages and restarts:
      </p>
      <CodeBlock
        filename="agents/analyst/agent.ts"
        language="typescript"
        code={`import { defineAgent, defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";
import { render } from "glove-env-render";

const workbench = defineWorkingEnvironment({
  options: { stdlib: [documents(), spreadsheets(), render()], limits: { maxVfsBytes: 256 * 1024 * 1024 } },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }), // one tree per instance
});

export default defineAgent({
  description: "Produces briefs, models and decks as files",
  workingEnvironment: workbench,
  // model, systemPrompt, store …
});`}
      />

      <h2 id="dont-build">What not to build</h2>
      <ul>
        <li>
          <strong>read_pdf, write_docx and make_chart tools.</strong> The{" "}
          <Link href="/docs/working-environment">working environment</Link> and its{" "}
          <Link href="/docs/working-environment#adapters">format adapters</Link> let the model
          compose any of those in a script.
        </li>
        <li>
          <strong>A code runner with filesystem access.</strong> Scripts run in terminable worker
          threads and import only what you inject: no ambient network, host files or processes.
        </li>
        <li>
          <strong>Copying documents into the prompt.</strong> Data stays in the{" "}
          <Link href="/docs/vfs">VFS</Link>; agents pass paths, not bodies.
        </li>
        <li>
          <strong>Fifty API tools.</strong> <Link href="/docs/code-execution">A REPL</Link> takes the
          whole catalogue behind one tool and returns only the program&apos;s answer.
        </li>
        <li>
          <strong>Your own check-the-output loop.</strong> <code>render()</code> plus a vision
          adapter gives the agent <code>view_image</code>, which catches the defects reading the
          text back cannot.
        </li>
      </ul>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <ol>
        <li>
          Deploy the Foundry app as one unit (<code>kuiper deploy --source . -u analyst --wait</code>)
          with <code>FileFoundryDataAdapter</code> under <code>/data</code>: VFS snapshots are stored
          through the data adapter, so the volume keeps them. Size the volume for your files with{" "}
          <code>resources.volumeGiB</code> in <code>kuiper.json</code>.
        </li>
        <li>
          PDF and image rendering need nothing installed. Rendering Word and Excel files needs
          LibreOffice in the image; Kuiper builds from your <code>Dockerfile</code> when the
          repository has one.
        </li>
        <li>
          Route the chat and vision models through the gateway (<code>${"{{"}models.BASE_URL{"}}"}</code>{" "}
          and <code>${"{{"}models.API_KEY{"}}"}</code>) so every call is recorded with tokens and cost.
        </li>
        <li>
          For untrusted code or tools the script runtime does not have (Python, a compiler), give
          the agent a <a href="https://kuiper.sh/docs/sandboxes/">sandbox</a> as well;{" "}
          <code>kuiper/documents</code> is an image with the usual document tooling.
        </li>
      </ol>
      <p>
        Full walkthrough: <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>.
      </p>

      <h2 id="further">Go further</h2>
      <ul>
        <li>
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/document-desk">
            examples/document-desk
          </a>{" "}
          and{" "}
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/analyst-desk">
            examples/analyst-desk
          </a>
          : runnable desks with uploads, a file browser and measured scenarios.
        </li>
        <li>
          Build the parts one at a time: <Link href="/docs/build/workspace">give it a workspace</Link>,{" "}
          <Link href="/docs/build/team">split the work</Link>.
        </li>
        <li>
          Reference: <Link href="/docs/working-environment">Working environment</Link>,{" "}
          <Link href="/docs/vfs">Virtual filesystem</Link>,{" "}
          <Link href="/docs/code-execution">Code execution</Link>,{" "}
          <Link href="/foundry/docs/working-environments">Foundry working environments</Link>.
        </li>
      </ul>
    </article>
  );
}
