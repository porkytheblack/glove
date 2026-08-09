---
"glove-working-environment": patch
---

Route the host doors and checkpoint verbs through the environment's mutation queue.

`snapshot()`, `export()`, `mount()` and the `checkpoint` verb walked or rewrote the tree outside the single lock that linearizes every other mutation. Concurrent with a running script — a server on a persistence tick, a Save button, a second request — that produced a snapshot of a tree the environment was never in, an outright rejection when the version ring rotated a blob out between listing it and reading it, two mounts that each passed the size check and together exceeded it, and a `checkpoint restore` that could stop half-applied.

- `EnvCore.serialize` is now `EnvCore.exclusive` and is public: whole-tree *reads* need the lock as much as writes do.
- `checkpoint restore` is all-or-nothing — the current tree is captured first and reinstated if any step fails — and tolerates a file that vanished between listing and removal.
- `restore` now clears the per-file undo rings for the files it rewrote, so a later `undo` cannot quietly reinstate content from before the restore.
- `mount` keeps its host-file read outside the lock; only the size check and the write are serialized.

The synchronous `InMemoryFs.toSnapshot()` fast path is unchanged.
