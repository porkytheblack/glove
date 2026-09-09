# Goals, facts, and form preparation

Use this reference when building goal-driven agents, retaining early evidence, or preparing form answers from information already supplied.

## Package and tool discovery

- Dynamic goals ship in `glove-memory@1.2.0` under `glove-memory/goals`, also exported at the package root. There is no separate `glove-goals` package.
- Import `GoalRunner`, `defineGoalProgram` and goal types from `glove-memory/goals`; `useGoalRunner` and `buildGoalRunnerTools` from `glove-memory/tools`; `InMemoryGoalAdapter` from `glove-memory/in-memory`.
- Forms use `defineForm`, `FormRegistry`, and `FormRunner` from `glove-memory/forms`, and `useFormRunner` from `glove-memory/tools`.
- Shared evidence ships separately as `glove-facts@0.1.0`: `FactStore`, `InMemoryFactAdapter`, `FactPreparation`, `useFacts`, and `buildRecordFactTool` are root exports.
- `useGoalRunner` mounts the `glove_goal_*` tools; `useFormRunner` mounts `glove_form_*`; `useFacts` mounts `record_fact`. Merely importing the classes does not expose tools to an agent.

## Runtime visibility and caching

Use glove-core >=3.8.0 with current glove-memory. Goals, forms, and pinned context register live providers through `addContextProvider`. Glove appends current state as transient user-role messages after saved history before each model iteration, including after tool results. State stays in its scoped adapter; snapshots never rewrite the system prompt or become saved conversation messages. `runtime_context` subscriber events expose resolved snapshots for tracing. Prefix stability does not guarantee provider cache hits.

Runnable proxies must forward `addContextProvider` and `getRuntimeContext`. Forms/goals can opt out with `injectStatus: false` and a custom renderer. Preparation and lifecycle synchronization still run before mounted requests; reading a snapshot does not run inference. Realtime voice silently injects changed snapshots at start and after tools; call `await realtime.refreshContext()` after external changes. Voice providers retain earlier injected snapshots in their session, superseded by the latest one.

## Agent-backed preparation

The caller supplies a dedicated, built `IGloveRunnable` with its model, store and tracing subscribers already configured. The library manages preparation through that agent's normal `processRequest` path. It appends `submit_preparation` once, on the first preparation run, preserving existing tools and the system prompt. Model events, usage, tool execution/results and conversation history remain observable through the supplied agent.

```ts
import type { IGloveRunnable } from "glove-core";
import { FactPreparation, type FactStore } from "glove-facts";

export function makePreparer(facts: FactStore, agent?: IGloveRunnable) {
  return new FactPreparation(facts, { agent });
}
```

Agent presence enables automatic preparation. Omit the agent to keep capture/manual progression without automatic inference, claims or prefilling. Set `preparer.config.agent` to a built agent or `undefined` to affect subsequent operations; an in-flight request retains its starting agent. Do not use the removed `createModelPreparation`, an `inference` callback, a raw model call, or a separate `enabled` flag.

Use a separate preparation agent and store per exact fact scope. Goals and forms in that scope may share it. Do not use the workflow's conversational agent as its own preparation agent. The library serializes preparation on a supplied agent and rejects scope/history mismatches. Avoid concurrent unrelated requests on it. Preparation-agent tools/hooks must not re-enter the same fact store or workflow while the fact scope lock is held.

## Shared integration

The following helper mounts both workflows on a caller-supplied conversational agent. The caller provides the separate preparation agent; each adapter here is process-local and must be replaced for durable production use.

```ts
/** Use one evidence store for both workflows. Supply your own conversational and preparation agents
 * and durable adapters in production; the reference adapters are process-local. */
import type { IGloveRunnable } from "glove-core";
import { z } from "zod";
import { FactStore, FactPreparation, InMemoryFactAdapter, useFacts } from "glove-facts";
import { defineForm, defineGoalProgram, FormRegistry, MemorySchema, InMemoryFormAdapter, InMemoryGoalAdapter } from "glove-memory";
import { useFormRunner, useGoalRunner, type FormEnableTarget } from "glove-memory/tools";

export async function sharedEvidence(glove: FormEnableTarget, preparationAgent: IGloveRunnable, currentMessageId: () => string) {
  const subject = "tenant:1/client:2";
  const facts = new FactStore(new InMemoryFactAdapter(), { scope: { subject, context: "matter:3" } });
  useFacts(glove, facts, () => {
    const id = currentMessageId();
    return { source: { kind: "message", id }, operationId: id };
  });
  const preparer = new FactPreparation(facts, { agent: preparationAgent });
  const rule = { kind: "information" as const, criteria: "Client's preferred contact email" };
  const registry = new FormRegistry().register("contact", {
    name: "Contact", description: "Client contact details",
    load: () => defineForm({ id: "contact", version: 1, name: "Contact", description: "Client contact details" })
      .step("details", { title: "Contact details" }, s => s.field("email", { label: "Email", schema: z.email() })).build(),
  });
  const { runner: forms } = useFormRunner(glove, new InMemoryFormAdapter({ schema: new MemorySchema() }), {
    registry, subject, preparation: { preparer, rule: field => field.id === "email" ? rule : undefined },
  });
  const { runner: goals } = useGoalRunner(glove, new InMemoryGoalAdapter(), {
    scope: { subject, key: "intake" }, preparation: { preparer, rule: (_goal, item) => item.key === "email" ? rule : undefined },
  });
  await facts.record({ text: "Ada's preferred contact email is ada@example.com.", value: "ada@example.com",
    source: { kind: "document", id: "contract:contact-details" }, verification: "verified",
  }, { operationId: "contract:contact-details/email" });
  await goals.start(defineGoalProgram({ key: "intake", goals: [{ key: "contact", title: "Contact", objective: "Know how to contact the client", items: [{ key: "email", label: "Preferred email" }] }] }));
  await forms.start("contact");
  return { facts, preparer, forms, goals };
}
```

The host rule is an allowlist: returning `undefined` leaves a field/item manual. Goal preparation proposes completion (`true`); forms use the field's real Zod schema. The same fact can support both consumers through separate links; facts are never consumed globally.

## Timing and lifecycle

Recording only saves evidence. It does not fan out to every workflow. Preparation runs on new workflow starts, relevant runner commits, before mounted model turns, or explicit `runner.prepare()`. Plain status/inspect reads do not invoke inference. Idempotent no-op goal starts/updates do not force another pass.

Goals retain definitions, versioned progress and stable item keys. Use `runner.revise(program, { ifVersion, reason })` for definition changes and ordinary progress updates for dispositions. A host-owned `eligible` callback can gate automatic completion; default goal preparation considers every live item. Forms reevaluate conditional eligibility as prepared answers open later steps, before their activation/hooks observe state.

Goal lifecycle hooks and `useGoalRunner`'s `configure` callback can project progress into the conversational agent's tools/model/prompt. The host can build a new runnable when constructor/build choices must change. Do not let model-authored goal data become executable hook code or call goal mutations/refresh recursively from configuration.

## Evidence and recovery constraints

- Scope is the exact subject/context tuple; qualify it by tenant/client/matter. Host code owns scope, source and operation identity. `record_fact({ fact, urgent? })` captures unverified prose; it cannot certify actions or approvals.
- Host `facts.record(input, { operationId })` can save verified document/tool evidence. Identical operation retries deduplicate. Corrections use `supersedes: { id, revision }` and retain history.
- Unverified information needs confirmation unless the host information rule explicitly allows it. Actions/outcomes require verified successful evidence with the matching `evidenceKey`; approvals also require an authorized actor. Intentions are not completed actions.
- The model proposes. Source/revision checks, schemas, evidence rules and workflow gates determine authoritative commits. Missing/invalid/failed preparation stays unresolved.
- Corrections or changed criteria flag prior answers/completions for review; they do not silently overwrite existing work or repeat completed actions. Resolve through explicit runner operations. Urgent facts can trigger the host `onUrgent` callback immediately at capture.
- Persist consumer claim receipts with answer/progress history. BYO fact adapters must serialize each scope across workers. Prepared form adapters must retain pending hooks/effects and receipts for recovery. External effects are at least once and need idempotency; do not promise exactly-once delivery.

For full contracts, consult the [facts guide](https://github.com/porkytheblack/glove/blob/main/packages/glove-facts/README.md) and [memory guide](https://github.com/porkytheblack/glove/blob/main/packages/glove-memory/README.md). The [shared-workflow example](https://github.com/porkytheblack/glove/blob/main/packages/glove-memory/examples/shared-facts.ts) is compiled against public package exports.
