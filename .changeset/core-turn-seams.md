---
"glove-core": minor
---

Runnable members for runtimes that drive an agent without `processRequest`, such as realtime sessions:

- `prepareTurn(signal?)` is now public on `IGloveRunnable`. It runs the turn preparers (`addTurnPreparer`) on demand, so another runtime can run the same preparation (goal recovery, form preparation) at its own turn boundaries.
- `notifySubscribers(type, data)` delivers an event to the subscribers added with `addSubscriber`. Activity from another runtime, such as tool calls, transcripts and usage, then reaches the same subscribers a text turn does.
- `holdTurns({ signal?, onEvent? })` waits for the turns ahead and then holds the turn queue until `release()`. While it is held, requests and event wakes wait, and `emitEvent` queues events for the holder (`onEvent` hears each one) instead of waking the model. The returned `TurnHold` has `takeEvents(phase?)`, which returns the queued events as one formatted message, and `historyContext(signal?)`, which returns the `delivery: "history"` context a request would save, so the holding runtime can save it where it keeps the conversation. `release()` resolves once the queue is free.
