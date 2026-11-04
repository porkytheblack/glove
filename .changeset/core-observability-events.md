---
"glove-core": minor
---

Subscribers see more of what an agent does, so an inspector can draw it without guessing:

- `turn_start` and `turn_end` bracket every turn: a request, queued events waking the agent, or a resumed tool step (`trigger`). `turn_end` has the status (`success`, `error`, `aborted`, or `suspended` at a deferred permission) and the duration. A subagent's turns arrive inside its parent's.
- `tool_use_start` fires when a tool actually starts running, after the calls ahead of it, its permission check and its input validation. `waited_ms` is how long the permission check and validation took, including waiting on a person. `tool_use` still fires when the model asks for the call.
- `text_delta`, `tool_use`, `model_response` and `model_response_complete` carry the `request_id` of the model request they belong to, for every subscriber.
- `subagent_invoked` and `subagent_completed` carry the `call_id` of the `glove_invoke_subagent` call that ran the subagent.
- `inbox_injected` reports resolved inbox items being saved to history (`ids`, `tags`, and `phase`: before a request's message or at a tool-step boundary).
- `event_received` has a `preview`: the start of the event's text, with media named.
