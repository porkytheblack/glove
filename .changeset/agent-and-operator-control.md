---
"glove-working-environment": minor
---

Control over long-running work, and a way to ask the person a question.

- **`ask_user`** — a host-gated verb, on the same terms as `present` and `view_image`: wire `onAsk` and it appears, with a conditional skill and one preamble line. Without a channel, models invent an `ask_user` tool and spend turns on "no such tool" — or, in a turn-capped loop where ending the turn to ask *is* failing the run, guess. A verb rather than an `env:` module, because a script blocking on a human would spend its own `runTimeoutMs` waiting.
- **Per-run budgets** — `run_script({ timeout_ms })` and `env.runScript(path, args, { timeoutMs })`, clamped to `limits.runTimeoutMs`. The worker already received a deadline and recomputed its own from the limits, ignoring it; now it honours it, and the refusal names whichever budget actually applied.
- **Progress** — `execution.onProgress` receives console lines while the script is still running, batched in the worker. The full transcript still arrives with the result.
- **Cancellation** — `env.runScript(..., { signal })` cancels one run without touching the environment. `EnvTool.do` now matches glove-core's fold signature `(input, display, glove, signal)`, so an agent built with `mountWorkingEnvironment` gets this for free: glove already passed the request's signal to every tool and the verbs ignored it. `defineTools` capabilities finally receive the `ToolFnContext.signal` they were always declared to get.
