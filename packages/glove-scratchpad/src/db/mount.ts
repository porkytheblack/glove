/**
 * Mount the database emulator onto a Glove agent: fold `execute_sql` (+
 * `explain_sql`) and prime the model to discover → invoke → act → stage.
 */
import type { IGloveRunnable } from "glove-core/glove";
import type { Database } from "./database";
import { buildExecuteSqlTool, buildExplainSqlTool, type DatabaseToolOptions } from "./surface";

/**
 * Primes the agent to treat its capabilities as a relational database. The
 * cheap, obvious move becomes: walk `information_schema`, then express the answer
 * as one declarative query — composition the engine wires for it.
 */
export const DATABASE_PREAMBLE = `Your capabilities are exposed as a relational DATABASE. You have ONE tool, execute_sql, and you work entirely in SQL (Postgres dialect).

Operating discipline:
- DISCOVER before you act. You are NOT told every capability up front — query the catalog. \`SELECT table_name FROM information_schema.tables\` lists the tables (each is a capability/entity); \`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'X'\` shows a table's columns.
- INVOKE a capability by querying its table. Push arguments through WHERE as equalities — they are inputs, not just filters: \`SELECT url FROM images WHERE prompt = 'a watercolor cat'\`. A "required key" column MUST be equated (explain_sql tells you which); other WHERE clauses filter the returned rows.
- COMPOSE in a single statement. JOIN across tables, use subqueries, or \`INSERT INTO b SELECT … FROM a\` to pipe one capability's output into another. The data flows between tools inside the query — it does NOT round-trip back to you, so prefer one declarative statement over fetch-then-fetch.
- ACT with INSERT / UPDATE / DELETE. To act safely, STAGE first: \`BEGIN;\` then your INSERT/UPDATE/DELETE (nothing fires yet), inspect what is staged, then \`COMMIT\` to fire it in order — or \`ROLLBACK\` to discard it (a dry run).
- PREVIEW with explain_sql when unsure: it reports exactly which tables a query will hit, each one's volatility, and the arguments it resolved — without running anything.

The only data that enters your context is the rows a SELECT returns — so narrow with WHERE / LIMIT and read just what you need.`;

export interface MountDatabaseConfig extends DatabaseToolOptions {
  db: Database;
  /** Prepend {@link DATABASE_PREAMBLE} to the system prompt. Default true. */
  prime?: boolean;
  /** Also fold `explain_sql`. Default true. */
  explain?: boolean;
}

/**
 * Fold the database tool(s) onto a built Glove and prime it. Returns the same
 * runnable.
 */
export function mountDatabase(glove: IGloveRunnable, config: MountDatabaseConfig): IGloveRunnable {
  const { db, prime, explain, ...toolOpts } = config;
  glove.fold(buildExecuteSqlTool(db, toolOpts));
  if (explain !== false) glove.fold(buildExplainSqlTool(db, toolOpts));
  if (prime !== false) {
    const existing = glove.getSystemPrompt();
    glove.setSystemPrompt(existing ? `${DATABASE_PREAMBLE}\n\n${existing}` : DATABASE_PREAMBLE);
  }
  return glove;
}
