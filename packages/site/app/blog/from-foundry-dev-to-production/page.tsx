import Link from "next/link";
import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { ProductionDiagram } from "@/components/diagrams";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("from-foundry-dev-to-production")!;
export const metadata = postMetadata(post);

export default function FoundryToProductionPost() {
  return (
    <article className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        A Foundry agent that works on your laptop is three changes away from production:
        keep its state on a disk, put a check in front of its API, and point its model at a
        gateway. This walkthrough makes those changes to the minimal starter and deploys it
        on Kuiper, with no Dockerfile and no config file.
      </p>

      <h2 id="start">Start from the minimal template</h2>
      <CodeBlock language="bash" code={`npx glove-foundry init assistant --template minimal
cd assistant
pnpm install
pnpm dev`} />
      <p>
        Open <code>http://127.0.0.1:4141</code>, start a run, and ask the assistant what time
        it is. The inspector shows the run, the model call and the{" "}
        <code>current_time</code> tool call. That is a whole agent system already: an
        instance, a conversation, a run queue, an HTTP API and an inspector.
      </p>
      <p>
        Two files matter for production. <code>foundry.application.ts</code> holds the
        process-level setup, and <code>agents/assistant/agent.ts</code> is the agent. The
        file path is the agent&apos;s id.
      </p>

      <h2 id="state">1. Keep state on a disk you choose</h2>
      <p>
        Foundry runs every message in a fresh process. Anything the agent needs on the next
        message has to be stored outside that process. The starter already does this under{" "}
        <code>.data/</code>: <code>FileFoundryDataAdapter</code> keeps instances,
        conversations, schedules and workspace data, and <code>lib/file-store.ts</code> keeps
        each conversation&apos;s transcript.
      </p>
      <p>
        The only change is to make the directory configurable, so the same code writes to{" "}
        <code>.data/</code> on your laptop and to Kuiper&apos;s persistent disk in production:
      </p>
      <CodeBlock filename="lib/paths.ts" language="typescript" code={`import { fileURLToPath } from "node:url";

/** The persistent disk in production; .data/ beside the project locally. */
export const dataDir = process.env.AGENT_DATA_DIR
  ?? fileURLToPath(new URL("../.data/", import.meta.url));`} />
      <p>
        Point both adapters at it. The transcript store takes a directory as its second
        argument:
      </p>
      <CodeBlock filename="agents/assistant/agent.ts" language="typescript" code={`store: ({ conversationId }) =>
  FileStore.open(conversationId, join(dataDir, "transcripts")),`} />
      <p>
        If the agent uses <code>glove-memory</code> or a working environment, put their files
        under the same directory. The four things to persist separately are runtime data,
        transcripts, memory and the VFS; see <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h2 id="authorization">2. Put a check in front of the API</h2>
      <p>
        Locally Foundry listens on loopback. On a public interface it refuses to start
        unless <code>foundry.application.ts</code> defines <code>requestAuthorization</code>.
        Without it, the API, the inspector and the event streams would be open to anyone.
      </p>
      <p>
        The smallest useful check accepts one bearer token and lets health checks through:
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { dataDir } from "./lib/paths.js";

const token = process.env.FOUNDRY_TOKEN;

function bearerMatches(authorization?: string): boolean {
  if (!token || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const data = new FileFoundryDataAdapter({ file: join(dataDir, "foundry.json") });

export default defineApplication({
  name: "assistant",
  data,
  accounts: [],
  routes: [],
  bindings: [],
  requestAuthorization: {
    identifier: "foundry-token",
    challenge: "Bearer",
    authorize: ({ path, authorization }) =>
      Effect.succeed(path === "/health" || bearerMatches(authorization)),
  },
});`} />
      <p>
        The adapter only returns yes or no. Foundry never keeps the credential, and it never
        reaches prompts, events or the inspector. For a browser login to the inspector, add
        an HTTP Basic branch; <a href="https://kuiper.sh/docs/foundry/">Glove Foundry units</a>{" "}
        has the version that accepts both.
      </p>

      <h2 id="models">3. Call models through a gateway</h2>
      <p>
        The starter reads an OpenRouter key from the environment. In production you would
        rather not hand provider keys to the running process at all. Kuiper&apos;s model
        gateway serves each provider&apos;s own API at one address, sends each call to your
        organisation&apos;s provider key, and records every call with its tokens and
        estimated cost. Glove&apos;s <code>createAdapter</code> only needs a different base
        URL and key, and <code>@kuiper-sh/sdk</code> supplies both:
      </p>
      <CodeBlock language="bash" code={`pnpm add @kuiper-sh/sdk`} />
      <CodeBlock filename="agents/assistant/agent.ts" language="typescript" code={`import { join } from "node:path";
import { Kuiper } from "@kuiper-sh/sdk";
import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js";
import { dataDir } from "../../lib/paths.js";

export default defineAgent({
  description: "A general-purpose Glove assistant",

  // The gateway key. Kuiper keeps KUIPER_ names for itself, so name it here.
  model: () => {
    const kuiper = new Kuiper({ apiKey: process.env.GATEWAY_KEY });
    return createAdapter({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      ...kuiper.models.glove("anthropic"),
    });
  },

  store: ({ conversationId }) =>
    FileStore.open(conversationId, join(dataDir, "transcripts")),

  systemPrompt: "You are a precise, practical assistant.",

  tools: [{
    name: "current_time",
    description: "Return the current ISO timestamp",
    inputSchema: z.object({}),
    async do() {
      return { status: "success", data: new Date().toISOString() };
    },
  }],
});`} />
      <p>
        <code>kuiper.models.glove(provider)</code> returns the <code>baseURL</code> and{" "}
        <code>apiKey</code> for that provider: the Anthropic path for{" "}
        <code>anthropic</code>, the shared one for every other provider. A provider&apos;s own
        model names, like <code>claude-…</code> or <code>gpt-…</code>, find your key of that
        provider. Add the provider key once for the organisation:
      </p>
      <CodeBlock language="bash" code={`kuiper providers add anthropic --key -`} />
      <p>
        For local development, make a gateway key for your laptop and put it in{" "}
        <code>.env.local</code> as <code>GATEWAY_KEY</code>. Your laptop and
        production then take the same code path:
      </p>
      <CodeBlock language="bash" code={`kuiper keys create laptop -p assistant --services models`} />

      <h2 id="deploy">4. Deploy</h2>
      <p>
        Kuiper detects Foundry from <code>foundry.config.ts</code> or the{" "}
        <code>glove-foundry</code> dependency. It builds a Node 22 image with your package
        manager, starts <code>glove foundry start --host 0.0.0.0 --port 4141</code>, gives the
        unit a public HTTPS address, a health check and a 5 GiB disk at <code>/data</code>.
      </p>
      <CodeBlock language="bash" code={`kuiper projects create assistant
kuiper use assistant
kuiper units create assistant

openssl rand -hex 24 | kuiper secrets set FOUNDRY_TOKEN=-
kuiper env set -u assistant \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}' \\
  'GATEWAY_KEY=\${{models.API_KEY}}' \\
  AGENT_DATA_DIR=/data

kuiper deploy --source . -u assistant --wait`} />
      <p>
        The variable names are the ones this code reads: <code>FOUNDRY_TOKEN</code> by the
        authorizer, <code>GATEWAY_KEY</code> by the model setup (a unit can&apos;t set names
        that start with <code>KUIPER_</code>), <code>AGENT_DATA_DIR</code>{" "}
        by <code>lib/paths.ts</code>. Their values are templates.{" "}
        <code>{"${{secrets.FOUNDRY_TOKEN}}"}</code> reads a sealed project secret, which never
        enters the image and is redacted from logs. <code>{"${{models.API_KEY}}"}</code> is a
        gateway key made for each running copy of the unit, revoked when that copy stops.
        Because the unit references <code>models</code>, its key opens the model gateway and
        nothing else.
      </p>
      <p>
        The deploy uploads the folder, streams the build log, and prints each step of the
        rollout until the deployment is live. <code>.env</code> files are never uploaded.
      </p>
      <CodeBlock language="bash" code={`kuiper status -u assistant
kuiper logs -u assistant -f
kuiper outputs -u assistant`} />

      <ProductionDiagram />

      <h2 id="call-it">5. Call it from your app</h2>
      <p>
        <code>kuiper outputs</code> lists the unit&apos;s <code>PUBLIC_URL</code>. The typed
        client takes it and a header function:
      </p>
      <CodeBlock language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "./.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({
  baseUrl: assistantUrl, // the unit's PUBLIC_URL
  authorization: {
    identifier: "foundry-token",
    headers: () => ({ authorization: \`Bearer \${foundryToken}\` }),
  },
});

const me = await foundry.agent("assistant").create();
const thread = await foundry.createConversation(me.id);
const run = await foundry.send(me.id, thread.id, "What time is it?");
const done = await run.wait();
console.log(done.output?.value);`} />
      <p>
        The same instance answers on <code>/v1/chat/completions</code> and{" "}
        <code>/v1/responses</code>, so an OpenAI SDK or an existing chat UI can talk to it
        with the instance id as the model. A web app deployed as another unit in the same
        project can reach it privately through <code>{"${{assistant.INTERNAL_URL}}"}</code>.
      </p>

      <h2 id="watch">6. Watch it</h2>
      <p>
        Every Foundry unit has an <strong>Inspect</strong> card, and every project an{" "}
        <strong>Agents</strong> page. They show runs, conversations, events, approvals,
        activations and health, read from the app&apos;s own API through the node it runs
        on. The browser never sees the token, and only reads are possible. The authorizer
        above is what makes that work: Kuiper calls the API with the unit&apos;s{" "}
        <code>FOUNDRY_TOKEN</code>.
      </p>
      <CodeBlock language="bash" code={`kuiper models calls --unit assistant
kuiper models usage --by model`} />
      <p>
        The first lists the unit&apos;s model calls, newest first. The second sums calls,
        tokens and estimated provider cost.
      </p>

      <h2 id="what-to-know">What to know before you rely on it</h2>
      <ul>
        <li>
          <strong>One replica.</strong> The file adapters are single-host, and a unit with a
          volume runs one copy, recreated on deploy rather than overlapped. For several hosts,
          implement <code>FoundryDataAdapter</code> and a <code>StoreAdapter</code> over a
          managed Postgres.
        </li>
        <li>
          <strong>Runs time out after five minutes.</strong> Foundry&apos;s embedded queue is
          in memory. Long waits belong in <code>glove_foundry_sleep</code>, which suspends the
          run and wakes the same conversation later.
        </li>
        <li>
          <strong>Health.</strong> Foundry&apos;s <code>/health</code> sits behind your
          authorizer. The default check is TCP. Because this authorizer lets{" "}
          <code>/health</code> through, an HTTP check works too.
        </li>
        <li>
          <strong>Push to deploy.</strong> <code>kuiper link -u assistant --repo … --branch main</code>{" "}
          replaces <code>deploy --source</code> once the code is in a repository.
        </li>
      </ul>

      <h2 id="what-kuiper-took">What you did not write</h2>
      <table>
        <thead><tr><th>Concern</th><th>Without Kuiper</th><th>On Kuiper</th></tr></thead>
        <tbody>
          <tr><td>Build and start</td><td>A Dockerfile, a process manager</td><td>Detected from the Foundry project</td></tr>
          <tr><td>Disk for state</td><td>A volume, mounted and backed up</td><td>A disk at <code>/data</code> on every Foundry unit</td></tr>
          <tr><td>Provider keys</td><td>Copied into every service</td><td>Held by the gateway; units get a per-copy key</td></tr>
          <tr><td>Secrets</td><td>A secrets manager integration</td><td>Sealed, bound by template, redacted from logs</td></tr>
          <tr><td>HTTPS</td><td>Certificates and a proxy</td><td>An address per unit, custom domains on request</td></tr>
          <tr><td>Seeing runs in production</td><td>Exposing the inspector</td><td>Inspect card and Agents page, read-only</td></tr>
          <tr><td>Model spend</td><td>Reconciling provider bills</td><td>Every call recorded with tokens and cost</td></tr>
          <tr><td>Rolling back</td><td>Image tags and a runbook</td><td><code>kuiper rollback DEPLOYMENT</code></td></tr>
        </tbody>
      </table>

      <div className="blog-note">
        <strong>More.</strong> <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link> is
        the reference for everything here, including browsers, sandboxes and email for
        agents. <a href="https://kuiper.sh/docs/foundry/">Glove Foundry units</a> on
        kuiper.sh covers the dashboard login and the inspector mount path.
      </div>
    </article>
  );
}
