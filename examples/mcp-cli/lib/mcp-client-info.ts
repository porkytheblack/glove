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

export interface BuildClientMetadataOptions {
  redirectUrl: string;
  /** Space-separated OAuth scopes. Required for servers that don't advertise
   *  scopes via PRM (gmailmcp.googleapis.com); optional for servers that do
   *  (mcp.notion.com/mcp). */
  scope?: string;
  /**
   * How the client authenticates at the token endpoint:
   *  - `"none"` for public clients (default; what DCR-registered MCP servers expect).
   *  - `"client_secret_basic"` for confidential clients (Google's manually-registered
   *     web-app OAuth clients).
   */
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
}

/**
 * `clientMetadata` for Dynamic Client Registration, or for pre-registered
 * client info stored via `saveClientInformation`. Pass `redirectUrl` so the
 * runtime use of the provider matches the URL that was registered.
 */
export function buildClientMetadata(
  opts: string | BuildClientMetadataOptions,
): OAuthClientMetadata {
  const o: BuildClientMetadataOptions =
    typeof opts === "string" ? { redirectUrl: opts } : opts;

  return {
    client_name: MCP_CLIENT_NAME,
    redirect_uris: [o.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: o.tokenEndpointAuthMethod ?? "none",
    ...(o.scope ? { scope: o.scope } : {}),
  };
}
