---
"glove-voice-s2s": minor
---

`RealtimeAgent.inject(text, { role: "system" })` passes the role through to the adapter, so product or framework context reaches the model as system text rather than as the caller. The OpenAI adapters already supported it. Gemini Live, which has no system role for mid-session text, now sends it as user text marked `[system]`.
