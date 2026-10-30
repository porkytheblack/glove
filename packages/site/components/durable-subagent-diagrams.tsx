import { FlowStory } from "./flow-story";
import styles from "./durable-subagent-diagrams.module.css";

export function DurableOwnershipDiagram() {
  return (
    <figure className={`dg-figure ${styles.figure}`} aria-labelledby="durable-ownership-caption">
      <div className={styles.canvas}>
        <div className={styles.blueprint}>
          <span className={styles.label}>Reusable code</span>
          <code>durableSubagents: {"{ analysis: { agent: worker } }"}</code>
          <span>One relationship declared in the coordinator definition</span>
        </div>
        <div className={styles.instances}>
          {["A", "B"].map((name) => (
            <div className={styles.lane} key={name}>
              <div className={styles.parent}>
                <span className={styles.label}>Parent instance {name}</span>
                <strong>Coordinator</strong>
              </div>
              <div className={styles.ownershipArrow}>
                <code>analysis</code>
                <span>created on first use</span>
              </div>
              <div className={styles.worker}>
                <span className={styles.label}>Owned worker {name}</span>
                <strong>Its own instance ID and data</strong>
                <div className={styles.conversations}>
                  <span>Default events</span><span>Task 1</span><span>Task 2</span>
                </div>
                <div className={styles.runs}>Conversations persist · runs start and finish</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption id="durable-ownership-caption">The same worker definition produces a different owned instance for each parent and slot. New tasks reuse that instance; an idle worker needs no continuously running process.</figcaption>
    </figure>
  );
}

export function DurableMemoryDiagram() {
  return (
    <figure className={`dg-figure ${styles.figure}`} aria-labelledby="durable-memory-caption">
      <div className={`${styles.canvas} ${styles.memoryModes}`}>
        <div className={styles.memoryMode}>
          <div className={styles.modeTitle}><strong>Shared</strong><code>scope: "shared"</code></div>
          <div className={styles.memoryStore}>
            <span className={styles.label}>Parent namespace</span>
            <strong>One memory store</strong>
          </div>
          <div className={styles.memoryBranches} aria-hidden="true"><span /><span /></div>
          <div className={styles.consumers}>
            <div><strong>Parent</strong><span>its existing access</span></div>
            <div><strong>Worker</strong><span>reader by default</span></div>
          </div>
          <div className={styles.modeNote}>Both mount the same parent-scoped memory.</div>
        </div>
        <div className={styles.memoryMode}>
          <div className={styles.modeTitle}><strong>Isolated</strong><code>scope: "isolated"</code></div>
          <div className={styles.namespaces}>
            <div className={styles.privateStore}>
              <span className={styles.label}>Parent namespace</span>
              <strong>Parent memory</strong>
            </div>
            <div className={styles.privateStore}>
              <span className={styles.label}>Child namespace</span>
              <strong>Worker memory</strong>
            </div>
          </div>
          <div className={styles.modeNote}>Same profile definitions, separate storage identities.</div>
        </div>
      </div>
      <figcaption id="durable-memory-caption">These are alternative inheritance settings. Access is bounded by the parent&apos;s permissions in both modes. Isolation depends on adapters honoring the supplied namespace; app access is a separate explicit grant.</figcaption>
    </figure>
  );
}

export function DurableEventDeliveryStory() {
  return (
    <div className={styles.delivery}>
      <FlowStory
        id="durable-events"
        viewBox="0 0 990 470"
        label="Durable event delivery: parent agents and applications write addressed events to a journal. Live conversations receive native events; idle conversations wake or defer. Pending events survive restart and expired events are skipped."
        boxes={[
          { id: "parent", x: 16, y: 30, w: 170, h: 60, title: "Parent or worker", sub: "message · task · result", tone: "harness" },
          { id: "app", x: 16, y: 164, w: 170, h: 60, title: "Application", sub: "client.emitEvent", tone: "neutral" },
          { id: "journal", x: 266, y: 98, w: 210, h: 80, title: "Durable journal", sub: "target · policy · receipt", tone: "system" },
          { id: "target", x: 546, y: 98, w: 200, h: 80, title: "Target conversation", sub: "agentId + conversationId", tone: "system" },
          { id: "context", x: 806, y: 98, w: 168, h: 80, title: "Runtime context", sub: "native AgentEvent", tone: "harness" },
          { id: "policy", x: 546, y: 274, w: 200, h: 64, title: "Idle policy", sub: "wake · defer · deadline", tone: "system" },
          { id: "run", x: 806, y: 274, w: 168, h: 64, title: "New event run", sub: "processEvents()", tone: "harness" },
          { id: "pending", x: 546, y: 400, w: 200, h: 54, title: "Pending", sub: "until a turn or deadline", tone: "system", dashed: true },
          { id: "expired", x: 266, y: 400, w: 210, h: 54, title: "Expired", sub: "skip stale input", tone: "neutral", dashed: true },
        ]}
        edges={[
          { id: "message", d: "M186,60 L226,60 L226,124 L262,124" },
          { id: "external", d: "M186,194 L226,194 L226,152 L262,152" },
          { id: "accepted", d: "M476,138 L542,138", label: "persisted", lx: 509, ly: 126 },
          { id: "live", d: "M746,138 L802,138", label: "live", lx: 774, ly: 126 },
          { id: "idle", d: "M646,178 L646,270", label: "idle", lx: 658, ly: 228, anchor: "start" },
          { id: "wake", d: "M746,306 L802,306", label: "wake", lx: 774, ly: 294 },
          { id: "inject", d: "M890,274 L890,182" },
          { id: "defer", d: "M646,338 L646,396", label: "defer", lx: 658, ly: 372, anchor: "start", dashed: true },
          { id: "later", d: "M746,427 L890,427 L890,342", label: "turn / deadline", lx: 824, ly: 415, dashed: true },
          { id: "expire", d: "M546,427 L480,427", label: "expiry", lx: 513, ly: 415, dashed: true },
          { id: "ack", d: "M890,98 L890,22 L371,22 L371,94", label: "acknowledge after success", lx: 637, ly: 14 },
        ]}
        steps={[
          {
            title: "Choose an exact destination",
            lit: ["parent", "app", "message", "external", "journal", "target"],
            packet: { edge: "message", label: "event" },
            text: <>Messages, delegated work and application events resolve to an agent instance and conversation. An omitted message conversation selects the recipient&apos;s stable event conversation; it does not guess the latest chat.</>,
          },
          {
            title: "Persist before dispatch",
            lit: ["journal", "accepted", "target"],
            packet: { edge: "accepted", label: "event" },
            text: <>The journal stores the event ID, destination and delivery policy before dispatch. The sender receives durable acceptance; a response may come later.</>,
          },
          {
            title: "A live run receives a spontaneous event",
            lit: ["target", "live", "context"],
            packet: { edge: "live", label: "event" },
            text: <>If the conversation has a live run, the event joins its native runtime context at the next boundary. An executing tool is allowed to finish; realtime sessions control when they respond.</>,
          },
          {
            title: "An idle conversation follows its policy",
            lit: ["target", "idle", "policy", "wake", "run", "inject", "context", "defer", "pending"],
            packet: { edge: "defer", label: "defer" },
            text: <><code>wake</code> starts an event turn. <code>defer</code> waits for another turn, or for <code>deferTimeoutMs</code> when configured. The controller owns that wait; no worker process must remain alive.</>,
          },
          {
            title: "Pending delivery survives a restart",
            lit: ["journal", "target", "pending", "later", "run", "inject", "context"],
            packet: { edge: "later", label: "replay" },
            text: <>Recovery reconciles completed receipts and retries unfinished delivery to the stored target. A deferred deadline is measured from original acceptance. Delivery is at least once, so repeated external effects need idempotent handling.</>,
          },
          {
            title: "Acknowledge consumption, or expire stale input",
            lit: ["context", "ack", "journal", "pending", "expire", "expired"],
            packet: { edge: "ack", label: "ack" },
            text: <>A successful receiving run acknowledges consumed events. An event that expires before consumption is skipped. Acknowledged and expired IDs remain as deduplication receipts until owned-data purge.</>,
          },
        ]}
        caption="One durable delivery layer carries direct messages and task communication. Native runtime events do not require a mesh inbox. Use the controls to inspect each stage; on small screens, scroll the diagram horizontally."
      />
    </div>
  );
}

export function DurableLifecycleDiagram() {
  return (
    <figure className={`dg-figure ${styles.figure}`} aria-labelledby="durable-lifecycle-caption">
      <div className={styles.canvas}>
        <div className={styles.lifecycle}>
          <div className={styles.state}>
            <span className={styles.label}>Active</span>
            <strong>Accepts work</strong>
            <span>Identity and owned data persist between runs.</span>
          </div>
          <div className={styles.transition}>
            <span>archive <i className={styles.forward} aria-hidden="true" /></span>
            <span className={styles.return}><i className={styles.backward} aria-hidden="true" /> resume</span>
          </div>
          <div className={styles.state}>
            <span className={styles.label}>Archived</span>
            <strong>Work stopped</strong>
            <span>Data and pending events retained for recovery.</span>
          </div>
          <div className={styles.transition}>
            <span>purge <i className={styles.forward} aria-hidden="true" /></span>
            <small>cleanup required</small>
          </div>
          <div className={`${styles.state} ${styles.tombstone}`}>
            <span className={styles.label}>Purged</span>
            <strong>Tombstone remains</strong>
            <span>The same slot cannot silently recreate the worker.</span>
          </div>
        </div>
        <div className={styles.cleanup}>Purge: archived + no running work + descendants purged + successful application cleanup</div>
        <div className={styles.retention}>
          <div><strong>Remove owned data</strong><span>Application hook: private memory, transcripts and external files.</span><span>Bundled adapter: conversations, events, receipts and owned runtime records.</span></div>
          <div><strong>Keep shared data</strong><span>Parent memory, workspace entries and app accounts remain.</span><span>Received copies, execution logs and third-party records have their own retention.</span></div>
        </div>
      </div>
      <figcaption id="durable-lifecycle-caption">Archive and resume preserve the worker&apos;s identity. Purge is a separate cleanup operation. A cleanup failure leaves archived Foundry records available for retry; a replacement uses a new slot name.</figcaption>
    </figure>
  );
}
