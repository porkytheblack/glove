# glove-core

## 3.7.0

### Minor Changes

- [#157](https://github.com/porkytheblack/glove/pull/157) [`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Introduce Glove Foundry, the Effect-native, file-routed framework for typed and observable agent applications.

  - Publish the first `glove-foundry` release with composable code definitions, persisted instances, context-aware lazy assembly, applications and transmissions, dynamic playbooks and schedules, conversations, agent working environments, multi-agent composition, and the Foundry inspection workbench.
  - Add Gemini native image generation and editing to `glove-image`.
  - Refresh the Gemini model catalogue in `glove-core`.
  - Move Gemini Live runtime text onto the realtime input protocol and update its default live model.
  - Deprecate the Glovebox package family in favor of Glove Foundry. Existing Glovebox deployments remain supported as a legacy compatibility surface, while new agent runtimes should use Foundry.

### Patch Changes

- [#166](https://github.com/porkytheblack/glove/pull/166) [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Support OpenRouter-native video content in model requests and preserve fitted image dimensions in OpenRouter image generation, enabling identity-aware video generation and review workflows.

## 3.6.0

### Minor Changes

- [#67](https://github.com/porkytheblack/glove/pull/67) [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Run a Glove agent on a realtime speech-to-speech model, with the tools you already wrote.

  **glove-core** exposes `IGloveRunnable.tools` — the registry, read-only, readable _without_ running the loop. That is the enabling change: some runtimes own the agent loop themselves and cannot hand it to Glove, so they need the schemas up front to configure a session and then execute each call back through the same `Tool.run`. Also serves anything else wanting the surface without the loop — exporting over MCP, generating docs, auditing permissions.

  **glove-voice-s2s** gains `RealtimeAgent`, which takes a built Glove and an `S2SAdapter` and wires them together: the agent's system prompt becomes the session instructions, its tools become the provider's function declarations (via the same `getToolJsonSchema` every model adapter uses), and each tool call is validated against the tool's own zod schema and executed through its real implementation. One definition, two runtimes.

  It is a wrapper rather than a `ModelAdapter`, deliberately. Every other model in glove-core is a function — messages in, messages out, Glove owns the loop. A realtime model owns that loop itself: it listens continuously, decides on its own when you stopped talking, emits tool calls mid-utterance, and keeps conversation state provider-side. Dressing that up as a `ModelAdapter` would be a lie about who is driving.

  The adapter contract is now transport-neutral. Adapters declare `mode`:

  - `device` — opens the microphone and plays the reply itself. Browser-only, least code at the call site. `OpenAIRealtimeAdapter` (WebRTC) is this, and now refuses `sendAudio` loudly rather than accepting PCM it would never transmit.
  - `transport` — moves PCM and nothing else. Runs in Node and the browser, and is the only mode a server-hosted room or phone bridge can use, because there is no microphone in the process.

  New `GeminiLiveAdapter` is transport-mode over a plain WebSocket. Note its asymmetric rates — 16 kHz in, 24 kHz out — both declared on the adapter so hosts resample instead of guessing; get it wrong and the agent sounds drunk in one direction and like a chipmunk in the other.

  Also a conformance suite (`runConformance`) every adapter must pass against a fake socket: event mapping, tool-call round trips, PCM handling, teardown. That is what makes "swap the provider" a claim rather than a hope, since the adapters share no code. It cannot verify that a provider _accepts_ the frames an adapter sends — only a live call proves that.

### Patch Changes

- [#96](https://github.com/porkytheblack/glove/pull/96) [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Two dead-end errors now name the way out

  **An unknown tool name lists the real ones.** `No tool called ask_user exists.` was the whole message. A model that guessed a plausible name had nothing to correct towards, and the observed behaviour was three identical guesses before abandoning the capability. It now adds a near-match suggestion where the names overlap, and the list of tools that do exist.

  **A script's syntax error says where it is.** `syntax error: Unexpected identifier 'the'` sent the author searching a file for a common word. V8 puts the line, the source and a caret in the stack rather than the message; those three lines are now included, so an unterminated comment is visible instead of deduced.

- Report the exact model-token consumption for a compaction request on the
  `compaction_end` subscriber event, including provider-reported prompt-cache
  reads and writes. Consumers no longer need to infer compaction usage from the
  cumulative pre-compaction context counter, which can double-count earlier
  requests when used for billing.

- [#143](https://github.com/porkytheblack/glove/pull/143) [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb) Thanks [@claude](https://github.com/apps/claude)! - A session manager, the tree inside `defineTools` capabilities, and one pair of field names for tool events

  **`createSessionManager`** — the registry every host of this package was writing by hand, with the bug it ships with. `createWorkingEnvironment` is async, so `if (!map.has(id)) map.set(id, await create(id))` builds two environments for two requests that arrive together: one is orphaned with its worker thread alive and its `close()` never called, and the two requests act on different trees. Nothing throws. The manager memoizes the _promise_, so concurrent callers share one create; a create that rejects is not remembered, so a transient failure does not pin that id to an error for the life of the process.

  ```ts
  const sessions = createSessionManager({
    globalKey: "__deskSessions", // survives a dev server's module reload
    idleMs: 30 * 60_000,
    max: 50,
    create: (id) => buildSession(id),
    dispose: (s) => s.env.close(),
  });

  const session = await sessions.get(id);
  void sessions.reap(); // safe to call from every route, concurrently
  ```

  Eviction by idle window, absolute age, and capacity (least-recently-used first). `sessions.hold(id)` pins a session for the length of a turn — a turn can spend four minutes inside one `run_script`, and an idle sweep that fires in the middle closes the worker pool under the running script. `reap()` shares an in-flight sweep rather than starting a second, so a session can never be disposed twice.

  **`ToolFnContext.fs`** — `defineTools` capabilities now receive the guarded tree, matched to their call context. A capability that needs the tree ("answer a question about this image", "post this file") previously forced the host into a mutable `{ current?: env }` holder filled after `createWorkingEnvironment` resolved, because the module has to appear in `stdlib` before the environment exists. The write-time-validation refusal is unchanged and deliberately so: the reason was never the filesystem, it is the effect on the other side.

  **glove-core: `tool_use_result` also carries `id` and `name`.** A tool call arrives as `{ id, name }` and its result carried only `{ call_id, tool_name }`, so a UI keyed on `id` throughout recorded the calls, never matched the results, and showed every tool spinning forever — with nothing thrown anywhere. **Both spellings are emitted**; `id`/`name` are the pair to prefer because they match `tool_use`, and `call_id`/`tool_name` are neither removed nor deprecated — they are the field names of the persisted `ToolResult`, which is what a store replays from. The alias is added to the event payload only; the stored `ToolResult` shape is untouched. `duration_ms`, always emitted, is now declared on the event type too.

  **A hosting recipe** in the README covers the registry, eviction and the turn you must not evict, streaming a turn to a browser (the field-name trap, and why an error display should prefer `data` over `message`), collision-safe uploads with per-file errors, and handing deliverables over.

- [#131](https://github.com/porkytheblack/glove/pull/131) [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad) Thanks [@claude](https://github.com/apps/claude)! - A telemetry seam, and a way for adapters to let go of what they hold.

  - **`onVerb({ name, ok, durationMs, mutated })`** — per-verb timing, and a reliable answer to "did the tree change". `mutated` is measured rather than inferred from the verb's name: the hand-maintained list both examples kept drifts when a verb is added, ignores `toolsWithPrefix` entirely, and cannot tell a `run_script` that wrote a file from one that only read.
  - **`EnvTool.mutates`** carries the static answer, so a host never needs its own list.
  - **`env.counters`** — live `limitHits`, `spillovers` and `mutations` for a dashboard.
  - **`tool_use_result` carries `duration_ms`** (glove-core), so per-tool latency needs no wrapper around every folded tool.
  - **`StdlibAdapter.close()`**, awaited by `env.close()` after the worker pool is down. `env:motion` keeps a browser warm between renders; without this the only ways it came back were an idle timer or process exit, so a host closing fifty environments in a loop held fifty browsers. A `close` that throws is reported through `execution.onWarning` and does not fail the shutdown.

  Fixes a defect found while testing the counters: the spillover path refused its own write on a small `maxFileBytes`. It truncated to exactly the cap and then appended its marker, and counted both in characters against a cap measured in bytes (`…` alone is three). The model was told its output was too big to show _and_ too big to save — the one outcome spillover exists to prevent.
