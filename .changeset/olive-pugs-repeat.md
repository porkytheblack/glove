---
"glove-vfs": patch
"glove-working-environment": patch
---

Fix: a snapshot no longer silently drops the metadata index.

`withMeta` hides its sidecar from `files()` and `list()` — correct, it is
bookkeeping rather than content — but `snapshot()`, `restore()` and
`copyTree()` walked the tree *through* those methods, so the sidecar was never
captured. A snapshot/restore round trip returned the file bytes intact and lost
every summary, tag, link, provenance entry and embedding status, which looked
like it had worked. The same shape affected `glove-working-environment`'s own
`env.snapshot()` and its `checkpoint` fork/restore — the documented "close on
idle, resume from a snapshot" lifecycle.

Serialization now unwraps the layer stack first (`unwrap`, `isWrapping`,
`WrappingVfs` and `invalidateChain` are exported for hosts doing the same). It
captures what the backend **stores**, not what the outermost layer **shows**:
a snapshot exists to be restored, so anything it omits is data the restore
destroys. Access-fenced paths are captured for the same reason. These are host
doors, not a surface an agent reaches, so the narrowing that layers exist to
provide is unaffected everywhere else.

`restore()` and a checkpoint restore now also invalidate any cached index over
the tree, so a layer that had already read the old sidecar does not keep
serving it.
