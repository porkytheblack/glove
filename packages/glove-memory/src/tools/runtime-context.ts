import type { RuntimeContextProvider } from "glove-core";

export interface RuntimeContextTarget {
  addContextProvider?: (provider: RuntimeContextProvider) => () => void;
}

export function assertRuntimeContext(target: RuntimeContextTarget): asserts target is Required<RuntimeContextTarget> {
  if (typeof target.addContextProvider !== "function") {
    throw new Error("Memory context requires Glove.addContextProvider; upgrade glove-core or forward it from your runnable proxy. Forms/goals can use injectStatus: false for explicit tools only.");
  }
}

/** A live snapshot at the model-input tail. Never rewrites the system prompt or chat history. */
export function attachRuntimeContext(target: RuntimeContextTarget, render: RuntimeContextProvider): () => void {
  assertRuntimeContext(target);
  return target.addContextProvider(render);
}
