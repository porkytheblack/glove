---
"glove-memory": minor
---

Goals render as XML and can be saved to history.

- `renderGoalStatus` returns an escaped `<goals program version status active_goal>` section with `<goal>`, `<item>`, `<deferred>` and `<preparation>` children, wherever it appears (runtime context, the status tool, history). Labels and notes are escaped. The text format it replaces began with `GOALS —`; update anything that matched on it.
- `useGoalRunner`, `useFormRunner` and `useContext` take `delivery: "iteration" | "request" | "history"` (default `"iteration"`, unchanged). With `"history"`, goals are saved before the next request's message once per version (key `GOAL_CONTEXT_KEY`, `glove.goals`) and never ride on tool-step prompts. They age into the background, and the model can reason over them without a status call. Forms use key `glove.forms`, pinned context `glove.context` (or `key`). Needs glove-core with `addContextProvider` options; proxies must forward the second argument.
- Goal and form preparation (`synchronize`) registers through `addTurnPreparer` when the runnable has it, so turns started by events get the same recovery and configuration as requests. Runnables without it keep the `processRequest` wrapper.
