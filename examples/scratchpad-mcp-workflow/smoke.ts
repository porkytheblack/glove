/**
 * No-API-key smoke test for the MCP × scratchpad plumbing.
 *
 * Exercises the entire non-model path: start the two dummy MCP servers, connect
 * with glove-mcp, and bridge + contain every tool in one call with
 * `containMcpTools` (from `glove-scratchpad/mcp`). Then it calls the tools over
 * real Streamable HTTP, narrows + JOINs in SQL on the scratchpad, and
 * materializes the answer — all without a model. Verifies the wiring (and the
 * exact SQL the live agent is expected to write) before you spend any tokens.
 *
 * Run (from the repo root): `pnpm scratchpad:mcp-smoke`
 */
import { connectMcp } from "glove-mcp";
import { Scratchpad, MemoryBackend } from "glove-scratchpad";
import { containMcpTools, createContainmentReporter } from "glove-scratchpad/mcp";
import type { GloveFoldArgs } from "glove-core/glove";
import { startDummyMcpServers } from "./mcp-servers";

const bytes = (v: unknown): number =>
  new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v ?? "")).length;
const fmt = (n: number): string => `${n.toLocaleString()} b`;
const rule = () => console.log("─".repeat(74));

async function call(tool: GloveFoldArgs<unknown>): Promise<{ ref: string }> {
  const result = await tool.do({}, undefined as never, undefined as never, undefined);
  if (result.status !== "success") throw new Error(`${tool.name} failed: ${result.message}`);
  return result.data as { ref: string };
}

async function main() {
  const fleet = await startDummyMcpServers();
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const reporter = createContainmentReporter();

  rule();
  console.log("1. Connect + bridge + contain every tool in one call (containMcpTools)\n");

  const issuesConn = await connectMcp({ namespace: "issues", url: fleet.issues.url });
  const crmConn = await connectMcp({ namespace: "crm", url: fleet.crm.url });

  const issuesTools = await containMcpTools(issuesConn, { scratchpad: sp, actor: "smoke", onContain: reporter.onContain });
  const crmTools = await containMcpTools(crmConn, { scratchpad: sp, actor: "smoke", onContain: reporter.onContain });
  console.log(`   issues: ${issuesTools.map((t) => t.name).join(", ")}`);
  console.log(`   crm   : ${crmTools.map((t) => t.name).join(", ")}`);

  rule();
  console.log("2. Call each tool — payload contained, stub returned\n");

  const issuesRef = (await call(issuesTools.find((t) => t.name === "issues__search_issues")!)).ref;
  const accountsRef = (await call(crmTools.find((t) => t.name === "crm__list_accounts")!)).ref;
  for (const [tool, s] of Object.entries(reporter.report().byTool)) {
    console.log(`   ${tool}: ${fmt(s.bytesContained)} payload → ${fmt(s.bytesEmitted)} stub`);
  }

  rule();
  console.log("3. Narrow + JOIN in SQL on the scratchpad (the plan the agent must find)\n");

  const atRisk = await sp.query(
    `SELECT a.account_id, a.name, a.arr, a.region, COUNT(i._rid) AS open_p0
       FROM ${accountsRef} a
       JOIN ${issuesRef} i ON i.account_id = a.account_id
      WHERE a.tier = 'enterprise' AND i.state = 'open' AND i.priority = 'P0'
      GROUP BY a.account_id, a.name, a.arr, a.region`,
    { store: "at_risk", provenance: { source: "smoke", actor: "smoke" } },
  );
  const atRiskRef = (atRisk as { ref: string }).ref;
  console.log(`   stored at-risk set as ref=${atRiskRef}`);

  // COALESCE(SUM(...)) — the idiomatic defensive aggregate an LLM tends to write.
  const summary = await sp.materialize({
    sql: `SELECT COUNT(*) AS accounts, COALESCE(SUM(arr), 0) AS total_arr FROM ${atRiskRef}`,
  });
  const top5 = await sp.materialize({
    sql: `SELECT name, arr, region, open_p0 FROM ${atRiskRef} ORDER BY arr DESC LIMIT 5`,
  });

  rule();
  console.log("4. Materialized answer (last mile)\n");
  console.log("   summary:", JSON.stringify(summary.rows[0]));
  console.log("   top 5 at-risk enterprise accounts by ARR:");
  for (const row of top5.rows) console.log("    ", JSON.stringify(row));

  rule();
  const report = reporter.report();
  const lastMile = bytes(summary.rows) + bytes(top5.rows);
  console.log("CONTEXT ACCOUNTING (no model)\n");
  console.log(`   containment: ${reporter.format()}`);
  console.log(`   last-mile reads into context              : ${fmt(lastMile)}`);
  console.log(`   total tool→context vs naive               : ${fmt(report.bytesEmitted + lastMile)} vs ${fmt(report.bytesContained)}`);
  rule();

  await issuesConn.close();
  await crmConn.close();
  await fleet.close();
  await sp.close();
  console.log("\nSmoke test OK — MCP transport, bridge, containment, SQL narrow/join all working.\n");
}

main().catch((err) => {
  console.error("\n[smoke failed]", err);
  process.exit(1);
});
