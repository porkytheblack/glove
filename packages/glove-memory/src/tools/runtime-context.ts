import type { RuntimeContextDelivery, RuntimeContextOptions, RuntimeContextProvider } from "glove-core";

export interface RuntimeContextTarget {
  /** Proxies must forward `options` too; dropping it silently falls back to per-iteration delivery. */
  addContextProvider?: (provider: RuntimeContextProvider, options?: RuntimeContextOptions) => () => void;
}

/** How a memory surface's snapshot reaches the model. See `RuntimeContextDelivery` in glove-core. */
export type MemoryContextDelivery = RuntimeContextDelivery;

export function assertRuntimeContext(target: RuntimeContextTarget): asserts target is Required<RuntimeContextTarget> {
  if (typeof target.addContextProvider !== "function") {
    throw new Error("Memory context requires Glove.addContextProvider; upgrade glove-core or forward it from your runnable proxy. Forms/goals can use injectStatus: false for explicit tools only.");
  }
}

/**
 * A live snapshot for the model. Never rewrites the system prompt; it stays
 * out of history unless `options.delivery` is `"history"`.
 */
export function attachRuntimeContext(target: RuntimeContextTarget, render: RuntimeContextProvider, options?: RuntimeContextOptions): () => void {
  assertRuntimeContext(target);
  return options ? target.addContextProvider(render, options) : target.addContextProvider(render);
}
