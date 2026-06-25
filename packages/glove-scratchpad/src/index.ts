/**
 * glove-scratchpad — The Scratchpad Computer for Glove.
 *
 * A substrate-independent architecture for context-efficient multi-agent
 * workflows: handles + deterministic SQL transforms over a durable store. The
 * context win is recovered through *topology*, not a shell.
 *
 * Two mechanisms, decoupled from any substrate:
 *   1. Interface disclosure — partition tools across subagents (use Glove's
 *      subagents + glove-mcp discovery; nothing here is needed for it).
 *   2. Result containment — {@link storeAndTruncate} writes a tool's full result
 *      into a {@link Scratchpad} and returns only a stub.
 *
 * Most consumers import from the barrel:
 *
 * ```ts
 * import { Scratchpad, MemoryBackend, mountScratchpad, storeAndTruncate } from "glove-scratchpad";
 *
 * const sp = await Scratchpad.create(await MemoryBackend.create());
 * mountScratchpad(agent, { scratchpad: sp });
 * agent.fold(storeAndTruncate(someBigTool, { scratchpad: sp }));
 * ```
 *
 * The default backend is {@link MemoryBackend} — a zero-dependency, pure-JS
 * Postgres-subset emulator whose tables are constructed at runtime from whatever
 * data is ingested. A PGlite (WASM Postgres) backend is available behind the
 * `glove-scratchpad/pglite` subpath when a real Postgres dialect is wanted. The
 * contract is a defined Postgres subset ({@link ScratchpadBackend}); the backend
 * is swappable.
 *
 * For multi-subagent topologies, `glove-scratchpad/graph` builds a wired graph
 * from a plain, schema-validated definition object.
 */
export * from "./core";
export * from "./tools";
export * from "./persist";
export { MemoryBackend, type MemoryBackendOptions } from "./backends/memory";
export * from "./graph";
