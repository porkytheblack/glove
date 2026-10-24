import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Deploy & security",
  description:
    "Run glove foundry start in production: request authorization, TLS, health checks, the managed execution daemon, execution config and a container recipe.",
};

export default function DeployPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Deploy &amp; security</span>
      <h1>Deploy &amp; security</h1>
      <p className="blog-lede">
        A Foundry deployment is one Node 22+ process tree: the control process (HTTP API,
        inspector, instances, schedules) plus a managed execution daemon that runs each agent
        turn in its own job process. Deploying it means giving that tree durable adapters, an
        authorization boundary and a health check.
      </p>

      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        <strong>The short way.</strong> <a href="https://kuiper.sh">Kuiper</a> deploys a
        Foundry folder as it is: no Dockerfile, a persistent disk for state, the model
        gateway, and the agent&apos;s runs in its dashboard. Follow{" "}
        <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>. This page is for
        running <code>glove foundry start</code> anywhere else, and explains what both
        rely on.
      </p></div>

      <h2 id="start">glove foundry start</h2>
      <CodeBlock filename="terminal" language="bash" code={`# from the project root (the directory holding foundry.config.ts)
glove foundry start --host 0.0.0.0 --port 4141`} />
      <table>
        <thead><tr><th>Flag</th><th>Default</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>--root &lt;dir&gt;</code></td><td>current directory</td><td>Project root.</td></tr>
          <tr><td><code>--host &lt;address&gt;</code></td><td><code>server.host</code>, else <code>127.0.0.1</code></td><td>Bind address. Anything but loopback requires <code>requestAuthorization</code>.</td></tr>
          <tr><td><code>--port &lt;number&gt;</code></td><td><code>server.port</code>, else <code>4141</code></td><td>Listen port.</td></tr>
        </tbody>
      </table>
      <p>On start, Foundry:</p>
      <ol>
        <li>
          Loads <code>.env</code>, then <code>.env.local</code>, from the root. A variable that is
          already set is never overwritten, so real environment variables win, and{" "}
          <code>.env</code> wins over <code>.env.local</code>.
        </li>
        <li>
          Imports <code>foundry.config.(ts|mts|js|mjs)</code> and the application file
          (<code>foundry.application.ts</code> unless <code>applicationFile</code> says otherwise).
        </li>
        <li>
          Discovers agents, writes <code>.foundry/routes.d.ts</code> and{" "}
          <code>.foundry/manifest.json</code> (so the root must be writable), starts the runtime and
          its execution daemon, then listens.
        </li>
      </ol>
      <p>
        TypeScript runs directly through <code>tsx</code>, a dependency of{" "}
        <code>glove-foundry</code>; there is no build step. <code>start</code> is{" "}
        <code>dev</code> without file watching. <code>SIGTERM</code>/<code>SIGINT</code> close the
        HTTP server, then stop the runtime, its daemon and running jobs. Full CLI reference:{" "}
        <Link href="/foundry/docs/getting-started">Install &amp; CLI</Link>.
      </p>

      <h2 id="checklist">Production checklist</h2>
      <table>
        <thead><tr><th>Item</th><th>API</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>Durable runtime data</td><td><code>defineApplication({"{ data: new FileFoundryDataAdapter({ file }) }"})</code> or your adapter</td><td>The default is in memory; agent writes during runs are otherwise lost.</td></tr>
          <tr><td>Durable transcripts</td><td><code>conversationStore</code> / <code>store</code> returning a durable <code>StoreAdapter</code></td><td><code>MemoryStore</code> gives every run an empty history.</td></tr>
          <tr><td>Durable memory</td><td><code>createSqliteMemoryAdapters</code> in <code>defineMemory</code></td><td>In-memory adapters reset.</td></tr>
          <tr><td>Persistent files</td><td><code>foundryDataEnvironmentPersistence</code> or a persistent <code>Vfs</code></td><td>The VFS is discarded after every run.</td></tr>
          <tr><td>Authorization</td><td><code>defineApplication({"{ requestAuthorization }"})</code></td><td>Required to bind a non-loopback address; gates every route.</td></tr>
          <tr><td>Client credentials</td><td><code>createFoundryClient({"{ authorization: { identifier, headers } }"})</code></td><td>Headers are resolved per request, outside Foundry data.</td></tr>
          <tr><td>TLS</td><td>A reverse proxy in front of Foundry</td><td>Foundry serves plain HTTP.</td></tr>
          <tr><td>Readiness</td><td><code>GET /health</code> → check <code>ok</code></td><td>Answers 503 (with the same body) when a subsystem is down, so a status-code probe works.</td></tr>
          <tr><td>Body limits</td><td><code>server.messageBodyBytes</code></td><td>1 MB default for message endpoints; raise only for trusted multimodal clients.</td></tr>
          <tr><td>Concurrency and retries</td><td><code>execution.maxConcurrent</code>, <code>maxAttempts</code>, <code>retryBackoffMs</code></td><td>Each running turn is a Node process; retries re-run whole turns.</td></tr>
          <tr><td>Event retention and export</td><td><code>observability.maxEvents</code>; a custom <code>FoundryObservabilityAdapter</code></td><td>Events are kept in memory only (<Link href="/foundry/docs/observability#export">export them</Link>).</td></tr>
          <tr><td>Secrets</td><td>Environment variables and your adapters</td><td>Never in instance <code>context</code>, installation config, workspace entries or environment values.</td></tr>
          <tr><td>One runtime per data store</td><td>—</td><td>Replicas would each re-arm every schedule (see <a href="#scaling">scaling</a>).</td></tr>
        </tbody>
      </table>
      <p>
        The four persistence rows are explained, with a complete working setup, in{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h2 id="authorization">Request authorization</h2>
      <p>
        Foundry binds <code>127.0.0.1</code> by default and refuses any other host
        (<code>0.0.0.0</code>, a LAN or public address) unless the application supplies{" "}
        <code>requestAuthorization</code>: <code>listen()</code> fails with “Foundry refuses to
        bind … without application.requestAuthorization”. Loopback means{" "}
        <code>localhost</code>, <code>127.x.x.x</code> and <code>::1</code>.
      </p>
      <p>
        Once configured, the adapter runs before <em>every</em> request: inspector pages,{" "}
        <code>/api/*</code>, <code>/v1/*</code>, event streams, <code>/health</code> and{" "}
        <code>/health/detailed</code>. It receives:
      </p>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td><code>method</code></td><td><code>string</code></td><td>HTTP method</td></tr>
          <tr><td><code>path</code></td><td><code>string</code></td><td>URL path, e.g. <code>/api/runs</code></td></tr>
          <tr><td><code>query</code></td><td><code>string</code></td><td>Search string including <code>?</code>, or empty</td></tr>
          <tr><td><code>authorization</code></td><td><code>string | undefined</code></td><td>The <code>Authorization</code> header</td></tr>
          <tr><td><code>cookie</code></td><td><code>string | undefined</code></td><td>The <code>Cookie</code> header</td></tr>
          <tr><td><code>remoteAddress</code></td><td><code>string | undefined</code></td><td>The TCP peer (your proxy, when behind one)</td></tr>
        </tbody>
      </table>
      <p>
        <code>authorize</code> returns <code>Effect&lt;boolean&gt;</code>. <code>false</code>, or a
        failure of the effect, produces a <code>401</code> with{" "}
        <code>WWW-Authenticate: &lt;challenge&gt;</code> (default{" "}
        <code>Bearer realm=&quot;Glove Foundry&quot;</code>) and no error detail. Foundry does not
        store or log the credential. This adapter accepts a bearer token for services and HTTP
        Basic for people, because a <code>Basic</code> challenge makes browsers show a login
        prompt for the inspector:
      </p>
      <CodeBlock filename="lib/authorization.ts" language="typescript" code={`import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import type { FoundryRequestAuthorizationAdapter } from "glove-foundry";

const token = process.env.FOUNDRY_API_TOKEN;
const password = process.env.FOUNDRY_INSPECTOR_PASSWORD;

function same(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bearer for services, Basic (browser prompt) for people using the inspector. */
export const controlAuthorization: FoundryRequestAuthorizationAdapter = {
  identifier: "static-control-auth",
  challenge: 'Basic realm="Foundry", charset="UTF-8"',
  authorize: (request) =>
    Effect.sync(() => {
      // Optional: let an unauthenticated load-balancer probe read GET /health only.
      if (request.method === "GET" && request.path === "/health") return true;
      const header = request.authorization ?? "";
      if (token && header.startsWith("Bearer ")) return same(header.slice(7), token);
      if (password && header.startsWith("Basic ")) {
        const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
        return same(decoded, \`operator:\${password}\`);
      }
      return false;
    }),
};`} />
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { join } from "node:path";
import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { controlAuthorization } from "./lib/authorization.js";
import { FileConversationStore } from "./lib/conversation-store.js";
import { dataDir } from "./lib/data-dir.js";

export default defineApplication({
  name: "Support",
  data: new FileFoundryDataAdapter({ file: join(dataDir, "foundry.json") }),
  conversationStore: ({ conversationId }) =>
    FileConversationStore.open(join(dataDir, "transcripts"), conversationId),
  // Required before Foundry will bind anything other than loopback.
  requestAuthorization: controlAuthorization,
});`} />
      <p>
        For sessions, OIDC or a trusted identity proxy, validate <code>cookie</code> or a proxy
        header inside <code>authorize</code> instead (wrap async checks in{" "}
        <code>Effect.tryPromise</code>). The adapter verifies; acquiring, refreshing and revoking
        credentials stays in your identity system. <code>lib/conversation-store.ts</code> and{" "}
        <code>lib/data-dir.ts</code> are on the{" "}
        <Link href="/foundry/docs/persistence#complete-example">Persistence</Link> page.
      </p>
      <h3 id="client-credentials">Sending credentials</h3>
      <CodeBlock filename="lib/foundry.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

export const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
  authorization: {
    identifier: "support-backend",
    // Called on every request, so rotated tokens are picked up without a restart.
    headers: () => ({ authorization: \`Bearer \${process.env.FOUNDRY_API_TOKEN}\` }),
  },
});`} />
      <p>
        <code>headers</code> receives <code>{"{ url, method }"}</code> and may be async. An OpenAI
        SDK pointed at <code>FOUNDRY_URL/v1</code> already sends{" "}
        <code>Authorization: Bearer &lt;apiKey&gt;</code>, so pass the Foundry token as its{" "}
        <code>apiKey</code> (see <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link>).
      </p>

      <h2 id="tls">TLS and reverse proxies</h2>
      <ul>
        <li>Foundry speaks plain HTTP. Terminate TLS at a proxy or load balancer and keep the Foundry port on a private network.</li>
        <li>
          Event streams (<code>/api/events</code>, <code>/v1/runs/:id/events</code>, streaming{" "}
          <code>/v1/chat/completions</code> and <code>/v1/responses</code>) are server-sent events.
          Foundry sends <code>X-Accel-Buffering: no</code> and a heartbeat comment every 15 seconds;
          disable response buffering and keep the proxy’s read timeout above 15 seconds.
        </li>
        <li>
          <code>remoteAddress</code> is the socket peer. Foundry does not parse{" "}
          <code>X-Forwarded-For</code>; if your adapter trusts a proxy header, accept it only from
          your proxy.
        </li>
        <li>
          The inspector is an operator console: it can create instances and conversations,
          start, stop and redirect runs, and approve or deny tool calls. Expose it only to
          operators.
        </li>
      </ul>

      <h2 id="health">Health checks</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Returns</th></tr></thead>
        <tbody>
          <tr>
            <td><code>GET /health</code></td>
            <td>
              <code>ok</code> (all of the next three are true); <code>execution</code>,{" "}
              <code>environment</code>, <code>activations</code> (each true when the execution
              daemon answers its ping; today all three probe the same daemon); counts{" "}
              <code>agents</code>, <code>capabilities</code>, <code>surfaces</code>
            </td>
          </tr>
          <tr>
            <td><code>GET /health/detailed</code></td>
            <td>Everything above plus <code>connections</code> (application connection states) and <code>runs</code> (every retained run, including inputs). Keep it authenticated.</td>
          </tr>
        </tbody>
      </table>
      <p>
        A healthy check returns <code>200</code> with <code>{"\"ok\": true"}</code>. When a
        subsystem is down it returns <code>503</code> with the same body and{" "}
        <code>{"\"ok\": false"}</code>, so a load balancer can gate on the status code alone.
        Both endpoints pass through <code>requestAuthorization</code>, so a probe must send
        credentials unless your adapter exempts <code>GET /health</code> as above. The typed
        client exposes the same check as <code>await foundry.health()</code>.
      </p>

      <h2 id="execution-daemon">The managed execution daemon</h2>
      <CodeBlock filename="process tree" language="text" code={`glove foundry start
└─ Foundry control process   HTTP API, inspector, instances, approvals, schedules, events
   └─ execution daemon       Station 3 on 127.0.0.1: run queue, recurring schedules
      ├─ job process         one per run: imports foundry.application.ts + the agent, runs one turn
      └─ job process`} />
      <ul>
        <li>The runtime forks the daemon at start. The daemon binds loopback only and generates fresh random credentials on every start; keys and backend configuration never enter agent manifests.</li>
        <li>Each run is a separate job process. Agent code, tools and adapters execute there, not in the control process.</li>
        <li>Stopping Foundry gracefully stops the daemon and its jobs. If the daemon loses its connection to the control process, it shuts down too.</li>
        <li>The run queue and recurring schedules live in memory inside the daemon. Persisted activations are re-armed at startup; interrupted jobs are not restored.</li>
      </ul>
      <div className="docs-note">
        <span className="docs-note-icon">!</span>
        <p>
          Not supported yet: attaching to an independently administered or remote daemon, jobs
          that keep running after the control process exits, and distributed failover or high
          availability. Approvals and core callbacks pass through private local temporary files.
        </p>
      </div>
      <p>
        <code>stationDaemon</code> from <code>glove-foundry/station</code> configures the daemon
        Foundry already starts. Omit it for the jobs-only default.
      </p>
      <table>
        <thead><tr><th>Option</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>stationId</code></td><td>Required. 1–128 characters of <code>[a-zA-Z0-9_-]</code>.</td></tr>
          <tr><td><code>name</code></td><td>Display name; defaults to <code>stationId</code>.</td></tr>
          <tr><td><code>port</code></td><td>Fixed loopback port (1–65535). Omit to use any free port; must be unique per runtime.</td></tr>
          <tr><td><code>resources</code></td><td>Factory run once inside the daemon, returning optional <code>browser</code> / <code>sandbox</code> providers. See <Link href="/foundry/docs/browser-and-sandbox">Browser &amp; sandbox</Link>.</td></tr>
          <tr><td><code>onReady</code></td><td>Called inside the daemon with <code>{"{ url, stationId, token }"}</code>. The token has Station admin scope.</td></tr>
        </tbody>
      </table>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineApplication } from "glove-foundry";
import { stationDaemon } from "glove-foundry/station";
import { dataDir } from "./lib/data-dir.js";

export default defineApplication({
  name: "Support",
  daemon: stationDaemon({
    stationId: "support",
    // port: 4244,                       // optional fixed loopback port; default: any free port
    // resources: async () => ({ ... }), // optional browser/sandbox providers
    onReady: async (connection) => {
      // Runs inside the daemon. The token has Station admin scope: never expose it.
      await writeFile(join(dataDir, "station.json"), JSON.stringify(connection), { mode: 0o600 });
    },
  }),
});`} />

      <h2 id="execution-config">Execution and server config</h2>
      <CodeBlock filename="foundry.config.ts" language="typescript" code={`import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { host: "0.0.0.0", port: 4141, messageBodyBytes: 8 * 1024 * 1024 },
  execution: {
    maxConcurrent: 8,   // agent jobs running at once (default 5)
    maxAttempts: 1,     // 1 = no automatic retry (default)
    retryBackoffMs: 1_000,
    pollIntervalMs: 100,
  },
  observability: { maxEvents: 10_000 },
});`} />
      <table>
        <thead><tr><th>Key</th><th>Default</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>server.host</code> / <code>server.port</code></td><td><code>127.0.0.1</code> / <code>4141</code></td><td>Overridden by <code>--host</code> / <code>--port</code>.</td></tr>
          <tr><td><code>server.messageBodyBytes</code></td><td>1,048,576</td><td>JSON limit for message-bearing endpoints; an integer from 1,048,576 to 134,217,728. Other endpoints stay at 1 MB.</td></tr>
          <tr><td><code>execution.maxConcurrent</code></td><td><code>5</code></td><td>Runs executing at the same time.</td></tr>
          <tr><td><code>execution.maxAttempts</code></td><td><code>1</code></td><td>Attempts per run before it fails. Retries re-run the whole turn, so raise it only when tools are idempotent.</td></tr>
          <tr><td><code>execution.retryBackoffMs</code></td><td><code>1000</code></td><td>Delay before a retry.</td></tr>
          <tr><td><code>execution.pollIntervalMs</code></td><td><code>100</code></td><td>Queue polling interval.</td></tr>
          <tr><td><code>execution.idlePollIntervalMs</code></td><td><code>1000</code></td><td>Deprecated; accepted but not forwarded (the daemon owns idle backoff).</td></tr>
          <tr><td><code>observability.maxEvents</code></td><td><code>10000</code></td><td>Size of the in-memory event buffer.</td></tr>
        </tbody>
      </table>
      <p>
        <code>defineConfig</code> rejects unknown keys at compile time. <code>agentsDir</code>,{" "}
        <code>applicationFile</code>, <code>strictFileRoutes</code> and <code>branding</code> are
        covered in <Link href="/foundry/docs/project-structure">Project structure</Link> and{" "}
        <Link href="/foundry/docs/observability#branding">Inspector &amp; WebChat</Link>.
      </p>

      <h2 id="scaling">Scaling by operational role</h2>
      <ul>
        <li>
          <strong>Scale the runtime up, not out.</strong> Every executing turn is a Node process;
          size the machine and <code>execution.maxConcurrent</code> together.
        </li>
        <li>
          <strong>One runtime per data store.</strong> Each runtime has its own in-memory queue and
          re-arms every persisted activation it finds at startup, so two runtimes over one data
          file or database would both fire the same schedules. There is no shared queue or
          failover yet.
        </li>
        <li>
          <strong>Scale your web tier freely.</strong> A Next.js app or API server only calls
          Foundry over HTTP with <code>FOUNDRY_URL</code> (see{" "}
          <Link href="/foundry/docs/nextjs">Next.js integration</Link>).
        </li>
        <li>
          <strong>Split unrelated agent systems</strong> into separate Foundry projects, each with
          its own runtime and data.
        </li>
        <li>
          <strong>Move heavy resources out.</strong> Browser and sandbox providers can run on the
          same Station (<code>resources</code>) or as external workers that mounts connect to.
        </li>
        <li>
          <strong>Retries from webhooks are safe.</strong> Inbound deliveries are claimed by{" "}
          <code>&lt;routeId&gt;:&lt;eventId&gt;</code>; a repeated event returns the runs it
          already started.
        </li>
      </ul>

      <h2 id="container">Container recipe</h2>
      <CodeBlock filename="Dockerfile" language="dockerfile" code={`# Any Node 22.13+ image (glove-memory/sqlite needs 22.13; Foundry needs 22).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# start writes .foundry/ under the project root; state lives on the volume.
RUN mkdir -p /data /app/.foundry && chown -R node:node /data /app/.foundry
USER node
ENV FOUNDRY_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 4141
CMD ["./node_modules/.bin/glove", "foundry", "start", "--host", "0.0.0.0", "--port", "4141"]`} />
      <CodeBlock filename="terminal" language="bash" code={`docker build -t support-foundry .
docker run --init -p 4141:4141 \\
  -v support-data:/data \\
  -e FOUNDRY_API_TOKEN -e FOUNDRY_INSPECTOR_PASSWORD -e OPENROUTER_API_KEY \\
  support-foundry`} />
      <ul>
        <li><code>--host 0.0.0.0</code> only starts because the application sets <code>requestAuthorization</code>.</li>
        <li>
          Point every file-based adapter (<code>FileFoundryDataAdapter</code>, transcripts,{" "}
          <code>memory.sqlite</code>) at <code>FOUNDRY_DATA_DIR</code> on a local volume; SQLite
          memory does not support network filesystems.
        </li>
        <li>
          <code>--init</code> forwards signals and reaps child processes; Foundry starts a daemon
          and one process per run. Leave <code>/tmp</code> writable for the per-runtime approval
          files.
        </li>
        <li>Exclude <code>node_modules</code>, <code>.data</code> and <code>.env*</code> in <code>.dockerignore</code>; pass secrets as environment variables.</li>
        <li>With pnpm, replace the install step with <code>corepack enable &amp;&amp; pnpm install --frozen-lockfile --prod</code> and copy <code>pnpm-lock.yaml</code>.</li>
      </ul>
    </article>
  );
}
