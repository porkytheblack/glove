// Subpath barrel: `import { ... } from "glove-mcp/oauth"`.
//
// Everything an application needs to drive the MCP authorization spec
// OAuth flow without rolling its own provider.

export {
  emptyOAuthState,
  FsOAuthStore,
  MemoryOAuthStore,
  type OAuthProviderState,
  type OAuthStore,
} from "./oauth-store";

export {
  buildClientMetadata,
  MCP_DEFAULT_CLIENT_INFO,
  McpOAuthProvider,
  type BuildClientMetadataOptions,
  type McpOAuthProviderOptions,
} from "./oauth-provider";

export {
  runMcpOAuth,
  type PreRegisteredClient,
  type RunMcpOAuthOptions,
  type RunMcpOAuthResult,
  type McpOAuthVerify,
} from "./oauth-runner";

// Re-exported from the SDK so consumers don't need a direct dependency on it
// just to type their providers / tokens.
export type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
