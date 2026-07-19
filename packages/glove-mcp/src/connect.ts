import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /**
   * JSON Schema for the tool's structured result (MCP 2025-06-18+). Present only
   * when the server declares one; older servers omit it. Consumers render it into
   * a result shape (see `jsonSchemaToShape`) so the model knows the return shape
   * without calling the tool first.
   */
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface McpCallToolResult {
  content: Array<{ type: string; text?: string;[k: string]: unknown }>;
  /**
   * Structured result payload (MCP 2025-06-18+) matching the tool's
   * `outputSchema`. Present only when the server returns one. Preferred over the
   * joined text content when surfacing the result to the model.
   */
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpServerConnection {
  /** Stable namespace, used as the tool name prefix. Matches the entry id. */
  readonly namespace: string;
  /** List tools exposed by the server. */
  listTools(): Promise<McpToolDef[]>;
  /** Call a tool by its un-namespaced name (the name as the server knows it). */
  callTool(name: string, args: unknown): Promise<McpCallToolResult>;
  /** Close the underlying transport. */
  close(): Promise<void>;
  /** Underlying SDK client, for advanced use (resources, prompts). */
  raw: Client;
}

export interface ConnectMcpAuth {
  headers: () => Promise<Record<string, string>>;
}

export interface ConnectMcpConfig {
  /** Namespace for tool names — produces `${namespace}__${toolName}`. */
  namespace: string;
  /** MCP server URL. */
  url: string;
  /**
   * Static-headers auth, e.g. `bearer(token)`. The framework only does bearer
   * auth — anything more sophisticated (OAuth flow, refresh, etc.) belongs in
   * the consumer's app, which then exposes a refreshed token through
   * `McpAdapter.getAccessToken`.
   */
  auth?: ConnectMcpAuth;
  /** Identify this client to the server. */
  clientInfo?: { name: string; version: string };
  /**
   * Tool names to hide from this connection — exact, un-namespaced names as the
   * server knows them (e.g. `"delete_repository"`, NOT `"github__delete_repository"`).
   * Filtered out of `listTools()`, so an excluded tool is never bridged or
   * mounted by ANY consumer — `mountMcp`, the discovery subagent's `activate`,
   * `glove-scratchpad`'s `mcpResources` / `fnsFromMcp` all read this same
   * listing. The single "don't mount these functions from the server" knob.
   *
   * Only the listing is filtered; `raw` and a direct `callTool(name, …)` are
   * left untouched as an advanced escape hatch.
   */
  excludeTools?: string[];
  /**
   * Finer-grained listing filter — return `false` to hide a tool. Runs AFTER
   * `excludeTools` (a name in `excludeTools` is dropped regardless). Use for
   * pattern- or annotation-based rules, e.g. drop every destructive tool:
   * `filterTools: (t) => !t.annotations?.destructiveHint`.
   */
  filterTools?: (tool: McpToolDef) => boolean;
}

// ─── Tool filtering ──────────────────────────────────────────────────────────

/**
 * Whether a tool survives a connection's exclusion rules. `excludeTools` drops
 * by exact name; `filterTools` (checked only for names that survived) drops by
 * predicate. Exported so the drop semantics are unit-testable and reusable — it
 * is the single gate every consumer's listing passes through.
 */
export function includeTool(
  tool: McpToolDef,
  opts: {
    excludeTools?: Iterable<string> | Set<string>;
    filterTools?: (tool: McpToolDef) => boolean;
  },
): boolean {
  const excluded =
    opts.excludeTools instanceof Set ? opts.excludeTools : new Set(opts.excludeTools ?? []);
  if (excluded.has(tool.name)) return false;
  return opts.filterTools ? opts.filterTools(tool) !== false : true;
}

// ─── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_CLIENT_INFO = { name: "glove-mcp", version: "0.1.0" };

export async function connectMcp(
  config: ConnectMcpConfig,
): Promise<McpServerConnection> {
  const headers = config.auth ? await config.auth.headers() : undefined;

  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: headers ? { headers } : undefined,
  });

  const client = new Client(config.clientInfo ?? DEFAULT_CLIENT_INFO);

  const excluded = new Set(config.excludeTools ?? []);
  const filterTools = config.filterTools;

  try {
    await client.connect(transport);
  } catch (err) {
    // Known SDK quirk: connect can throw UnauthorizedError on the first
    // attempt even when the credentials are valid. Retry once.
    if (err instanceof UnauthorizedError) {
      await client.connect(transport);
    } else {
      throw err;
    }
  }

  return {
    namespace: config.namespace,
    raw: client,

    async listTools(): Promise<McpToolDef[]> {
      const result = await client.listTools();
      const defs = result.tools.map((t) => {
        // Read defensively via cast: `outputSchema` only exists on SDK types at
        // the 2025-06-18 revision, and servers below it simply omit the field.
        const outputSchema = (t as { outputSchema?: Record<string, unknown> })
          .outputSchema;
        return {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
          ...(outputSchema ? { outputSchema } : {}),
          annotations: t.annotations
            ? {
                readOnlyHint: t.annotations.readOnlyHint,
                destructiveHint: t.annotations.destructiveHint,
                idempotentHint: t.annotations.idempotentHint,
              }
            : undefined,
        };
      });
      // Exclusion happens HERE, at the one listing every consumer reads —
      // mountMcp, discovery `activate`, and the scratchpad bridges all bridge
      // exactly what this returns, so a dropped tool is dropped everywhere.
      if (excluded.size === 0 && !filterTools) return defs;
      return defs.filter((d) => includeTool(d, { excludeTools: excluded, filterTools }));
    },

    async callTool(name: string, args: unknown): Promise<McpCallToolResult> {
      const result = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      const structuredContent = (result as { structuredContent?: unknown })
        .structuredContent;
      return {
        content: (result.content ?? []) as McpCallToolResult["content"],
        ...(structuredContent !== undefined ? { structuredContent } : {}),
        isError: Boolean(result.isError),
      };
    },

    async close() {
      await client.close();
    },
  };
}

/** Re-exported so consumers branching on auth errors can detect them. */
export { UnauthorizedError };
