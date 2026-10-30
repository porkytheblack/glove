---
"glove-realtime": patch
---

Queue and coalesce OpenAI Realtime response requests from typed input, spontaneous events and tool results. Wait for the current response and outstanding tool batch to finish, preventing overlapping-response errors and dropped continuations during agent-to-agent exchanges.
