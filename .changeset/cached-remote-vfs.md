---
"glove-working-environment": minor
---

`cachedRemote` — back the working environment with object storage

A third `Vfs` backend, alongside `inMemoryFs()` and `hostDirectory()`. You supply the store as four methods (`get`, `put`, `delete`, `list`) — the common denominator of S3, GCS, R2 and Azure Blob — so the package still depends on no cloud SDK.

```ts
const env = await createWorkingEnvironment({
  filesystem: await cachedRemote(myStore, { prefix: `sessions/${id}/` }),
});
```

The name carries the design. Three `Vfs` methods are whole-tree operations on hot paths: `totalSize()` runs on every write (the byte-budget check) and `files()` backs glob, grep, recursive rm, directory mv/cp and checkpoint fork. Passed straight through to an object store those become a full bucket LIST per write. So the structural index — paths, sizes, mtimes, which directories exist — is built from one LIST at open and maintained in memory on every mutation; only file content crosses the network. `files()`, `list()`, `stat()`, `exists()` and `totalSize()` cost zero round trips, and reads are served from a bounded LRU (32 MiB default) because a session re-reads the same scripts and `.d.ts` siblings constantly.

Correctness details worth knowing: the index is updated only after the store confirms a write, so a failed put leaves it honest rather than claiming a file that is not there. Object stores have no directories — a non-empty one is implied by the keys beneath it and derived on load, while `mkdir` writes a zero-byte `<key>/` marker for the empty case, and `rm` clears markers as well as content so a deleted directory cannot resurrect itself. Directory removal fans out at a bounded concurrency (16 by default) rather than firing one request per file at once.

It is deliberately not a persistence layer. If you only want the tree to survive a restart, `env.snapshot()` to a single object is one round trip per session instead of one per file, and atomic. Reach for this when the tree genuinely outgrows the heap or other systems need the files as individual objects. There is no distributed locking — give every session its own prefix.
