import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";

import type { McpCatalogueEntry } from "./adapter";
import { bridgeMcpTool, type McpToolWrapper } from "./bridge";
import type { McpServerConnection } from "./connect";
import { mcpUtilityTools } from "./utilities";

export interface MountMcpToolSetOptions {
  readonly glove: IGloveRunnable;
  readonly connection: McpServerConnection;
  readonly entry: McpCatalogueEntry;
  readonly wrapTool?: McpToolWrapper;
}

export interface MountedMcpToolSet {
  readonly toolNames: ReadonlyArray<string>;
  /** Re-list and atomically replace this server's mounted surface. */
  refresh(): Promise<void>;
  /** Remove this server's tools and close its transport. */
  dispose(): Promise<void>;
}

async function buildToolSet(
  glove: IGloveRunnable,
  connection: McpServerConnection,
  entry: McpCatalogueEntry,
  wrapTool?: McpToolWrapper,
): Promise<ReadonlyArray<GloveFoldArgs<unknown>>> {
  const tools = await connection.listTools();
  const utilities = mcpUtilityTools(connection, {
    resources: entry.resources,
    prompts: entry.prompts,
    occupiedNames: tools.map((tool) => tool.name),
  });
  const wrap = (tool: GloveFoldArgs<unknown>) => wrapTool ? wrapTool(tool, entry) : tool;
  return [
    ...tools.map((tool) => wrap(bridgeMcpTool(connection, tool, glove.serverMode))),
    ...utilities.map(wrap),
  ];
}

/**
 * Mount one MCP server as an owned, live tool set.
 *
 * Servers that advertise `tools.listChanged` are re-listed after the SDK's
 * debounce. Wrapping, filtering and utility collision checks are recomputed,
 * then Glove swaps the complete provider surface atomically. Failed refreshes
 * leave the previous surface intact.
 */
export async function mountMcpToolSet(
  options: MountMcpToolSetOptions,
): Promise<MountedMcpToolSet> {
  const { glove, connection, entry, wrapTool } = options;
  let names: string[] = [];
  let disposed = false;
  let lifecycle: Promise<void> = Promise.resolve();

  const initial = await buildToolSet(glove, connection, entry, wrapTool);
  glove.replaceTools([], initial);
  names = initial.map((tool) => tool.name);

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const result = lifecycle.then(task, task);
    lifecycle = result.then(() => undefined, () => undefined);
    return result;
  };

  const refresh = () => enqueue(async () => {
    if (disposed) return;
    const next = await buildToolSet(glove, connection, entry, wrapTool);
    glove.replaceTools(names, next);
    names = next.map((tool) => tool.name);
  });

  const unsubscribe = connection.capabilities?.toolsListChanged
    ? connection.onToolsChanged?.(() => refresh().catch((error) => {
        // A transient re-list failure must not remove a working tool surface.
        // eslint-disable-next-line no-console
        console.warn(`[glove-mcp] failed to refresh ${entry.id}:`, error);
      }))
    : undefined;

  return {
    get toolNames() { return names; },
    refresh,
    async dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      await enqueue(async () => {
        glove.replaceTools(names, []);
        names = [];
        await connection.close();
      });
    },
  };
}
