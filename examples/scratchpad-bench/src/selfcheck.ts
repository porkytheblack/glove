/**
 * Deterministic self-check — NO API key. Validates that:
 *   1. all ten MCP servers stand up and answer `tools/list` + `tools/call`,
 *   2. the scratchpad DB registers every resource and answers discovery,
 *   3. filtering, required-key pushdown, cross-service JOINs, and aggregates work,
 *   4. staged writes fire real side effects (the outbox),
 *   5. the real `mountMcpDatabase` product path also works.
 *
 * Run: pnpm --filter glove-scratchpad-bench selfcheck
 */
import { Database } from "glove-scratchpad";
import { mountMcpDatabase } from "glove-scratchpad/mcp";
import { buildMockOrg, totalToolCount } from "./mcp/index";
import { bridgeMcpTool } from "glove-mcp";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  const ok = cond ? "✓" : "✗";
  if (!cond) failures++;
  console.log(`  ${ok} ${label}${!cond && detail !== undefined ? `  →  ${JSON.stringify(detail)}` : ""}`);
}
async function rows(db: Database, sql: string): Promise<Record<string, unknown>[]> {
  const res = await db.execute(sql, { allowWrites: true });
  return res.rows as Record<string, unknown>[];
}

async function main() {
  const org = await buildMockOrg({ scale: Number(process.env.BENCH_SCALE ?? 1) });
  console.log(`\nWorld: ${org.world.githubPrs.length} PRs, ${org.world.linearIssues.length} Linear issues, ` +
    `${org.world.sentryIssues.length} Sentry issues, ${org.world.emails.length} emails`);
  console.log(`Servers: ${org.specs.length}, total MCP tools: ${totalToolCount(org.specs)}\n`);

  // ── 1. MCP layer: every server lists + calls ──────────────────────────────
  console.log("[1] MCP servers (real in-process protocol):");
  for (let i = 0; i < org.connections.length; i++) {
    const conn = org.connections[i];
    const tools = await conn.listTools();
    check(`${conn.namespace}: ${tools.length} tools listed`, tools.length > 0);
  }
  // A direct baseline-style call + a bridged call.
  const gh = org.connections[0];
  const prCall = await gh.callTool("list_pull_requests", { state: "merged" });
  const prText = prCall.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const merged = JSON.parse(prText) as Array<{ state: string }>;
  check("github.list_pull_requests(state=merged) returns only merged", merged.every((p) => p.state === "merged"), merged[0]);
  const bridged = bridgeMcpTool(gh, (await gh.listTools())[0], true);
  check("bridgeMcpTool produces a namespaced tool", bridged.name === "github__list_pull_requests", bridged.name);

  // ── 2–4. Scratchpad DB over all resources ─────────────────────────────────
  console.log("\n[2] Scratchpad discovery + querying:");
  const db = await Database.create({ policy: { writes: true } });
  db.registerAll(org.resources());

  const tables = await rows(db, "SELECT table_name FROM information_schema.tables ORDER BY table_name");
  check(`information_schema lists tables (${tables.length})`, tables.length >= 14, tables.map((t) => t.table_name));

  const cols = await rows(db, "SELECT column_name FROM information_schema.columns WHERE table_name = 'github_pull_requests'");
  check("columns of github_pull_requests discoverable", cols.some((c) => c.column_name === "closes_linear"));

  const openPrs = await rows(db, "SELECT number, title FROM github_pull_requests WHERE state = 'open' LIMIT 5");
  check("filtered SELECT on github_pull_requests", openPrs.length > 0, openPrs.length);

  // Required-key pushdown: must bind id.
  const knownId = org.world.linearIssues[3].id;
  const one = await rows(db, `SELECT id, title, assignee FROM linear_issue WHERE id = '${knownId}'`);
  check(`required-key pushdown linear_issue WHERE id='${knownId}'`, one.length === 1 && one[0].id === knownId, one);
  let pushdownErr = "";
  try {
    await rows(db, "SELECT id FROM linear_issue LIMIT 1");
  } catch (e) {
    pushdownErr = e instanceof Error ? e.message : String(e);
  }
  check("missing required key is a clear error", /require|equality|key/i.test(pushdownErr), pushdownErr);

  console.log("\n[3] Cross-service composition:");
  const joined = await rows(
    db,
    `SELECT p.number, p.title, i.assignee, i.state
       FROM github_pull_requests p
       JOIN linear_issues i ON p.closes_linear = i.id
      WHERE p.state = 'merged' LIMIT 10`,
  );
  check("JOIN github_pull_requests × linear_issues on closes_linear", joined.length > 0, joined.length);

  const agg = await rows(
    db,
    `SELECT status, COUNT(*) AS n FROM sentry_issues GROUP BY status ORDER BY n DESC`,
  );
  check("GROUP BY over sentry_issues", agg.length > 0 && agg.every((r) => "n" in r), agg);

  // ── 4. Staged write fires a real side effect ──────────────────────────────
  console.log("\n[4] Staged write → real effect:");
  const before = org.world.outbox.length;
  await db.execute("BEGIN", { allowWrites: true });
  const staged = await db.execute(
    "INSERT INTO emails (to_addr, subject, body) VALUES ('alice@acme.io', 'ping', 'hello from bench')",
    { allowWrites: true },
  );
  check("INSERT is staged, not fired", org.world.outbox.length === before, { staged: staged.staged, outbox: org.world.outbox.length });
  await db.execute("COMMIT", { allowWrites: true });
  const sent = org.world.outbox.filter((o) => o.kind === "email.send");
  check("COMMIT fires send_email into outbox", sent.length === 1 && (sent[0].payload as { to: string }).to === "alice@acme.io", sent);

  // ── 5. The real mountMcpDatabase product path ─────────────────────────────
  console.log("\n[5] mountMcpDatabase (product path):");
  const db2 = await Database.create({ policy: { writes: false } });
  const mounted = await mountMcpDatabase(db2, org.connections[6] /* sentry */, {
    table: (t) =>
      t.name === "list_issues"
        ? {
            name: "sentry_via_mount",
            op: "select",
            volatility: "stable",
            columns: [
              { name: "id", type: "text" },
              { name: "title", type: "text" },
              { name: "status", type: "text" },
              { name: "count", type: "bigint" },
            ],
            rows: (d) => JSON.parse(d as string),
          }
        : null,
  });
  check("mountMcpDatabase returns a table name", mounted.includes("sentry_via_mount"), mounted);
  const mountedRows = await rows(db2, "SELECT id, title FROM sentry_via_mount WHERE status = 'unresolved' LIMIT 3");
  check("query the mounted table", mountedRows.length > 0, mountedRows.length);

  await org.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nSELF-CHECK CRASHED:\n", err);
  process.exit(1);
});
