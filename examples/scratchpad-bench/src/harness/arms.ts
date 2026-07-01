/**
 * The two arms under test, built over the SAME mock org and model:
 *
 *   - "baseline": every MCP tool from all ten servers folded directly into the
 *     agent (the realistic "I connected 10 MCP servers" setup). All ~32 tool
 *     schemas live in context; every result streams back verbatim.
 *   - "scratchpad": a single `execute_sql` tool (+ `explain_sql`) over the same
 *     capabilities exposed as SQL tables. The model discovers via
 *     information_schema and only the rows a SELECT returns enter context.
 */
import { Glove, Displaymanager, MemoryStore, type ModelAdapter } from "glove-core";
import { Database } from "glove-scratchpad";
import { bridgeMcpTool } from "glove-mcp";
import { mountDatabase } from "glove-scratchpad";
import type { MockOrg } from "../mcp/index";
import { totalToolCount } from "../mcp/index";
import { BenchSubscriber } from "./instrument";

export type ArmName = "baseline" | "scratchpad";

export interface ArmConfig {
  maxTurns: number;
  compactionContextLimit: number;
  echo?: boolean;
}

export interface BuiltArm {
  arm: ArmName;
  runnable: ReturnType<Glove["build"]>;
  sub: BenchSubscriber;
  toolsInContext: number;
  db?: Database;
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
  // Folds execute_sql + explain_sql and prepends the DATABASE_PREAMBLE.
  mountDatabase(runnable, { db, allowWrites: true });

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  // 2 tools in context (execute_sql, explain_sql) vs the baseline's ~32.
  return { arm: "scratchpad", runnable, sub, toolsInContext: 2, db };
}

export function baselineToolTotal(org: MockOrg): number {
  return totalToolCount(org.specs);
}
