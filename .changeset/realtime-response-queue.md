---
"glove-realtime": patch
---

Queue and coalesce OpenAI Realtime response requests from typed input, spontaneous events and tool results. Wait for the current response and outstanding tool batch to finish, recover from correlated request rejections, isolate late summary completions, and defer queued responses through user speech and the automatic VAD response. This prevents overlapping-response errors and dropped continuations during agent-to-agent exchanges.
