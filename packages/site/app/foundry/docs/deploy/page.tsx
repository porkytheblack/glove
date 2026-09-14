import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Deploy" };

export default function DeployPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / 11</span>
      <h1>Deploy Foundry</h1>
      <p className="blog-lede">
        Local Foundry uses fast memory adapters. Production Foundry keeps the same
        definitions and replaces operational seams: durable data, execution claims,
        schedules, artifacts, credentials, transports, and telemetry.
      </p>

      <h2 id="checklist">Production adapter checklist</h2>
      <ul>
        <li><strong>Data:</strong> atomic instance provisioning, conversation writes, installation updates, and idempotent inbound claims.</li>
        <li><strong>Execution:</strong> bounded concurrency, cancellation, retry classification, leases, and recovery after process loss.</li>
        <li><strong>Schedules:</strong> durable once/cron triggers, update and cancellation, plus sleep continuations.</li>
        <li><strong>Credentials:</strong> user-owned secret storage, acquisition and refresh with capability-scoped resolution.</li>
        <li><strong>Workspaces:</strong> persistent VFS and artifact storage with size, egress, and read-only policies.</li>
        <li><strong>Observability:</strong> durable events, redaction, retention, and an exporter appropriate to your environment.</li>
      </ul>

      <h2 id="start">Run without the watcher</h2>
      <CodeBlock filename="terminal" language="bash" code={`pnpm typecheck
pnpm start

# or explicitly
glove foundry start --host 0.0.0.0 --port 4141`} />

      <h2 id="workers">Package Foundry workers</h2>
      <p>
        Build the Foundry package and deploy its start command in your ordinary Node
        container or process runtime. Mount working environments through Foundry adapters,
        keep file payloads behind typed artifact references, and give each worker only the
        capabilities its operational role needs. Glovebox is deprecated and should only
        remain in existing deployments while they migrate to this model.
      </p>

      <h2 id="scale">Scale by operational role</h2>
      <p>
        The application API can remain stateless while adapters own durable data. Split
        inbound workers, scheduled activators, model execution, and artifact workers when
        load requires it. Every process uses the same instance reconstruction contract
        and run correlation, so scale does not introduce a second agent model.
      </p>

      <h2 id="health">Do not accept traffic before health</h2>
      <p>
        The <code>/health</code> response reports discovery, execution, environment, and
        activation readiness. Treat required adapter failure as startup failure. A
        deployment that can receive an inbound event but cannot claim or persist it is
        not healthy.
      </p>

      <h2 id="cloud">The cloud path</h2>
      <p>
        Foundry’s public contract is intentionally deployment-neutral. A future managed
        control plane can discover projects, provision adapters, deploy workers, and
        aggregate inspection without changing definitions or leaking infrastructure
        primitives into application code. Today, deploy it wherever Node 20 and your
        selected adapters can run.
      </p>
    </article>
  );
}
