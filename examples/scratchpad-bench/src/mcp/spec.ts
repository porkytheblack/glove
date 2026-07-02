/**
 * A single, unified description of a mock service.
 *
 * Each service is declared ONCE as a {@link ServerSpec}: a set of MCP `tools`
 * (real handlers, real input schemas) plus a set of scratchpad `entities` (the
 * same capabilities projected as SQL tables). `buildConnection` turns the tools
 * into a live MCP server; `serverResources` turns the entities into
 * `defineResource` tables whose CRUD verbs call that same server. Both arms of
 * the benchmark therefore run against byte-identical data and identical effects.
 */
import type { z } from "zod";
import { defineResource, makeBindings } from "glove-scratchpad";
import type {
  Bindings,
  ResourceColumn,
  ResourceTable,
  SqlScalar,
  Volatility,
} from "glove-scratchpad";
import type { McpServerConnection } from "glove-mcp";

export type Row = Record<string, unknown>;

/** One MCP tool: name, schema, and a handler returning arbitrary JSON. */
export interface ToolSpec {
  name: string;
  description: string;
  /** Zod raw shape — the MCP server derives the JSON Schema the model sees. */
  input: z.ZodRawShape;
  /** `readOnlyHint`; drives the scratchpad default op (select vs insert). */
  readOnly?: boolean;
  handler: (args: Row) => unknown | Promise<unknown>;
}

export interface EntitySelect {
  tool: string;
  /** Pull the row array out of the tool's JSON (default: the value itself). */
  extract?: (data: unknown) => unknown;
  /** Map pushed-down WHERE bindings → tool arguments (default: column=arg). */
  args?: (b: Bindings) => Row;
  /**
   * For a get-by-key tool exposed as a table: the column to FAN OUT over. When
   * the model writes `WHERE key IN (a, b, c)` the resolver calls the underlying
   * single-fetch tool once per value and unions the rows — so `IN` behaves as a
   * SQL user expects instead of silently resolving only the first value.
   */
  fanOut?: string;
}
export interface EntityInsert {
  tool: string;
  args?: (row: Row) => Row;
}
export interface EntityUpdate {
  tool: string;
  args?: (set: Row, b: Bindings) => Row;
  /** Fan a single-target tool out over `WHERE <col> IN (…)` — one call per value.
   *  Without it, a multi-value match silently updates only the first target. */
  fanOut?: string;
}
export interface EntityDelete {
  tool: string;
  args?: (b: Bindings) => Row;
}

/** True when a binding carries exactly ONE value — a multi-value (IN) binding
 *  must NOT be narrowed to its first value by `b.one`; leave the arg off and let
 *  the surface's residual filter (or a fanOut) handle it. */
export function single(b: Bindings, col: string): boolean {
  return b.has(col) && b.all(col).length === 1;
}

/** One scratchpad table, wired verb-by-verb to the MCP tools above. */
export interface EntitySpec {
  table: string;
  description: string;
  volatility: Volatility;
  columns: ResourceColumn[];
  select?: EntitySelect;
  insert?: EntityInsert;
  update?: EntityUpdate;
  delete?: EntityDelete;
}

export interface ServerSpec {
  namespace: string;
  title: string;
  tools: ToolSpec[];
  entities: EntitySpec[];
}

/** Bound columns → a flat args object (used when an entity gives no `args` map). */
export function bindingsToArgs(b: Bindings): Row {
  const out: Row = {};
  for (const [col] of b.eq) out[col] = b.one(col);
  return out;
}

/** Call an MCP tool and JSON-parse its text content (throwing on tool error). */
export async function callJson(
  conn: McpServerConnection,
  tool: string,
  args: unknown,
): Promise<unknown> {
  const res = await conn.callTool(tool, args);
  const text = (res.content ?? [])
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  if (res.isError) throw new Error(text || `MCP tool ${tool} returned an error`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Project a server's entities into scratchpad resource tables over `conn`. */
export function serverResources(
  spec: ServerSpec,
  conn: McpServerConnection,
): ResourceTable[] {
  return spec.entities.map((e) =>
    defineResource({
      name: e.table,
      description: e.description,
      volatility: e.volatility,
      columns: e.columns,
      ...(e.select && {
        select: async (b: Bindings) => {
          const sel = e.select!;
          const runOne = async (bb: Bindings) => {
            const args = sel.args ? sel.args(bb) : bindingsToArgs(bb);
            const data = await callJson(conn, sel.tool, args);
            return sel.extract ? sel.extract(data) : data;
          };
          // Fan out a get-by-key tool over `WHERE key IN (…)`.
          if (sel.fanOut && b.all(sel.fanOut).length > 1) {
            const out: unknown[] = [];
            for (const v of b.all(sel.fanOut)) {
              const single = makeBindings(new Map<string, SqlScalar[]>([[sel.fanOut, [v]]]));
              const rows = await runOne(single);
              if (Array.isArray(rows)) out.push(...rows);
              else if (rows != null) out.push(rows);
            }
            return out;
          }
          return runOne(b);
        },
      }),
      ...(e.insert && {
        insert: async (rows: Row[]) => {
          const out: unknown[] = [];
          for (const row of rows) {
            const args = e.insert!.args ? e.insert!.args(row) : row;
            out.push(await callJson(conn, e.insert!.tool, args));
          }
          return out;
        },
      }),
      ...(e.update && {
        update: async (set: Row, b: Bindings) => {
          const runOne = async (bb: Bindings) => {
            const args = e.update!.args ? e.update!.args(set, bb) : { ...bindingsToArgs(bb), ...set };
            return callJson(conn, e.update!.tool, args);
          };
          const fo = e.update!.fanOut;
          if (fo && b.all(fo).length > 1) {
            const out: unknown[] = [];
            for (const v of b.all(fo)) {
              out.push(await runOne(makeBindings(new Map<string, SqlScalar[]>([[fo, [v]]]))));
            }
            return out;
          }
          return runOne(b);
        },
      }),
      ...(e.delete && {
        delete: async (b: Bindings) => {
          const args = e.delete!.args ? e.delete!.args(b) : bindingsToArgs(b);
          return callJson(conn, e.delete!.tool, args);
        },
      }),
    }),
  );
}
