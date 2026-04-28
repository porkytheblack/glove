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
   * Resolve a fresh access token for this entry id. Sole auth seam — the
   * framework wraps the returned string in `Authorization: Bearer ...`.
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
  getAccessToken(id: string): Promise<string>;
}
