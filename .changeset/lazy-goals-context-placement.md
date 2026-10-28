---
"glove-core": minor
"glove-memory": minor
"glove-foundry": minor
---

Lazy goals, and runtime context that can sit before the user's latest message.

**Lazy goals (glove-memory).** A goal definition can set `lazy: { turns }`. It is shown in the runtime context for that many user turns, then drops off by itself: no tool call settles it. Lazy goals sit beside the ordered program, never take `activeGoal`, and may have no items. Each `processRequest` on a runnable mounted with `useGoalRunner` counts one turn; hosts with their own loop call the new `runner.advanceTurn()`. Turn counts persist with the goal set (`GoalSnapshot.lazy`, revisions of kind `"turn"`). A goal past its turns has status `expired` and fires the new `onExpire` hook. Settling its items first completes it early. Programs without lazy goals are unchanged and write nothing extra.

**Runtime context placement (glove-core).** New `runtimeContextPlacement` config: `"tail"` (default, unchanged) or `"before_request"`, which inserts snapshots just before the latest real user message so the user's own words come last. It stays anchored there across tool steps and falls back to the tail if compaction removed the message. The trade-off is that the previous request's transcript stops being a cached prefix on the next request. Foundry agents accept the same `runtimeContextPlacement` field.
