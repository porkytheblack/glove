/**
 * No-API-key smoke test for the FLEET mechanism: 10 providers up, contain the 5
 * a churn-risk board needs, JOIN across all 5 in SQL, then persist + restore to
 * prove the whole thing is resumable. Observability via the scratchpad event
 * stream. No model — proves the datapath the live agent will drive.
 *
 * Run (from the repo root): `pnpm scratchpad:fleet-smoke`
 */
import { connectMcp } from "glove-mcp";
import { Scratchpad, MemoryBackend, createScratchpadStats, createConsumptionTracker } from "glove-scratchpad";
import { MemoryScratchpadStore, persistScratchpad, restoreScratchpad } from "glove-scratchpad";
import { containMcpTools, createContainmentReporter } from "glove-scratchpad/mcp";
import { startFleet } from "./mcp-fleet";

const rule = () => console.log("─".repeat(76));
const NEEDED = ["crm", "issues", "support", "billing", "analytics"];

async function main() {
  const fleet = await startFleet();
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const reporter = createContainmentReporter();
  const stats = createScratchpadStats();
  const consumption = createConsumptionTracker();
  sp.subscribe(stats.subscriber);
  sp.subscribe(consumption.subscriber);

  rule();
  console.log(`Fleet up: ${fleet.catalogue.length} providers. Containing the ${NEEDED.length} a churn board needs.\n`);

  // Connect + contain the 5 relevant providers; capture each stored reference.
  const ref: Record<string, string> = {};
  for (const id of NEEDED) {
    const conn = await connectMcp({ namespace: id, url: fleet.urlOf(id) });
    const [tool] = await containMcpTools(conn, { scratchpad: sp, actor: id, onContain: reporter.onContain });
    const result = await tool.do({}, undefined as never, undefined as never, undefined);
    ref[id] = (result.data as { ref: string }).ref;
    console.log(`  ${id.padEnd(10)} → contained as ref=${ref[id]}`);
    await conn.close();
  }

  rule();
  console.log("Cross-provider JOIN in SQL (enterprise churn-risk board)\n");

  // Per-account risk signals from four providers, joined onto enterprise accounts.
  await sp.query(
    `WITH p0 AS (SELECT account_id, COUNT(*) AS c FROM ${ref.issues} WHERE state='open' AND priority='P0' GROUP BY account_id),
          hs AS (SELECT account_id, COUNT(*) AS c FROM ${ref.support} WHERE status='open' AND severity='high' GROUP BY account_id),
          od AS (SELECT account_id, COUNT(*) AS c, COALESCE(SUM(amount),0) AS amt FROM ${ref.billing} WHERE status='overdue' GROUP BY account_id)
     SELECT a.account_id, a.name, a.arr, a.region,
            COALESCE(p0.c,0) AS open_p0,
            COALESCE(hs.c,0) AS high_sev_tickets,
            COALESCE(od.c,0) AS overdue_invoices,
            COALESCE(od.amt,0) AS overdue_amount,
            u.trend_30d_pct AS usage_trend
       FROM ${ref.crm} a
       LEFT JOIN p0 ON p0.account_id = a.account_id
       LEFT JOIN hs ON hs.account_id = a.account_id
       LEFT JOIN od ON od.account_id = a.account_id
       LEFT JOIN ${ref.analytics} u ON u.account_id = a.account_id
      WHERE a.tier = 'enterprise'`,
    { store: "board" },
  );

  const summary = await sp.materialize({
    sql: `SELECT COUNT(*) AS flagged, COALESCE(SUM(arr),0) AS arr_at_risk
            FROM board
           WHERE open_p0 > 0 OR high_sev_tickets > 0 OR overdue_invoices > 0 OR usage_trend < 0`,
  });
  const top = await sp.materialize({
    sql: `SELECT name, arr, region, open_p0, high_sev_tickets, overdue_invoices, overdue_amount, usage_trend
            FROM board
           WHERE open_p0 > 0 OR high_sev_tickets > 0 OR overdue_invoices > 0 OR usage_trend < 0
           ORDER BY arr DESC LIMIT 8`,
  });

  console.log("  summary:", JSON.stringify(summary.rows[0]));
  console.log("  top flagged enterprise accounts by ARR:");
  for (const r of top.rows) console.log("   ", JSON.stringify(r));

  rule();
  console.log("Persist → restore (prove the whole multi-provider scratchpad is resumable)\n");
  const store = new MemoryScratchpadStore();
  await persistScratchpad(sp, store, "fleet-session");
  const restored = await restoreScratchpad({ store, key: "fleet-session" });
  const check = await restored!.materialize({ sql: `SELECT COUNT(*) AS n FROM board` });
  console.log(`  restored scratchpad: board has ${JSON.stringify(check.rows[0])} rows — refs survived.`);
  await restored!.close();

  rule();
  console.log("OBSERVABILITY\n");
  console.log(`  containment: ${reporter.format()}`);
  console.log(`  scratchpad : ${stats.format()}`);
  console.log(`  tokens     : ${consumption.format()}`);
  rule();

  await fleet.close();
  await sp.close();
  console.log("\nFleet smoke OK — 10 providers, 5 contained + joined, persisted, restored.\n");
}

main().catch((err) => {
  console.error("\n[fleet smoke failed]", err);
  process.exit(1);
});
