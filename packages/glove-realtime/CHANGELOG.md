# glove-realtime

## 0.1.1

### Patch Changes

- [#218](https://github.com/porkytheblack/glove/pull/218) [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Normalize object-union tool schemas at OpenAI-compatible and OpenAI realtime provider boundaries. Preserve common root fields and constraints when merging branch properties into an object-shaped wire schema, including keys allowed by branch patternProperties, while retaining the original Zod discriminated-union validation in the executor. Custom realtime adapters keep the original schema; raw JSON Schema tools retain their existing pass-through validation behavior. This fixes OpenAI rejecting built-in Foundry tools such as schedule management.

- [#218](https://github.com/porkytheblack/glove/pull/218) [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Queue and coalesce OpenAI Realtime response requests from typed input, spontaneous events and tool results. Wait for the current response and outstanding tool batch to finish, recover from correlated request rejections, isolate late summary completions, and defer queued responses through user speech and the automatic VAD response. This prevents overlapping-response errors and dropped continuations during agent-to-agent exchanges.

- Updated dependencies [[`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c), [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c)]:
  - glove-core@4.6.0

## 0.1.0

### Minor Changes

- [#210](https://github.com/porkytheblack/glove/pull/210) [`7cbbbfb`](https://github.com/porkytheblack/glove/commit/7cbbbfbdec186a185c30fa28de3365fd5e477ff6) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New package: run a built Glove agent on realtime multimodal models (OpenAI Realtime, GPT-Live, Gemini Live).

  - `RealtimeAdapter` puts the boundary where the provider's side ends. The adapter owns tool registration (schema projection, live patch or reconnect), synthetic prompts (`inject` with keyed supersession), compaction (`compact` in place or by reconnect, `summarize` out of band) and modalities (audio, text, images, video frames in; audio or text out). It declares its `capabilities` and reports through one standardized `RealtimeEvent` stream.
  - `RealtimeSession` translates Glove primitives onto the live session. Tool calls run through glove-core's `Executor`. `requiresPermission` is enforced through a policy (`display`, `deny`, `allow`, or a function). Turns, tool call/result pairs and compaction summaries are written to the store, and fresh sessions are seeded from it. Runtime context follows each provider's `delivery`. `"iteration"` context is refreshed after every tool. `"request"` context is read when the session opens and at each user turn. `"history"` context is saved to the store when its value changes and told to the call once. The inbox is injected. The session holds the agent's turn queue (`holdTurns`), so events emitted on the agent (Foundry delegation updates, webhooks) join the call instead of waking the text model. They go in silently at the next user turn or tool result, or are spoken about at the next pause. `events: false` turns this off. Async `requiresPermission` predicates are awaited. Both session subscribers and the agent's own subscribers (via `notifySubscribers`) receive the usual `SubscriberEvent`s. Tools folded mid-call, and system-prompt changes a tool makes, are sent to the provider. The agent's turn preparers (`prepareTurn`, which glove-memory goals and forms register) run before the session opens and at each user turn. `beforeTurn` adds other per-turn work.
  - Session management: reconnect with backoff, resumption handles, a move to a resumed connection before Gemini's `goAway`, Glove-driven compaction on a context limit, and a maximum duration.
  - `createRealtimeAdapter` / `realtimeModel` follow the shape of `createAdapter`: explicit args, then `REALTIME_*` env.

  - GPT-Live host integration: `notifyUserSpeech` supplies input boundaries for turn preparation and request/history context, `transcript` preserves overlapping timestamped fragments, and `resumeOutput` resumes manually muted playback. Typed input prepares and refreshes context before being sent. Startup waits for Glove turn queue ownership, and all callers of `stop` await the same finalization; final usage failures reject after cleanup.
  - GPT-Live typed input is queued as Responses user messages and waits for outstanding function results before backend continuation. Includes a runnable sales discovery demo with real Glove goals, product tools, spontaneous offer updates and an opt-in live verification script.

### Patch Changes

- Updated dependencies [[`6f04d7e`](https://github.com/porkytheblack/glove/commit/6f04d7e1db19b30676254753c6a2a68c04d427cb)]:
  - glove-core@4.5.0
