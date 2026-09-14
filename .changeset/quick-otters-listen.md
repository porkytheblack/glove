---
"glove-vfs": patch
---

Fix two silent losses found by running the documented composition rather than reading it.

**`withAccess` erased the optional capabilities.** `GuardedFs` implemented only
the nine base `Vfs` methods, so `withAccess(withMeta(...))` — the layering every
example in the README, the docs and the agent skill shows — returned a tree
where `hasMeta()` and `hasSearch()` were both `false`. Nothing threw: the memory
resource adapter simply read back empty metadata, `fsFns` stopped emitting
`fs__meta` / `fs__links_for` / `fs__set_meta` / `fs__search`, and the model was
never offered the calls. The same shape as the snapshot bug, one layer over.

The capabilities are now forwarded when the inner tree has them, and forwarded
**policy-aware** rather than as a passthrough — a summary describes bytes you
may not read, and a semantic hit is an existence proof for a path meant to be
invisible. So `getMeta` on an unreadable path is refused like a `read`,
`setMeta` / `setEmbedding` on a read-only path are refused like a `write`,
`linksFor` / `searchSemantic` / `findNeedingEmbedding` filter to visible paths,
and `replaceLinkTarget` is refused whole if any holder is fenced, the way a
recursive `rm` already was. A tree without the capabilities still reports
`false`, so detection stays honest.

The `replaceLinkTarget` refusal is careful not to become the leak the filtering
prevents: the caller names an id, not a path, so an unreadable holder is refused
without being identified, while a read-only one — already visible — is named,
because there the filename is the useful answer.

**`describeFsFns` threw for every tree.** It ran `basename()` over a bare
function name (`"read"`), which has no leading `/`, so the helper a host pastes
into a system prompt raised `PathError: path must be absolute` on every call.
Nothing in the suite called it. Fixed, and now covered for plain, read-only,
metadata-bearing and custom-namespace trees.
