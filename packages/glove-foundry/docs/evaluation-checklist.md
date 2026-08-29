# Evaluation checklist

Use this when deciding whether Foundry has the structure you want.

## Run the evidence

```bash
pnpm --filter glove-foundry typecheck
pnpm --filter glove-foundry test
pnpm --filter glove-foundry build
pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify
```

The package tests include an inbound subscription with zero initial instances, two targets, per-thread provisioning, connection activation, and duplicate-event idempotency.

## Definition and instance boundary

- [ ] `defineAgent` produces a reusable data structure, not an invocation contract.
- [ ] The file route is the definition route.
- [ ] Instances are stored independently with workspace, context, installations, and playbooks.
- [ ] An instance can be updated and reconstructed without modifying code.
- [ ] One instance can own multiple conversations.
- [ ] Every run assembles from current instance data and the current native Glove message.

## Reference safety

- [ ] Code-authored routes use `transmission`, `account`, and other imported values.
- [ ] Runtime-composed playbooks use transmission, predicate, route, app, and account values.
- [ ] Playbooks are produced by lazy agent resolvers or runtime data, never file-discovered definitions.
- [ ] Schedules are agent-local composable values, never a root registry.
- [ ] Code-authored installations use `install(definition, config)`.
- [ ] String ids appear only in JSON-safe persisted/API records or inherently dynamic selections.
- [ ] Reconstruction validates and freezes stored records.

## Composition and installation

- [ ] Tools, applications, MCPs, memory, inboxes, layers, subscribers, working environments, and REPLs can be colocated under an agent.
- [ ] Components are functionally returnable and composable.
- [ ] Applications and MCPs remain inert until instance data installs them.
- [ ] Memory belongs to the definition and can be selected lazily.
- [ ] Inboxes are always lazy functions.
- [ ] Assembly can depend on current message, conversation, instance, and workspace.

## Applications and transmissions

- [ ] An app owns multiple inbound and outbound transmissions.
- [ ] Installing an app mounts outbound transmission tools.
- [ ] Transmissions own authentication, normalization, classification, predicates, serialization, and delivery.
- [ ] Playbooks contain serializable match parameters and directives only.
- [ ] Credential acquisition and refresh remain in user adapters.
- [ ] Account metadata exposed by Foundry contains no secret values.

## Background activation

- [ ] A durable playbook subscription is evaluated with zero matching instances.
- [ ] One inbound event can target one or many agent definitions.
- [ ] `singleton`, `per-thread`, `per-event`, `existing`, and `custom` policies are supported.
- [ ] Provisioning keys are enforced atomically by the data adapter.
- [ ] Duplicate route/event deliveries return the original run ids.
- [ ] A failed dispatch releases its claim for a safe retry.

## Provider workers

- [ ] Provider listeners are defined as application connections.
- [ ] Connections start only for active installed-app/playbook requirements.
- [ ] Connections receive only safe account metadata, routes, identity, abort, ready, receive, and optional account-session access.
- [ ] Retry and supervision are observable without exposing backend worker primitives.
- [ ] Public config, client methods, API routes, manifests, generated declarations, and inspector copy contain no backend deployment concepts.

## Runtime primitives

- [ ] Conversations, workspace entries, shared inbox items, tasks, and scoped environment values are first-class adapter data.
- [ ] Agent-local schedules reconcile into adapter data; agents can also create triggers dynamically.
- [ ] Core tools can list, update, cancel, recur, sleep, run in background, and reconvene within agent identity.
- [ ] Layered agents, S2S/S2V calls, mesh, custom subscribers, custom build, and custom run/handler functions remain available.
- [ ] A native working environment mounts its guarded VFS and script tools with lifecycle cleanup and telemetry.
- [ ] JavaScript, Python, and Lisp REPLs mount through one typed, lazy agent field.
- [ ] VFS persistence and storage credentials remain behind user-selectable adapters.

## Developer experience

- [ ] `npx glove foundry` scaffolds a type-checking project.
- [ ] `.foundry/routes.d.ts` provides typed file routes.
- [ ] ESLint checks Foundry conventions.
- [ ] The inspector makes arrival → policy → workforce → work visible.
- [ ] Raw trace data is available without making it the default interface.
- [ ] The runnable example uses the same public API described in the docs.
