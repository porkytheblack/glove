# glove-voice-s2s

## 0.2.1

### Patch Changes

- [#157](https://github.com/porkytheblack/glove/pull/157) [`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Introduce Glove Foundry, the Effect-native, file-routed framework for typed and observable agent applications.

  - Publish the first `glove-foundry` release with composable code definitions, persisted instances, context-aware lazy assembly, applications and transmissions, dynamic playbooks and schedules, conversations, agent working environments, multi-agent composition, and the Foundry inspection workbench.
  - Add Gemini native image generation and editing to `glove-image`.
  - Refresh the Gemini model catalogue in `glove-core`.
  - Move Gemini Live runtime text onto the realtime input protocol and update its default live model.
  - Deprecate the Glovebox package family in favor of Glove Foundry. Existing Glovebox deployments remain supported as a legacy compatibility surface, while new agent runtimes should use Foundry.

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0

## 0.2.0

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

- [#45](https://github.com/porkytheblack/glove/pull/45) [`1809a99`](https://github.com/porkytheblack/glove/commit/1809a99d7c9d9fb5d966bcc138f66461e51abfc5) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New package — speech-to-speech adapters, the architecture step past the cascaded pipeline.

  `glove-voice`'s cascade (VAD → STT → LLM → TTS) bottoms out around **1.3–1.6s** voice-to-voice: every stage adds serial latency, and end-of-turn has to be _reconstructed_ from transcripts with heuristics or an EOU model. A speech-to-speech model collapses the cascade — audio in, one model, audio out — with turn-taking decided by the model actually listening. Production S2S APIs run **500–800ms**.

  - **`S2SAdapter`** — a provider-agnostic contract, so Gemini Live and Amazon Nova Sonic implementations slot in beside the OpenAI one without touching call sites.
  - **`OpenAIRealtimeAdapter`** — the first implementation. Tool calls surface as a `tool_call` event and results go back with `sendToolResult`, which is what lets the layered-agents pattern survive intact: the realtime model takes over the thin front agent's job (persona, addressing, voice), while the heavy text worker runs unchanged behind a tool.
  - **`createOpenAIRealtimeToken`** (from `glove-voice-s2s/server`) — mints ephemeral tokens so API keys never reach the browser.

  What this deletes is as notable as what it adds: client endpointing — VAD, holds, EOU scoring — goes away entirely in favour of provider semantic VAD, as does the heard-prefix barge-in repair. Note the tradeoff that comes with it: turn-taking becomes a black box you cannot inspect or tune, which is the right trade for some products and the wrong one for others.

  See `examples/layered-voice` (`/s2s`) for a working integration with true voice-to-voice measurement.

### Patch Changes

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
