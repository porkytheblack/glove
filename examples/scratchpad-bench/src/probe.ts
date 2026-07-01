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

  // ── Probe B: required-key IN (…) fan-out ──────────────────────────────────
  console.log("\n[B] required-key slack_messages WHERE channel IN (3 channels):");
  const chans = org.world.slackChannels.slice(0, 3).map((c) => c.name);
  const inRes = await run(`SELECT DISTINCT channel FROM slack_messages WHERE channel IN ('${chans[0]}','${chans[1]}','${chans[2]}')`);
  const got = new Set(inRes.rows.map((r) => r.channel as string));
  console.log(`  asked for ${chans.length} channels [${chans.join(", ")}] → resolved ${got.size}: ${JSON.stringify([...got])}`);
  console.log(`  → ${got.size === chans.length ? "fans out OK ✓" : "UNDER-FETCH ✗ (only first channel resolved)"}`);

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

  // ── Probe D: read-your-writes (the droid instinct) ────────────────────────
  console.log("\n[D] read-your-writes — INSERT an email, then SELECT it back:");
  const inboxBefore = (await run(`SELECT COUNT(*) AS n FROM emails`)).rows[0].n;
  await run(`INSERT INTO emails (to_addr, subject, body) VALUES ('oncall@acme.io', 'Top error', 'boom')`);
  const readback = await run(`SELECT to_addr, subject FROM emails WHERE subject = 'Top error'`);
  const inboxAfter = (await run(`SELECT COUNT(*) AS n FROM emails`)).rows[0].n;
  const found = readback.rows.length === 1 && readback.rows[0].to_addr === "oncall@acme.io";
  console.log(`  inbox count ${inboxBefore} → ${inboxAfter} (+1); re-SELECT of the sent row → ${readback.rows.length} row`);
  console.log(`  → ${found ? "the write is readable back this session ✓" : "NOT reflected ✗ (would spiral a verifying model)"}`);

  await org.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
