---
"glove-realtime": minor
---

New package: run a built Glove agent on realtime multimodal models (OpenAI Realtime, GPT-Live, Gemini Live).

- `RealtimeAdapter` puts the boundary where the provider's side ends. The adapter owns tool registration (schema projection, live patch or reconnect), synthetic prompts (`inject` with keyed supersession), compaction (`compact` in place or by reconnect, `summarize` out of band) and modalities (audio, text, images, video frames in; audio or text out). It declares its `capabilities` and reports through one standardized `RealtimeEvent` stream.
- `RealtimeSession` translates Glove primitives onto the live session. Tool calls run through glove-core's `Executor`. `requiresPermission` is enforced through a policy (`display`, `deny`, `allow`, or a function). Turns, tool call/result pairs and compaction summaries are written to the store, and fresh sessions are seeded from it. Runtime context providers and the inbox are injected. Both session subscribers and the agent's own subscribers (via `notifySubscribers`) receive the usual `SubscriberEvent`s. Tools folded mid-call, and system-prompt changes a tool makes, are sent to the provider. The agent's turn preparers (`prepareTurn`, which glove-memory goals and forms register) run before the session opens and at each user turn. `beforeTurn` adds other per-turn work.
- Session management: reconnect with backoff, resumption handles, a move to a resumed connection before Gemini's `goAway`, Glove-driven compaction on a context limit, and a maximum duration.
- `createRealtimeAdapter` / `realtimeModel` follow the shape of `createAdapter`: explicit args, then `REALTIME_*` env.
