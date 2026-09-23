# glove-vfs

## 0.1.0

### Minor Changes

- [#156](https://github.com/porkytheblack/glove/pull/156) [`331ce80`](https://github.com/porkytheblack/glove/commit/331ce80da3eb0a4b313311d6628a87299b209cc4) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New package: one virtual filesystem for a whole agent.

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

### Patch Changes

- [#156](https://github.com/porkytheblack/glove/pull/156) [`653c3f5`](https://github.com/porkytheblack/glove/commit/653c3f54c231675da30afe62725d53e2855261a9) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Fix: a snapshot no longer silently drops the metadata index.

  `withMeta` hides its sidecar from `files()` and `list()` — correct, it is
  bookkeeping rather than content — but `snapshot()`, `restore()` and
  `copyTree()` walked the tree _through_ those methods, so the sidecar was never
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

- [#182](https://github.com/porkytheblack/glove/pull/182) [`a01c6f7`](https://github.com/porkytheblack/glove/commit/a01c6f7917a2194279b195f7706bb6b7bd18bebd) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Fix two silent losses found by running the documented composition rather than reading it.

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
