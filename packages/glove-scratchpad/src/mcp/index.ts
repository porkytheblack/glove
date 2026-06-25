/**
 * glove-scratchpad/mcp — bridge an MCP server's tools AND contain their results
 * in one call.
 *
 * This is the canonical composition the package's README leads with —
 * `storeAndTruncate(bridgeMcpTool(conn, tool, serverMode))` — but applied to a
 * whole connection so you never hand-roll the
 * `listTools → bridge → contain → fold` loop again:
 *
 * ```ts
 * import { connectMcp } from "glove-mcp";
 * import { mountContainedMcp, createContainmentReporter } from "glove-scratchpad/mcp";
 *
 * const conn = await connectMcp({ namespace: "crm", url });
 * const reporter = createContainmentReporter();
 * await mountContainedMcp(agent, conn, { scratchpad: sp, onContain: reporter.onContain });
 * // …the agent now sees crm__* tools whose big results land in the scratchpad.
 * console.log(reporter.format());
 * ```
 *
 * `glove-mcp` is an OPTIONAL peer dependency — installing `glove-scratchpad`
 * doesn't pull it in. This subpath only resolves when you've added `glove-mcp`
 * yourself, exactly like `glove-scratchpad/pglite` and `@electric-sql/pglite`.
 */
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { bridgeMcpTool } from "glove-mcp";
import type { McpServerConnection, McpToolDef } from "glove-mcp";
import { storeAndTruncate, type StoreAndTruncateOptions } from "../tools/store-and-truncate";

export interface ContainMcpOptions extends Omit<StoreAndTruncateOptions, "name"> {
  /**
   * Passed through to `bridgeMcpTool` — controls the bridged tool's
   * `requiresPermission` default. True (headless) never gates; false gates
   * read-write tools. Defaults to true, matching the server-side containment
   * use case this subpath is built for.
   */
  serverMode?: boolean;
  /**
   * Decide per-tool whether to contain its result. Receives the MCP tool
   * definition (so you can branch on `name` / `annotations.readOnlyHint`).
   * Returning false bridges the tool but leaves its result uncontained.
   * Default: contain every tool. Combine with `minBytes` for a size gate.
   */
  shouldContain?: (tool: McpToolDef) => boolean;
}

/**
 * Bridge every tool a connection exposes and wrap each in `storeAndTruncate`
 * (subject to `shouldContain`). Pure — folds nothing; returns the tools so the
 * caller decides where they land (main agent, a subagent, a graph node).
 */
export async function containMcpTools(
  connection: McpServerConnection,
  opts: ContainMcpOptions,
): Promise<GloveFoldArgs<unknown>[]> {
  const { serverMode = true, shouldContain, ...stOpts } = opts;
  const defs = await connection.listTools();
  return defs.map((def) => {
    const bridged = bridgeMcpTool(connection, def, serverMode);
    return !shouldContain || shouldContain(def) ? storeAndTruncate(bridged, stOpts) : bridged;
  });
}

/**
 * {@link containMcpTools} + fold the result onto a built Glove. Returns the
 * folded tool names (e.g. `["crm__list_accounts", "crm__get_account"]`).
 *
 * The caller still owns the connection lifecycle — connect with `connectMcp`
 * before, `connection.close()` after (or on conversation end / auth refresh).
 */
export async function mountContainedMcp(
  glove: IGloveRunnable,
  connection: McpServerConnection,
  opts: ContainMcpOptions,
): Promise<string[]> {
  const tools = await containMcpTools(connection, opts);
  for (const tool of tools) glove.fold(tool);
  return tools.map((tool) => tool.name);
}

// Re-export the telemetry helpers so an MCP-only consumer needs a single import.
export {
  createContainmentReporter,
  type ContainmentReporter,
  type ContainmentReport,
  type ContainmentInfo,
  type ContainmentListener,
} from "../tools/store-and-truncate";
