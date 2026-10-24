import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { ProductionDiagram } from "@/components/diagrams";

export const metadata = {
  title: "Deploy on Kuiper",
  description:
    "Deploy a Foundry folder on Kuiper with no Dockerfile: state on the /data disk, an authorizer, the model gateway, email, browsers and sandboxes, health checks, and the agent's runs in the Kuiper dashboard.",
};

const backs: { need: string; yourself: string; kuiper: string }[] = [
  { need: "Build and start", yourself: "A Dockerfile, a process manager, the right flags", kuiper: "Detected from foundry.config.ts or the glove-foundry dependency; runs glove foundry start --host 0.0.0.0 --port 4141 under tini" },
  { need: "Durable state", yourself: "A volume, and making sure only one copy runs", kuiper: "A disk at /data on every Foundry unit; a unit with a disk always runs one copy, so schedules fire once" },
  { need: "An authorization boundary", yourself: "Generate, store and rotate a token", kuiper: "Warns before the build when no requestAuthorization exists; generates FOUNDRY_TOKEN and the inspector login for you" },
  { need: "Model calls", yourself: "Provider keys in every service, your own usage tracking", kuiper: "The model gateway: your provider keys stay at the organisation; every call recorded with tokens and estimated cost" },
  { need: "Email for the agent", yourself: "A mail provider, inbound parsing, webhook verification", kuiper: "A mailbox per agent and Glove tools in @kuiper-sh/inbox/glove" },
  { need: "Browsers and sandboxes", yourself: "Chrome and a container fleet", kuiper: "Gateway browsers and sandboxes, or a Docker socket Kuiper polices for Station's own containers" },
  { need: "A database", yourself: "Provision it, copy the URL into config", kuiper: "kuiper db create postgres main, referenced as ${{main.DATABASE_URL}}" },
  { need: "Seeing production", yourself: "Expose the inspector, ship logs", kuiper: "The Inspect card and Agents page read runs through the node; logs, network logs, usage and budgets" },
];

export default function FoundryKuiperPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Deploy on Kuiper</span>
      <h1>Deploy on Kuiper</h1>
      <p className="blog-lede">
        <a href="https://kuiper.sh">Kuiper</a> is a deployment platform for agents, the
        way Vercel is for Next.js. It recognises a Foundry folder and deploys it with no
        Dockerfile and no config, keeps its state on a persistent disk, and reads its
        runs into the dashboard. This page is the Foundry side: what to change in your
        project, then how to deploy it.
      </p>

      <ProductionDiagram />

      <h2 id="what-kuiper-does">What Kuiper takes off your hands</h2>
      <table>
        <thead><tr><th>A Foundry app needs</th><th>On your own servers</th><th>On Kuiper</th></tr></thead>
        <tbody>
          {backs.map((row) => (
            <tr key={row.need}><td>{row.need}</td><td>{row.yourself}</td><td>{row.kuiper}</td></tr>
          ))}
        </tbody>
      </table>
      <p>
        Kuiper&apos;s own guide, <a href="https://kuiper.sh/docs/glove/">Glove on Kuiper</a>,
        maps every part of a Glove agent to the service under it and has steps for
        personal agents, support desks, coding agents and web or voice fronts.
      </p>

      <h2 id="state">1. Keep state on /data</h2>
      <p>
        Foundry has <Link href="/foundry/docs/persistence">four kinds of state</Link>:
        its runtime data, conversation transcripts, memory and working-environment
        files. All four must be outside the image, or a redeploy loses them. The
        starter templates write to <code>.data/</code> beside the code; on Kuiper, point
        them at the unit&apos;s disk:
      </p>
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`import { join } from "node:path";
import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";

// ".data" locally; set to /data on the unit.
export const dataDir = process.env.AGENT_DATA_DIR ?? ".data";
export const data = new FileFoundryDataAdapter({ file: join(dataDir, "foundry.json") });

export default defineApplication({
  name: "concierge",
  data,
  // requestAuthorization: step 2
});`}
      />
      <ul>
        <li><strong>Transcripts.</strong> Open the template&apos;s <code>FileStore</code> under the same directory: <code>FileStore.open(conversationId, join(dataDir, &quot;transcripts&quot;))</code>.</li>
        <li><strong>Memory.</strong> <code>createSqliteMemoryAdapters({"{ file: join(dataDir, \"memory.db\"), namespace, schema }"})</code> from <code>glove-memory/sqlite</code>.</li>
        <li><strong>Working environment.</strong> <code>foundryDataEnvironmentPersistence()</code> keeps VFS snapshots in the data adapter, so they land on the disk too.</li>
        <li><strong>One copy.</strong> These are single-host adapters. Kuiper runs one copy of a unit with a disk and replaces it on deploy without overlap, which is also what keeps each schedule firing once. To run several copies, move to database-backed adapters on a managed Postgres.</li>
      </ul>

      <h2 id="inspector">2. Add an authorizer</h2>
      <p>
        Foundry won&apos;t bind <code>0.0.0.0</code> without{" "}
        <code>requestAuthorization</code>. This one accepts a bearer token from API
        clients and the Kuiper dashboard, and a username and password from browsers,
        so you can open the inspector:
      </p>
      <CodeBlock
        filename="foundry.application.ts"
        language="typescript"
        code={`import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";

const token = process.env.FOUNDRY_TOKEN;
const dashboardUser = process.env.FOUNDRY_DASHBOARD_USERNAME ?? "admin";
const dashboardPassword = process.env.FOUNDRY_DASHBOARD_PASSWORD;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const allowed = (authorization?: string) => {
  if (!authorization) return false;
  if (token && authorization.startsWith("Bearer ")) return same(authorization.slice(7), token);
  if (dashboardPassword && authorization.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    return i > 0 && same(decoded.slice(0, i), dashboardUser) && same(decoded.slice(i + 1), dashboardPassword);
  }
  return false;
};

export default defineApplication({
  name: "concierge",
  data,
  requestAuthorization: {
    identifier: "kuiper",
    challenge: 'Basic realm="Foundry", charset="UTF-8"',
    authorize: ({ path, authorization }) => Effect.succeed(path === "/health" || allowed(authorization)),
  },
});`}
      />
      <p>
        On Kuiper, open the unit and choose <strong>Foundry inspector → Turn on</strong>{" "}
        (or <code>kuiper dashboard -u concierge --enable</code>). Kuiper generates the
        password, stores it as a project secret and sets both variables. The unit&apos;s{" "}
        <strong>Inspect</strong> card offers <strong>Generate token and restart</strong>{" "}
        for <code>FOUNDRY_TOKEN</code>, which it then uses to read runs through the
        node. Your browser never sees it.
      </p>

      <h2 id="models">3. Call models through the gateway</h2>
      <CodeBlock
        filename="agents/concierge/agent.ts"
        language="typescript"
        code={`import { Kuiper } from "@kuiper-sh/sdk";
import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";

const kuiper = new Kuiper(); // reads KUIPER_GATEWAY_KEY

export default defineAgent({
  description: "Answers for Acme",
  model: () =>
    createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514", ...kuiper.models.glove("anthropic") }),
  // store, systemPrompt, tools, …
});`}
      />
      <p>
        The gateway serves each provider&apos;s own API, so Glove keeps its provider
        and model and only changes the base URL and key. Without the SDK, pass{" "}
        <code>baseURL</code> from <code>{"${{models.BASE_URL}}"}</code> (or{" "}
        <code>{"${{models.ANTHROPIC_BASE_URL}}"}</code> for the <code>anthropic</code>{" "}
        provider) and <code>apiKey</code> from <code>{"${{models.API_KEY}}"}</code>. See{" "}
        <a href="https://kuiper.sh/docs/models/#glove">Kuiper&apos;s models page</a>.
      </p>

      <h2 id="deploy">4. Deploy</h2>
      <CodeBlock
        filename="terminal"
        language="bash"
        code={`curl -fsSL https://kuiper.sh/install | sh
kuiper login
kuiper projects create concierge && kuiper use concierge
kuiper units create concierge

kuiper providers add anthropic --key -            # once per organisation
kuiper env set -u concierge AGENT_DATA_DIR=/data \\
  'KUIPER_GATEWAY_KEY=\${{models.API_KEY}}'

kuiper deploy --source . -u concierge --wait       # or: kuiper link -u concierge --repo … --branch main
kuiper dashboard -u concierge --enable             # inspector login
kuiper logs -u concierge -f`}
      />
      <p>
        The builder uses Node 22 and your package manager, runs your{" "}
        <code>build</code> script if you have one (Foundry needs none), and starts{" "}
        <code>glove foundry start</code>. The default manifest asks for 0.5 vCPU and
        768 MiB, allows up to 2 vCPU and 2 GiB, adds a 5 GiB disk at{" "}
        <code>/data</code>, and lists the names in <code>.env.example</code> as optional
        variables. Run <code>kuiper manifest init --foundry</code> to write that{" "}
        <code>kuiper.json</code> out and tune it.
      </p>

      <h2 id="health">Health checks</h2>
      <p>
        The default manifest checks TCP: the unit is healthy once Foundry accepts
        connections. From glove-foundry 0.5.2, <code>/health</code> answers{" "}
        <code>503</code> when the execution daemon or scheduler fails its ping, so if
        your authorizer lets <code>/health</code> through (the one above does), use it
        as a real readiness check:
      </p>
      <CodeBlock filename="kuiper.json (excerpt)" language="json" code={`{ "health": { "http": "/health" } }`} />

      <h2 id="services">Email, browsers and sandboxes</h2>
      <h3 id="inbox">Email</h3>
      <CodeBlock
        filename="agents/concierge/agent.ts"
        language="typescript"
        code={`import { Inbox } from "@kuiper-sh/inbox";
import { inboxTools } from "@kuiper-sh/inbox/glove";
import { defineSchedule } from "glove-foundry";

// The key is KUIPER_GATEWAY_KEY, as for models. The unit's key only opens the
// services its variables reference, so the unit must also reference the inbox.
const inbox = new Inbox({ gatewayUrl: process.env.INBOX_URL });

const checkMail = defineSchedule({
  name: "check-mail",
  timing: { kind: "every", interval: "5m" },
  message: "Check your mailbox with check_email and answer each new email once.",
});

// in defineAgent:
//   tools: inboxTools(inbox, { mailbox: "concierge" }),
//   schedules: [checkMail],`}
      />
      <p>
        Bind the inbox once, so the unit&apos;s gateway key opens it:{" "}
        <code>kuiper env set -u concierge &apos;INBOX_URL={"${{inbox.BASE_URL}}"}&apos;</code>.{" "}
        <code>kuiper inbox create concierge</code> prints the address. The tools are{" "}
        <code>check_email</code>, <code>read_email</code>,{" "}
        <code>get_email_attachment</code>, <code>send_email</code> and{" "}
        <code>reply_email</code>; <code>allowRecipient</code> limits who the agent may
        write to. Foundry&apos;s API sits behind your authorizer, so to answer the
        moment mail arrives, point the mailbox&apos;s webhook at a small unit that
        forwards to Foundry, as in the{" "}
        <Link href="/foundry/docs/applications#webhooks">webhook recipe</Link>. Kuiper&apos;s{" "}
        <a href="https://kuiper.sh/docs/email-agent/">email agent example</a> builds one
        end to end.
      </p>

      <h3 id="execution">Browsers and sandboxes</h3>
      <p>
        <code>glove-execution</code>&apos;s adapters drive browsers and sandboxes that a
        Station hosts. There is no adapter for Kuiper&apos;s gateway services yet, so
        pick one of these:
      </p>
      <ul>
        <li>
          <strong>Station on the unit.</strong> Host Station&apos;s container sandboxes
          and browsers with <Link href="/foundry/docs/browser-and-sandbox">stationDaemon</Link>{" "}
          and mount them with <code>mountSandbox</code> / <code>mountBrowser</code>. When
          your app depends on <code>station-sandbox</code> or{" "}
          <code>station-browser-use</code>, Kuiper adds the Docker CLI and gives the unit a
          Docker socket it serves and polices; every container runs under gVisor within
          the unit&apos;s limits. Kuiper&apos;s ready-made images, such as{" "}
          <code>kuiper/coding</code>, start by name.
        </li>
        <li>
          <strong>Kuiper&apos;s services from your own tools.</strong>{" "}
          <code>kuiper.sandboxes.create({"{ image: \"kuiper/coding\" }"})</code> and{" "}
          <code>kuiper.browsers.create()</code> from <code>@kuiper-sh/sdk</code> run on
          separate machines, are billed by the second and are held to your budgets.
          Wrap them in Glove tools, or implement a <code>SandboxBackend</code> for{" "}
          <code>createSandboxAdapter</code>.
        </li>
      </ul>

      <h2 id="nextjs">Next.js and Foundry</h2>
      <p>
        An app that runs Next.js and Foundry as two processes deploys as two units from
        one repository. Point the web unit at the Foundry unit&apos;s private address,
        which needs no public route:
      </p>
      <CodeBlock filename="terminal" language="bash" code={`kuiper env set -u web 'FOUNDRY_URL=\${{concierge.INTERNAL_URL}}'`} />
      <p>
        The generated <code>lib/foundry.ts</code> client reads <code>FOUNDRY_URL</code>;
        give it the same bearer token through its <code>authorization</code> option. See{" "}
        <Link href="/foundry/docs/nextjs">Next.js integration</Link>.
      </p>

      <h2 id="checklist">Checklist</h2>
      <ul>
        <li>Data adapter, transcripts, memory and VFS snapshots under <code>AGENT_DATA_DIR</code>, set to <code>/data</code>.</li>
        <li><code>requestAuthorization</code> that accepts <code>Bearer $FOUNDRY_TOKEN</code> and lets <code>/health</code> through.</li>
        <li>Models through the gateway; provider keys added with <code>kuiper providers add</code>, never set on the unit.</li>
        <li>Secrets set with <code>kuiper secrets set</code> and bound with <code>{"${{secrets.NAME}}"}</code> templates.</li>
        <li>Inspector login turned on; <code>FOUNDRY_TOKEN</code> generated from the Inspect card.</li>
        <li>A budget on the project if the agent can start browsers or sandboxes.</li>
      </ul>
      <p>
        Running somewhere else? <Link href="/foundry/docs/deploy">Deploy &amp; security</Link>{" "}
        covers <code>glove foundry start</code>, TLS, the execution daemon and a
        container recipe for any host.
      </p>
    </article>
  );
}
