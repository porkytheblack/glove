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
- DISCOVER before you act. The tables are listed below (each is a capability/entity). To see a table's columns: \`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'X'\`. Reference tables by their bare name (\`linear_issues\`), never schema-qualified (\`public.linear_issues\`).
- INVOKE a capability by querying its table. Push arguments through WHERE as equalities — they are inputs, not just filters: \`SELECT url FROM images WHERE prompt = 'a watercolor cat'\`. A "required key" column MUST be equated (explain_sql tells you which); other WHERE clauses filter the returned rows.
- COMPOSE in a single statement. JOIN across tables, use subqueries, or \`INSERT INTO b SELECT … FROM a\` to pipe one capability's output into another. The data flows between tools inside the query — it does NOT round-trip back to you, so prefer one declarative statement over fetch-then-fetch.
- BE DECISIVE — answer with as FEW queries as possible. Prefer ONE query that computes the result (COUNT, SUM, GROUP BY, JOIN) over many small ones. Once a query returns the data you need, STOP and give the answer. If a query errors, read the message, change only the ONE thing it names, and retry — do not re-run the same query or thrash between tables.
- ACT with INSERT / UPDATE / DELETE. A SINGLE write can be run on its own — it fires immediately and returns a confirmation. Use \`BEGIN; … COMMIT\` ONLY to stage/preview SEVERAL writes together; if you open \`BEGIN\` you must close it with \`COMMIT\` (fire) or \`ROLLBACK\` (discard) before running anything else.
- DO NOT re-read to verify a write. These tables are LIVE VIEWS of upstream services: a row you INSERT (a sent email, a created issue) will NOT appear in a later SELECT of that table. The write's success message is authoritative — trust it and move on.
- PREVIEW with explain_sql when unsure: it reports exactly which tables a query will hit, each one's volatility, and the arguments it resolved — without running anything.

The only data that enters your context is the rows a SELECT returns — so narrow with WHERE / LIMIT and read just what you need.`;

/** A compact "here are your tables" catalog line, primed so the model needn't
 *  spend a round-trip listing them (and can't guess a wrong table name). */
function catalogHint(db: Database): string {
  const tables = db.catalog.list();
  if (tables.length === 0) return "";
  const lines = tables.map((t) => `- ${t.name}: ${t.description ?? t.name}`);
  return `\n\nTables available to you:\n${lines.join("\n")}`;
}

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
    const preamble = DATABASE_PREAMBLE + catalogHint(db);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
