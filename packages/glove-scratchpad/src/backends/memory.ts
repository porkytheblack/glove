/**
 * The default scratchpad backend — the zero-dependency, pure-JS Postgres-subset
 * SQL engine, now maintained as the standalone `glove-sql` package.
 *
 * Re-exported here so `glove-scratchpad` (and its `glove-scratchpad/memory`
 * subpath) keep their existing API. `MemoryBackend` satisfies the
 * `ScratchpadBackend` contract structurally.
 */
export { MemoryBackend, type MemoryBackendOptions } from "glove-sql";
