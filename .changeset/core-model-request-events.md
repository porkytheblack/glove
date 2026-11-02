---
"glove-core": minor
---

Glove reports what each model call is sent. Every call to the model adapter now emits two subscriber events:

- `model_request` carries `request_id`, `model`, `purpose` (`"turn"` or `"compaction"`), `system_prompt`, `messages` and `tools` (name, description and JSON Schema). These are exactly what the adapter receives, after tool-result summaries, with runtime context at the tail.
- `model_request_end` carries the same `request_id`, `duration_ms`, `status` (`success`, `error` or `aborted`), `error`, the response `messages` and the token counts. A failed call still ends its request, and the model's own error is the one that is thrown.

Both carry the whole conversation on every call. So they go only to subscribers that set `modelRequests: true`, and a subscriber that forwards every event to a socket or a log doesn't start sending prompts. The arrays are the request's own: read them, don't change them. `ModelRequestTool` is exported.
