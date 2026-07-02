/**
 * Deterministic Lisp probes (NO API): every benchmark scenario hand-authored as
 * the Lisp program a competent model should write, executed against the same
 * seeded world + live MCP servers as the real runs, and graded with the same
 * verifiers. Proves the surface can EXPRESS every task before any model is in
 * the loop — the Lisp-arm analogue of probe.ts / selfcheck.ts.
 *
 * Probe H is the exploration's motivating case: conditional branching
 * (decide-and-act) inside ONE call — the composition the SQL essay names as
 * SQL's honest limit.
 *
 *   pnpm --filter glove-scratchpad-bench probe:lisp
 */
import { LispSession } from "glove-lisp";
import { buildMockOrg } from "./mcp/index";
import { SCENARIOS } from "./scenarios";

let failures = 0;

function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "OK ✓" : "FAIL ✗"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  const org = await buildMockOrg({ scale: 1 });
  const session = LispSession.create({ policy: { writes: true } });
  session.registerAll(org.resources());
  const run = async (code: string) => session.execute(code, { allowWrites: true });
  const scenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    return s;
  };

  // ── A: count-open-prs — single aggregate ───────────────────────────────────
  console.log("\n[A] count-open-prs");
  {
    const r = await run(`(count (github_pull_requests {:state "open"}))`);
    const v = scenario("count-open-prs").verify(String(r.value), org.world);
    check("one-form COUNT", v.pass, `got ${r.value}, expected ${v.expected}`);
  }

  // ── B: sentry-billing-unresolved — filtered lookup, ids + count ────────────
  console.log("\n[B] sentry-billing-unresolved");
  {
    const r = await run(
      `(let [hits (sentry_issues {:status "unresolved" :project "billing"})]
         (str (count hits) " unresolved: " (join ", " (map :id hits))))`,
    );
    const v = scenario("sentry-billing-unresolved").verify(String(r.value), org.world);
    check("filter + ids in one program", v.pass, String(r.value).slice(0, 80));
  }

  // ── C: merged-prs-open-linear — the cross-service JOIN ─────────────────────
  console.log("\n[C] merged-prs-open-linear (cross-service join)");
  {
    const r = await run(
      `(let [done (->> (linear_issues) (filter #(= (:state %) "done")) (map :id))
             hits (->> (github_pull_requests {:state "merged"})
                       (filter #(and (:closes_linear %) (not (contains? done (:closes_linear %))))))]
         (str (count hits) " PRs: "
              (join "; " (map #(str "PR " (:number %) " closes " (:closes_linear %)) hits))))`,
    );
    const v = scenario("merged-prs-open-linear").verify(String(r.value), org.world);
    check("join via filter over two reads", v.pass, String(r.value).slice(0, 100));
  }

  // ── D: busiest-assignee — GROUP BY + argmax ────────────────────────────────
  console.log("\n[D] busiest-assignee (group-by + argmax)");
  {
    const r = await run(
      `(let [freq (frequencies :assignee (linear_issues {:state "in_progress"}))
             top (apply max (vals freq))
             who (first (filter #(= (get freq %) top) (keys freq)))]
         (str who " has " top))`,
    );
    const v = scenario("busiest-assignee").verify(String(r.value), org.world);
    check("frequencies → argmax", v.pass, String(r.value));
  }

  // ── E: high-urgency-triggered — enum-case traps ────────────────────────────
  console.log("\n[E] high-urgency-triggered");
  {
    const r = await run(
      `(let [hits (pagerduty_incidents {:urgency "high" :status "triggered"})]
         (str (count hits) " incidents: " (join ", " (map :id hits))))`,
    );
    const v = scenario("high-urgency-triggered").verify(String(r.value), org.world);
    check("two pushed-down enums", v.pass, String(r.value).slice(0, 80));
  }

  // ── F: email-top-error — argmax → compose → send (write) ───────────────────
  console.log("\n[F] email-top-error (argmax → compose → write)");
  {
    const r = await run(
      `(let [worst (max-key :count (sentry_issues {:status "unresolved"}))]
         (insert! :emails {:to_addr "oncall@acme.io"
                           :subject "Top error"
                           :body (str "Worst unresolved error: " (:title worst))}))`,
    );
    const v = scenario("email-top-error").verify("", org.world);
    check("read→compose→send in one program", v.pass, r.message ?? "");
  }

  // ── G: compose-verify-issues — 15-row fan-out (write) ──────────────────────
  console.log("\n[G] compose-verify-issues (INSERT…SELECT-style fan-out)");
  {
    const r = await run(
      `(let [hits (->> (github_pull_requests {:state "merged"}) (filter :closes_linear))]
         (insert! :github_issues
                  (map #(assoc {} :repo "acme/web" :title (str "Verify: " (:title %))) hits))
         (str "opened " (count hits) " issues"))`,
    );
    const v = scenario("compose-verify-issues").verify(String(r.value), org.world);
    check("bulk insert from a computed list", v.pass, `${String(r.value)} (${v.note ?? ""})`);
  }

  // ── H: conditional branch + act in ONE call — SQL's named limit ────────────
  console.log("\n[H] decide-and-act in one program (SQL cannot)");
  {
    const before = org.world.outbox.filter((o) => o.kind === "slack.post_message").length;
    const r = await run(
      `(let [triggered (pagerduty_incidents {:urgency "high" :status "triggered"})]
         (if (empty? triggered)
           (insert! :slack_messages {:channel "ops" :text "All clear: no high-urgency incidents."})
           (insert! :emails {:to_addr "oncall@acme.io"
                             :subject (str (count triggered) " high-urgency incidents live")
                             :body (join ", " (map :id triggered))})))`,
    );
    const after = org.world.outbox.filter((o) => o.kind === "slack.post_message").length;
    const emails = org.world.outbox.filter((o) => o.kind === "email.send");
    const expected = org.world.pagerIncidents.filter((i) => i.urgency === "high" && i.status === "triggered");
    const tookEmailBranch = expected.length > 0;
    const branchedRight = tookEmailBranch
      ? emails.some((e) => String((e.payload as { subject?: string }).subject ?? "").startsWith(`${expected.length} high-urgency`))
      : after === before + 1;
    check("if/else chose the right side effect", branchedRight, `${expected.length} incidents → ${tookEmailBranch ? "email" : "slack"} branch, message: ${r.message ?? ""}`);
  }

  // ── I: session persistence — def once, reuse across calls ──────────────────
  console.log("\n[I] def persists across calls (the REPL is the scratchpad)");
  {
    const d = await run(`(def all-prs (github_pull_requests))`);
    const c1 = await run(`(count all-prs)`);
    const c2 = await run(`(count (filter #(= (:state %) "open") all-prs))`);
    const expectedAll = org.world.githubPrs.length;
    const expectedOpen = org.world.githubPrs.filter((p) => p.state === "open").length;
    const dv = d.value as { defined?: string; count?: number; peek?: unknown };
    check(
      "def summary + later reuse",
      dv.defined === "all-prs" &&
        dv.count === expectedAll &&
        dv.peek !== undefined && // a peek of real values rides along (anti-fabrication)
        c1.value === expectedAll &&
        c2.value === expectedOpen,
      `def→${JSON.stringify(d.value)}, counts ${c1.value}/${c2.value} (expected ${expectedAll}/${expectedOpen})`,
    );
  }

  await org.close();
  console.log(`\n${failures === 0 ? "ALL PROBES PASS ✓" : `${failures} PROBE(S) FAILED ✗`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
