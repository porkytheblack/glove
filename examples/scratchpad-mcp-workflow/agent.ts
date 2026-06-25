/**
 * Scratchpad × MCP — an end-to-end workflow (requires OPENROUTER_API_KEY).
 *
 * A realistic "revenue at risk" briefing built from two MCP servers:
 *   • an issue tracker  (issues__search_issues — full issue dump)
 *   • a CRM             (crm__list_accounts   — full account dump)
 *
 * The whole bridge-and-contain step is one call per server:
 *
 *     await mountContainedMcp(agent, conn, { scratchpad, onContain: reporter.onContain });
 *
 * `mountContainedMcp` (from `glove-scratchpad/mcp`) lists the server's tools,
 * bridges each one, wraps it in `storeAndTruncate`, and folds it — so every big
 * MCP result lands in the scratchpad and only a compact stub reaches the model.
 * The agent then narrows in SQL, JOINs the two sources on account_id, and
 * materializes only the final small table.
 *
 * Run (from the repo root): `pnpm scratchpad:mcp`
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// OPENROUTER_API_KEY / OPENROUTER_MODEL live in the repo-root .env; a local
// .env in this folder (if present) overrides it.
dotenv.config({ path: join(__dirname, "../../.env") });
dotenv.config({ path: join(__dirname, ".env") });

import { Glove, Displaymanager, MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import type { SubscriberAdapter } from "glove-core";
import { connectMcp } from "glove-mcp";
import type { McpServerConnection } from "glove-mcp";
import { Scratchpad, MemoryBackend, mountScratchpad } from "glove-scratchpad";
import { mountContainedMcp, createContainmentReporter } from "glove-scratchpad/mcp";
import { startDummyMcpServers } from "./mcp-servers";

const fmt = (n: number): string => `${n.toLocaleString()} b`;
const rule = () => console.log("─".repeat(74));
const truncate = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n)}…` : s);

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL ?? "moonshotai/kimi-k2.5";
  if (!apiKey) {
    console.error(
      "Set OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL) in the repo-root .env to run this example.\n" +
        "For a no-API-key mechanism walkthrough, try `pnpm scratchpad:mcp-smoke`.",
    );
    process.exit(1);
  }

  console.log(`\nScratchpad × MCP workflow — model: ${model} (via OpenRouter)\n`);

  // 1. Stand up the two dummy MCP servers (real Streamable HTTP, in-process).
  const fleet = await startDummyMcpServers();
  console.log(`  issue tracker MCP : ${fleet.issues.url}`);
  console.log(`  CRM MCP           : ${fleet.crm.url}`);

  // 2. One scratchpad for this unit of work, and one reporter to prove the savings.
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const reporter = createContainmentReporter();

  // 3. The agent.
  const agent = new Glove({
    store: new MemoryStore("scratchpad-mcp-workflow"),
    model: createAdapter({ provider: "openrouter", model, stream: true }),
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: SYSTEM_PROMPT,
    compaction_config: { compaction_instructions: "Summarize the analysis so far, preserving scratchpad references." },
  }).build();
  agent.addSubscriber(traceSubscriber());

  // 4. Connect each MCP server and bridge + contain ALL its tools in one call.
  //    (This is the DX win — no hand-rolled listTools → bridge → wrap → fold loop.)
  const connections: McpServerConnection[] = [];
  async function mountServer(namespace: string, url: string): Promise<string[]> {
    const conn = await connectMcp({ namespace, url, clientInfo: { name: "scratchpad-mcp-workflow", version: "1.0.0" } });
    connections.push(conn);
    return mountContainedMcp(agent, conn, { scratchpad: sp, actor: "analyst", onContain: reporter.onContain });
  }
  const tools = [...(await mountServer("issues", fleet.issues.url)), ...(await mountServer("crm", fleet.crm.url))];
  console.log(`\n  bridged + contained tools: ${tools.join(", ")}`);

  // 5. Give the agent the scratchpad surface + last-mile restraint priming.
  mountScratchpad(agent, { scratchpad: sp, actor: "analyst" });

  rule();
  console.log("OBJECTIVE\n");
  console.log(OBJECTIVE.trim());
  rule();
  console.log("AGENT TRACE\n");

  const started = Date.now();
  await agent.processRequest(OBJECTIVE);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // 6. Accounting.
  const records = await sp.list();
  console.log("\n");
  rule();
  console.log("SCRATCHPAD RECORDS (created during the run)\n");
  for (const r of records) console.log(`  ${r.ref}  —  ${r.rowCount} rows  [${r.kind}]`);

  rule();
  console.log("CONTAINMENT (payloads kept out of the model's context)\n");
  const report = reporter.report();
  for (const [tool, s] of Object.entries(report.byTool)) {
    console.log(`  ${tool}: ${fmt(s.bytesContained)} contained → ${fmt(s.bytesEmitted)} stub`);
  }
  console.log(`\n  total: ${reporter.format()}`);
  console.log(`  wall clock: ${elapsed}s`);
  rule();

  // 7. Cleanup.
  for (const c of connections) await c.close().catch(() => {});
  await fleet.close();
  await sp.close();
}

/** A light trace: tool calls (with the SQL the model writes) + the streamed answer. */
function traceSubscriber(): SubscriberAdapter {
  return {
    async record(event_type, data) {
      if (event_type === "tool_use") {
        const { name, input } = data as { name: string; input: unknown };
        const sql = (input as { sql?: string })?.sql;
        console.log(`\n→ ${name}${sql ? ` ${truncate(sql.replace(/\s+/g, " "))}` : ""}`);
      }
      if (event_type === "text_delta") process.stdout.write((data as { text: string }).text);
    },
  };
}

const SYSTEM_PROMPT = `You are a revenue-operations analyst. Two data sources are available as tools:
  • issues__search_issues — the issue tracker; returns the FULL issue list.
  • crm__list_accounts    — the CRM; returns the FULL account list.

Both tools return large full-dump payloads, but they are wrapped so each result is
written into a SCRATCHPAD (a Postgres-subset store) and only a small stub returns to
you. Do NOT try to read the whole payload. Work it through the scratchpad tools:
describe the shape, narrow with SQL (scratchpad_query — pass \`store\` to persist a
narrowed result as a new reference), and materialize only the final small answer.

Join the two sources on the account_id column (issues.account_id = accounts.account_id).
Each stored record's root table is named by its reference and keyed by _rid.`;

const OBJECTIVE = `Prepare a "revenue at risk" briefing.

First call issues__search_issues and crm__list_accounts to load both datasets into the
scratchpad. Then, working in SQL on the scratchpad:

1. Identify ENTERPRISE-tier accounts (accounts.tier = 'enterprise') that have at least
   one OPEN P0 issue (issues.state = 'open' AND issues.priority = 'P0').
2. Report how many such at-risk enterprise accounts there are, and the TOTAL ARR summed
   across them.
3. List the top 5 of those accounts by ARR — each with account name, ARR, region, and
   the account's count of open P0 issues.

Narrow with scratchpad_query and only materialize the final small result. Do not
materialize the full issue or account payloads.`;

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(1);
});
