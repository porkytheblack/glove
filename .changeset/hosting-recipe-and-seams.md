---
"glove-working-environment": minor
"glove-core": patch
---

A session manager, the tree inside `defineTools` capabilities, and one pair of field names for tool events

**`createSessionManager`** — the registry every host of this package was writing by hand, with the bug it ships with. `createWorkingEnvironment` is async, so `if (!map.has(id)) map.set(id, await create(id))` builds two environments for two requests that arrive together: one is orphaned with its worker thread alive and its `close()` never called, and the two requests act on different trees. Nothing throws. The manager memoizes the *promise*, so concurrent callers share one create; a create that rejects is not remembered, so a transient failure does not pin that id to an error for the life of the process.

```ts
const sessions = createSessionManager({
  globalKey: "__deskSessions",      // survives a dev server's module reload
  idleMs: 30 * 60_000,
  max: 50,
  create: (id) => buildSession(id),
  dispose: (s) => s.env.close(),
});

const session = await sessions.get(id);
void sessions.reap();               // safe to call from every route, concurrently
```

Eviction by idle window, absolute age, and capacity (least-recently-used first). `sessions.hold(id)` pins a session for the length of a turn — a turn can spend four minutes inside one `run_script`, and an idle sweep that fires in the middle closes the worker pool under the running script. `reap()` shares an in-flight sweep rather than starting a second, so a session can never be disposed twice.

**`ToolFnContext.fs`** — `defineTools` capabilities now receive the guarded tree, matched to their call context. A capability that needs the tree ("answer a question about this image", "post this file") previously forced the host into a mutable `{ current?: env }` holder filled after `createWorkingEnvironment` resolved, because the module has to appear in `stdlib` before the environment exists. The write-time-validation refusal is unchanged and deliberately so: the reason was never the filesystem, it is the effect on the other side.

**glove-core: `tool_use_result` also carries `id` and `name`.** A tool call arrives as `{ id, name }` and its result carried only `{ call_id, tool_name }`, so a UI keyed on `id` throughout recorded the calls, never matched the results, and showed every tool spinning forever — with nothing thrown anywhere. **Both spellings are emitted**; `id`/`name` are the pair to prefer because they match `tool_use`, and `call_id`/`tool_name` are neither removed nor deprecated — they are the field names of the persisted `ToolResult`, which is what a store replays from. The alias is added to the event payload only; the stored `ToolResult` shape is untouched. `duration_ms`, always emitted, is now declared on the event type too.

**A hosting recipe** in the README covers the registry, eviction and the turn you must not evict, streaming a turn to a browser (the field-name trap, and why an error display should prefer `data` over `message`), collision-safe uploads with per-file errors, and handing deliverables over.
