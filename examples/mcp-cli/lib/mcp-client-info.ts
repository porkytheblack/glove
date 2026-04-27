import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Shared client identity used by every CLI in this folder.
 *
 * This shows up in two places:
 *
 *  1. As `clientInfo` on the MCP `Client` constructor — sent to the server in
 *     the `initialize` request body.
 *  2. As `client_name` in `clientMetadata` during Dynamic Client Registration —
 *     stored server-side as part of the registered client's record.
 *
 * Keeping both identical avoids any chance the server correlates one with
 * the other and rejects mismatches.
 */
export const MCP_CLIENT_NAME = "Glove MCP CLI";
export const MCP_CLIENT_VERSION = "0.1.0";

export const MCP_CLIENT_INFO = {
  name: MCP_CLIENT_NAME,
  version: MCP_CLIENT_VERSION,
};

/**
 * `clientMetadata` for Dynamic Client Registration. Pass `redirectUrl` so the
 * runtime use of the provider matches the URL the auth CLI registered with.
 */
export function buildClientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: MCP_CLIENT_NAME,
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
