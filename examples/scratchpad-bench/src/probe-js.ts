/**
 * Deterministic JS probes (NO API): every benchmark scenario hand-authored as
 * the JavaScript program a competent model should write, executed against the
 * same seeded world + live MCP servers as the real runs, and graded with the
 * same verifiers. Proves the glove-js surface can EXPRESS every task before any
 * model is in the loop — the JS analogue of probe-lisp.ts.
 *
 * The catalog is the FUNCTION-MODE catalog (`fnsFromMcp` over the same
 * connections), so tool names are `github__list_pull_requests` and the model
 * calls them either flat or through the auto-built namespace object
 * (`github.list_pull_requests({ … })`). A call fires immediately — no staging.
 *
 * Probe H is the motivating case: decide-and-act (conditional branch + effect)
 * in ONE call. Probes I/K exercise session persistence (top-level const across
 * calls); J is the negation join where a REPL reads more naturally than SQL.
 *
 *   pnpm --filter glove-scratchpad-bench probe:js
 */
import { JsSession } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { buildMockOrg } from "./mcp/index";
import { SCENARIOS } from "./scenarios";

let failures = 0;

function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "OK ✓" : "FAIL ✗"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  const org = await buildMockOrg({ scale: 1 });
  const session = JsSession.create();
  const fns = (await Promise.all(org.connections.map((c) => fnsFromMcp(c)))).flat();
  session.registerAll(fns);
  const run = (code: string) => session.execute(code);
  const scenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    return s;
  };

  // ── A: count-open-prs — single aggregate ───────────────────────────────────
  console.log("\n[A] count-open-prs");
  {
    const r = await run(`github.list_pull_requests({ state: "open" }).length`);
    const v = scenario("count-open-prs").verify(String(r.value), org.world);
    check("one-expression .length", v.pass, `got ${r.value}, expected ${v.expected}`);
  }

  // ── B: sentry-billing-unresolved — filtered lookup, ids + count ────────────
  console.log("\n[B] sentry-billing-unresolved");
  {
    const r = await run(
      `const hits = sentry.list_issues({ status: "unresolved", project: "billing" });
       \`\${hits.length} unresolved: \${hits.map(h => h.id).join(", ")}\``,
    );
    const v = scenario("sentry-billing-unresolved").verify(String(r.value), org.world);
    check("filter + ids in one program", v.pass, String(r.value).slice(0, 80));
  }

  // ── C: merged-prs-open-linear — the cross-service JOIN ─────────────────────
  console.log("\n[C] merged-prs-open-linear (cross-service join)");
  {
    const r = await run(
      `const done = linear.list_issues().filter(i => i.state === "done").map(i => i.id);
       const hits = github.list_pull_requests({ state: "merged" })
         .filter(p => p.closes_linear && !done.includes(p.closes_linear));
       \`\${hits.length} PRs: \${hits.map(p => \`PR \${p.number} closes \${p.closes_linear}\`).join("; ")}\``,
    );
    const v = scenario("merged-prs-open-linear").verify(String(r.value), org.world);
    check("join via filter over two reads", v.pass, String(r.value).slice(0, 100));
  }

  // ── D: busiest-assignee — group-by + argmax ────────────────────────────────
  console.log("\n[D] busiest-assignee (group-by + argmax)");
  {
    const r = await run(
      `const rows = linear.list_issues({ state: "in_progress" });
       const freq = {};
       for (const r of rows) freq[r.assignee] = (freq[r.assignee] ?? 0) + 1;
       const [who, top] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
       \`\${who} has \${top}\``,
    );
    const v = scenario("busiest-assignee").verify(String(r.value), org.world);
    check("frequencies → argmax", v.pass, String(r.value));
  }

  // ── E: high-urgency-triggered — enum-case traps ────────────────────────────
  console.log("\n[E] high-urgency-triggered");
  {
    const r = await run(
      `const hits = pagerduty.list_incidents({ urgency: "high", status: "triggered" });
       \`\${hits.length} incidents: \${hits.map(h => h.id).join(", ")}\``,
    );
    const v = scenario("high-urgency-triggered").verify(String(r.value), org.world);
    check("two pushed-down enums", v.pass, String(r.value).slice(0, 80));
  }

  // ── F: email-top-error — argmax → compose → send (write) ───────────────────
  console.log("\n[F] email-top-error (argmax → compose → write)");
  {
    const r = await run(
      `const worst = sentry.list_issues({ status: "unresolved" }).reduce((a, b) => (b.count > a.count ? b : a));
       email.send_email({ to: "oncall@acme.io", subject: "Top error", body: \`Worst unresolved error: \${worst.title}\` });`,
    );
    const v = scenario("email-top-error").verify("", org.world);
    check("read→compose→send in one program", v.pass, JSON.stringify(r.value));
  }

  // ── G: compose-verify-issues — fan-out writes (loop) ───────────────────────
  console.log("\n[G] compose-verify-issues (fan-out writes)");
  {
    const r = await run(
      `const hits = github.list_pull_requests({ state: "merged" }).filter(p => p.closes_linear);
       for (const p of hits) github.create_issue({ repo: "acme/web", title: \`Verify: \${p.title}\` });
       \`opened \${hits.length} issues\``,
    );
    const v = scenario("compose-verify-issues").verify(String(r.value), org.world);
    check("loop of create_issue from a computed list", v.pass, `${String(r.value)} (${v.note ?? ""})`);
  }

  // ── H: decide-and-act in ONE call — SQL's named limit ──────────────────────
  console.log("\n[H] decide-and-act in one program (SQL cannot)");
  {
    const before = org.world.outbox.filter((o) => o.kind === "slack.post_message").length;
    const r = await run(
      `const triggered = pagerduty.list_incidents({ urgency: "high", status: "triggered" });
       if (triggered.length === 0) {
         slack.post_message({ channel: "ops", text: "All clear: no high-urgency incidents." });
       } else {
         email.send_email({
           to: "oncall@acme.io",
           subject: \`\${triggered.length} high-urgency incidents live\`,
           body: triggered.map(i => i.id).join(", "),
         });
       }`,
    );
    const after = org.world.outbox.filter((o) => o.kind === "slack.post_message").length;
    const emails = org.world.outbox.filter((o) => o.kind === "email.send");
    const expected = org.world.pagerIncidents.filter((i) => i.urgency === "high" && i.status === "triggered");
    const tookEmailBranch = expected.length > 0;
    const branchedRight = tookEmailBranch
      ? emails.some((e) => String((e.payload as { subject?: string }).subject ?? "").startsWith(`${expected.length} high-urgency`))
      : after === before + 1;
    check("if/else chose the right side effect", branchedRight, `${expected.length} incidents → ${tookEmailBranch ? "email" : "slack"} branch, value ${JSON.stringify(r.value)}`);
  }

  // ── I: session persistence — const once, reuse across calls ────────────────
  console.log("\n[I] const persists across calls (the REPL is the scratchpad)");
  {
    const d = await run(`const allPrs = github.list_pull_requests();`);
    const c1 = await run(`allPrs.length`);
    const c2 = await run(`allPrs.filter(p => p.state === "open").length`);
    const expectedAll = org.world.githubPrs.length;
    const expectedOpen = org.world.githubPrs.filter((p) => p.state === "open").length;
    const defs = d.defs as { allPrs?: { count?: number; peek?: unknown } } | undefined;
    check(
      "const summary + later reuse",
      d.defined?.[0] === "allPrs" &&
        defs?.allPrs?.count === expectedAll &&
        defs?.allPrs?.peek !== undefined &&
        c1.value === expectedAll &&
        c2.value === expectedOpen,
      `def→${JSON.stringify(d.defs)}, counts ${c1.value}/${c2.value} (expected ${expectedAll}/${expectedOpen})`,
    );
  }

  // ── J: reconcile-ghost-issues — negation join (REPL reads cleaner than SQL) ─
  console.log("\n[J] reconcile-ghost-issues (negation join)");
  {
    const r = await run(
      `const byIssue = {};
       for (const p of github.list_pull_requests()) {
         if (p.closes_linear) (byIssue[p.closes_linear] ??= []).push(p.state);
       }
       const ghosts = linear.list_issues()
         .filter(i => i.state === "done" && byIssue[i.id] && !byIssue[i.id].includes("merged"))
         .map(i => i.id);
       \`\${ghosts.length} ghost issues: \${ghosts.join(", ")}\``,
    );
    const v = scenario("reconcile-ghost-issues").verify(String(r.value), org.world);
    check("NOT-merged filter over a claim map", v.pass, String(r.value).slice(0, 100));
  }

  // ── K: open-prs-breakdown — two-part answer reusing a const ────────────────
  console.log("\n[K] open-prs-breakdown (two-part, session reuse)");
  {
    await run(`const open = github.list_pull_requests({ state: "open" });`);
    const r = await run(
      `const byRepo = {};
       for (const p of open) byRepo[p.repo] = (byRepo[p.repo] ?? 0) + 1;
       const [repo, n] = Object.entries(byRepo).sort((a, b) => b[1] - a[1])[0];
       \`\${open.length} open PRs; \${repo} leads with \${n}\``,
    );
    const v = scenario("open-prs-breakdown").verify(String(r.value), org.world);
    check("count, then argmax-by-repo reusing the const", v.pass, String(r.value).slice(0, 100));
  }

  await org.close();
  console.log(`\n${failures === 0 ? "ALL PROBES PASS ✓" : `${failures} PROBE(S) FAILED ✗`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
