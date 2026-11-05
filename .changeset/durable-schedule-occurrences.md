---
"glove-foundry": minor
---

Schedule occurrences are durable: a crash between a schedule coming due and its run finishing no longer loses or hides it.

- Foundry's controller now arms recurring schedules itself, as it already did one-shot schedules and sleeps. Station's in-memory scheduler is no longer used, so no schedule state lives in the execution daemon.
- Each activation keeps `nextOccurrenceAt`, the scheduled time of the next occurrence it owes, and `scheduleRevision`. A restart resumes from that cursor instead of recomputing the next time from now.
- When an activation comes due, Foundry stores a `FoundryScheduleOccurrence` first, then moves the cursor past it, then hands it to the conversation. Its id is derived from the activation, the schedule revision and the scheduled instant, so retries after a crash keep it. Status is `pending`, `accepted`, `completed`, `failed`, `skipped` or `cancelled`, with the run, attempts, `scheduledFor` and a reason.
- On startup Foundry delivers every unfinished occurrence before re-arming, unless its activation was paused, cancelled or changed since. Delivery is at least once. Each run gets `request.source.occurrenceId` and `request.source.scheduledFor`; key side effects on the occurrence id.
- New optional `FoundryDataAdapter` methods: `claimScheduleOccurrence` (atomic insert-if-absent), `putScheduleOccurrence`, `getScheduleOccurrence` and `listScheduleOccurrences(filter?)`. `MemoryFoundryDataAdapter` and `FileFoundryDataAdapter` implement them and keep the latest 100 settled occurrences per activation. Without them, occurrences are kept in memory.
- Read occurrences with `runtime.listScheduleOccurrences(filter)`, `GET /api/schedule-occurrences` or `client.scheduleOccurrences(filter)`.
- Recurring timing takes `misfire`: `"fire-once"` (default, as before: the earliest missed occurrence, with its original `scheduledFor`), `"catch-up"` (each missed occurrence in order) or `"skip"` (record one more than a minute late as skipped). Cron expressions and time zones are validated when the schedule is defined.

Behaviour changes:

- A recurring occurrence that comes due while its conversation is busy now waits its turn through the conversation gate, and starts from the conversation as it is then. Before, it started at once from an envelope built when the schedule was armed.
- Resuming a paused schedule starts it again from now, and pausing, cancelling or changing a schedule cancels occurrences no run has yet.
- A run stopped by shutdown is not an outcome: the next start delivers its occurrence again.
