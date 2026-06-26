/**
 * Batch containment ergonomics.
 *
 * `storeAndTruncate` wraps one tool; in practice you wrap a whole catalogue at
 * once (every tool a bridged MCP server exposes, every tool in a registry). These
 * helpers do that in one call, with a `shouldContain` predicate so the cheap,
 * small-result tools (a status check, a create-ticket ack) stay uncontained while
 * the chunky ones (a full search dump) get the scratchpad treatment.
 *
 * MCP-agnostic by design — for the MCP-specific bridge+contain flow, see
 * `mountContainedMcp` on the `glove-scratchpad/mcp` subpath, which is built on
 * top of these.
 */
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { storeAndTruncate, type StoreAndTruncateOptions } from "./store-and-truncate";

export interface ContainToolsOptions extends Omit<StoreAndTruncateOptions, "name"> {
  /**
   * Decide per-tool whether to contain its result. Returning false leaves the
   * tool exactly as-is (its result reaches the model untouched). Default:
   * contain every tool. Combine with `minBytes` for a size-based gate per call.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shouldContain?: (tool: GloveFoldArgs<any>) => boolean;
}

/**
 * Wrap each tool with {@link storeAndTruncate} (unless `shouldContain` opts it
 * out). Pure — folds nothing, returns the (possibly wrapped) tools so the caller
 * decides where they land.
 *
 * Typed `any` on the tool element because a real catalogue is heterogeneous —
 * each tool carries its own input type, and `GloveFoldArgs.do` is contravariant
 * in it, so `<unknown>` would reject specifically-typed tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function containTools(
  tools: GloveFoldArgs<any>[],
  opts: ContainToolsOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): GloveFoldArgs<any>[] {
  const { shouldContain, ...stOpts } = opts;
  return tools.map((tool) =>
    !shouldContain || shouldContain(tool) ? storeAndTruncate(tool, stOpts) : tool,
  );
}

/**
 * {@link containTools} + fold the result onto a built Glove. Returns the folded
 * tool names (handy for logging / a system-prompt listing).
 */
export function mountContainedTools(
  glove: IGloveRunnable,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: GloveFoldArgs<any>[],
  opts: ContainToolsOptions,
): string[] {
  const wrapped = containTools(tools, opts);
  for (const tool of wrapped) glove.fold(tool);
  return wrapped.map((tool) => tool.name);
}
