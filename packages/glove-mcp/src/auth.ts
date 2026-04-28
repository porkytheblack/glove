export type BearerToken = string | (() => Promise<string> | string);

/**
 * Wrap a token (or a thunk that resolves to one) into an MCP-compatible auth
 * provider that emits an `Authorization: Bearer <token>` header.
 *
 * Internal helper used by `connectMcp` / `mountMcp`. Exported for advanced
 * consumers who call `connectMcp` directly. The thunk form lets callers
 * re-resolve a fresh token on each connection.
 */
export function bearer(token: BearerToken) {
  return {
    async headers(): Promise<Record<string, string>> {
      const t = typeof token === "function" ? await token() : token;
      return { Authorization: `Bearer ${t}` };
    },
  };
}
