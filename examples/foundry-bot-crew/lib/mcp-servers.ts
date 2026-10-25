import { fileURLToPath } from "node:url";
import type { FoundryAppMcpTool, FoundryAppToolDecision } from "glove-foundry";
import { readAccount, type AccountSession } from "./accounts.js";
import { dataDir } from "./paths.js";

// Where each app's MCP server is. A connected account uses the provider's
// hosted server with the person's token. A sample (offline) account starts a
// local server with the same tool names over sample data, so `pnpm verify`
// and `pnpm dev` run without a provider.

const SERVERS = {
  gmail: {
    name: "Gmail",
    description: "Search, read and draft mail in the person's Gmail",
    url: () => process.env.GMAIL_MCP_URL ?? "https://gmailmcp.googleapis.com/mcp/v1",
  },
  linear: {
    name: "Linear",
    description: "Find, file and update issues in the person's Linear workspace",
    url: () => process.env.LINEAR_MCP_URL ?? "https://mcp.linear.app/mcp",
  },
} as const;

export type McpApp = keyof typeof SERVERS;

/** The installation's account decides: the provider's server, or the local one for a sample account. */
export function mcpServer(app: McpApp) {
  return async ({ accountId }: { readonly accountId?: string }) => {
    const server = SERVERS[app];
    const account = accountId ? await readAccount(accountId) : undefined;
    if (!account?.offline) return { name: server.name, description: server.description, url: server.url() };
    return {
      name: server.name,
      description: `${server.description} (offline sample data)`,
      transport: {
        kind: "stdio" as const,
        command: process.execPath,
        args: ["--import", "tsx", fileURLToPath(new URL(`../demo/${app}-mcp.ts`, import.meta.url))],
        cwd: fileURLToPath(new URL("..", import.meta.url)),
      },
      connectTimeoutMs: 20_000,
    };
  };
}

/** The person's token as a bearer header, or, offline, whose sample mailbox to open. */
export function mcpCredentials() {
  return (session: unknown): Record<string, string> => {
    const { accessToken, account } = session as AccountSession;
    return account.offline
      ? { DEMO_ACCOUNT: account.metadata.email ?? account.externalAccountId, DEMO_DATA_DIR: dataDir }
      : { authorization: `Bearer ${accessToken}` };
  };
}

/**
 * The person decides what a tool may do without asking. Reads run; anything
 * else asks first, unless the person chose "Always allow" for it, which is a
 * write to the installation's config. Servers that don't mark their reads
 * are covered by `reads`.
 */
export function askUnlessAllowed(reads: ReadonlyArray<string>) {
  return (tool: FoundryAppMcpTool, { config }: { readonly config: { readonly alwaysAllow: ReadonlyArray<string> } }): FoundryAppToolDecision =>
    tool.readOnly || reads.includes(tool.name) || config.alwaysAllow.includes(tool.name) ? "allow" : "ask";
}
