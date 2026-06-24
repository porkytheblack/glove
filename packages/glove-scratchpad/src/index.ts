/**
 * glove-scratchpad — The Scratchpad Computer for Glove.
 *
 * A substrate-independent architecture for context-efficient multi-agent
 * workflows: handles + deterministic SQL transforms over a durable store. The
 * context win is recovered through *topology*, not a shell.
 *
 * Two mechanisms, decoupled from any substrate:
 *   1. Interface disclosure — partition tools across subdroids (use Glove's
 *      subagents + glove-mcp discovery; nothing here is needed for it).
 *   2. Result containment — {@link storeAndTruncate} writes a tool's full result
 *      into a {@link Scratchpad} and returns only a stub.
 *
 * Most consumers import from the barrel:
 *
 * ```ts
 * import { Scratchpad, mountScratchpad, storeAndTruncate } from "glove-scratchpad";
 * import { PgliteBackend } from "glove-scratchpad/pglite";
 *
 * const sp = await Scratchpad.create(await PgliteBackend.create());
 * mountScratchpad(agent, { scratchpad: sp });
 * agent.fold(storeAndTruncate(someBigTool, { scratchpad: sp }));
 * ```
 *
 * The PGlite backend lives behind the `glove-scratchpad/pglite` subpath so the
 * heavy WASM dependency is opt-in. The contract is a defined Postgres subset
 * ({@link ScratchpadBackend}); the backend is swappable.
 */
export * from "./core";
export * from "./tools";
