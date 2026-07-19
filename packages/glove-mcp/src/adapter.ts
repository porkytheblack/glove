/**
 * Static catalogue entry — describes one MCP server the app supports.
 *
 * Authored at the application level (in code or config). Identical across
 * users; passed to `mountMcp` alongside the per-conversation `McpAdapter`.
 */
export interface McpCatalogueEntry {
  /** Stable id, also used as the tool namespace prefix and the activation key. */
  id: string;
  /** Display name used by the discovery subagent. */
  name: string;
  /** Short description used by the subagent for matching. */
  description: string;
  /** MCP server URL (HTTP transport only in v1). */
  url: string;
  /** Optional — discovery uses these for matching. */
  tags?: string[];
  /**
   * Tool names NOT to mount from this server — exact, un-namespaced names as the
   * server knows them (e.g. `"delete_repository"`, not `"github__delete_repository"`).
   * Applied at the connection, so an excluded tool never reaches the model:
   * neither the boot-time reload (`mountMcp`) nor the discovery subagent's
   * `activate` bridges it, and a `glove-scratchpad` bridge built from the same
   * connection won't see it either. Use to drop dangerous, noisy, or duplicate
   * tools a server exposes.
   */
  excludeTools?: string[];
  /** Optional — extra arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Per-conversation MCP adapter — the consumer implements this, scoped to a
 * single conversation. Analogous to StoreAdapter. Both pieces of state it
 * holds — active ids and access tokens — are conversation-specific.
 */
export interface McpAdapter {
  /** For debugging / log correlation, e.g. the conversation id. */
  identifier: string;

  /** Active entry ids in this conversation. Used at session boot for reload. */
  getActive(): Promise<string[]>;

  /** Mark an entry active. Called by the discovery subagent's activate tool. */
  activate(id: string): Promise<void>;

  /**
   * Mark an entry inactive. Available for the consumer's own UI ("disconnect")
   * and called by the subagent if a deactivate request comes through.
   *
   * IMPORTANT: deactivate does NOT remove tools from the running Glove —
   * consumers who rely on this should refresh the session. v1 limitation.
   */
  deactivate(id: string): Promise<void>;

  /**
   * Resolve a fresh access token for this entry id. The framework wraps the
   * returned string in `Authorization: Bearer ...`. Implement this OR
   * `getAuthHeaders` (which takes precedence when both are defined); with
   * neither, connections are made without auth headers.
   *
   * Called every time a connection is established (session boot + activation).
   * Throwing here causes the activation/reload to fail gracefully.
   *
   * Token lifecycle (acquisition, refresh, persistence) is entirely the
   * consumer's responsibility. When a token expires mid-call the bridged
   * tool returns `{ status: "error", message: "auth_expired" }` — react in
   * your app, refresh, update your store, and the next connection picks
   * up the new value. See `glove-mcp/oauth` for an opt-in OAuth-flow runner.
   */
  getAccessToken?(id: string): Promise<string>;

  /**
   * Resolve the full auth header map for this entry id, for servers that
   * don't take a bearer token — e.g. `{ "x-api-key": "..." }`. Takes
   * precedence over `getAccessToken` when both are defined. Same call
   * timing and error semantics as `getAccessToken`.
   */
  getAuthHeaders?(id: string): Promise<Record<string, string>>;
}
