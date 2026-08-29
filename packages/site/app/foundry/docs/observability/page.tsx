export const metadata = { title: "Inspector & observability" };

export default function ObservabilityPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / 10</span>
      <h1>Inspector and observability</h1>
      <p className="blog-lede">
        Foundry is the runtime and the workbench. The same correlation model that runs
        the system explains it: instance → conversation → run → pass → tool, message,
        transmission, schedule, artifact, and handoff.
      </p>

      <h2 id="see">What the inspector shows</h2>
      <table>
        <thead><tr><th>View</th><th>Question it answers</th></tr></thead>
        <tbody>
          <tr><td>Run summary</td><td>What was requested, what state is it in, and what outcome or failure was returned?</td></tr>
          <tr><td>Agent activity</td><td>Which agents are active, waiting, sleeping, retrying, or complete?</td></tr>
          <tr><td>Message passing</td><td>Who handed what to whom, in which conversation, and with which artifact?</td></tr>
          <tr><td>Model passes</td><td>Which provider pass ran, for how long, and what usage or retry occurred?</td></tr>
          <tr><td>Tool and workbench activity</td><td>What capability ran, what safe input/output summary was recorded, and which files changed?</td></tr>
          <tr><td>Inbound and outbound</td><td>Which transmission matched, which subscription provisioned targets, and where was a reply delivered?</td></tr>
        </tbody>
      </table>

      <h2 id="thinking">Work notes, not hidden reasoning</h2>
      <p>
        The runtime can display declared intent, current action, progress, decisions,
        outputs, and safe summaries emitted by the agent or subscriber. It does not
        expose private chain-of-thought. Ask agents to emit useful working notes—“reviewing
        three directions against the brief”—and keep secrets, raw credentials, and
        unfiltered provider payloads out of telemetry.
      </p>

      <h2 id="events">One event envelope</h2>
      <p>
        Events carry timestamps plus run, definition, instance, conversation, workspace,
        pass, and parent correlation where relevant. Custom subscribers can stream them
        to OpenTelemetry, a warehouse, a product-specific interface, or an audit store
        without changing the agent definition.
      </p>

      <h2 id="provider-pressure">Provider pressure is a state</h2>
      <p>
        A transient 429 or interrupted stream should appear as a paused pass with its
        retry attempt and backoff, not as a completed agent or an unexplained wall of
        logs. Terminal exhaustion fails the run with the provider status. The inspector
        distinguishes a retrying pass, a sleeping run, a waiting handoff, and a finished agent.
      </p>

      <h2 id="product-ui">Embed the event stream</h2>
      <p>
        Product interfaces can subscribe to the same event API and render a simpler
        experience: campaign lanes, agent status, handoffs, artifacts, approvals, and a
        lead conversation. The Foundry workbench remains the deep diagnostic view; your
        application decides which operational concepts its users should see.
      </p>
    </article>
  );
}
