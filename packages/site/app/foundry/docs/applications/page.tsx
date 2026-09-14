import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Apps & transmissions" };

export default function ApplicationsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Model the system / 04</span>
      <h1>Applications and transmissions</h1>
      <p className="blog-lede">
        An application is an installable capability bundle. It is never mounted on
        every agent by default. Its inbound and outbound transmissions describe how
        the outside world enters the runtime and how agent tools reach back out.
      </p>

      <h2 id="application">Define an application</h2>
      <CodeBlock filename="agents/support/apps/helpdesk.app.ts" language="typescript" code={`const helpdesk = defineApp({
  description: "Support messages and replies",
  config: z.object({ queue: z.string() }),
  inbound: [supportTransmission],
  outbound: [supportTransmission],
  connections: [supportListener],
  install: ({ config }) => Effect.succeed({
    tools: [queueStatusTool(config.queue)],
  }),
});

export default helpdesk;`} />
      <p>
        One app can own multiple inbound and outbound transmissions. The install
        handler returns capability surfaces; it does not call the Glove runtime.
        The agent instance decides whether the app is installed.
      </p>

      <h2 id="install">Install on an instance</h2>
      <CodeBlock filename="instance-data.ts" language="typescript" code={`install(helpdesk, {
  queue: "enterprise",
}, {
  account: supportAccount,
})`} />
      <p>
        This expression is serializable into the instance record. At reconstruction,
        Foundry resolves the imported definitions, validates config, asks your account
        and credential adapters for the permitted connection, and mounts outbound
        transmission capabilities as tools.
      </p>

      <h2 id="transmissions">Transmissions own complex transport logic</h2>
      <CodeBlock filename="transmissions/support.transmission.ts" language="typescript" code={`const support = defineTransmission({
  name: "Support",
  account: {
    required: true,
    metadata: Schema.Struct({ address: Schema.String }),
  },
  events: [messageReceived, messageReply],
  inbound: {
    config: Schema.Struct({ channel: Schema.String }),
    event: Schema.Struct({ conversationId: Schema.String, message: Schema.String }),
    classify: () => Effect.succeed(messageReceived),
    predicates: [messageIncludes],
  },
  outbound: {
    input: Schema.Struct({ conversationId: Schema.String, message: Schema.String }),
    output: Schema.Struct({ externalMessageId: Schema.String }),
    adapter: { deliver: sendSupportReply },
  },
});`} />

      <h2 id="credentials">Credentials stay yours</h2>
      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        Foundry never performs OAuth, captures passwords, refreshes tokens, or chooses
        a secret store. Define an adapter that resolves credentials for the account,
        agent instance, installation, capability, and current run. Return only the
        scoped material the transmission needs.
      </p></div>
      <p>
        Accounts are metadata and identity, not credentials. Application account IDs
        and connection state may be persisted; secrets should not be copied into an
        instance, manifest, event, or inspector trace.
      </p>

      <h2 id="inbound">Inbound is a runtime entry point</h2>
      <p>
        A worker authenticates and normalizes an external event through a transmission.
        Persisted playbook subscriptions decide which instances—or provisioning
        policies—receive it. This surface is intentionally specific to agent systems;
        backend networking concepts do not become public Foundry primitives.
      </p>
    </article>
  );
}
