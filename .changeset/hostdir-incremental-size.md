---
"glove-working-environment": patch
---

`hostDirectory` no longer re-walks its base tree on every write.

Every guarded write asks the filesystem for its total size, and the cache was *invalidated* by each mutation — so the next write re-walked and re-statted the whole corpus. Measured over 1000 writes against a 500-file base: **137ms per write, 143s in total**. The cache is now adjusted by the known delta instead (one `stat`, not a walk): **4.0ms per write, 3.4s in total**. Removing a directory still invalidates, because the sizes of the base files it shadows are not knowable without looking.

Adds `pnpm --filter glove-working-environment bench`, which measures per-write latency as the number of mutated paths grows.
