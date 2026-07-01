/** Deterministic probes (NO API) for mechanics the live runs implicated. */
import { Database } from "glove-scratchpad";
import { buildMockOrg } from "./mcp/index";

async function main() {
  const org = await buildMockOrg({ scale: 1 });
  const db = await Database.create({ policy: { writes: true } });
  db.registerAll(org.resources());
  const run = (sql: string) => db.execute(sql, { allowWrites: true });

  // Ground truth from the world.
  const mergedClosing = org.world.githubPrs.filter((p) => p.state === "merged" && p.closes_linear);
  console.log(`\nGround truth: merged PRs closing a Linear issue (any repo) = ${mergedClosing.length}`);
  console.log(`  of those in acme/web = ${mergedClosing.filter((p) => p.repo === "acme/web").length}`);

  // ── Probe A: INSERT … SELECT row fan-out ──────────────────────────────────
  console.log("\n[A] INSERT … SELECT fan-out (expect one create_issue per selected row):");
  const before = org.world.outbox.filter((o) => o.kind === "github.create_issue").length;
  await run("BEGIN");
  const ins = await run(
    "INSERT INTO github_issues (repo, title) SELECT 'acme/web', 'Verify: ' || title FROM github_pull_requests WHERE state = 'merged' AND closes_linear IS NOT NULL",
  );
  console.log(`  staged: ${JSON.stringify(ins.staged ?? null)}`);
  const commit = await run("COMMIT");
  console.log(`  commit: ${commit.message ?? JSON.stringify(commit)}`);
  const after = org.world.outbox.filter((o) => o.kind === "github.create_issue").length;
  console.log(`  create_issue outbox entries fired: ${after - before}  (expected ${mergedClosing.length})`);
  const sample = (org.world.outbox.filter((o) => o.kind === "github.create_issue")[0]?.payload ?? {}) as { repo?: string; title?: string };
  const colsOk = sample.repo === "acme/web" && String(sample.title).startsWith("Verify: ");
  console.log(`  sample payload: repo=${JSON.stringify(sample.repo)} title=${JSON.stringify(String(sample.title).slice(0, 40))}`);
  console.log(`  → count ${after - before === mergedClosing.length ? "OK" : "MISMATCH"}, columns ${colsOk ? "OK ✓" : "MIS-MAPPED ✗"}`);

  // ── Probe B: required-key IN (…) ──────────────────────────────────────────
  console.log("\n[B] required-key linear_issue WHERE id IN (3 ids):");
  const ids = org.world.linearIssues.slice(0, 3).map((i) => i.id);
  const inRes = await run(`SELECT id, state FROM linear_issue WHERE id IN ('${ids[0]}','${ids[1]}','${ids[2]}')`);
  console.log(`  asked for ${ids.length} ids [${ids.join(", ")}] → got ${inRes.rows.length} row(s): ${JSON.stringify(inRes.rows)}`);
  console.log(`  → ${inRes.rows.length === ids.length ? "fans out OK ✓" : "UNDER-FETCH ✗ (only first id resolved)"}`);

  // ── Probe C: the intended JOIN solution to merged-prs-open-linear ─────────
  console.log("\n[C] JOIN github_pull_requests × linear_issues (the intended single-query solution):");
  const joined = await run(
    `SELECT p.number, p.closes_linear FROM github_pull_requests p
       JOIN linear_issues i ON p.closes_linear = i.id
      WHERE p.state = 'merged' AND i.state <> 'done'`,
  );
  const expected = org.world.githubPrs.filter(
    (p) => p.state === "merged" && p.closes_linear && org.world.linearIssues.find((i) => i.id === p.closes_linear)?.state !== "done",
  ).length;
  console.log(`  JOIN returned ${joined.rows.length} rows (expected ${expected}) → ${joined.rows.length === expected ? "OK ✓" : "MISMATCH ✗"}`);

  await org.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
