---
"glove-foundry": minor
---

One run at a time per conversation, and durable inbound events.

- A conversation never has two runs acting on it at once. A run asked for while another holds the conversation (a second message, a schedule firing, a flushed delivery) waits in arrival order and starts once the run ahead has settled and its process has let go. Different conversations still run in parallel.
  - A run the runtime starts waits parked in the execution queue. It has an id and stays `pending`, holds no concurrency slot, and starts from an envelope built when its turn comes. Time spent waiting does not count against `waitForRun` timeouts, so the OpenAI-compatible endpoint no longer fails on a queued request.
  - A run created inside the execution queue (a schedule firing) asks for the conversation in its process and waits there before it reads any history.
  - Steering holds the conversation through the cancel, and its replacement goes ahead of anything already waiting. Cancelling a waiting run removes it.
- An inbound transmission event for a thread whose run is still working no longer starts a second run beside it. It joins that run's turn at the next tool step as the same `<transmission>` message. If it arrives during the final answer, it starts the thread's next run once the thread is free, together with anything else that arrived meanwhile (`source.kind` `"transmission"`). `dispatchInbound` returns the run handling the event, which for a busy thread is the one that holds it.
- Every run now listens on its conversation, so anything delivered to it can join its turn.
- Pending inbound events: from dispatch until the run that handled it settles, an event is kept in the data adapter, and on startup any still pending are delivered again in arrival order. Runs stopped by shutdown keep theirs. `FileFoundryDataAdapter` and `MemoryFoundryDataAdapter` implement it. The new `FoundryDataAdapter` methods `putPendingInbound`, `deletePendingInbound` and `listPendingInbound` are optional, so custom adapters without them work as before, minus the restart guarantee. New exported types: `FoundryPendingInbound`, `FoundryTransmissionDelivery`.
- Deliveries held until a run starts listening are now marked handed over. Before, a delegation update delivered that way could be handed over again after a restart.
