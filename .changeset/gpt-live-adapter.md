---
"glove-voice-s2s": minor
---

Add an `openai-live` server WebSocket adapter for GPT-Live, selectable through
`createS2SAdapter` and `s2sDrivenModel`. Responses delegation exposes existing
Glove tools, with batched results and graceful session finalization. Add
continuous transcript capabilities, timestamped fragments, duration usage,
and host-controlled playback recovery without changing existing providers.

Keep final usage events observable during `RealtimeAgent.stop()` and prevent
tools from a stopped session from injecting results into a restarted session.
Fix the published event emitter declarations for NodeNext TypeScript consumers.
