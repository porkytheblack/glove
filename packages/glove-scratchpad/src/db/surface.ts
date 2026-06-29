/**
 * The single capability surface: `execute_sql` (and `explain_sql`).
 *
 * The model never sees the underlying tools — it sees a schema and writes SQL.
 * One tool parses each statement down to the resource operations beneath it.
 */
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { Database } from "./database";

export interface DatabaseToolOptions {
  /** Stamped into resolver context as the actor. */
  actor?: string;
  /** Row cap returned to the model. Default 50. */
  defaultLimit?: number;
  /**
   * Allow immediate (non-transactional) writes through `execute_sql`. Default
   * false — the model stages writes with BEGIN … COMMIT. (A read-only Database
   * rejects writes regardless of this flag.)
   */
  allowWrites?: boolean;
}

const inputSchema = z.object({
  sql: z
    .string()
    .describe(
      "ONE Postgres statement (or a BEGIN … COMMIT/ROLLBACK transaction script). SELECT to read; INSERT/UPDATE/DELETE to act. Pass tool arguments as WHERE equalities.",
    ),
  params: z.array(z.unknown()).optional().describe("Values for $1, $2 … placeholders."),
});

function errResult(err: unknown): ToolResultData {
  return { status: "error", message: err instanceof Error ? err.message : String(err), data: null };
}

export function buildExecuteSqlTool(
  db: Database,
  opts: DatabaseToolOptions = {},
): GloveFoldArgs<{ sql: string; params?: unknown[] }> {
  return {
    name: "execute_sql",
    description:
      "Run SQL against your capability database (Postgres dialect). Your tools ARE tables. " +
      "DISCOVER: `SELECT table_name FROM information_schema.tables`, then " +
      "`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '…'`. " +
      "INVOKE a capability by querying its table; push arguments as WHERE equalities " +
      "(required-key columns must be equated, e.g. `SELECT url FROM images WHERE prompt = 'a cat'`). " +
      "COMPOSE across tools in one statement (JOIN / subquery / INSERT … SELECT) — no intermediate results return to you. " +
      "ACT with INSERT/UPDATE/DELETE; STAGE outbound effects with `BEGIN; INSERT …;` then COMMIT, or ROLLBACK for a dry run.",
    inputSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const r = await db.execute(input.sql, {
          params: input.params,
          actor: opts.actor,
          limit: opts.defaultLimit,
          allowWrites: opts.allowWrites,
          signal,
        });
        return {
          status: "success",
          data: {
            rows: r.rows,
            truncated: r.truncated,
            touched: r.touched,
            ...(r.committed !== undefined ? { committed: r.committed } : {}),
            ...(r.staged ? { staged: r.staged } : {}),
            ...(r.message ? { message: r.message } : {}),
          },
        };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

export function buildExplainSqlTool(
  db: Database,
  opts: DatabaseToolOptions = {},
): GloveFoldArgs<{ sql: string; params?: unknown[] }> {
  return {
    name: "explain_sql",
    description:
      "Preview which tables/tools a SQL statement would hit (with each one's volatility, read/write access, and resolved arguments) WITHOUT running it. Use it to validate a query — especially required-key columns — before execute_sql.",
    inputSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const plan = await db.explain(input.sql, { params: input.params, actor: opts.actor, signal });
        return { status: "success", data: plan };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}
