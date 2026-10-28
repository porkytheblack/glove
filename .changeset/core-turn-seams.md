---
"glove-core": minor
---

Two runnable members for runtimes that drive an agent without `processRequest`, such as realtime sessions:

- `prepareTurn(signal?)` is now public on `IGloveRunnable`. It runs the turn preparers (`addTurnPreparer`) on demand, so another runtime can run the same preparation (goal recovery, form preparation) at its own turn boundaries.
- `notifySubscribers(type, data)` delivers an event to the subscribers added with `addSubscriber`. Activity from another runtime, such as tool calls, transcripts and usage, then reaches the same subscribers a text turn does.
