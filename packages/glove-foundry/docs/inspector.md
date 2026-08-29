# Foundry inspector

The development server includes a read-oriented runtime inspector. It is organized around Foundry's actual ownership boundaries rather than presenting every event on one screen.

## Navigation

| Page | Question it answers |
| --- | --- |
| Overview | Is the runtime healthy, what is active, and what needs attention? |
| Agents | Which definitions exist, which instances were provisioned, and how do they differ? |
| Agent definition | What can this code route assemble, including lazy fields, capabilities, native surfaces, schedules, and playbooks? |
| Agent instance | Which context, installations, playbooks, conversations, and runs belong to this persisted identity? |
| Runs | Which invocations occurred and what status, source, and attempt count did each have? |
| Run detail | What observable phases and events produced this outcome? |
| Automations | Which schedules, sleeping runs, playbook listeners, and inbound application workers exist? |
| Integrations | Which transmissions, safe account references, routes, and agent bindings form the external topology? |
| Workspaces | Which shared entries, inbox items, tasks, and non-secret environment values are available? |

Every detail view has a real URL. For example, `/agents/support-lead`, `/instances/<agent-id>`, and `/runs/<run-id>` can be bookmarked or opened directly; the Foundry server returns the inspector shell for non-API paths.

## Following a run

Open **Runs**, then choose one invocation. The run detail starts with a four-phase spine:

1. Accepted: Foundry persisted the invocation and its source.
2. Assembled: context-dependent agent components were resolved and mounted.
3. Agent work: observable model and tool work occurred.
4. Completed, failed, cancelled, or still in progress.

The event trace below the spine is collapsed by default. Expand an event when you need its adapter payload. The inspector shows observable intent, actions, and outcomes; it does not expose a model's private hidden chain-of-thought.

## Starting work

Use **New run** from any page. Select a definition and either:

- choose an existing runtime instance; or
- let Foundry create a new instance in the current/default workspace.

The inspector reuses that instance's latest conversation or creates its first conversation, sends the message, then navigates directly to the new run.

## Live updates and search

The inspector subscribes to `/api/events` with server-sent events and also performs a low-frequency reconciliation. Press `Command-K` or `Control-K` to search pages, definitions, instances, and retained runs.

## Operator API used by the inspector

The inspector is an API client and adds no hidden runtime state. Its primary read surfaces are:

- `/api/manifest`, `/api/agent-instances`, and `/api/conversations`
- `/api/runs`, `/api/runs/:id`, and `/api/events`
- `/api/activations` and `/api/playbook-subscriptions`
- `/api/application-connections`
- `/api/transmissions`, `/api/accounts`, `/api/routes`, and `/api/bindings`
- `/api/workspaces/:id/entries|inbox|tasks|environment`

`/api/activations` exposes persisted schedule and sleep records, optionally filtered with `?workspace=<id>`. Like the rest of Foundry's operator API, it contains runtime metadata, not credential material.
