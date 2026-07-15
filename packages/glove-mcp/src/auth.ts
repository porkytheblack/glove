import type { ConnectMcpAuth } from "./connect";
import type { McpAdapter } from "./adapter";

export type BearerToken = string | (() => Promise<string> | string);

export type CustomHeaders =
  | Record<string, string>
  | (() => Promise<Record<string, string>> | Record<string, string>);

/**
 * Wrap a token (or a thunk that resolves to one) into an MCP-compatible auth
 * provider that emits an `Authorization: Bearer <token>` header.
 *
 * Internal helper used by `connectMcp` / `mountMcp`. Exported for advanced
 * consumers who call `connectMcp` directly. The thunk form lets callers
 * re-resolve a fresh token on each connection.
 */
export function bearer(token: BearerToken): ConnectMcpAuth {
  return {
    async headers(): Promise<Record<string, string>> {
      const t = typeof token === "function" ? await token() : token;
      return { Authorization: `Bearer ${t}` };
    },
  };
}

/**
 * Wrap a header map (or a thunk that resolves to one) into an MCP-compatible
 * auth provider, for servers that don't take `Authorization: Bearer` — e.g.
 * an `x-api-key` header. The thunk form lets callers re-resolve fresh
 * headers on each connection.
 */
export function headers(custom: CustomHeaders): ConnectMcpAuth {
  return {
    async headers(): Promise<Record<string, string>> {
      return typeof custom === "function" ? await custom() : custom;
    },
  };
}

/**
 * Resolve the auth provider for a catalogue entry from the adapter's seams:
 * `getAuthHeaders` wins when defined, then `getAccessToken` wrapped as a
 * bearer, then no auth at all. Used by `mountMcp` and the discovery
 * subagent's `activate` tool.
 */
export function adapterAuth(
  adapter: McpAdapter,
  id: string,
): ConnectMcpAuth | undefined {
  if (adapter.getAuthHeaders) {
    return headers(() => adapter.getAuthHeaders!(id));
  }
  if (adapter.getAccessToken) {
    return bearer(() => adapter.getAccessToken!(id));
  }
  return undefined;
}
