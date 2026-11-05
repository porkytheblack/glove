---
"glove-foundry": patch
---

Schedule revisions no longer depend on object key order.

`activationScheduleRevision` hashed `JSON.stringify` of the activation as stored, so a store that reorders object keys (a PostgreSQL `jsonb` column returns `{ kind, timezone, expression }` for `{ kind, expression, timezone }`) changed the revision without any change to the schedule. On restart, Foundry then cancelled a pending or accepted occurrence as `superseded` and reset the schedule's cursor to now, so an overdue reminder was never sent.

- The revision is now a hash of JSON with every object's keys sorted, recursively. Array order and JSON value rules are unchanged. Reordered keys give the same revision; a real change to the message, target, timing or payload gives a different one.
- Revisions stored by 0.10.0 still match their configuration, including with the timing keys in any order, and are kept as stored. A schedule resumes from its cursor and its outstanding occurrences keep their ids. A 0.10.0 revision is replaced only when the schedule itself changes. A 0.10.0 payload whose object keys a store has already reordered cannot be matched.
- New export: `scheduleRevisionMatches(activation, revision)`.
