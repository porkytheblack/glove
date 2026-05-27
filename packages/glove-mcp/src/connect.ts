import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface McpCallToolResult {
  content: Array<{ type: string; text?: string;[k: string]: unknown }>;
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

/**
 * Wire-level transport for an MCP connection.
 *
 * - `"auto"` (default): try Streamable HTTP first; on a non-auth failure,
 *   fall back to the deprecated HTTP+SSE transport. Matches the MCP spec's
 *   backwards-compat guidance and covers both modern hosted servers
 *   (Notion, Linear, ...) and SSE-only legacy / embedded servers.
 * - `"streamable-http"`: Streamable HTTP only. Fastest for modern servers;
 *   fails outright against SSE-only servers.
 * - `"sse"`: legacy HTTP+SSE only. Skip the Streamable HTTP probe — useful
 *   for servers known to only speak SSE (some local / embedded / robot
 *   MCP servers).
 */
export type McpTransportKind = "auto" | "streamable-http" | "sse";

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
  /** Default `"auto"`. See `McpTransportKind`. */
  transport?: McpTransportKind;
}

// ─── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_CLIENT_INFO = { name: "glove-mcp", version: "0.1.0" };

export async function connectMcp(
  config: ConnectMcpConfig,
): Promise<McpServerConnection> {
  const headers = config.auth ? await config.auth.headers() : undefined;
  const clientInfo = config.clientInfo ?? DEFAULT_CLIENT_INFO;
  const url = new URL(config.url);
  const kind: McpTransportKind = config.transport ?? "auto";

  const client = await openClient(url, headers, clientInfo, kind);

  return {
    namespace: config.namespace,
    raw: client,

    async listTools(): Promise<McpToolDef[]> {
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        annotations: t.annotations
          ? {
              readOnlyHint: t.annotations.readOnlyHint,
              destructiveHint: t.annotations.destructiveHint,
              idempotentHint: t.annotations.idempotentHint,
            }
          : undefined,
      }));
    },

    async callTool(name: string, args: unknown): Promise<McpCallToolResult> {
      const result = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      return {
        content: (result.content ?? []) as McpCallToolResult["content"],
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

// ─── Transport helpers ───────────────────────────────────────────────────────

async function openClient(
  url: URL,
  headers: Record<string, string> | undefined,
  clientInfo: { name: string; version: string },
  kind: McpTransportKind,
): Promise<Client> {
  if (kind === "sse") {
    return connectSse(url, headers, clientInfo);
  }

  try {
    return await connectStreamableHttp(url, headers, clientInfo);
  } catch (err) {
    // Auth failure is transport-agnostic — same headers fail on SSE too.
    if (err instanceof UnauthorizedError) throw err;
    if (kind === "streamable-http") throw err;
    // auto: try the deprecated transport next.
    try {
      return await connectSse(url, headers, clientInfo);
    } catch (sseErr) {
      const a = err instanceof Error ? err.message : String(err);
      const b = sseErr instanceof Error ? sseErr.message : String(sseErr);
      throw new Error(
        `MCP connect failed via both transports. Streamable HTTP: ${a}. SSE: ${b}.`,
      );
    }
  }
}

async function connectStreamableHttp(
  url: URL,
  headers: Record<string, string> | undefined,
  clientInfo: { name: string; version: string },
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: headers ? { headers } : undefined,
  });
  const client = new Client(clientInfo);
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
  return client;
}

async function connectSse(
  url: URL,
  headers: Record<string, string> | undefined,
  clientInfo: { name: string; version: string },
): Promise<Client> {
  // EventSource (used for the persistent GET /sse stream) can't natively
  // set custom headers, so we route auth through a fetch wrapper. The POST
  // /messages endpoint picks them up via requestInit.headers.
  const transport = new SSEClientTransport(url, {
    eventSourceInit: headers
      ? {
          fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            const merged = new Headers(init?.headers);
            for (const [k, v] of Object.entries(headers)) merged.set(k, v);
            return fetch(input, { ...init, headers: merged });
          },
        }
      : undefined,
    requestInit: headers ? { headers } : undefined,
  });
  const client = new Client(clientInfo);
  try {
    await client.connect(transport);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      await client.connect(transport);
    } else {
      throw err;
    }
  }
  return client;
}
