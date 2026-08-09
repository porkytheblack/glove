---
"glove-env-motion": patch
---

Keep the browser between renders, and cap how many exist at once.

`env:motion` launched a Chromium and closed it around **every** render. And because each environment did that on its own, N agents rendering at the same time meant N concurrent browsers, each with `--no-sandbox`, with nothing anywhere counting them — `maxFrames` bounds one render, not the fleet. That is the multi-tenant failure in the issue: several sessions rendering at once spawn a browser per render per environment and exhaust memory.

Both halves are fixed, and both are measured (`pnpm --filter glove-env-motion bench`, 3 runs each, 320×180 stills on a host with a real Chromium):

```
                         before          after
warm still (renders 2,3)  770ms          437ms      1.76× faster
first render in an env   ~1310ms        ~1255ms      unchanged — it still launches
4 envs rendering at once  peak 4-6       peak 2      Chromium processes
```

A browser is now kept per adapter instance — one environment, one Chromium, never shared between tenants — and closed after 30s idle or when another environment needs its slot. The number of browsers is capped process-wide at 2 by default, configurable with `motion({ maxBrowsers })` or `GLOVE_MOTION_MAX_BROWSERS`, and reported by `capabilities().maxBrowsers`. Because the fleet is one shared resource, the setting is a floor: when two adapters disagree the smaller wins, so one careless mount cannot raise the ceiling for everything else on the box.

Isolation is unchanged, and this is the part that had to be proved rather than argued. A render gets a fresh browser **context** — empty storage, no cookies, no leftover page state — so what it reuses is the process, not the session. Determinism is what everything else in this package is built on, so there is a test that renders the same frame on a browser that has just launched and on one that has already rendered, and asserts the two PNGs are byte-identical.

The deadlock a process-wide semaphore invites is guarded three ways: a lease is released in a `finally`, so a render that throws still gives it up (asserted by a test that fails a render and checks nothing is still held); a browser nobody is using is closed to make room rather than waited on, so idle environments cannot block a busy one; and a wait has a deadline, after which the caller gets an error naming the cap instead of hanging. `closeMotionBrowsers()` is exported for host shutdown.

Also updates the up-front budget refusal for the new per-run timeout. It used to tell the agent to raise `limits.runTimeoutMs`, which hands the whole allowance to every script including an accidental `for(;;)`; it now names the `timeout_ms` to pass on the `run_script` call, with the environment ceiling as the thing that bounds it. `MOTION_LIMITS`, the generated `/std/motion/README.md`, the skill and the package README say the same thing. The 20s head on the estimate is deliberately kept: the first render in an environment still pays a cold launch, and being wrong high refuses a render the agent can see, where being wrong low kills one at frame 400.

Test-suite wall clock is unchanged — 22 tests in 30.8s against 18 in 38.2s — because the renders that share an environment now share its browser, which pays for the four new tests.
