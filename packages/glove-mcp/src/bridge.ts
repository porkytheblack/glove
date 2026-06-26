import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { McpCatalogueEntry } from "./adapter";
import type { McpCallToolResult, McpServerConnection, McpToolDef } from "./connect";
import { UnauthorizedError } from "./connect";

/** Tool namespace separator. Regex-safe across all model providers. */
const NAMESPACE_SEP = "__";

/**
 * Transform a freshly-bridged MCP tool before it's folded onto the agent.
 * The seam `mountMcp` and the discovery `activate` tool use to apply a
 * cross-cutting wrap to every bridged tool — e.g. scratchpad containment
 * (`glove-scratchpad`'s `containingWrap`), logging, or rate-limiting. Receives
 * the bridged tool and the catalogue entry it came from.
 */
export type McpToolWrapper = (
  tool: GloveFoldArgs<unknown>,
  entry: McpCatalogueEntry,
) => GloveFoldArgs<unknown>;

function joinTextContent(content: McpCallToolResult["content"]): string {
  return content
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

function isAuthError(err: unknown): boolean {
  if (err instanceof UnauthorizedError) return true;
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown; status?: unknown }).code;
    const status = (err as { status?: unknown }).status;
    if (code === 401 || status === 401) return true;
    const msg =
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
    if (msg.includes("401") || /unauthori[sz]ed/i.test(msg)) return true;
  }
  return false;
}

/**
 * Bridge a single MCP tool into a `GloveFoldArgs` ready to pass to `glove.fold`.
 *
 * - Tool names are namespaced as `${connection.namespace}__${tool.name}`.
 * - Raw JSON Schema is passed through via `jsonSchema` — the executor skips
 *   local Zod validation; the MCP server is the source of truth.
 * - `requiresPermission` defaults: in `serverMode` always false; otherwise
 *   true unless the tool is annotated `readOnlyHint: true`.
 * - 401-shaped errors during call are mapped to a documented
 *   `{ status: "error", message: "auth_expired" }` result so consumers can
 *   detect token expiry from the conversation log.
 * - Full MCP `content[]` is passed through as `renderData` for React renderers
 *   to use; the model only sees the joined text in `data`.
 */
export function bridgeMcpTool(
  connection: McpServerConnection,
  tool: McpToolDef,
  serverMode: boolean,
): GloveFoldArgs<unknown> {
  const name = `${connection.namespace}${NAMESPACE_SEP}${tool.name}`;
  const description = tool.description ?? `MCP tool ${tool.name}`;

  const requiresPermission = serverMode
    ? false
    : tool.annotations?.readOnlyHint === true
      ? false
      : true;

  return {
    name,
    description,
    jsonSchema: tool.inputSchema,
    requiresPermission,
    async do(input): Promise<ToolResultData> {
      try {
        const result = await connection.callTool(tool.name, input);
        const text = joinTextContent(result.content);

        if (result.isError) {
          return {
            status: "error",
            message: text || `MCP tool ${tool.name} returned an error`,
            data: result.content,
          };
        }

        return {
          status: "success",
          data: text || JSON.stringify(result.content),
          renderData: result.content,
        };
      } catch (err) {
        if (isAuthError(err)) {
          return { status: "error", message: "auth_expired", data: null };
        }
        const message =
          err instanceof Error ? err.message : String(err);
        return { status: "error", message, data: null };
      }
    },
  };
}

export { NAMESPACE_SEP as MCP_NAMESPACE_SEP };
