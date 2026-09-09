import type { IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter } from "glove-core/core";

import type { McpAdapter, McpCatalogueEntry } from "./adapter";
import type { McpToolDef } from "./connect";
import { connectMcpEntry } from "./connect-entry";
import type { McpToolWrapper } from "./bridge";
import { discoverySubAgent } from "./discovery";
import type { DiscoveryAmbiguityPolicy } from "./discovery/policy";
import { mountMcpToolSet, type MountedMcpToolSet } from "./mounted-tools";

export interface MountMcpConfig {
  /** Per-conversation adapter. Implements active-state persistence + token resolution. */
  adapter: McpAdapter;
  /** Static list of all entries the app supports. */
  entries: McpCatalogueEntry[];
  /** Default: "auto-pick-best" if glove.serverMode, else "interactive". */
  ambiguityPolicy?: DiscoveryAmbiguityPolicy;
  /** Override the subagent's model. Default: glove.model (inherits the main agent's). */
  subagentModel?: ModelAdapter;
  /** Override the subagent's system prompt. Default: built-in per-policy prompt. */
  subagentSystemPrompt?: string;
  /** Identify this client when connecting to MCP servers. */
  clientInfo?: { name: string; version: string };
  /**
   * Cross-server tool filter — return `false` to hide a tool from EVERY server
   * in the catalogue (applied after each entry's own include/exclude policy).
   * Applied both to the boot-time reload and to tools the discovery subagent
   * activates later. Use for catalogue-wide rules, e.g. drop every destructive
   * tool: `filterTools: (t) => !t.annotations?.destructiveHint`.
   */
  filterTools?: (tool: McpToolDef, entry: McpCatalogueEntry) => boolean;
  /**
   * Transform each bridged tool before it's folded — applied both to the
   * reload-on-boot tools and to tools the discovery subagent activates later.
   * Use `glove-scratchpad`'s `containingWrap` to give a whole catalogue
   * scratchpad containment so 10+ providers can be discovered on demand AND
   * have their results contained.
   */
  wrapTool?: McpToolWrapper;
}

/**
 * Reload previously active MCPs into the running Glove and register the
 * `discovermcp` discovery subagent so the parent agent can route to it
 * via `glove_invoke_subagent`.
 *
 * Fails open — if any single reload fails, logs and continues with the rest,
 * so a transient server outage doesn't kill the agent.
 *
 * Returns when reload + subagent registration are complete.
 */
export async function mountMcp(
  glove: IGloveRunnable,
  config: MountMcpConfig,
): Promise<void> {
  const { adapter, entries, subagentModel, subagentSystemPrompt, clientInfo, wrapTool, filterTools } =
    config;

  const policy: DiscoveryAmbiguityPolicy =
    config.ambiguityPolicy ??
    (glove.serverMode ? { type: "auto-pick-best" } : { type: "interactive" });

  // 1. Reload active servers
  const mounted = new Map<string, MountedMcpToolSet>();
  const activeIds = await adapter.getActive();
  for (const id of activeIds) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) continue; // entry removed since last session — drop silently

    let conn: Awaited<ReturnType<typeof connectMcpEntry>> | undefined;
    try {
      conn = await connectMcpEntry({
        adapter,
        entry,
        clientInfo,
        ...(filterTools ? { filterTools: (tool) => filterTools(tool, entry) } : {}),
      });
      const toolSet = await mountMcpToolSet({
        glove,
        connection: conn,
        entry,
        wrapTool,
      });
      mounted.set(entry.id, toolSet);
    } catch (err) {
      await conn?.close().catch(() => undefined);
      // eslint-disable-next-line no-console
      console.warn(`[glove-mcp] failed to reload ${id}:`, err);
    }
  }

  // 2. Register the discovery subagent
  glove.defineSubAgent(
    discoverySubAgent({
      adapter,
      entries,
      ambiguityPolicy: policy,
      subagentModel,
      subagentSystemPrompt,
      clientInfo,
      wrapTool,
      filterTools,
      mounted,
    }),
  );
}
