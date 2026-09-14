---
"glove-vfs": minor
---

New package: one virtual filesystem for a whole agent.

Glove grew three filesystems independently — the working environment's script
tree, the memory layer's resource store, and whatever a REPL session held in
scope — so a file the agent made could not be filed, a note it had filed could
not be read by a script, and a REPL intermediate was addressable from nowhere.
`glove-vfs` makes the tree the shared namespace all three mount.

- **`Vfs`** — nine methods over bytes and paths, deliberately the most every
  backend can promise. Richer surfaces are optional capabilities detected with
  `hasMeta()` / `hasSearch()` rather than required by the base type.
- **Backends** — `inMemoryFs()`, `hostDirectory()` (copy-on-write over a real
  directory), `cachedRemote()` (object storage, no SDK dependency).
- **`mountFs(mounts)`** — several backends composed into one tree.
  Longest-prefix routing, listable paths down to each mount, mount points that
  cannot be removed from inside, and `rooted: false` for backends whose stored
  paths must stay absolute.
- **`withAccess(fs, policy)`** — path-scoped `write` / `read` / `none` with
  last-match-wins rules. Enforced on the filesystem, so it binds model verbs,
  scripts, REPL calls and host handles alike.
- **`withMeta(fs, opts)`** — summaries, tags, links, append-only provenance and
  an out-of-band index lifecycle, kept in one hidden sidecar. Search is opt-in
  (`embedder` or `lexical: true`) and advertised only when real.
- **`glove-vfs/resources`** — `vfsResources()` returns a `ResourceFsAdapter`,
  so `glove-memory`'s resource tools read the same bytes a script wrote.
- **`glove-vfs/fns`** — `fsFns()` returns the filesystem as `ToolFn`s for
  `glove-js` / `glove-lisp` / `glove-python`, so a REPL can loop over files in
  one call instead of one round trip per file.
- **`glove-vfs/testing`** — `runVfsConformance()` for backend implementers.
