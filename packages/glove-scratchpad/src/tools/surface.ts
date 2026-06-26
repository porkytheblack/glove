/**
 * The manipulation surface as Glove tools (§6, §9).
 *
 * The four tools a subagent uses to work the store without dragging payloads
 * through context — three verbs (describe / query / materialize) plus an
 * enumerator (list):
 *
 *   - `scratchpad_describe` — read the metadata surface of a reference (shape,
 *     preview, provenance). Reasoning over descriptors, not values.
 *   - `scratchpad_query`    — the deterministic ALU. Narrow with SQL; persist
 *     the result as a new reference (`store`) to keep it as a handle, or read
 *     bounded rows for a quick check.
 *   - `scratchpad_materialize` — the last mile. The explicit, budgeted load
 *     that puts real values into context (§9 "no transparent materialization").
 *   - `scratchpad_list`     — enumerate references currently in the store.
 *
 * Every subagent *can* call all of these (§8.1 "reading is universal"); they are
 * primed to defer materialization to the last mile.
 */
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { Scratchpad } from "../core/scratchpad";

export interface ScratchpadToolOptions {
  /** Stamped into provenance as the actor (e.g. the subagent's name). */
  actor?: string;
  /** Default row cap for read-mode query / materialize. Default 50. */
  defaultLimit?: number;
  /** Default preview rows in descriptors. Default 5. */
  defaultPreviewRows?: number;
}

function errResult(err: unknown): ToolResultData {
  const message = err instanceof Error ? err.message : String(err);
  return { status: "error", message, data: null };
}

export function buildDescribeTool(
  sp: Scratchpad,
  opts: ScratchpadToolOptions = {},
): GloveFoldArgs<{ ref: string; previewRows?: number }> {
  return {
    name: "scratchpad_describe",
    description:
      "Inspect a stored record by reference: its columns + types, row count, a small preview, child tables, and provenance — without pulling the full payload into context. Plan your query against this shape.",
    inputSchema: z.object({
      ref: z.string().describe("The reference (root table name) to describe."),
      previewRows: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("How many preview rows to include. Default 5."),
    }),
    async do(input): Promise<ToolResultData> {
      try {
        const d = await sp.describe(
          input.ref,
          input.previewRows ?? opts.defaultPreviewRows ?? 5,
        );
        return { status: "success", data: d };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

export function buildQueryTool(
  sp: Scratchpad,
  opts: ScratchpadToolOptions = {},
): GloveFoldArgs<{ sql: string; store?: string; limit?: number; previewRows?: number }> {
  return {
    name: "scratchpad_query",
    description:
      "Run a Postgres-dialect query over stored records (SELECT / WHERE / JOIN / GROUP BY / CTEs; nested depth via -> / ->>). " +
      "Pass `store` to persist the result as a NEW reference and get back a stub (shape only) — the preferred way to narrow data for a downstream step without materializing it. " +
      "Omit `store` to read back a bounded set of rows for a quick check.",
    inputSchema: z.object({
      sql: z
        .string()
        .describe(
          "Postgres SQL. Read FROM the table names shown in a record's descriptor. Root tables have a `_rid` primary key; child tables join on `_parent = _rid` and order by `_idx`.",
        ),
      store: z
        .string()
        .optional()
        .describe(
          "Persist the result as a new record under this readable name and return a stub instead of rows. Use when narrowing for a later step.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max rows returned in read mode (ignored when `store` is set). Default 50."),
      previewRows: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Preview rows in the returned stub when `store` is set. Default 5."),
    }),
    async do(input): Promise<ToolResultData> {
      try {
        const result = await sp.query(input.sql, {
          store: input.store,
          limit: input.limit ?? opts.defaultLimit ?? 50,
          previewRows: input.previewRows ?? opts.defaultPreviewRows ?? 5,
          provenance: { actor: opts.actor },
        });
        return { status: "success", data: result };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

export function buildMaterializeTool(
  sp: Scratchpad,
  opts: ScratchpadToolOptions = {},
): GloveFoldArgs<{ ref?: string; sql?: string; limit?: number; offset?: number }> {
  return {
    name: "scratchpad_materialize",
    description:
      "THE LAST MILE — read actual values into context. Use this only when you genuinely need the data (to answer, format, or decide on content). Bounded by `limit`; page with `offset`. Prefer scratchpad_query(store) to narrow first, then materialize the small result.",
    inputSchema: z.object({
      ref: z.string().optional().describe("Materialize an entire stored record by reference."),
      sql: z
        .string()
        .optional()
        .describe("Or materialize the rows of a read-only SELECT / CTE. Mutually exclusive with `ref`."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max rows to read. Default 50."),
      offset: z.number().int().min(0).optional().describe("Skip this many rows (paging)."),
    }),
    async do(input): Promise<ToolResultData> {
      try {
        const result = await sp.materialize({
          ref: input.ref,
          sql: input.sql,
          limit: input.limit ?? opts.defaultLimit ?? 50,
          offset: input.offset,
        });
        return { status: "success", data: result };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

export function buildListTool(
  sp: Scratchpad,
  _opts: ScratchpadToolOptions = {},
): GloveFoldArgs<Record<string, never>> {
  return {
    name: "scratchpad_list",
    description:
      "List every record currently in the scratchpad: reference, kind, row count, columns, and provenance. Shapes only — no payloads.",
    inputSchema: z.object({}),
    async do(): Promise<ToolResultData> {
      try {
        const records = await sp.list();
        return { status: "success", data: { records } };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

/** All four surface tools, ready to fold onto a subagent. */
export function scratchpadTools(
  sp: Scratchpad,
  opts: ScratchpadToolOptions = {},
): GloveFoldArgs<unknown>[] {
  return [
    buildDescribeTool(sp, opts),
    buildQueryTool(sp, opts),
    buildMaterializeTool(sp, opts),
    buildListTool(sp, opts),
  ] as GloveFoldArgs<unknown>[];
}
