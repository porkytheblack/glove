---
"glove-mesh": minor
"glove-foundry": patch
---

Mesh messages can arrive as Glove events instead of inbox items.

- `mountMesh` takes `delivery: "inbox" | "events"`. The default stays `"inbox"`, so existing integrations are unchanged; `"events"` needs a runnable with `emitEvent` and `addContextProvider` (glove-core 4.4).
- With events, an incoming message or broadcast is emitted as a Glove event (`source: "mesh:<from>"`, `kind: "direct" | "broadcast" | "reply"`). It joins a running loop at the next tool step. An idle agent wakes for it, or it waits for the user's next message, per the Glove's event policy and the new `whenIdle` option. The model sees it as escaped XML marked as outside information, and re-deliveries of a message id are dropped. Blocking sends wait in memory and show as `<mesh_waiting>` runtime context until the ack or reply, which arrives as an event. No inbox methods are needed on the store.
- Agents can now react to each other without a person prompting them. Use a Glove `events.policy` (by `source`) or `whenIdle: "defer"` to keep them from waking each other in a loop.
- `ToolContext` has `waits` (a `PendingWaits`) instead of `store` and `pending`. `inboxWaits` and `EventWaits` are exported for custom tool composition.
- Foundry mounts mesh with `delivery: "inbox"`: it builds a runnable per run, so messages that arrive between runs must wait in the conversation store.
