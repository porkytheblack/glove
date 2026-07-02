/**
 * The three arms under test, built over the SAME mock org and model:
 *
 *   - "baseline": every MCP tool from all ten servers folded directly into the
 *     agent (the realistic "I connected 10 MCP servers" setup). All ~32 tool
 *     schemas live in context; every result streams back verbatim.
 *   - "scratchpad": a single `execute_sql` tool (+ `explain_sql`) over the same
 *     capabilities exposed as SQL tables. The model discovers via
 *     information_schema and only the rows a SELECT returns enter context.
 *   - "lisp": a single `execute_lisp` tool (+ `explain_lisp`) over the same
 *     capabilities exposed as functions in a persistent Clojure-flavored REPL.
 *     Only the last form's (elided) value enters context; `def` keeps
 *     intermediates in the session; branching composes inside one program.
 */
import { Glove, Displaymanager, MemoryStore, type ModelAdapter } from "glove-core";
import { Database } from "glove-scratchpad";
import { bridgeMcpTool } from "glove-mcp";
import { mountDatabase } from "glove-scratchpad";
import { LispSession, mountLisp } from "glove-lisp";
import type { MockOrg } from "../mcp/index";
import { totalToolCount } from "../mcp/index";
import { BenchSubscriber } from "./instrument";

export type ArmName = "baseline" | "scratchpad" | "lisp" | "both";

export interface ArmConfig {
  maxTurns: number;
  compactionContextLimit: number;
  echo?: boolean;
  /** false = BARE mode: no primed preamble/catalog/discipline — the model gets
   *  only the role and the tools' own descriptions, and must DISCOVER the rest
   *  (information_schema / (tables) / (describe)). The realistic adopter setup. */
  prime?: boolean;
}

export interface BuiltArm {
  arm: ArmName;
  runnable: ReturnType<Glove["build"]>;
  sub: BenchSubscriber;
  toolsInContext: number;
  db?: Database;
  lisp?: LispSession;
}

const COMPACTION_INSTRUCTIONS =
  "Summarize the conversation so far, preserving every concrete fact already retrieved " +
  "(ids, counts, names, states) and the user's outstanding request, so work can continue without re-fetching.";

const SHARED_ROLE =
  "You are an engineering-operations assistant for Acme. Answer the user's request precisely and concisely, " +
  "grounding every claim in data you actually retrieved. When the answer is a list or a count, state the exact " +
  "numbers/ids. Do not ask clarifying questions — make reasonable assumptions and finish the task.";

const SERVICE_LIST =
  "Connected services (as tools): GitHub, Linear, Email, Slack, Notion, Jira, Sentry, PagerDuty, Calendar, Filesystem. " +
  "Tool names are namespaced like `github__list_pull_requests`.";

function baseGlove(model: ModelAdapter, systemPrompt: string, cfg: ArmConfig): Glove {
  return new Glove({
    store: new MemoryStore(`bench_${Math.floor(Math.random() * 1e9)}`),
    model,
    displayManager: new Displaymanager(),
    systemPrompt,
    serverMode: true,
    maxRetries: 2,
    compaction_config: {
      max_turns: cfg.maxTurns,
      compaction_instructions: COMPACTION_INSTRUCTIONS,
      compaction_context_limit: cfg.compactionContextLimit,
    },
  });
}

export async function buildBaselineArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, `${SHARED_ROLE}\n\n${SERVICE_LIST}`, cfg);
  const runnable = glove.build();

  // Fold every tool from every server directly — the "naive" surface.
  let folded = 0;
  for (const conn of org.connections) {
    const tools = await conn.listTools();
    for (const def of tools) {
      glove.fold(bridgeMcpTool(conn, def, true));
      folded++;
    }
  }

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  return { arm: "baseline", runnable, sub, toolsInContext: folded };
}

export async function buildScratchpadArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  const db = await Database.create({ policy: { writes: true } });
  db.registerAll(org.resources());
  // Folds execute_sql + explain_sql; primes unless bare mode.
  mountDatabase(runnable, { db, allowWrites: true, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 2 tools in context (execute_sql, explain_sql) vs the baseline's ~32.
  return { arm: "scratchpad", runnable, sub, toolsInContext: 2, db };
}

export async function buildLispArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, SHARED_ROLE, cfg);
  const runnable = glove.build();

  const lisp = LispSession.create({ policy: { writes: true } });
  lisp.registerAll(org.resources());
  // Folds execute_lisp + explain_lisp; primes unless bare mode.
  mountLisp(runnable, { session: lisp, allowWrites: true, prime: cfg.prime !== false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 2 tools in context (execute_lisp, explain_lisp) vs the baseline's ~32.
  return { arm: "lisp", runnable, sub, toolsInContext: 2, lisp };
}

/** A neutral two-surface preamble: both cards, one catalog, free choice. */
function bothPreamble(org: MockOrg): string {
  const cat = org
    .resources()
    .map((t) => {
      const described = t.columns.filter((c) => c.description).map((c) => `${c.name} (${c.description})`);
      const detail = described.length ? `\n    columns — ${described.join("; ")}` : "";
      return `- ${t.name}: ${t.description ?? t.name}${detail}`;
    })
    .join("\n");
  return `Your capabilities are exposed through TWO equivalent surfaces over the SAME live services. Use whichever fits each task — both are fully capable; pick one per task and stay with it (a write made on one surface is confirmed by its own result; do not re-verify across surfaces).

SURFACE A — SQL database (tools: execute_sql, explain_sql).
Entities are tables (Postgres dialect). Push arguments as WHERE equalities; a vector of values fans out like IN. Compute in the query (COUNT/GROUP BY/JOIN/INSERT … SELECT). A single write fires immediately and reports its row count; BEGIN … COMMIT stages several writes. Discovery: information_schema.tables / .columns (is_nullable marks required keys; description carries valid values).

SURFACE B — Lisp REPL (tools: execute_lisp, explain_lisp), Clojure-flavored, PERSISTENT ((def name …) survives across calls).
Entities are functions: (github_pull_requests {:state "open"}) — the argument map pushes down; vector values fan out like IN. Compute in the program (count/filter/group-by/frequencies/max-key; (sort-by :k > rows) sorts descending; (apply max-key :k rows) is argmax). BRANCHING composes in one call: (if (empty? xs) (insert! :slack_messages {…}) (insert! :emails {…})). Writes: (insert! :t {…}) fires immediately with a row count; (insert! :t (map f rows)) bulk-writes in ONE call; (stage …) then (commit!)/(rollback!) stages several. Discovery: (tables), (describe :name).

Shared rules: only the data your query/program RETURNS enters your context — return counts and small selections, never raw dumps. Writes are immediate and authoritative; do NOT verify them with reads (your own writes are reflected if you do). Be decisive: prefer ONE composed call; if a call errors, change the one thing the message names.

Entities available on BOTH surfaces (use exact values as shown):
${cat}`;
}

export async function buildBothArm(model: ModelAdapter, org: MockOrg, cfg: ArmConfig): Promise<BuiltArm> {
  const glove = baseGlove(model, cfg.prime === false ? SHARED_ROLE : `${bothPreamble(org)}\n\n${SHARED_ROLE}`, cfg);
  const runnable = glove.build();

  const db = await Database.create({ policy: { writes: true } });
  db.registerAll(org.resources());
  mountDatabase(runnable, { db, allowWrites: true, prime: false });

  const lisp = LispSession.create({ policy: { writes: true } });
  lisp.registerAll(org.resources());
  mountLisp(runnable, { session: lisp, allowWrites: true, prime: false });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 4 tools in context: execute_sql, explain_sql, execute_lisp, explain_lisp.
  return { arm: "both", runnable, sub, toolsInContext: 4, db, lisp };
}

export function baselineToolTotal(org: MockOrg): number {
  return totalToolCount(org.specs);
}
