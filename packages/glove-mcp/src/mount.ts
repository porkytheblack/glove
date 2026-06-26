import type { IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter } from "glove-core/core";

import type { McpAdapter, McpCatalogueEntry } from "./adapter";
import { connectMcp } from "./connect";
import { bridgeMcpTool, type McpToolWrapper } from "./bridge";
import { bearer } from "./auth";
import { discoverySubAgent } from "./discovery";
import type { DiscoveryAmbiguityPolicy } from "./discovery/policy";

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
  const { adapter, entries, subagentModel, subagentSystemPrompt, clientInfo, wrapTool } =
    config;

  const policy: DiscoveryAmbiguityPolicy =
    config.ambiguityPolicy ??
    (glove.serverMode ? { type: "auto-pick-best" } : { type: "interactive" });

  // 1. Reload active servers
  const activeIds = await adapter.getActive();
  for (const id of activeIds) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) continue; // entry removed since last session — drop silently

    try {
      const conn = await connectMcp({
        namespace: id,
        url: entry.url,
        auth: bearer(() => adapter.getAccessToken(id)),
        clientInfo,
      });
      const tools = await conn.listTools();
      // Build the full wrapped set first; fold only after every wrapTool call
      // succeeds, so a throwing wrapper can't leave a half-rehydrated provider.
      const wrapped = tools.map((tool) => {
        const bridged = bridgeMcpTool(conn, tool, glove.serverMode);
        return wrapTool ? wrapTool(bridged, entry) : bridged;
      });
      for (const t of wrapped) glove.fold(t);
    } catch (err) {
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
    }),
  );
}
