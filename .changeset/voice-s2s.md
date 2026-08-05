---
"glove-voice-s2s": minor
---

New package — speech-to-speech adapters, the architecture step past the cascaded pipeline.

`glove-voice`'s cascade (VAD → STT → LLM → TTS) bottoms out around **1.3–1.6s** voice-to-voice: every stage adds serial latency, and end-of-turn has to be *reconstructed* from transcripts with heuristics or an EOU model. A speech-to-speech model collapses the cascade — audio in, one model, audio out — with turn-taking decided by the model actually listening. Production S2S APIs run **500–800ms**.

- **`S2SAdapter`** — a provider-agnostic contract, so Gemini Live and Amazon Nova Sonic implementations slot in beside the OpenAI one without touching call sites.
- **`OpenAIRealtimeAdapter`** — the first implementation. Tool calls surface as a `tool_call` event and results go back with `sendToolResult`, which is what lets the layered-agents pattern survive intact: the realtime model takes over the thin front agent's job (persona, addressing, voice), while the heavy text worker runs unchanged behind a tool.
- **`createOpenAIRealtimeToken`** (from `glove-voice-s2s/server`) — mints ephemeral tokens so API keys never reach the browser.

What this deletes is as notable as what it adds: client endpointing — VAD, holds, EOU scoring — goes away entirely in favour of provider semantic VAD, as does the heard-prefix barge-in repair. Note the tradeoff that comes with it: turn-taking becomes a black box you cannot inspect or tune, which is the right trade for some products and the wrong one for others.

See `examples/layered-voice` (`/s2s`) for a working integration with true voice-to-voice measurement.
