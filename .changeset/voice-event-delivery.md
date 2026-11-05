---
"glove-foundry": minor
---

Addressed events with explicit acknowledgement, fresh preparation, and voice calls that tell them at a pause with durable delivery receipts.

- **`context.onEvent(handler, match?)`.** A handler takes addressed events (agent messages and transmissions) one at a time, both those that started the run and those that arrive while it runs. Nothing consumes one but its `ack()`: registering, returning and the run ending do not, and a mixed batch acknowledges only the events acknowledged. An event left unacknowledged that arrived mid-run goes back to the runtime when the run ends; one that started the run stays pending for the next run. The run waits for handler calls still running, and so does the returned stop function. Delegation updates, mesh messages and runs without `onEvent` are unchanged. `context.eventTurn` says whether events started the run.
- **`defineAgent({ prepareEvent })`.** Reads current facts just before a text turn sees an addressed event, whether it starts the run or joins a turn already going. `{ say }` replaces its content, `{ suppress }` finishes it unseen, and a throw withholds it. The runtime delivers a withheld event again after a delay that doubles from 1s to 5 minutes.
- **`voiceCall({ events: { accept, prepare, afterCall, resolveUncertain, transcript, respond } })`.**
  - Accepted events wait for a pause in speech and are prepared at that pause. If speech starts while `prepare` runs, the next pause prepares again.
  - Told events go to the model with the `system` role and are transcribed as framework event context, never as the caller.
  - A failing event never holds up delegation updates or other events.
  - An event that wakes a voice agent with no call open no longer opens a room: `afterCall` takes it, or it stays pending.
- **Delivery receipts.** Each event's receipt moves through `queued`, `dispatching`, `accepted`, `suppressed`, `redirecting` and `redirected`, and is written before every step that has an effect.
  - A redelivered event is never told twice.
  - A dispatch whose outcome is unknown is never replayed or sent to chat.
  - A late-chat effect is retried under the same `effectId`.
  - A transcript line missing after a crash is written once without speaking.
  - "Accepted" means the provider's transport took the text, not that anyone heard it.
- **New optional `FoundryDataAdapter` methods:** `claimEventReceipt`, `putEventReceipt`, `getEventReceipt` and `listEventReceipts`. The memory and file adapters implement them, apart from workspace entries so agent workspace tools never reach them. Without them, receipts last only as long as the process.
- **New exports:** `FoundryHandledEvent`, `FoundryEventPreparation`, `FoundryEventReceipt`, `eventReceiptStore`, `lateChatEffectId` and `eventTranscriptMessageId`, plus `VoiceCallEvents` and `defaultEventTranscript` from `glove-foundry/voice`.
