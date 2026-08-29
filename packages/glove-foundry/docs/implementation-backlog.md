# Glove Foundry implementation backlog

This file records accepted architectural gaps and their implementation status.

## Completed — filename-owned definitions and typed config flow

Status: implemented across discovery, isolated execution, the scaffold, ESLint,
the reference application, and persistence reconstruction.

- convention files default-export one definition and derive nested identities
  from their path;
- imported definition objects are the only code-authoring reference mechanism;
- isolated agent processes repeat discovery binding before assembly;
- instance/playbook/subscription seeds defer serialization until identities are
  bound;
- Zod installation schemas infer `install(...)` input and decoded callback
  config;
- Effect transmission schemas infer account metadata and inbound/outbound route
  config;
- `defineConfig` rejects unknown framework keys while preserving exact types;
- runtime/data records retain explicit IDs because they are dynamically
  provisioned and editable; and
- the recommended ESLint preset rejects explicit IDs on static file-routed
  definitions.

## Completed — Playbook subscriptions activate agents without pre-existing instances

Status: implemented in the runtime and memory data adapter.

The inbound dispatcher evaluates both instance playbooks and independent,
durable `PlaybookSubscription` records. A subscription can activate work when
no `AgentInstance` exists.

Implemented behavior:

- persist playbook subscriptions independently from materialized agent
  instances;
- let a subscription target one or more agent definition routes;
- resolve existing instances or atomically provision instances from persisted
  data when a matching inbound transmission arrives;
- support explicit provisioning policies such as singleton, per-thread,
  per-event, fixed fan-out, and a user-supplied provisioning adapter;
- create or reuse the appropriate conversation before dispatching each run;
- make inbound retries idempotent across event matching, instance provisioning,
  conversation creation, and run enqueueing;
- keep executable predicates on transmission definitions and keep playbooks and
  subscriptions serializable;
- emit observable match, provisioning, fan-out, and dispatch events without
  exposing backend execution-engine terminology.

The intended flow is:

```text
inbound event
  -> authenticate, normalize, and classify through its transmission
  -> query persisted playbook subscriptions
  -> evaluate named transmission predicates
  -> resolve or provision every subscribed agent instance
  -> create or reuse conversations
  -> reconstruct each agent from persisted instance data
  -> enqueue one run per resolved subscription target
```

The package test suite covers zero pre-existing instances, one-to-many fan-out,
connection activation, and duplicate delivery. Production adapters must
implement the same atomic `provisionAgent` and inbound-delivery claim contract;
adapter-specific restart/concurrency tests belong with those adapters.
