---
"glove-foundry": minor
---

Layered agents and voice calls.

- `defineAgent({ delegates })` names sibling agents by route. The delegating agent gets `glove_foundry_delegate` and `glove_foundry_reply`. A run working on a delegated task gets `glove_foundry_ask`. Each delegation runs as its own conversation on a worker instance, one per delegating instance and route.
- Results, questions and failures come back to the conversation that delegated. They go straight into a run that listens with `ctx.onDelegationUpdate`. Otherwise they wait until the conversation is free and start one run, as `<delegation>` messages.
- A worker's question waits `answerWaitMs` (90 s by default) inside its run, then the run suspends with `suspension.kind: "question"`.
- Open delegations appear in the delegating agent's runtime context. `runtime.listDelegations()` lists them all.
- Deliveries that are still owed are recorded on the delegation and handed over again when the runtime restarts.
- New `glove-foundry/voice` subpath. `voiceCall({ room, greeting })` runs an agent as a live call over `RealtimeAgent`: it saves the transcript, speaks delegation updates at the next pause, and keeps Foundry's bookkeeping tools and approval-gated tools off the call. `webSocketRoom({ port, token })` is a built-in room serving PCM16 over one WebSocket.
