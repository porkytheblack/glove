import type { McpAdapter, McpCatalogueEntry } from "./adapter.js";
import { adapterAuth } from "./auth.js";
import {
  connectMcp,
  type ConnectedMcpServerConnection,
  type McpToolDef,
} from "./connect.js";
import { recyclableMcpConnection, validateMcpRecyclePolicy } from "./recycle.js";

export interface ConnectMcpEntryOptions {
  readonly adapter: McpAdapter;
  readonly entry: McpCatalogueEntry;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly filterTools?: (tool: McpToolDef) => boolean;
}

/** Resolve connection-only credentials and process environment at the last responsible moment. */
export async function connectMcpEntry(
  options: ConnectMcpEntryOptions,
): Promise<ConnectedMcpServerConnection> {
  const { adapter, entry, clientInfo, filterTools } = options;
  const shared = {
    namespace: entry.id,
    ...(clientInfo ? { clientInfo } : {}),
    ...(entry.excludeTools ? { excludeTools: [...entry.excludeTools] } : {}),
    ...(entry.includeTools ? { includeTools: [...entry.includeTools] } : {}),
    ...(entry.connectTimeoutMs !== undefined ? { connectTimeoutMs: entry.connectTimeoutMs } : {}),
    ...(entry.requestTimeoutMs !== undefined ? { requestTimeoutMs: entry.requestTimeoutMs } : {}),
    ...(filterTools ? { filterTools } : {}),
  };
  if (entry.transport?.kind === "stdio") {
    const transport = entry.transport;
    const recyclePolicy = validateMcpRecyclePolicy(entry);
    const open = async () => {
      const environment = adapter.getStdioEnvironment
        ? await adapter.getStdioEnvironment(entry.id)
        : undefined;
      return connectMcp({
        ...shared,
        transport: {
          ...transport,
          ...(environment ? { environment } : {}),
        },
      });
    };
    const initial = await open();
    if (!recyclePolicy.idleTimeoutMs && !recyclePolicy.maxLifetimeMs) return initial;
    return recyclableMcpConnection({
      initial,
      open,
      ...recyclePolicy,
    });
  }
  const url = entry.transport?.kind === "http" ? entry.transport.url : entry.url;
  if (!url) throw new Error(`MCP entry "${entry.id}" has no HTTP URL.`);
  return connectMcp({
    ...shared,
    url,
    auth: adapterAuth(adapter, entry.id),
  });
}
