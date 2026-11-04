---
"glove-foundry": minor
---

A run in the inspector opens three more views, about how Foundry composed and connected it:

- **Composition**, like DevTools' Sources: each assembly step with its time, and every tool the agent had under the step or installation that added it (Foundry core tools, app transmissions, the definition's tools, delegation, mesh, the working environment, calls, each installed app, MCP servers, the REPL), with how often it was called. Also the playbooks, schedules and activations, delegates and durable subagents, mesh, memory, layers, subscribers, hooks, skills and calls. A run records this as one `foundry.assembly.composed` event before its first turn.
- **Queues**, like a WebSocket's Messages pane: everything that crossed the run's boundary. Inbound, what started it, transmission follow-ups, delegation updates, agent and mesh messages, deliveries handed to it live and resolved inbox items, each with when it joined the conversation and the model request that first saw it. Outbound, transmissions, delegations, questions and replies, messages, spawns, schedules, sleeps, inbox items and approvals, each with what came of it and the run it started.
- **Call chain**, like DevTools' initiator chain across runs: the runs this one came from and the runs it started, through delegations and their questions, replies and results, spawns, schedules, sleeps and steering.

Network and Console use glove-core's new turn, tool-start and request events: a subagent's requests and tool calls sit under it, a run with several turns shows where each began, waterfall bars split waiting (first token, permission check) from work, a tool's wait behind earlier calls shows before its bar, and requests and tool calls have a Timing pane. Streamed text is one console line per request.
