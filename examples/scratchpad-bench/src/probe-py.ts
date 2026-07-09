/**
 * Deterministic Python probes (NO API): every benchmark scenario hand-authored
 * as the Python program a competent model should write, executed against the
 * same seeded world + live MCP servers as the real runs, and graded with the
 * same verifiers. Proves the glove-python surface can EXPRESS every task before
 * any model is in the loop — the Python analogue of probe-js.ts / probe-lisp.ts.
 *
 * The catalog is the FUNCTION-MODE catalog (`fnsFromMcp` over the same
 * connections), so tool names are `github__list_pull_requests` and the model
 * calls them either flat or through the auto-built namespace object
 * (`github.list_pull_requests(state="open")`) with KEYWORD args. A call fires
 * immediately — no staging.
 *
 * Probe H is the motivating case: decide-and-act (conditional branch + effect)
 * in ONE call. Probes I/K exercise session persistence (top-level names across
 * calls); J is the negation join where a comprehension reads more naturally
 * than SQL.
 *
 *   pnpm --filter glove-scratchpad-bench probe:py
 */
import { PySession } from "glove-python";
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
  const session = PySession.create();
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
    const r = await run(`len(github.list_pull_requests(state="open"))`);
    const v = scenario("count-open-prs").verify(String(r.value), org.world);
    check("one-expression len()", v.pass, `got ${r.value}, expected ${v.expected}`);
  }

  // ── B: sentry-billing-unresolved — filtered lookup, ids + count ────────────
  console.log("\n[B] sentry-billing-unresolved");
  {
    const r = await run(
      `hits = sentry.list_issues(status="unresolved", project="billing")\n` +
        `f"{len(hits)} unresolved: " + ", ".join([h['id'] for h in hits])`,
    );
    const v = scenario("sentry-billing-unresolved").verify(String(r.value), org.world);
    check("filter + ids in one program", v.pass, String(r.value).slice(0, 80));
  }

  // ── C: merged-prs-open-linear — the cross-service JOIN ─────────────────────
  console.log("\n[C] merged-prs-open-linear (cross-service join)");
  {
    const r = await run(
      `done = [i['id'] for i in linear.list_issues() if i['state'] == 'done']\n` +
        `hits = [p for p in github.list_pull_requests(state="merged") if p['closes_linear'] and p['closes_linear'] not in done]\n` +
        `f"{len(hits)} PRs: " + "; ".join([f"PR {p['number']} closes {p['closes_linear']}" for p in hits])`,
    );
    const v = scenario("merged-prs-open-linear").verify(String(r.value), org.world);
    check("join via comprehension over two reads", v.pass, String(r.value).slice(0, 100));
  }

  // ── D: busiest-assignee — group-by + argmax ────────────────────────────────
  console.log("\n[D] busiest-assignee (group-by + argmax)");
  {
    const r = await run(
      `rows = linear.list_issues(state="in_progress")\n` +
        `freq = {}\n` +
        `for r in rows:\n` +
        `  freq[r['assignee']] = freq.get(r['assignee'], 0) + 1\n` +
        `top = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)[0]\n` +
        `f"{top[0]} has {top[1]}"`,
    );
    const v = scenario("busiest-assignee").verify(String(r.value), org.world);
    check("dict group-by → argmax", v.pass, String(r.value));
  }

  // ── E: high-urgency-triggered — enum-case traps ────────────────────────────
  console.log("\n[E] high-urgency-triggered");
  {
    const r = await run(
      `hits = pagerduty.list_incidents(urgency="high", status="triggered")\n` +
        `f"{len(hits)} incidents: " + ", ".join([h['id'] for h in hits])`,
    );
    const v = scenario("high-urgency-triggered").verify(String(r.value), org.world);
    check("two pushed-down enums", v.pass, String(r.value).slice(0, 80));
  }

  // ── F: email-top-error — argmax → compose → send (write) ───────────────────
  console.log("\n[F] email-top-error (argmax → compose → write)");
  {
    const r = await run(
      `issues = sentry.list_issues(status="unresolved")\n` +
        `worst = max(issues, key=lambda i: i['count'])\n` +
        `email.send_email(to="oncall@acme.io", subject="Top error", body=f"Worst unresolved error: {worst['title']}")`,
    );
    const v = scenario("email-top-error").verify("", org.world);
    check("read→compose→send in one program", v.pass, JSON.stringify(r.value));
  }

  // ── G: compose-verify-issues — fan-out writes (loop) ───────────────────────
  console.log("\n[G] compose-verify-issues (fan-out writes)");
  {
    const r = await run(
      `hits = [p for p in github.list_pull_requests(state="merged") if p['closes_linear']]\n` +
        `for p in hits:\n` +
        `  github.create_issue(repo="acme/web", title=f"Verify: {p['title']}")\n` +
        `f"opened {len(hits)} issues"`,
    );
    const v = scenario("compose-verify-issues").verify(String(r.value), org.world);
    check("loop of create_issue from a computed list", v.pass, `${String(r.value)} (${v.note ?? ""})`);
  }

  // ── H: decide-and-act in ONE call — SQL's named limit ──────────────────────
  console.log("\n[H] decide-and-act in one program (SQL cannot)");
  {
    const before = org.world.outbox.filter((o) => o.kind === "slack.post_message").length;
    const r = await run(
      `triggered = pagerduty.list_incidents(urgency="high", status="triggered")\n` +
        `if len(triggered) == 0:\n` +
        `  slack.post_message(channel="ops", text="All clear: no high-urgency incidents.")\n` +
        `else:\n` +
        `  email.send_email(to="oncall@acme.io", subject=f"{len(triggered)} high-urgency incidents live", body=", ".join([i['id'] for i in triggered]))`,
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

  // ── I: session persistence — bind once, reuse across calls ─────────────────
  console.log("\n[I] a name persists across calls (the REPL is the scratchpad)");
  {
    const d = await run(`all_prs = github.list_pull_requests()`);
    const c1 = await run(`len(all_prs)`);
    const c2 = await run(`len([p for p in all_prs if p['state'] == 'open'])`);
    const expectedAll = org.world.githubPrs.length;
    const expectedOpen = org.world.githubPrs.filter((p) => p.state === "open").length;
    const defs = d.defs as { all_prs?: { count?: number; peek?: unknown } } | undefined;
    check(
      "bind summary + later reuse",
      d.defined?.[0] === "all_prs" &&
        defs?.all_prs?.count === expectedAll &&
        defs?.all_prs?.peek !== undefined &&
        c1.value === expectedAll &&
        c2.value === expectedOpen,
      `def→${JSON.stringify(d.defs)}, counts ${c1.value}/${c2.value} (expected ${expectedAll}/${expectedOpen})`,
    );
  }

  // ── J: reconcile-ghost-issues — negation join (comprehension reads cleaner) ─
  console.log("\n[J] reconcile-ghost-issues (negation join)");
  {
    const r = await run(
      `by_issue = {}\n` +
        `for p in github.list_pull_requests():\n` +
        `  if p['closes_linear']:\n` +
        `    by_issue.setdefault(p['closes_linear'], []).append(p['state'])\n` +
        `ghosts = [i['id'] for i in linear.list_issues() if i['state'] == 'done' and i['id'] in by_issue and 'merged' not in by_issue[i['id']]]\n` +
        `f"{len(ghosts)} ghost issues: " + ", ".join(ghosts)`,
    );
    const v = scenario("reconcile-ghost-issues").verify(String(r.value), org.world);
    check("NOT-merged filter over a claim map", v.pass, String(r.value).slice(0, 100));
  }

  // ── K: open-prs-breakdown — two-part answer reusing a binding ──────────────
  console.log("\n[K] open-prs-breakdown (two-part, session reuse)");
  {
    await run(`open_prs = github.list_pull_requests(state="open")`);
    const r = await run(
      `by_repo = {}\n` +
        `for p in open_prs:\n` +
        `  by_repo[p['repo']] = by_repo.get(p['repo'], 0) + 1\n` +
        `top = sorted(by_repo.items(), key=lambda kv: kv[1], reverse=True)[0]\n` +
        `f"{len(open_prs)} open PRs; {top[0]} leads with {top[1]}"`,
    );
    const v = scenario("open-prs-breakdown").verify(String(r.value), org.world);
    check("count, then argmax-by-repo reusing the binding", v.pass, String(r.value).slice(0, 100));
  }

  await org.close();
  console.log(`\n${failures === 0 ? "ALL PROBES PASS ✓" : `${failures} PROBE(S) FAILED ✗`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
