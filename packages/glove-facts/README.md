# glove-facts

Shared evidence for Glove goals, forms, text and voice agents. Capture information when it arrives; prepare workflow requirements from that evidence when they become relevant. One fact can support many independent requirements. Capturing a fact never completes a workflow by itself.

```sh
pnpm add glove-facts glove-memory
```

## Capture and inference are separate

```ts
import {
  FactStore, FactPreparation, InMemoryFactAdapter,
  useFacts,
} from "glove-facts";

const facts = new FactStore(new InMemoryFactAdapter(), {
  scope: { subject: "tenant:1/client:2", context: "matter:3" },
  maxRevisions: 10_000, // Optional. Capacity rejects explicitly; it never evicts.
  onUrgent: fact => alertConversation(fact), // Runs at capture, before any stage.
});

// glove is your runnable. Bind source identity to the current message/tool call.
useFacts(glove, facts, () => ({
  source: { kind: "message", id: currentMessageId },
  operationId: currentMessageId,
}));
// Registers record_fact({ fact: string, urgent?: boolean }). Model capture is
// unverified. The model cannot select another scope, attest success or approve.

// A dedicated, built IGloveRunnable, with your model, store and subscribers.
// The library mounts its submission tool and manages preparation requests.
const preparer = new FactPreparation(facts, { agent: preparationAgent });
```

The caller supplies a built Glove agent. The library runs `agent.processRequest`,
so model events, token accounting, tool execution and persisted conversation history
use the agent's normal store and subscribers. There is no direct model invocation
or custom inference callback that bypasses Glove. Preparation does not create an
extra user-facing conversational turn or replace the agent's system prompt.

For example, build a dedicated agent with the same tracing subscriber your
application uses (and a separate conversation store):

```ts
import { Glove, Displaymanager } from "glove-core";

const preparationAgent = new Glove({
  model: preparationModel,
  store: preparationStore,
  displayManager: new Displaymanager(),
  systemPrompt: "Evaluate workflow requirements using supplied evidence.",
  serverMode: true,
  compaction_config: { compaction_instructions: "Summarize preparation history.", max_turns: 6 },
}).addSubscriber(tracingSubscriber).build();
```

**Agent presence is the opt-in.** `new FactPreparation(facts)` disables automatic
preparation. Set `preparer.config.agent = preparationAgent` to enable it, or set it
to `undefined` to disable it for subsequent operations. An in-flight preparation
retains the agent it started with. Capture, accepted links, answers, progress and
manual operations remain available without an agent. Already committed form
effects can still be resumed. Re-enabling reconciles on the next runner operation
or mounted turn; host code can call `runner.prepare()` immediately.

Use a dedicated agent and store per exact fact scope. Forms and goals in that
scope may share it; preparation requests on the same agent serialize. The library
rejects another scope, including when reopening persisted preparation history.
Do not use the workflow's conversational agent as its own preparation agent, run
unrelated requests concurrently on the preparation agent, or mount preparation
recursively on it. The reserved `submit_preparation` tool binds each submission
to a fresh request identity. Its results, errors, and usage follow ordinary Glove
tracing. Missing, duplicate, aborted or failed submissions never authorize values.
Evidence text is encoded to prevent it from activating Glove slash hooks/skills.

Migration from the unreleased preview: replace
`{ enabled: true, inference: createModelPreparation(model) }` with
`{ agent: preparationAgent }`. The model-only helper and inference callback API
have been removed; disabled preparation is represented by the absence of an agent.

## Host-verified evidence and corrections

```ts
const sent = await facts.record({
  text: "The welcome email was delivered to Ada.",
  source: { kind: "tool", id: "mail:delivery:42" },
  verification: "verified",
  evidence: { kind: "action", key: "welcome-email", result: "success" },
}, { operationId: "mail:delivery:42" });

const email = await facts.record({
  text: "Ada's preferred email is ada@example.com.",
  value: "ada@example.com",
  source: { kind: "person", id: "client:2" },
  verification: "verified",
}, { operationId: "conversation:8/email" });

await facts.record({
  text: "Correction: Ada's preferred email is ada@work.example.",
  value: "ada@work.example",
  source: { kind: "message", id: "message:9" },
  verification: "verified",
}, { operationId: "message:9/email", supersedes: email });
```

Facts have a stable id, monotonically increasing revision, exact subject/context scope, observed timestamp, optional effective timestamp, provenance, verification state and optional action/approval/outcome attestation. Corrections append a revision; old evidence is retained. Repeating an operation id and identical input returns the original fact; different input or a stale correction fails. Separate statements remain separate facts, including conflicts. Scope and attestation come from trusted application code, which must authenticate the source and verify the claimed result.

`list()` returns current revisions. `list({ history: true })` includes superseded evidence. `list({ unclaimedBy: consumerId })` excludes only that consumer's accepted references to the exact current revision. `inspect()` includes all facts, links and capture operation receipts. Urgent facts remain available through `list({ urgent: true })` and preparation context. An urgent callback failure throws `FactCaptureError` with the saved fact; retry the same operation id. Urgent delivery is at least once, so deduplicate by id and revision.

## Goals

```ts
import { useGoalRunner } from "glove-memory/tools";

const { runner: goals } = useGoalRunner(glove, goalAdapter, {
  scope: { subject: "tenant:1/client:2", key: "intake" },
  preparation: {
    preparer,
    rule: (goal, item) => {
      if (goal.key === "welcome" && item.key === "sent") {
        return {
          kind: "action", criteria: "Welcome email successfully delivered",
          evidenceKey: "welcome-email",
        };
      }
      if (item.key === "email") {
        return { kind: "information", criteria: "Client's preferred email" };
      }
      return undefined; // This obligation remains manual.
    },
    // Optional host workflow gate; evidence cannot override it.
    eligible: (goal, item, snapshot) => workflowAllows(goal, item, snapshot),
  },
});
```

Goal proposals must have `value: true`. Rules are host-owned and opt each item into preparation. Eligible supported items are applied by the same validated CAS commit that derives progress and lifecycle events. Upcoming obligations can be prepared without entering them. A future goal already satisfied by evidence does not need an `onEnter` action to do the work again. Goal completion hooks still run as completion notifications; use `status.preparation` to inspect supporting claims. All items are eligible by default because GoalRunner supports progress on future goals; supply `eligible` for additional workflow/approval gates.

Preparation runs at start, definition changes, progress commits and before mounted model turns. `runner.prepare()` reconciles out-of-band evidence. Status, lifecycle context, prompt sections and tool replies contain source-linked decisions, synthesized values, unresolved gaps and urgency. Goal `validateChange` sees the final prepared snapshot before persistence.

## Forms

```ts
import { useFormRunner } from "glove-memory/tools";

const { runner: forms } = useFormRunner(glove, formAdapter, {
  registry, subject: "tenant:1/client:2",
  preparation: {
    preparer, // The exact same FactStore used by goals.
    rule: field => field.id === "email"
      ? { kind: "information", criteria: "Client's preferred email" }
      : undefined,
  },
});
```

Form proposals use the real field schemas and authoritative answer history. Preparation does not call adapters to overwrite answers or merely hide prompts. It runs inside the normal entry staging, evaluation, CAS, rising-edge and executor path. Conditional eligibility settles as inferred values open steps, before hooks or returned views observe the next state. Ineligible proposals remain candidates; held values and unrelated checkpoints keep their normal semantics. A model-generated invalid value or invented/stale source rejects the inference batch without entering answer history.

Existing answers—including explicit retractions and undo—are not silently replaced. A corrected source, changed criteria or contrary proposed value yields `review`. This initial release uses that explicit review policy rather than automatic reopening or replacement: the host or agent must revise/retract a form answer or reopen/update a goal through its ordinary operations. Completed actions are preserved. Goal rule definitions and form schema versions must be updated when obligations change.

An action/outcome rule may explicitly declare `fulfills: ["field", "step"]` to acknowledge that its verified result also fulfills this field's `onFill` or its step's `onComplete` effect. Only name an effect if the evidence covers everything it does. Such effects get dispatch receipts with the claim id instead of executing again. Checkpoints and form completion effects cannot be suppressed this way. Information or approval rules cannot suppress effects. Without `fulfills`, ordinary hooks run normally.

## Completion rules

- Information requires verified evidence unless that rule explicitly sets `allowUnverified: true`.
- Ambiguous or conflicted evidence requires clarification. Missing facts stay missing.
- Actions and outcomes require verified, host-attested success for the exact `evidenceKey`. Intention, planned work, an unrelated result or a description of an explanation does not attest success or understanding.
- Approvals additionally require the attested actor to be in the rule's `authorizedActors`. A preference is not an approval.
- All supporting references must exist in the same scope at the current revision; synthesized proposals retain every cited source and their derivation label.
- Inference errors are explicit unresolved preparation reports; they never cause automatic completion. Manual workflow operations still work.

## Persistence, concurrency and recovery

`InMemoryFactAdapter` is a development/reference adapter; it is not durable across process restart. Supply a durable `FactAdapter` for production. A scope is the exact `(subject, context)` tuple. Qualify both with tenancy/matter identities and enforce access in host code. Goal and form subjects must match the FactStore subject; their independent consumer ids prevent cross-workflow link acceptance.

The adapter's `withScope` must serialize capture, correction and preparation/consumer commits across workers. `read()` returns detached snapshots. Each `save()` persists a version + 1 aggregate independently; a later exception does not roll back earlier saves. Use a cross-process lock released on process death (or genuinely fenced transactions); a best-effort TTL lock is insufficient. Do not re-enter this FactStore from a preparation-agent tool or hook, eligibility rule, goal validator or adapter commit. External hooks run after the scope lock is released.

The commit protocol is a recoverable outbox across the two stores: persist proposed links, atomically save values/progress and claim-id receipts in the consumer, then acknowledge accepted links. A process interrupted between the two writes leaves proposed links, never a false accepted completion. Subsequent preparation reconciles acceptance from consumer history. `FactClaimCommitError.value` exposes the already committed result if acknowledgement fails. Deterministic link ids exclude model rationale wording, so retries do not multiply equivalent links.

Form tool replies include prepared context. If settlement or link acknowledgement fails after a write, their error data contains `committed: true` and the existing `instance_id`; resume that instance instead of starting another. Direct runner calls expose `FormPostCommitError` or `FactClaimCommitError`.

A FormAdapter used with preparation must also persist `preparation`, entry `claimId`/`fulfilledHooks`, `pendingHooks` batches and dispatch `effects`. Batches are saved atomically with answers and rising edges. `runner.resumeHooks()` (also called by `prepare()` and mounted turns) finishes interrupted effects and returned patches. Completed effects with durable receipts are not invoked again. Definition drift with pending effects must be resolved explicitly. The adapter must preserve the new fields, not silently discard them.

Goal lifecycle hooks and form effects are at least once around process failure; external services must deduplicate the supplied stable idempotency key. Fact serialization does not make an external email send or payment exactly once. Persist dispatch receipts durably. A correction cannot race validation and the consumer commit within the same scope; it can arrive afterwards and is surfaced on reconciliation. Retention and archival policies are host-owned; no facts, links or completed work are silently pruned.
