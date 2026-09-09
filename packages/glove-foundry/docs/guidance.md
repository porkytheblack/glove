# Goals, facts, forms, and live context

Foundry exposes `goals`, `facts`, `forms`, and `contextProviders` as typed lazy
agent fields. Use them in `defineAgent` or as named exports in `agent.ts`.
Configurations may be literal values or resolvers returning values, Promises, or
Effects based on the current message, history, instance, and conversation.

These mount native Glove surfaces, not a second workflow engine. Programs, schemas,
gates, hooks, and preparation rules are code. Progress, answers, fact revisions,
evidence claims, and effect receipts are adapter-owned runtime data.

## Mount native surfaces

```ts
import { defineAgent, defineFacts, defineGoals, defineForms,
  foundryGuidanceSubject, type AgentAssemblyContext } from "glove-foundry";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { MemorySchema } from "glove-memory/core";
import { intakeGoals, intakeForms } from "./workflow.js";
import model from "./model.js";

const memory = (ctx: AgentAssemblyContext) => createSqliteMemoryAdapters({
  file: "/data/agent-memory.sqlite",
  namespace: foundryGuidanceSubject(ctx, "instance"),
  schema: new MemorySchema(),
});

export default defineAgent({
  description: "Conversational intake",
  systemPrompt: "Collect information conversationally using workflow tools.",
  model,
  facts: (_agent, ctx) => defineFacts({ adapter: memory(ctx).facts }),
  goals: (_agent, ctx) => defineGoals({ adapter: memory(ctx).goals, program: intakeGoals }),
  forms: (_agent, ctx) => defineForms({ adapter: memory(ctx).forms, registry: intakeForms }),
  contextProviders: (_agent, ctx) => [async signal => {
    signal?.throwIfAborted();
    return `Response preference: ${ctx.agentInstance.context.concise ? "concise" : "detailed"}`;
  }],
});
```

See the complete [guided-intake example](../../../examples/foundry-agent/agents/guided-intake)
for the native program, Zod form, direct code references, deterministic no-key
model, and optional OpenRouter model. Run `pnpm verify:guidance` in the example
project for a real Foundry worker/restart check.

One surface of each kind mounts per runnable. A program can contain many goals;
a registry can contain many forms. Return `undefined` to omit a surface for a run.
This removes its tools from that assembly, not its saved state.

## Scope and reconstruction

The default subject derives from workspace, instance, and conversation—not run id.
Set `scope: "instance"` to deliberately share across an instance's conversations.
For externally scoped business identities, supply a native goal/fact scope or
form `{ subject }`. Authorization and tenant isolation remain host-owned.
`foundryGuidanceSubject(ctx, scope)` derives the same key outside assembly.
Facts additionally have an evidence context; goals have a program key.

`program` seeds an absent goal scope through native idempotent `start`. Reassembly
never resets progress or overwrites an existing program. To adapt obligations,
call the runner's `revise` with the version you read and a reason. Keep native
goal/item keys stable; use code values such as `identityGoal.key`, not repeated
string references. These are native revision keys, not a new Foundry registry.

`configure`, `spawn`, and `run` receive `ctx.goals`, `ctx.facts`, and `ctx.forms`
as typed native handles. Goals also accept native `configure({ glove, status })`,
`hooks`, `tools`, and `onChange` options for progress-dependent behavior.

## Facts and opt-in preparation

Mounting facts adds native `record_fact`. The model supplies text and urgency;
Foundry binds message/run provenance. It cannot grant verification or choose
another subject. Supply `source` for transport-specific stable operation ids.
Host-verified evidence can be written with `ctx.facts.record(...)`.

To enable automatic preparation, give `facts.preparationAgent` a dedicated,
built Glove runnable with its own scope-specific store and tracing subscribers.
Then configure `goals.preparation` or `forms.preparation` with native `rule` and
optional `eligible` callbacks. Foundry constructs the shared native
`FactPreparation`; it never calls a model adapter directly. Preparation without
a dedicated agent, or with mismatched facts/workflow subjects, rejects explicitly.
Never reuse the conversational runnable or a preparation store across fact scopes.

Rules are host-owned allowlists; omitted requirements remain manual. Unverified
information needs confirmation unless explicitly permitted. Actions and outcomes
need verified successful evidence with the correct evidence key; approvals need
an authorized actor. Intentions are not actions. Corrections can require review;
they do not automatically overwrite answers or repeat completed effects. The same
evidence can support multiple workflows without being consumed globally.

## Forms and effects

Use native `defineForm`, Zod fields, gates, checkpoints and executors. Register a
definition using its own `.id`, not a copied reference string. The registry makes
forms available; it does not start every form. Native tools select, start, fill,
inspect, revise and abandon them. A host may call `ctx.forms.start(form.id)`;
check saved instances, including completed ones, before once-only initialization.

Adapters retain full answer history, pending hook batches, prepared claims,
checkpoint state, and dispatch receipts. Goal hooks and form effects are
at-least-once: downstream effects must use their idempotency keys. Native schemas
and gates retain authority over valid values and permitted effects.

## Custom context providers

The outer resolver selects providers once per run. Each returned native provider
is re-read before a model iteration and may fetch live adapter state. It returns
text, null, or undefined and receives an abort signal. Keep providers read-only;
do not run inference inside one. Foundry removes its providers during cleanup,
including failures.

Glove appends transient user-role context after complete tool-result pairs, without
rewriting system instructions or storing snapshots as conversation messages.
Custom runnable wrappers must forward `addContextProvider` and `getRuntimeContext`.
Realtime voice refreshes at startup and after tools; after external changes the
host calls `realtime.refreshContext()`. It does not automatically interrupt speech
or erase superseded context already in the provider's session.

## Persistence and inspection

`createSqliteMemoryAdapters` supplies goals, facts and forms alongside entity,
episodic, resource and pinned-context memory. Use Node 22.13+ and a local persistent
volume. Goal/form operations are transactional with native CAS and audit state.
Facts use a separate SQLite lock file across asynchronous scope callbacks;
each save commits independently and process death releases the OS-owned lock.
All fact scopes in one database serialize. For greater concurrency use separate
files or a production database adapter. Network filesystems are unsupported.
Same-process callers queue behind the active callback; `busyTimeoutMs` bounds
SQLite contention after that queue, not inference or callback duration. Bound
preparation-agent execution in the host and avoid recursive fact callbacks.
Do not delete or replace database/lock files while workers run. Back up a coherent
SQLite snapshot, not just a live main file without its WAL. The lock file contains
no application records.

The inspector's **Conversation guidance** card shows goal progress, fact
revision/claim counts, and form status/pending effects. It is the latest observed
run snapshot, not a live database query. Its `foundry.guidance.state` event omits
answers and fact bodies. Native runtime-context/tool traces can still contain
conversation content; apply normal access and retention controls. Never put
credentials in facts or context providers.

Foundry data, transcript storage, workflow state, and VFS persistence are separate
boundaries. Durable workflow adapters do not make a transient transcript durable.
These fields do not schedule background work; use Foundry's existing schedules,
sleep, and inbound activations for that.
