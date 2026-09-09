import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Dynamic goals",
  description: "Adapt structured goals to conversation context while preserving progress, deferred work, and revision history.",
};

export default function GoalsPage() {
  return (
    <div className="docs-content">
      <h1>Dynamic goals</h1>
      <p>
        Goals in <code>glove-memory</code> describe what the agent is working
        toward. Each program contains ordered goals with stable keys,
        objectives, and checklist items. As the agent learns more, it can
        revise the program without losing completed work or deferred follow-ups.
      </p>
      <p>
        A returning client might need a short update instead of a full intake.
        Keep the verified identity, retire irrelevant questions, and add a goal
        for the new development. The application chooses its practice rules;
        Glove handles persistence, progress, revisions, and tool integration.
      </p>

      <h2 id="mount">Attach the runner</h2>
      <CodeBlock language="typescript" filename="goals.ts" code={`import { defineGoalProgram, InMemoryGoalAdapter } from "glove-memory";
import { useGoalRunner } from "glove-memory/tools";

const { runner, refresh } = useGoalRunner(glove, new InMemoryGoalAdapter(), {
  scope: { subject: "firm:1/matter:2", key: "intake", agent: "assistant" },
  actor: "intake-agent",
  source: "conversation:3",
  tools: { deny: ["start"] }, // The host chooses the initial program.
});

await runner.start(defineGoalProgram({
  key: "client-intake",
  goals: [{
    key: "identity",
    title: "Confirm identity",
    objective: "Know who is speaking",
    items: [{ key: "client", label: "Verify the client", locked: true }],
  }],
}));

await runner.update({
  goalKey: "identity", completed: ["client"],
  reason: "Returning client verified from stored records",
});`} />
      <p>
        The tools and direct runner share the same state operations. Scope is
        the exact tuple <code>(subject, key, agent?)</code>; qualify subjects
        with the tenant and matter or conversation identity. The model cannot
        select another scope. Use an application-owned <code>GoalAdapter</code>
        for durable storage; the in-memory adapter lasts one process.
      </p>

      <h2 id="revise">Revise when context changes</h2>
      <CodeBlock language="typescript" code={`const current = await runner.inspect();
if (!current) throw new Error("Start a goal program first");

await runner.revise({
  ...current.program,
  goals: [...current.program.goals, {
    key: "updates",
    title: "Matter updates",
    objective: "Collect changes since the previous conversation",
    items: [
      { key: "changes", label: "New developments" },
      { key: "documents", label: "New documents" },
    ],
  }],
}, { ifVersion: current.version, reason: "This is an existing-matter follow-up" });

await runner.update({
  goalKey: "updates", completed: ["changes"], deferred: ["documents"],
  reason: "Update recorded; client will send documents tomorrow",
});`} />
      <p>
        Revisions supply the full ordered program. Stable keys preserve progress,
        including when a removed item is reintroduced. Use new keys for new
        obligations. Remove obsolete definitions or mark them
        <code> retired: true</code>; their history and progress remain. A new
        pending item reopens a completed goal. Program identity cannot change
        within a scope: use another set for a different program.
      </p>
      <p>
        Set <code>locked: true</code> on a goal or item to prevent editing,
        removing, retiring, or unlocking its definition. Locks do not constrain
        dispositions. Hosts can enforce stricter rules through the
        side-effect-free <code>validateChange</code> callback, which runs before
        every commit attempt and rejects by throwing.
      </p>

      <h2 id="progress">Track progress without losing follow-ups</h2>
      <p>
        Untouched items are pending. <code>completed</code> means done;
        <code> deferred</code> and <code> declined</code> settle progression
        while retaining <code>done: false</code>. The first goal with unresolved
        live items is active. Updates can target any goal, including a later
        goal whose answers are already known.
      </p>
      <p>
        Deferred work stays visible after the program completes, including
        deferrals belonging to removed definitions. Complete or decline it
        later; <code>reopened</code> makes a live item pending again. Restore
        retired definitions before reopening them. Repeated dispositions are
        no-ops; unknown or repeated keys reject the whole update.
      </p>

      <h2 id="tools">Agent tools</h2>
      <table>
        <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>glove_goal_status</code></td><td>Read definitions, progress, version, and deferred work.</td></tr>
          <tr><td><code>glove_goal_start</code></td><td>Start a program without resetting an existing set.</td></tr>
          <tr><td><code>glove_goal_update</code></td><td>Set item dispositions with a reason and expected version.</td></tr>
          <tr><td><code>glove_goal_revise</code></td><td>Revise the definition set with a reason and expected version.</td></tr>
          <tr><td><code>glove_goal_history</code></td><td>Inspect saved snapshots, reasons, and provenance.</td></tr>
        </tbody>
      </table>
      <p>
        Tool allow/deny selection narrows model access while the host retains
        the full runner. For custom text or voice surfaces, use
        <code> GoalRunner</code> and <code>buildGoalRunnerTools</code> directly.
      </p>

      <h2 id="lifecycle">Configure the agent as goals progress</h2>
      <p>
        Host-defined <code>onEnter</code>, <code>onComplete</code>, and
        <code> onReopen</code> hooks receive the goal, historical status,
        transition, reason, and a stable idempotency key. Mounted hooks also
        receive the typed <code>glove</code> runnable, so they can fold tools
        or switch its model during a turn. Hook code stays in the host;
        editable goal definitions cannot contain executable callbacks.
      </p>
      <CodeBlock language="typescript" code={`useGoalRunner(glove, adapter, {
  scope,
  hooks: {
    onEnter({ glove, goal }) {
      if (goal.definition.key === "evidence") glove.setModel(evidenceModel);
    },
  },
  configure({ glove, status }) {
    // Reapply current state to a fresh runnable after a restart.
    glove.setModel(status?.activeGoal === "evidence" ? evidenceModel : intakeModel);
  },
});`} />
      <p>
        Transitions are saved atomically with progress. Separate dispatch
        receipts use leases and owner-fenced acknowledgements. Completed
        effects are skipped on restart; failed effects can resume with
        <code> runner.resumeHooks()</code> using the same idempotency key.
        Delivery is at least once: external effects must deduplicate that key.
        Configure an appropriate <code>hookLeaseMs</code> for long effects.
      </p>
      <p>
        <code>configure</code> reapplies current state after writes and before
        requests, including with prompt injection disabled. It must be
        idempotent and must not mutate goal state or call refresh. Async calls
        are serialized. To select constructor options or remove tools, read
        saved status before building a new runnable for the next request.
        The existing <code>fold</code> method adds tools; check for duplicates.
      </p>
      <p>
        Entry means a goal became active; completion means all live items were
        settled, including deferrals and declines; reopening means a completed
        goal has unresolved work. Retirement is not completion. Hooks receive
        the historical transition state, while configure receives current state.
      </p>

      <h2 id="storage">Storage and conflicts</h2>
      <p>
        A <code>GoalAdapter</code> implements <code>get(scope)</code> and
        <code> commit(scope, next, &#123; ifVersion &#125;)</code>. Writes must
        atomically persist definitions, progress, and append-only history
        with compare-and-set semantics; null means create-if-absent. Return
        detached snapshots and throw <code>GoalConflictError</code> on a
        mismatch. The runner assigns versions, timestamps, and provenance.
      </p>
      <p>
        Definition revisions and model progress updates require an explicit
        version. On conflict, read status and reconsider. Direct host updates
        can omit the version to retry disjoint item changes; same-item races
        and concurrent definition changes still surface conflicts. History
        stores complete snapshots, so restoring a runner needs no definition
        registry. Plan durable storage capacity for that growing history.
      </p>
      <p>
        Optional <code>onChange</code> runs after commit. If it fails,
        <code> GoalPostCommitError</code> includes the committed status; the
        state has not rolled back.
      </p>

      <p>
        Lifecycle-enabled adapters also implement <code>claimTransition</code>,
        <code> settleTransition</code>, and <code>getTransitionDispatches</code>.
        These receipts must survive aggregate commits. A busy lease blocks
        later effects and a mounted request waits to be retried before running
        the model. All workers sharing a scope use the same hooks.
      </p>
      <h2 id="forms">Compose with forms and context</h2>
      <p>
        Goals own an independent prompt section, refreshed before each request
        and after runner writes. Forms, context, and goals replace only their
        own marked sections and preserve host prompt edits. External changes
        appear next turn or when the host calls <code>refresh()</code>.
        Use <code>injectStatus: false</code> and <code>renderGoalStatus</code>
        to supply a custom renderer.
      </p>
      <p>
        Form-to-goal mappings belong to the application: after validating a
        form answer, call <code>runner.update</code> for the corresponding
        checklist item. A scope thunk can select a conversation between
        requests; keep it stable during an operation. Use separate runnables
        for concurrent conversations.
      </p>
      <p>
        Continue with <a href="/docs/forms">Forms</a> or the other
        <a href="/docs/memory"> memory subsystems</a>.
      </p>
    </div>
  );
}
