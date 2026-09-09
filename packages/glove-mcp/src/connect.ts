import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { sanitizeMcpMetadata, sanitizeMcpText, sanitizeMcpValue } from "./sanitize.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /**
   * JSON Schema for the tool's structured result (MCP 2025-06-18+). Present only
   * when the server declares one; older servers omit it. Consumers render it into
   * a result shape (see `jsonSchemaToShape`) so the model knows the return shape
   * without calling the tool first.
   */
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface McpCallToolResult {
  content: Array<{ type: string; text?: string;[k: string]: unknown }>;
  /**
   * Structured result payload (MCP 2025-06-18+) matching the tool's
   * `outputSchema`. Present only when the server returns one. Preferred over the
   * joined text content when surfacing the result to the model.
   */
  structuredContent?: unknown;
  isError?: boolean;
  /** Sanitized vendor metadata; protocol-reserved namespaces are removed. */
  metadata?: Record<string, unknown>;
}

export interface McpResourceDef {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  [key: string]: unknown;
}

export type McpResourceContent =
  | { uri: string; text: string; mimeType?: string; [key: string]: unknown }
  | { uri: string; blob: string; mimeType?: string; [key: string]: unknown };

export interface McpPromptDef {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  [key: string]: unknown;
}

export interface McpPromptResult {
  description?: string;
  messages: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface McpServerConnection {
  /** Stable namespace, used as the tool name prefix. Matches the entry id. */
  readonly namespace: string;
  /** List tools exposed by the server. */
  listTools(): Promise<McpToolDef[]>;
  /** Call a tool by its un-namespaced name (the name as the server knows it). */
  callTool(name: string, args: unknown): Promise<McpCallToolResult>;
  /** Capabilities negotiated during initialize; utility tools use this gate. */
  readonly capabilities?: {
    readonly resources: boolean;
    readonly prompts: boolean;
    /** Whether the server negotiated `tools.listChanged`. */
    readonly toolsListChanged?: boolean;
  };
  /**
   * Subscribe to negotiated tool-list changes. The handler is invoked after
   * the SDK's debounce, but must call `listTools()` itself so the connection's
   * sanitization and filtering remain authoritative. Returns an unsubscribe.
   */
  onToolsChanged?(handler: () => void | Promise<void>): () => void;
  listResources?(cursor?: string): Promise<{
    resources: McpResourceDef[];
    nextCursor?: string;
    metadata?: Record<string, unknown>;
  }>;
  readResource?(uri: string): Promise<{
    contents: McpResourceContent[];
    metadata?: Record<string, unknown>;
  }>;
  listPrompts?(cursor?: string): Promise<{
    prompts: McpPromptDef[];
    nextCursor?: string;
    metadata?: Record<string, unknown>;
  }>;
  getPrompt?(name: string, args?: Record<string, string>): Promise<McpPromptResult>;
  /** Close the underlying transport. */
  close(): Promise<void>;
  /** Underlying SDK client, for advanced use (resources, prompts). */
  raw: Client;
}

/** A connection created by this package, with every negotiated utility seam present. */
export type ConnectedMcpServerConnection = McpServerConnection & Required<Pick<
  McpServerConnection,
  "capabilities" | "listResources" | "readResource" | "listPrompts" | "getPrompt"
>>;

export interface ConnectMcpAuth {
  headers: () => Promise<Record<string, string>>;
}

export type ConnectMcpTransport =
  | { readonly kind: "http"; readonly url: string }
  | {
      readonly kind: "stdio";
      readonly command: string;
      readonly args?: ReadonlyArray<string>;
      readonly cwd?: string;
      readonly environment?: Readonly<Record<string, string>>;
    };

interface ConnectMcpConfigBase {
  /** Namespace for tool names — produces `${namespace}__${toolName}`. */
  readonly namespace: string;
  /**
   * Static-headers auth, e.g. `bearer(token)`. The framework only does bearer
   * auth — anything more sophisticated (OAuth flow, refresh, etc.) belongs in
   * the consumer's app, which then exposes a refreshed token through
   * `McpAdapter.getAccessToken`.
   */
  readonly auth?: ConnectMcpAuth;
  /** Identify this client to the server. */
  readonly clientInfo?: { name: string; version: string };
  /** Bound transport initialization/handshake time. Default 30 seconds. */
  readonly connectTimeoutMs?: number;
  /** Bound each tools/resources/prompts request. Default 60 seconds. */
  readonly requestTimeoutMs?: number;
  /**
   * Tool names to hide from this connection — exact or glob, un-namespaced names as the
   * server knows them (e.g. `"delete_repository"`, NOT `"github__delete_repository"`).
   * Filtered out of `listTools()`, so an excluded tool is never bridged or
   * mounted by ANY consumer — `mountMcp`, the discovery subagent's `activate`,
   * `glove-scratchpad`'s `mcpResources` / `fnsFromMcp` all read this same
   * listing. The single "don't mount these functions from the server" knob.
   *
   * Only the listing is filtered; `raw` and a direct `callTool(name, …)` are
   * left untouched as an advanced escape hatch.
   */
  readonly excludeTools?: string[];
  /** Exact names or glob patterns. If non-empty, non-matching tools are hidden. */
  readonly includeTools?: string[];
  /**
   * Finer-grained listing filter — return `false` to hide a tool. Runs after
   * the entry's include/exclude selection. When `includeTools` is non-empty it
   * is authoritative; otherwise exclusions are applied. Use this predicate for
   * pattern- or annotation-based rules, e.g. drop every destructive tool:
   * `filterTools: (t) => !t.annotations?.destructiveHint`.
   */
  readonly filterTools?: (tool: McpToolDef) => boolean;
}

export type ConnectMcpConfig = ConnectMcpConfigBase & (
  | { readonly url: string; readonly transport?: never }
  | { readonly url?: never; readonly transport: ConnectMcpTransport }
);

// ─── Tool filtering ──────────────────────────────────────────────────────────

/**
 * Whether a tool survives a connection's selection rules. `includeTools` narrows
 * by exact name or glob, `excludeTools` denies matches, and `filterTools` applies
 * a final predicate. Exported so the semantics are unit-testable and reusable — it
 * is the single gate every consumer's listing passes through.
 */
export function includeTool(
  tool: McpToolDef,
  opts: {
    excludeTools?: Iterable<string> | Set<string>;
    includeTools?: Iterable<string> | Set<string>;
    filterTools?: (tool: McpToolDef) => boolean;
  },
): boolean {
  const excluded = [...(opts.excludeTools ?? [])];
  const included = [...(opts.includeTools ?? [])];
  // An explicit allowlist is authoritative: a match stays visible even if a
  // broad deny glob also matches. This makes a narrow exception possible.
  if (included.length) return included.some((pattern) => matchToolName(tool.name, pattern))
    && (opts.filterTools ? opts.filterTools(tool) !== false : true);
  if (excluded.some((pattern) => matchToolName(tool.name, pattern))) return false;
  return opts.filterTools ? opts.filterTools(tool) !== false : true;
}

function matchToolName(name: string, pattern: string): boolean {
  if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("[")) {
    return name === pattern;
  }
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0) source += "\\[";
      else {
        const body = pattern.slice(index + 1, end);
        const negated = body.startsWith("!");
        const members = negated ? body.slice(1) : body;
        // Tool ids are intentionally conservative. Treat malformed or exotic
        // classes literally rather than compiling attacker-controlled regex.
        if (members && /^[A-Za-z0-9_.-]+$/.test(members)) {
          source += `[${negated ? "^" : ""}${members.replaceAll("\\", "\\\\")}]`;
          index = end;
        } else {
          source += "\\[";
        }
      }
    } else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "u").test(name);
}

// ─── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_CLIENT_INFO = { name: "glove-mcp", version: "0.1.0" };
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 30_000;
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 60_000;

function checkedTimeout(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 2_147_483_647) {
    throw new Error(`${field} must be a positive integer no greater than 2147483647ms.`);
  }
  return resolved;
}

export async function connectMcp(
  config: ConnectMcpConfig,
): Promise<ConnectedMcpServerConnection> {
  const connectTimeoutMs = checkedTimeout(
    config.connectTimeoutMs,
    DEFAULT_MCP_CONNECT_TIMEOUT_MS,
    "connectTimeoutMs",
  );
  const requestTimeoutMs = checkedTimeout(
    config.requestTimeoutMs,
    DEFAULT_MCP_REQUEST_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  const requestOptions = {
    timeout: requestTimeoutMs,
    maxTotalTimeout: requestTimeoutMs,
  } as const;
  const target: ConnectMcpTransport = config.transport ?? { kind: "http", url: config.url };
  const transport = target.kind === "http"
    ? new StreamableHTTPClientTransport(new URL(target.url), {
        requestInit: config.auth ? { headers: await config.auth.headers() } : undefined,
      })
    : new StdioClientTransport({
        command: target.command,
        ...(target.args ? { args: [...target.args] } : {}),
        ...(target.cwd ? { cwd: target.cwd } : {}),
        ...(target.environment
          ? { env: { ...getDefaultEnvironment(), ...target.environment } }
          : {}),
        stderr: "pipe",
      });

  const toolChangeHandlers = new Set<() => void | Promise<void>>();
  const client = new Client(config.clientInfo ?? DEFAULT_CLIENT_INFO, {
    listChanged: {
      tools: {
        autoRefresh: false,
        debounceMs: 100,
        onChanged: () => {
          // A subscriber owns refresh error reporting because it has the
          // entry/runtime context. Settle every handler independently so one
          // consumer cannot block the others or create an unhandled rejection.
          void Promise.allSettled([...toolChangeHandlers].map((handler) => handler()));
        },
      },
    },
  });

  const excluded = new Set(config.excludeTools ?? []);
  const included = new Set(config.includeTools ?? []);
  const filterTools = config.filterTools;
  const exposedToServerName = new Map<string, string>();
  const exposedToServerResourceUri = new Map<string, string>();
  const exposedToServerPromptName = new Map<string, string>();

  try {
    await client.connect(transport, { timeout: connectTimeoutMs, maxTotalTimeout: connectTimeoutMs });
  } catch (err) {
    // Known SDK quirk: connect can throw UnauthorizedError on the first
    // attempt even when the credentials are valid. Retry once.
    if (err instanceof UnauthorizedError) {
      try {
        await client.connect(transport, { timeout: connectTimeoutMs, maxTotalTimeout: connectTimeoutMs });
      } catch (retryError) {
        await client.close().catch(() => transport.close().catch(() => undefined));
        throw retryError;
      }
    } else {
      await client.close().catch(() => transport.close().catch(() => undefined));
      throw err;
    }
  }

  const serverCapabilities = client.getServerCapabilities();
  const capabilities = {
    resources: Boolean(serverCapabilities?.resources),
    prompts: Boolean(serverCapabilities?.prompts),
    toolsListChanged: Boolean(serverCapabilities?.tools?.listChanged),
  } as const;

  return {
    namespace: config.namespace,
    raw: client,
    capabilities,

    onToolsChanged(handler) {
      toolChangeHandlers.add(handler);
      return () => toolChangeHandlers.delete(handler);
    },

    async listTools(): Promise<McpToolDef[]> {
      const result = await client.listTools(undefined, requestOptions);
      exposedToServerName.clear();
      const defs = result.tools.flatMap((t) => {
        // Read defensively via cast: `outputSchema` only exists on SDK types at
        // the 2025-06-18 revision, and servers below it simply omit the field.
        const outputSchema = (t as { outputSchema?: Record<string, unknown> })
          .outputSchema;
        const name = sanitizeMcpText(t.name);
        // Do not let two server-controlled names collapse onto the same
        // exposed tool after sanitization.
        if (!name || exposedToServerName.has(name)) return [];
        exposedToServerName.set(name, t.name);
        return [{
          name,
          description: t.description ? sanitizeMcpText(t.description) : undefined,
          inputSchema: sanitizeMcpValue(t.inputSchema as Record<string, unknown>),
          ...(outputSchema ? { outputSchema: sanitizeMcpValue(outputSchema) } : {}),
          annotations: t.annotations
            ? {
                readOnlyHint: t.annotations.readOnlyHint,
                destructiveHint: t.annotations.destructiveHint,
                idempotentHint: t.annotations.idempotentHint,
              }
            : undefined,
        }];
      });
      // Exclusion happens HERE, at the one listing every consumer reads —
      // mountMcp, discovery `activate`, and the scratchpad bridges all bridge
      // exactly what this returns, so a dropped tool is dropped everywhere.
      if (excluded.size === 0 && included.size === 0 && !filterTools) return defs;
      return defs.filter((d) => includeTool(d, {
        excludeTools: excluded,
        includeTools: included,
        filterTools,
      }));
    },

    async callTool(name: string, args: unknown): Promise<McpCallToolResult> {
      const result = await client.callTool(
        {
          name: exposedToServerName.get(name) ?? name,
          arguments: sanitizeMcpValue((args ?? {}) as Record<string, unknown>),
        },
        undefined,
        requestOptions,
      );
      const structuredContent = (result as { structuredContent?: unknown })
        .structuredContent;
      const metadata = sanitizeMcpMetadata((result as { _meta?: unknown })._meta);
      return {
        content: sanitizeMcpValue((result.content ?? []) as McpCallToolResult["content"]),
        ...(structuredContent !== undefined ? { structuredContent: sanitizeMcpValue(structuredContent) } : {}),
        isError: Boolean(result.isError),
        ...(metadata ? { metadata } : {}),
      };
    },

    async listResources(cursor?: string) {
      const result = await client.listResources(cursor ? { cursor } : undefined, requestOptions);
      const resources = result.resources.flatMap((resource) => {
        const sanitized = sanitizeMcpValue(resource) as McpResourceDef;
        const existing = exposedToServerResourceUri.get(sanitized.uri);
        if (!sanitized.uri || (existing !== undefined && existing !== resource.uri)) return [];
        exposedToServerResourceUri.set(sanitized.uri, resource.uri);
        return [sanitized];
      });
      const metadata = sanitizeMcpMetadata(result._meta);
      return {
        resources,
        ...(result.nextCursor ? { nextCursor: sanitizeMcpText(result.nextCursor) } : {}),
        ...(metadata ? { metadata } : {}),
      };
    },

    async readResource(uri: string) {
      const result = await client.readResource({
        uri: exposedToServerResourceUri.get(uri) ?? uri,
      }, requestOptions);
      const metadata = sanitizeMcpMetadata(result._meta);
      return {
        contents: sanitizeMcpValue(result.contents) as McpResourceContent[],
        ...(metadata ? { metadata } : {}),
      };
    },

    async listPrompts(cursor?: string) {
      const result = await client.listPrompts(cursor ? { cursor } : undefined, requestOptions);
      const prompts = result.prompts.flatMap((prompt) => {
        const sanitized = sanitizeMcpValue(prompt) as McpPromptDef;
        const existing = exposedToServerPromptName.get(sanitized.name);
        if (!sanitized.name || (existing !== undefined && existing !== prompt.name)) return [];
        exposedToServerPromptName.set(sanitized.name, prompt.name);
        return [sanitized];
      });
      const metadata = sanitizeMcpMetadata(result._meta);
      return {
        prompts,
        ...(result.nextCursor ? { nextCursor: sanitizeMcpText(result.nextCursor) } : {}),
        ...(metadata ? { metadata } : {}),
      };
    },

    async getPrompt(name: string, args?: Record<string, string>) {
      const result = await client.getPrompt({
        name: exposedToServerPromptName.get(name) ?? name,
        ...(args ? { arguments: sanitizeMcpValue(args) } : {}),
      }, requestOptions);
      const metadata = sanitizeMcpMetadata(result._meta);
      return {
        ...(result.description ? { description: sanitizeMcpText(result.description) } : {}),
        messages: sanitizeMcpValue(result.messages) as Array<Record<string, unknown>>,
        ...(metadata ? { metadata } : {}),
      };
    },

    async close() {
      toolChangeHandlers.clear();
      await client.close();
    },
  };
}

/** Re-exported so consumers branching on auth errors can detect them. */
export { UnauthorizedError };
