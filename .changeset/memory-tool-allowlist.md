---
"glove-memory": minor
---

Memory: hold back what the agent may do, two independent ways.

**Tool allowlists.** Every `use*` helper now takes an options bag selecting which tools of the surface get folded — `useResourcesCurator(glove, resources, { tools: { deny: ["remove", "move"] } })`, `useContext(glove, ctx, { tools: { allow: ["get"] } })`, `useFormRunner(..., { tools: { deny: ["abandon"] } })`. Names resolve in full (`"glove_resources_remove"`) or short (`"remove"`); `allow` narrows first, `deny` subtracts. A selector matching nothing throws `MemoryToolSelectionError` rather than silently doing nothing, since a typo in a `deny` entry would otherwise leave the tool registered. `selectTools` is exported for surfaces you build yourself.

**Path-scoped access policies.** `withResourceAccess(adapter, policy)` wraps a `ResourceFsAdapter` so every call is checked against per-path modes — `"write"`, `"read"` (readable, every mutation refused with `ResourceAccessError`), `"none"` (invisible, and filtered out of `ls` / `grep` / `glob` / `search` / `links_for` results). Rules take a directory prefix or a glob and cascade last-match-wins over a `default`. Enforcement is on the adapter, not the tool list, so a write into a read-only folder is refused whichever tool asks: the affordance and the capability are removed separately, and the two compose.

Recursive removes and directory moves are checked against the whole subtree, so `rm -r /` can't take a protected folder with it; directories on the path to a granted subtree stay listable so an allowlist policy is still navigable; and the active policy is rendered into every resource tool description (`describe: false` suppresses the text, never the enforcement).
