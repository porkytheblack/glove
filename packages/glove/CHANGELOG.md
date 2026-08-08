# glove-core

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
