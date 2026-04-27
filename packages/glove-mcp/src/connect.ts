import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

export interface ConnectMcpConfig {
  /** Namespace for tool names — produces `${namespace}__${toolName}`. */
  namespace: string;
  /** MCP server URL. */
  url: string;
  /** Auth provider — currently only the bearer shape is supported in v1. */
  auth?: ConnectMcpAuth;
  /** Identify this client to the server. */
  clientInfo?: { name: string; version: string };
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

  try {
    await client.connect(transport);
  } catch (err) {
    // Known SDK quirk: connect can throw UnauthorizedError on the first attempt
    // even when the credentials are valid. Retry once.
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
