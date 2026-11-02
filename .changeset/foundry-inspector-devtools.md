---
"glove-foundry": minor
---

The inspector opens a run like a browser's DevTools.

- **Network** lists every model request and tool call in order, with type, status, initiator, size, time and a waterfall. Filter by text or by model, tools or errors.
  - A model request opens to Overview, Prompt (the system prompt), Messages (the conversation as that request sent it, with earlier messages folded), Context (memory and other runtime context, marked new or changed), Tools (descriptions and schemas), Response and Raw.
  - **Copy request** copies the request as JSON.
  - A tool call opens to its input, result, the request that made it, and its approval.
- **Console** is the run as a levelled log. Streamed text is one line, and you can filter by text, level and source.
- **Context** is a tree of what the agent had: per request (system prompt, runtime context, tools, messages), the run's input and output, the instance's context, installations and playbooks, and goals, facts, forms and memory.
- **Summary** has the phases, the output, the slowest steps and the errors. **Export trace** downloads the run and its events.
- The view, the open request and its pane are in the URL (`?tab=&item=&pane=`). `1`–`4` switch views, `j`/`k` walk requests and `Esc` closes one.
- A run's page reads that run's own events (`/api/runs/:id/events`, which now takes `?after=`), so a long run isn't cut off by the global event list.

Runs record each model request from Glove's new `model_request` events, compactly:

- The system prompt and tools are recorded in full once per run, then by hash.
- Messages are recorded as a change against the previous request. Runtime context is recorded each time.
- Text and JSON are cut, media becomes a placeholder, and `renderData` and echoed reasoning are left out.

Set `observability: { modelRequests: false }` in `foundry.config.ts` to leave them out of the event stream. Runs recorded without them still list their tool calls and responses.
