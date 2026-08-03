---
"glove-memory": minor
---

Forms: structured collection over a conversation, as a fifth memory subsystem. Definitions are code — `defineForm(...).step(...).field(...).checkpoint(...).onComplete(...).build()` — with zod schemas, gate closures and executors colocated in one type-threaded builder chain, so `ctx.values` narrows to the real shape at every callsite. `required` and the agent-facing `type` string are both derived from the schema (`safeParse(undefined)` and `z.toJSONSchema`), so there is no field-type vocabulary and no flag that can disagree with the inferred values type.

Writes are never gated: `glove_form_fill` takes a patch of any field ids, validates each independently, and keeps what isn't applicable yet as a held entry rather than dropping it. One storage map holds every answer ever given; liveness is recomputed on each commit by a shrink-only repartition, so a correction that orphans an answer is always recoverable by changing it back. Completion counts applicable required fields only.

Executors colocate at four points (`field.onFill`, `step.onComplete`, `checkpoint.run`, `form.onComplete`) behind one signature, dispatched commit-then-run and at-least-once with a per-occurrence idempotency key, and can hand back `{ patch }`, `{ fail }`, `{ jump }` or `{ complete }`. `ctx.memory` bridges to entity, episodic, resources and context with engine-supplied provenance.

Loading is tiered like the inbox: a one-line tier-0 notification injected into the system prompt each turn (open step, pending labels, one-line preview per remaining step), `glove_form_status` for the open step in full, `glove_form_inspect` for anything else. Form modules aren't imported until a form is started — `glove_form_list` renders registration data only.

Adds `glove-memory/forms`, `InMemoryFormAdapter`, `useFormRunner` / `useFormReader`, the `FormAdapter` contract, and the `form_conflict` / `form_validation_failed` / `form_blocked` / `form_stale` / `form_definition_error` error codes.
