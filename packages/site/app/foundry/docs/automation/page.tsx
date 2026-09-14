import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Playbooks & schedules" };

export default function AutomationPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Model the system / 05</span>
      <h1>Playbooks and schedules</h1>
      <p className="blog-lede">
        Both are runtime data. An agent definition may supply defaults or lazy
        factories, but instances own the chosen playbooks and scheduled triggers—and
        agents can create, list, update, cancel, sleep, and wake through core tools.
      </p>

      <h2 id="playbooks">Playbooks are serializable directives</h2>
      <p>
        A playbook matches a classified inbound transmission event, serializes it into
        the conversation, and tells the agent what outcome is expected. Complex
        authentication, normalization, delivery, and predicates remain on the
        transmission definition.
      </p>
      <CodeBlock filename="playbook-data.ts" language="typescript" code={`composePlaybook({
  name: "support-release-planning",
  transmission: supportTransmission,
  match: {
    event: messageReceived,
    routes: [supportInbound],
    predicate: {
      definition: messageIncludes,
      parameters: { text: "release" },
    },
  },
  directives: [{
    action: respond,
    instruction: "Resolve the request and preserve its external thread.",
    parameters: { tone: "concise" },
  }],
  outbound: [{
    route: supportOutbound,
    application: releaseNotes,
    account: supportAccount,
    event: messageReply,
  }],
  serialization: { payload: "json", envelope: "xml" },
})`} />
      <p>
        The code above composes a valid playbook from imported primitives. The resulting
        value can be returned lazily by a definition, saved on an instance, created by
        a product UI, or attached by a subscription. Playbooks do not need dedicated
        static files.
      </p>

      <h2 id="subscriptions">Subscriptions can provision agents</h2>
      <p>
        An inbound event does not require a pre-existing instance. A subscription can
        request a singleton, per-thread, per-event, fixed fan-out, or custom provisioning
        policy. Foundry claims the delivery, provisions each target, creates or reuses
        conversations, reconstructs the agents, and enqueues one run per target.
      </p>

      <h2 id="predefined-schedules">Predefined schedules are supported</h2>
      <CodeBlock filename="agents/release-planner/schedules/readiness.ts" language="typescript" code={`export default defineSchedule({
  name: "release-readiness",
  description: "Review release readiness every weekday morning.",
  timing: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  message: "Review the plan, workspace tasks, and inbox. Resolve what is actionable.",
});

// agent.ts — loaded only for instances where it applies
schedules: (_agent, { agentInstance }) =>
  agentInstance.context.disableReadiness ? [] : [releaseReadiness],`} />
      <p>
        The definition supplies a composable default. Foundry materializes it as an
        instance-bound schedule before execution, so it can still be listed, updated,
        paused, or cancelled like a schedule created at runtime.
      </p>

      <h2 id="core-tools">Core scheduling tools</h2>
      <table>
        <thead><tr><th>Operation</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td><code>glove_foundry_schedule</code></td><td>Wake an agent once or recurringly with a specific message and payload.</td></tr>
          <tr><td><code>glove_foundry_schedules</code></td><td>List, update, or cancel scheduled triggers owned by the current agent instance.</td></tr>
          <tr><td><code>glove_foundry_sleep</code></td><td>Suspend the logical run until a duration or instant, then resume the same instance and conversation.</td></tr>
          <tr><td><code>glove_foundry_background</code></td><td>Start detached work and optionally reconvene its result through the shared inbox.</td></tr>
        </tbody>
      </table>

      <h2 id="sleep">Sleep is not a detached reminder</h2>
      <p>
        A scheduled trigger starts a future run. Sleep preserves the continuation of
        the current run: the agent can wait for a cooldown, an external result, or a
        deadline and wake with the same instance and conversation correlation. Both
        use the schedule adapter underneath, but expose different agent semantics.
      </p>
    </article>
  );
}
