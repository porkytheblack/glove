import type { IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter } from "glove-core/core";

import type { McpAdapter, McpCatalogueEntry } from "./adapter";
import { connectMcp } from "./connect";
import { bridgeMcpTool } from "./bridge";
import { bearer } from "./auth";
import { discoveryTool } from "./discovery";
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
}

/**
 * Reload previously active MCPs into the running Glove and fold in
 * `find_capability`.
 *
 * Fails open — if any single reload fails, logs and continues with the rest,
 * so a transient server outage doesn't kill the agent.
 *
 * Returns when reload + discovery fold are complete.
 */
export async function mountMcp(
  glove: IGloveRunnable,
  config: MountMcpConfig,
): Promise<void> {
  const { adapter, entries, subagentModel, subagentSystemPrompt, clientInfo } =
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
      for (const tool of tools) {
        glove.fold(bridgeMcpTool(conn, tool, glove.serverMode));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[glove-mcp] failed to reload ${id}:`, err);
    }
  }

  // 2. Fold the discovery tool
  glove.fold(
    discoveryTool({
      adapter,
      entries,
      ambiguityPolicy: policy,
      subagentModel,
      subagentSystemPrompt,
      clientInfo,
    }),
  );
}
