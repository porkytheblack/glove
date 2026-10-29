---
"glove-foundry": minor
---

Delegation updates join the turn that is still working. A run with delegates, open delegations or a delegated task of its own now listens on its conversation for as long as it lasts. A result, question or failure that arrives while the delegating turn is still calling tools joins it at the next tool step as a Glove event, which reads as the same `<delegation>` message a new run would start with and is saved after the tool results. The open-delegations runtime context stops listing a delegation once its result is in. Follow-up replies reach a worker that is still working the same way, and an answer that reaches a worker's turn after `glove_foundry_ask` gave up no longer leaves the run suspended. Updates the run did not read go back to the runtime when it ends and start one new run, as before. `ctx.onDelegationUpdate` handlers take updates first, including any that arrived before they registered. Every listener in a run now shares one mailbox reader, so a worker's reply is no longer lost to an update handler reading the same mailbox.

Foundry's per-run Glove never wakes itself: events emitted while no turn runs wait for the run's next request.
