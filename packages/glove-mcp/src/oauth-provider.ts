import { randomBytes } from "node:crypto";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { type OAuthStore } from "./oauth-store";

/**
 * Default identity used by `runMcpOAuth` and `McpOAuthProvider` when callers
 * don't supply their own. Shows up as `clientInfo` in the MCP `initialize`
 * request and as `client_name` in DCR / pre-registered client metadata.
 */
export const MCP_DEFAULT_CLIENT_INFO = {
  name: "Glove MCP",
  version: "0.1.0",
};

export interface BuildClientMetadataOptions {
  /** Where the OAuth server should redirect after authorization. */
  redirectUrl: string;
  /** Space-separated OAuth scopes. Required by some servers, ignored by others. */
  scope?: string;
  /**
   * Token-endpoint auth method.
   *  - `"none"` for public clients (DCR-registered MCP servers default).
   *  - `"client_secret_basic"` for confidential clients (Google's manually-
   *    registered web-app OAuth clients).
   */
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
  /** Override the `client_name` reported in the metadata. */
  clientName?: string;
}

/**
 * Build the `clientMetadata` object the MCP SDK needs — for DCR and for
 * pre-registered client info.
 */
export function buildClientMetadata(
  opts: BuildClientMetadataOptions,
): OAuthClientMetadata {
  return {
    client_name: opts.clientName ?? MCP_DEFAULT_CLIENT_INFO.name,
    redirect_uris: [opts.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: opts.tokenEndpointAuthMethod ?? "none",
    ...(opts.scope ? { scope: opts.scope } : {}),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// McpOAuthProvider
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface McpOAuthProviderOptions {
  /** Where to persist state. */
  store: OAuthStore;
  /** Stable string keying this provider's slot in the store. */
  key: string;
  /** Where the OAuth server redirects after authorization. */
  redirectUrl: string;
  /** Sent during DCR or pre-registration. */
  clientMetadata: OAuthClientMetadata;
  /**
   * Invoked when the SDK wants to send the user to the authorize URL.
   *
   * Auth-flow CLIs typically open the user's browser. Agent-runtime providers
   * usually want to *throw* — there's no user there to grant access, the agent
   * should fail loudly and the operator re-runs the auth CLI.
   */
  onAuthorizeUrl: (url: URL) => void | Promise<void>;
}

/**
 * `OAuthClientProvider` implementation backed by an {@link OAuthStore}.
 *
 * The MCP SDK calls each method independently as the OAuth flow progresses;
 * we just round-trip values through the store atomically.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  constructor(private readonly opts: McpOAuthProviderOptions) {}

  // ── interface getters ─────────────────────────────────────────────────────

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.opts.clientMetadata;
  }

  state(): string {
    return randomBytes(24).toString("hex");
  }

  // ── client info ───────────────────────────────────────────────────────────

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const s = await this.opts.store.get(this.opts.key);
    return (s.clientInformation as OAuthClientInformation | null) ?? undefined;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.mutate((s) => {
      s.clientInformation = info;
    });
  }

  // ── tokens ────────────────────────────────────────────────────────────────

  async tokens(): Promise<OAuthTokens | undefined> {
    const s = await this.opts.store.get(this.opts.key);
    return s.tokens ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.mutate((s) => {
      s.tokens = tokens;
    });
  }

  // ── PKCE verifier ─────────────────────────────────────────────────────────

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.mutate((s) => {
      s.codeVerifier = codeVerifier;
    });
  }

  async codeVerifier(): Promise<string> {
    const s = await this.opts.store.get(this.opts.key);
    if (!s.codeVerifier) {
      throw new Error(
        `No PKCE code_verifier saved for "${this.opts.key}". The SDK calls saveCodeVerifier ` +
          `before redirectToAuthorization — if you're seeing this, the auth flow wasn't ` +
          `started by this provider, or the store was tampered with.`,
      );
    }
    return s.codeVerifier;
  }

  // ── redirect ──────────────────────────────────────────────────────────────

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.opts.onAuthorizeUrl(authorizationUrl);
  }

  // ── invalidation ──────────────────────────────────────────────────────────

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    await this.mutate((s) => {
      if (scope === "all") {
        s.clientInformation = null;
        s.tokens = null;
        s.codeVerifier = null;
      }
      if (scope === "client") s.clientInformation = null;
      if (scope === "tokens") s.tokens = null;
      if (scope === "verifier") s.codeVerifier = null;
      // 'discovery' state isn't persisted by this provider — no-op.
    });
  }

  // ── housekeeping ──────────────────────────────────────────────────────────

  /** Wipe all state for this provider's key. */
  async reset(): Promise<void> {
    await this.opts.store.delete(this.opts.key);
  }

  // ── private ───────────────────────────────────────────────────────────────

  private async mutate(fn: (s: import("./oauth-store").OAuthProviderState) => void): Promise<void> {
    const current = await this.opts.store.get(this.opts.key);
    fn(current);
    await this.opts.store.set(this.opts.key, current);
  }
}
