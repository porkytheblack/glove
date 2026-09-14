---
"glove-working-environment": minor
---

The filesystem now comes from `glove-vfs`.

`Vfs`, `VfsEntry`, `VfsStat`, `EnvSnapshot` (as `VfsSnapshot`), the path
helpers and the three backends (`inMemoryFs`, `hostDirectory`, `cachedRemote`)
moved into the new `glove-vfs` package and are re-exported from here, so every
existing import keeps working unchanged.

What this buys: `filesystem` can now be a tree the memory resource store and
the sandboxed REPLs are also mounted on, so a file a script writes is a note
`glove_resources_read` can read at the same path, with no copy and no export
step. The composition helpers are re-exported for that purpose — `mountFs`,
`withAccess`, `withMeta`, `hasMeta`, `hasSearch`.
