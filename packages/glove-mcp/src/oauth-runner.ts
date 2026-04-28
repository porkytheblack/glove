import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, type AuthResult } from "@modelcontextprotocol/sdk/client/auth.js";

import { type OAuthStore } from "./oauth-store";
import {
  McpOAuthProvider,
  buildClientMetadata,
  MCP_DEFAULT_CLIENT_INFO,
} from "./oauth-provider";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PreRegisteredClient {
  client_id: string;
  /** Optional — present for confidential clients. */
  client_secret?: string;
}

export type McpOAuthVerify =
  | false
  | { type: "listTools" }
  | { type: "callTool"; name: string; arguments?: Record<string, unknown> };

export interface RunMcpOAuthOptions {
  /** MCP server URL. */
  serverUrl: string;
  /** Where to persist OAuth state. */
  store: OAuthStore;
  /** Key under which this server's state lives in the store (e.g. "notion"). */
  key: string;

  /** MCP `clientInfo` (sent in `initialize`). Defaults to `MCP_DEFAULT_CLIENT_INFO`. */
  clientInfo?: { name: string; version: string };

  /** Local port for the OAuth callback listener. Default `53683`. */
  port?: number;
  /** Override the redirect URL. Default `http://localhost:${port}/callback`. */
  redirectUrl?: string;

  /**
   * Pre-registered OAuth client. Provide this for servers that don't support
   * Dynamic Client Registration (e.g. Google's hosted MCP). `client_id` is
   * pre-seeded in the store; the SDK skips DCR.
   */
  preRegisteredClient?: PreRegisteredClient;

  /** Space-separated OAuth scopes. */
  scope?: string;

  /**
   * Token-endpoint auth method. Defaults:
   *  - `"none"` when there's no `preRegisteredClient.client_secret` (DCR / public).
   *  - `"client_secret_basic"` when a client_secret is supplied.
   */
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";

  /** Hook called when the SDK wants to send the user to the authorize URL.
   *  Default: opens the user's browser via `open` / `xdg-open` / `start`. */
  onAuthorizeUrl?: (url: URL) => void | Promise<void>;
  /** Hook called with progress messages. Default: writes to stdout. */
  onProgress?: (msg: string) => void;

  /** Verify the saved tokens by calling against the server. Default
   *  `{ type: "listTools" }`. Set to `false` to skip. */
  verify?: McpOAuthVerify;

  /** Callback timeout. Default 5 minutes. */
  timeoutMs?: number;
}

export interface RunMcpOAuthResult {
  /** `"AUTHORIZED"` after a fresh flow, or `"ALREADY_AUTHORIZED"` if existing
   *  tokens were valid and the SDK didn't need to redirect. */
  status: "AUTHORIZED" | "ALREADY_AUTHORIZED";
  /** Number of tools advertised after auth (if `verify.type === "listTools"`). */
  toolCount?: number;
  /** Raw result of the verify tool call (if `verify.type === "callTool"`). */
  verifyResult?: unknown;
  /** The redirect URL we listened on — handy for printing. */
  redirectUrl: string;
}

/**
 * Run the MCP authorization spec OAuth flow end-to-end.
 *
 * 1. Spins up a local HTTP listener for the callback.
 * 2. (optional) Pre-seeds `clientInformation` so the SDK skips DCR.
 * 3. Calls the SDK's `auth()` to discover OAuth metadata + redirect.
 * 4. The user's browser opens, they grant access, OAuth server redirects
 *    to `http://localhost:${port}/callback?code=...`.
 * 5. Exchanges code for tokens via `auth({ authorizationCode })`.
 * 6. Verifies (optional) by listing tools or calling a specific tool.
 *
 * Throws on any failure.
 */
export async function runMcpOAuth(
  opts: RunMcpOAuthOptions,
): Promise<RunMcpOAuthResult> {
  const port = opts.port ?? 53683;
  const redirectUrl = opts.redirectUrl ?? `http://localhost:${port}/callback`;
  const log = opts.onProgress ?? defaultProgress;
  const onAuthorizeUrl = opts.onAuthorizeUrl ?? defaultOnAuthorizeUrl(log);
  const clientInfo = opts.clientInfo ?? MCP_DEFAULT_CLIENT_INFO;
  const tokenEndpointAuthMethod =
    opts.tokenEndpointAuthMethod ??
    (opts.preRegisteredClient?.client_secret ? "client_secret_basic" : "none");

  const provider = new McpOAuthProvider({
    store: opts.store,
    key: opts.key,
    redirectUrl,
    clientMetadata: buildClientMetadata({
      redirectUrl,
      scope: opts.scope,
      tokenEndpointAuthMethod,
      clientName: clientInfo.name,
    }),
    onAuthorizeUrl,
  });

  // Wipe any half-completed state so re-running auth always starts clean.
  await provider.reset();

  if (opts.preRegisteredClient) {
    await provider.saveClientInformation({
      client_id: opts.preRegisteredClient.client_id,
      ...(opts.preRegisteredClient.client_secret
        ? { client_secret: opts.preRegisteredClient.client_secret }
        : {}),
      client_name: clientInfo.name,
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      ...(opts.scope ? { scope: opts.scope } : {}),
    });
  }

  // Listener up first, so a fast user can't beat us to /callback.
  const callbackPromise = awaitCallback(port, opts.timeoutMs ?? 5 * 60 * 1000);

  // Drive auth() directly. The transport-based "let connect throw 401" flow
  // works for some servers (mcp.notion.com) but not others (gmailmcp.googleapis.com
  // returns 200 to unauthenticated initialize). Going through auth() directly
  // works for both.
  let initial: AuthResult;
  try {
    initial = await auth(provider, { serverUrl: opts.serverUrl });
  } catch (err) {
    closeQuietly(callbackPromise);
    throw new Error(
      `OAuth discovery / setup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (initial === "AUTHORIZED") {
    closeQuietly(callbackPromise);
    return {
      status: "ALREADY_AUTHORIZED",
      redirectUrl,
    };
  }

  // Wait for the user to grant access.
  let cb: CallbackResult;
  try {
    cb = await callbackPromise;
  } catch (err) {
    throw new Error(
      `OAuth flow aborted: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  log("Received authorization code. Exchanging for an access token...");

  let final: AuthResult;
  try {
    final = await auth(provider, {
      serverUrl: opts.serverUrl,
      authorizationCode: cb.code,
    });
  } catch (err) {
    throw new Error(
      `OAuth token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (final !== "AUTHORIZED") {
    throw new Error(`OAuth returned unexpected result: ${final}`);
  }

  // Verify
  const verify = opts.verify ?? { type: "listTools" };
  let toolCount: number | undefined;
  let verifyResult: unknown;
  if (verify) {
    const transport = new StreamableHTTPClientTransport(new URL(opts.serverUrl), {
      authProvider: provider,
    });
    const client = new Client(clientInfo);
    try {
      await client.connect(transport);
      if (verify.type === "listTools") {
        const r = await client.listTools();
        toolCount = r.tools.length;
      } else {
        verifyResult = await client.callTool({
          name: verify.name,
          arguments: verify.arguments ?? {},
        });
      }
    } finally {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
  }

  return {
    status: "AUTHORIZED",
    toolCount,
    verifyResult,
    redirectUrl,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internals
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface CallbackResult {
  code: string;
  state: string | null;
}

interface ClosablePromise<T> extends Promise<T> {
  __close?: () => void;
}

function awaitCallback(port: number, timeoutMs: number): ClosablePromise<CallbackResult> {
  let cleanup: () => void = () => {};
  const promise = new Promise<CallbackResult>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        respondHtml(res, 400, "Authorization failed", [
          `<p>OAuth server returned <code>${escapeHtml(oauthError)}</code>.</p>`,
          "<p>You can close this tab and re-run the auth command.</p>",
        ]);
        cleanup();
        reject(new Error(`Authorization denied: ${oauthError}`));
        return;
      }

      if (!code) {
        respondHtml(res, 400, "Missing code", [
          "<p>Callback did not include an authorization code.</p>",
        ]);
        cleanup();
        reject(new Error("Callback received without `code` parameter."));
        return;
      }

      respondHtml(res, 200, "Connected", [
        '<p style="font-size:1.1rem">✅ <strong>Access granted.</strong></p>',
        "<p>You can close this tab and return to the terminal.</p>",
      ]);
      cleanup();
      resolve({ code, state });
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for callback.`));
    }, timeoutMs);

    cleanup = () => {
      clearTimeout(timer);
      server.close();
    };

    server.on("error", (err) => {
      cleanup();
      reject(err);
    });

    server.listen(port, "127.0.0.1");
  }) as ClosablePromise<CallbackResult>;

  promise.__close = () => cleanup();
  return promise;
}

function closeQuietly<T>(p: ClosablePromise<T>): void {
  try {
    p.__close?.();
  } catch {
    // ignore
  }
  // Swallow rejection if the timer / listener resolves later.
  p.catch(() => {});
}

function defaultProgress(msg: string): void {
  // eslint-disable-next-line no-console
  process.stdout.write(msg.endsWith("\n") ? msg : `${msg}\n`);
}

function defaultOnAuthorizeUrl(log: (msg: string) => void): (url: URL) => void {
  return (url: URL) => {
    log(
      [
        "",
        "Opening authorization page in your browser. If it doesn't open,",
        "copy this URL into a browser yourself:",
        "",
        `  ${url.toString()}`,
        "",
        "Waiting for you to grant access...",
        "",
      ].join("\n"),
    );
    openInBrowser(url.toString());
  };
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    // best-effort; URL also printed to stdout
  });
}

function respondHtml(
  res: ServerResponse,
  status: number,
  title: string,
  body: string[],
): void {
  const html =
    "<!doctype html><html><head>" +
    `<meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    '<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#222;}code{background:#eee;padding:.1em .3em;border-radius:.25em;}</style>' +
    "</head><body>" +
    `<h1>${escapeHtml(title)}</h1>` +
    body.join("\n") +
    "</body></html>";
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
