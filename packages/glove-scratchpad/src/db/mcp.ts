/**
 * MCP → resource tables.
 *
 * "Most MCP tools are CRUD over some resource type" — so decompose a server into
 * resources and give each a table. `list_pull_requests` → `github_pr` (read);
 * `create_issue` → `linear_issue` (insert). Compose across servers in one
 * statement: `INSERT INTO linear_issue SELECT … FROM github_pr WHERE merged`.
 *
 * `glove-mcp` is an OPTIONAL peer dependency — this subpath only resolves when
 * you've added it yourself (like `glove-scratchpad/pglite`).
 */
import { bridgeMcpTool } from "glove-mcp";
import type { McpServerConnection, McpToolDef } from "glove-mcp";
import type { Database } from "./database";
import { resourceFromTool, type ResourceFromToolSpec } from "./resource";
import type { ResourceTable } from "./provider";

export interface McpResourceSpec {
  /** Passed to `bridgeMcpTool`. Default true (headless — never gate on permission). */
  serverMode?: boolean;
  /**
   * Map an MCP tool to a resource. Return a partial spec to override the
   * defaults (name / op / columns / volatility), or `null` to skip the tool.
   * MCP descriptions rarely give clean column lists, so declaring `columns`
   * (and a `rows` extractor) here is how you make a server's data queryable
   * beyond the default single `result` column.
   */
  table?: (tool: McpToolDef) => (Partial<ResourceFromToolSpec> & { name?: string }) | null;
}

/** Bridge every tool a connection exposes and turn each into a {@link ResourceTable}. */
export async function mcpResources(
  conn: McpServerConnection,
  spec: McpResourceSpec = {},
): Promise<ResourceTable[]> {
  const serverMode = spec.serverMode ?? true;
  const defs = await conn.listTools();
  const out: ResourceTable[] = [];
  for (const def of defs) {
    const override = spec.table ? spec.table(def) : {};
    if (override === null) continue;
    const bridged = bridgeMcpTool(conn, def, serverMode);
    const readOnly = (def as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true;
    const resolved: ResourceFromToolSpec = {
      name: override?.name ?? def.name,
      description: override?.description ?? def.description,
      volatility: override?.volatility ?? (readOnly ? "stable" : "volatile"),
      op: override?.op ?? (readOnly ? "select" : "insert"),
      // Default: a single `result` column capturing the tool's (text) output.
      // Declare `columns` via `spec.table` to make structured data queryable.
      columns: override?.columns ?? [{ name: "result", type: "text", description: "Tool result." }],
      inputs: override?.inputs,
      rows:
        override?.rows ??
        ((d: unknown) => [{ result: typeof d === "string" ? d : JSON.stringify(d) }]),
      buildInput: override?.buildInput,
    };
    out.push(resourceFromTool(bridged, resolved));
  }
  return out;
}

/** {@link mcpResources} + register them on a {@link Database}. Returns the table names. */
export async function mountMcpDatabase(
  db: Database,
  conn: McpServerConnection,
  spec: McpResourceSpec = {},
): Promise<string[]> {
  const resources = await mcpResources(conn, spec);
  for (const r of resources) db.register(r);
  return resources.map((r) => r.name);
}
