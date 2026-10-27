import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { ProductionDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/production";
export const metadata = docsMetadata(HREF);

export default function BuildProductionPage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Put it in production</h1>
      <p className="blog-lede">
        Production is four more questions. Where does it run and stay running? Where
        does state live across redeploys? How does it reach models, browsers,
        sandboxes and mail without keys in every unit? How do you see what it did?{" "}
        <a href="https://kuiper.sh">Kuiper</a> answers all four for a Foundry folder,
        with no Dockerfile.
      </p>

      <ProductionDiagram />

      <h2 id="ready">Three changes before you deploy</h2>

      <h3 id="disk">1. Put state on the disk</h3>
      <p>
        Every Foundry unit on Kuiper gets a persistent disk at <code>/data</code>. The
        starter template writes its state next to the code, which is inside the
        image, so a redeploy would wipe it. Point Foundry&apos;s data, the
        transcripts and any SQLite memory at one directory you can set per
        environment:
      </p>
      <CodeBlock
        filename="lib/paths.ts"
        language="typescript"
        code={`import { join } from "node:path";

// ".data" on your machine; set it to /data on Kuiper.
export const dataDir = process.env.AGENT_DATA_DIR ?? ".data";
export const dataFile = (name: string) => join(dataDir, name);`}
      />
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { dataFile } from "./lib/paths.js";

export const data = new FileFoundryDataAdapter({ file: dataFile("foundry.json") });

export default defineApplication({ name: "release-desk", data /* , requestAuthorization (below) */ });`}
      />
      <CodeBlock
        filename="agents/release/agent.ts (store)"
        language="typescript"
        code={`store: ({ conversationId }) => FileStore.open(conversationId, dataFile("transcripts")),`}
      />
      <p>
        These adapters are single-host, so the unit runs one replica. Kuiper
        guarantees that for a unit with a disk: a deploy replaces the copy and never
        overlaps it. That matters for schedules too, because every runtime arms the
        schedules it finds. For several hosts, use a database-backed data adapter
        and store; Kuiper&apos;s managed Postgres is one command away.
      </p>

      <h3 id="auth">2. Put an authorizer in front</h3>
      <p>
        Foundry refuses to listen on a public interface unless{" "}
        <code>foundry.application.ts</code> defines <code>requestAuthorization</code>.
        Otherwise the inspector, the API and the event streams would be open to
        anyone. The smallest one accepts a bearer token and lets the health check
        through:
      </p>
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";

const token = process.env.FOUNDRY_TOKEN;
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default defineApplication({
  name: "release-desk",
  data,
  requestAuthorization: {
    identifier: "release-desk-token",
    challenge: "Bearer",
    authorize: ({ path, authorization }) =>
      Effect.succeed(
        path === "/health" ||
          (!!token && !!authorization?.startsWith("Bearer ") && same(authorization.slice(7), token)),
      ),
  },
});`}
      />
      <p>
        Browsers can&apos;t send a bearer token, so to open the inspector from one, add
        a Basic branch; Kuiper&apos;s <strong>Foundry inspector</strong> switch then
        manages the username and password for you. The{" "}
        <Link href="/foundry/docs/kuiper#inspector">Deploy on Kuiper</Link> page has
        that version.
      </p>

      <h3 id="models">3. Call models through the gateway</h3>
      <p>
        Kuiper&apos;s model gateway serves each provider&apos;s own API at one address
        and sends calls to <em>your</em> provider keys, which never reach the unit. It
        records every call with its tokens and estimated cost. Glove keeps its
        provider and model; it only changes base URL and key:
      </p>
      <CodeBlock
        filename="agents/release/agent.ts (model)"
        language="typescript"
        code={`import { Kuiper } from "@kuiper-sh/sdk";

const kuiper = new Kuiper({ apiKey: process.env.GATEWAY_KEY });   // KUIPER_ names are Kuiper's own

model: () => createAdapter({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  ...kuiper.models.glove("anthropic"),   // { baseURL, apiKey } for this provider
}),`}
      />

      <h2 id="deploy">Deploy</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`curl -fsSL https://kuiper.sh/install | sh
kuiper login

kuiper projects create release-desk
kuiper use release-desk
kuiper units create release

# Provider keys live at the organisation, never in the unit
kuiper providers add anthropic --key -

# Secrets and variables, as templates
openssl rand -hex 24 | kuiper secrets set FOUNDRY_TOKEN=-
kuiper env set -u release \\
  AGENT_DATA_DIR=/data \\
  'FOUNDRY_TOKEN=\${{secrets.FOUNDRY_TOKEN}}' \\
  'GATEWAY_KEY=\${{models.API_KEY}}'

kuiper deploy --source . -u release --wait
kuiper logs -u release -f`}
      />
      <p>
        Kuiper sees a Foundry app (a <code>foundry.config.ts</code> or a{" "}
        <code>glove-foundry</code> dependency) and builds it on Node 22 with your
        package manager. It starts <code>glove foundry start</code> on port 4141 with
        a health check, a 5 GiB disk at <code>/data</code>, and the names in{" "}
        <code>.env.example</code> as optional variables. <code>kuiper link --repo …</code>{" "}
        makes every push to a branch deploy, and every deployment is numbered, so{" "}
        <code>kuiper rollback</code> brings any earlier one back.
      </p>

      <h2 id="watch">See it run</h2>
      <ul>
        <li><strong>Inspect card and Agents page.</strong> The unit&apos;s runs, conversations, events, approvals and activations, read through the node with the unit&apos;s own <code>FOUNDRY_TOKEN</code>. Your browser never holds it. If the unit has no token yet, the card offers to generate one.</li>
        <li><strong>Model calls.</strong> <code>kuiper models calls --unit release</code> lists every call with tokens, latency and estimated cost; turn on logging to keep prompts and tool calls too.</li>
        <li><strong>Logs</strong> survive crashes and redeploys, with secret values redacted.</li>
        <li><strong>Budgets</strong> notify or block at a limit you set, per organisation, project or key.</li>
        <li><strong>Your coding agent</strong> can read all of it over Kuiper&apos;s MCP server: <code>claude mcp add --transport http kuiper https://app.kuiper.sh/mcp</code>.</li>
      </ul>

      <h2 id="reach">Browsers, sandboxes and email</h2>
      <p>
        The same gateway key reaches the rest of Kuiper&apos;s services once the
        unit&apos;s variables reference them. <a href="https://kuiper.sh/docs/inbox/">Inbox</a>{" "}
        gives the agent an email address, with Glove tools from{" "}
        <code>@kuiper-sh/inbox/glove</code> and signed webhooks straight to the unit.{" "}
        <a href="https://kuiper.sh/docs/browsers/">Browsers</a> are real Chrome behind
        Steel&apos;s API. <a href="https://kuiper.sh/docs/sandboxes/">Sandboxes</a> come
        from ready-made images such as <code>kuiper/coding</code>; a Foundry app that
        hosts Station&apos;s own container sandboxes declares{" "}
        <code>capabilities.sandbox</code> in <code>kuiper.json</code> and gets a Docker
        socket Kuiper polices. <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>{" "}
        covers each.
      </p>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["run", "keep", "reach", "watch"]} />

      <h2 id="done">Where you are now</h2>
      <p>
        You have built every layer: a harness with all seven parts, a Foundry system
        around it, and production on Kuiper. Most of it was configuration. You wrote
        tools, prompts and a few adapters; the loop, the state, the queue, the
        approvals, the API, the inspector, the deploy and the gateway already existed.
        That ratio is the point. From here:
      </p>
      <ul>
        <li>Pick a <Link href="/docs/harnesses">harness blueprint</Link> close to what you are building.</li>
        <li>Keep the <Link href="/docs/primitives">primitives map</Link> open while you build.</li>
        <li>Give your coding agent the <Link href="/docs/agent-skill">skills</Link> so it knows all this too.</li>
      </ul>
      <StepPath href={HREF} />
    </article>
  );
}
