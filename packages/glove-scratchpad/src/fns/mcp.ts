/**
 * MCP → functions. One server, one call: every tool the connection exposes
 * becomes a {@link ToolFn} named `namespace__tool`, its own input schema as the
 * contract. This is the on-the-fly path — no columns, no per-tool table specs;
 * mount the result on any fn-mode surface and the model discovers the rest
 * in-band.
 *
 * `glove-mcp` is an OPTIONAL peer dependency — this subpath only resolves when
 * you've added it yourself (like `glove-scratchpad/mcp`).
 */
import { bridgeMcpTool } from "glove-mcp";
import type { McpServerConnection, McpToolDef } from "glove-mcp";
import type { ToolFn } from "./catalog";
import { fnFromTool } from "./from-tool";

export interface FnsFromMcpOptions {
  /** Passed to `bridgeMcpTool`. Default true (headless — never gate on permission). */
  serverMode?: boolean;
  /**
   * Skip or rename tools. Return `null` to skip, a string to use as the FULL
   * callable name (no namespace is re-applied), or `undefined` to keep the
   * default `namespace__tool` name. Also the escape hatch when a tool's name
   * collides with a surface's stdlib/globals.
   */
  filter?: (tool: McpToolDef) => string | null | undefined;
  /** Override result parsing. Default: JSON-parse text that looks like JSON. */
  parse?: (data: unknown) => unknown;
}

/** Bridge every tool a connection exposes into {@link ToolFn}s. */
export async function fnsFromMcp(
  conn: McpServerConnection,
  opts: FnsFromMcpOptions = {},
): Promise<ToolFn[]> {
  const serverMode = opts.serverMode ?? true;
  const defs = await conn.listTools();
  const out: ToolFn[] = [];
  for (const def of defs) {
    const renamed = opts.filter ? opts.filter(def) : undefined;
    if (renamed === null) continue;
    const bridged = bridgeMcpTool(conn, def, serverMode);
    out.push(
      fnFromTool(bridged, {
        ...(renamed !== undefined ? { name: renamed } : {}),
        readOnlyHint: def.annotations?.readOnlyHint === true ? true : undefined,
        parse: opts.parse,
      }),
    );
  }
  return out;
}
