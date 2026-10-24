# Contributing to glove-foundry itself

> Read only when changing the `glove-foundry` package, its inspector, or its examples inside the Glove repository (https://github.com/porkytheblack/glove). App authors do not need this file.
>
> Part of the `glove-foundry` skill. Start from [SKILL.md](../SKILL.md).

## Start with the repository

Before changing Foundry, inspect the current public surface and the closest executable example. Do not rely on remembered APIs.

- Read [`packages/glove-foundry/docs/building-with-foundry.md`](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/building-with-foundry.md) for authoring conventions.
- Read [`packages/glove-foundry/docs/architecture.md`](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/architecture.md) when changing definitions, instances, activation, persistence, credentials, or runtime boundaries.
- Read [`packages/glove-foundry/docs/inspector.md`](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/inspector.md) for observability and workbench changes.
- Use [`examples/foundry-agent`](https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent) as the canonical small application. Use the Braind Storm and voice examples only when their specialized behavior is relevant.
- Inspect exports in [`packages/glove-foundry/src/index.ts`](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/src/index.ts) and tests beside the affected module before inventing a helper.

## Effect and error handling

Foundry's service, persistence, transmission, and orchestration internals are Effect-native. Preserve typed errors, resource scopes, cancellation, and service boundaries. Use `Effect.gen`, schemas, layers, and scoped finalizers where they clarify lifecycle or failure semantics. Do not wrap Effect code in ad-hoc promises merely to suppress its error channel.

User-provided Glove callbacks may return promises where the public type permits it. Keep adapters replaceable and avoid coupling domain definitions to the in-memory implementation.

## Observability and inspector language

Emit safe, correlated events using Foundry concepts: definition, instance, conversation, activation, run, model, tool, application, transmission, inbox, memory, MCP, workspace, artifact, and system. Show work intent, action, handoff, status, and result—not private hidden reasoning or raw secrets.

The inspector should make the causal path obvious:

```text
arrival -> matched playbook -> provisioned instance(s) -> conversations -> runs -> artifacts/outcomes
```

Avoid provider/backend error jargon in primary UI copy. Put detailed raw events behind diagnostics while presenting a plain-language current state and next action.

## Verification

Run checks proportional to the change. For framework work, the normal floor is:

```bash
pnpm --filter glove-foundry typecheck
pnpm --filter glove-foundry test
pnpm --filter glove-foundry build
pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify
```

For scaffold or public API changes, also generate a temporary project and verify its typecheck. For inspector/site changes, build the site and exercise the affected UI. Assert behavioral invariants rather than snapshots of prose. Finish with `git diff --check` and check that no credential value entered generated files, events, or manifests.

## Framework boundaries contributors must keep

- Keep backend concepts such as Station networks, beacons, signals, or worker topology out of public agent definitions, client types, manifests, and inspector language. Expose only purpose-built agent-system concepts such as inbound connections, activations, scheduled work, and runs.
- Do not expose the private execution backend as the authoring model for schedules or sleep.
- When changing inbound behavior, preserve idempotency: claim delivery by route and event before provisioning or enqueueing runs. Provision through the data adapter so `provisioningKey` remains atomic.
- Keep adapters replaceable and avoid coupling domain definitions to the in-memory implementation.

Design references in the repository: [architecture](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/architecture.md), [building with Foundry](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/building-with-foundry.md), [execution](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/execution.md), [guidance](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/guidance.md), [inspector](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/inspector.md).
