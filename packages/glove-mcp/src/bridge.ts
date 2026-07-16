import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { McpCatalogueEntry } from "./adapter";
import type { McpCallToolResult, McpServerConnection, McpToolDef } from "./connect";
import { UnauthorizedError } from "./connect";
import { jsonSchemaToShape } from "./shape";

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
 * - When the server declares an `outputSchema` (MCP 2025-06-18+), a compact
 *   `Returns: …` shape is appended to the description so the model knows the
 *   return shape up front. Model tool-call wire formats are input-only, so the
 *   description is the only channel to surface it on the plain bridged path.
 * - `requiresPermission` defaults: in `serverMode` always false; otherwise
 *   true unless the tool is annotated `readOnlyHint: true`.
 * - 401-shaped errors during call are mapped to a documented
 *   `{ status: "error", message: "auth_expired" }` result so consumers can
 *   detect token expiry from the conversation log.
 * - The model sees the server's `structuredContent` when present (MCP
 *   2025-06-18+), else the joined text, in `data`. Full MCP `content[]` is
 *   always passed through as `renderData` for React renderers to use.
 */
export function bridgeMcpTool(
  connection: McpServerConnection,
  tool: McpToolDef,
  serverMode: boolean,
): GloveFoldArgs<unknown> {
  const name = `${connection.namespace}${NAMESPACE_SEP}${tool.name}`;
  const baseDescription = tool.description ?? `MCP tool ${tool.name}`;
  const shape = tool.outputSchema ? jsonSchemaToShape(tool.outputSchema) : undefined;
  const description = shape ? `${baseDescription}\n\nReturns: ${shape}` : baseDescription;

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

        // Prefer the server's structured result when present: the model sees
        // typed data matching the tool's outputSchema instead of re-parsing
        // joined text. Fall back to text (then raw content) otherwise.
        const data =
          result.structuredContent !== undefined
            ? JSON.stringify(result.structuredContent)
            : text || JSON.stringify(result.content);

        return {
          status: "success",
          data,
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
