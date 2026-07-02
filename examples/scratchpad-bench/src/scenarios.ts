/**
 * Benchmark tasks. Each is a realistic cross-service ops request whose correct
 * answer is COMPUTED from the seeded world — so grading is deterministic, not an
 * LLM-judge. Read scenarios grade the final answer; write scenarios grade the
 * real side effect (the outbox), which is unforgeable.
 *
 * Difficulty is deliberately skewed toward multi-service composition — the place
 * a single `execute_sql` (JOIN / GROUP BY / INSERT…SELECT) should pull ahead of
 * fetch-everything-into-context.
 */
import type { World } from "./mcp/seed";

export interface VerifyResult {
  pass: boolean;
  expected: unknown;
  note?: string;
}

export interface Scenario {
  id: string;
  title: string;
  prompt: string;
  requiresWrites?: boolean;
  verify: (finalText: string, world: World) => VerifyResult;
}

// ── grading helpers ──────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase();
/** The integer n appears as a standalone token (not a substring of a bigger number). */
function hasNumber(text: string, n: number): boolean {
  return new RegExp(`(^|[^\\d])${n}([^\\d]|$)`).test(text);
}
function fractionPresent(text: string, ids: string[]): number {
  if (ids.length === 0) return 1;
  const t = norm(text);
  return ids.filter((id) => t.includes(norm(id))).length / ids.length;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "count-open-prs",
    title: "Count open PRs across all repos",
    prompt:
      "How many GitHub pull requests are currently in the 'open' state across all repositories? Reply with the exact number.",
    verify: (text, w) => {
      const expected = w.githubPrs.filter((p) => p.state === "open").length;
      return { pass: hasNumber(text, expected), expected };
    },
  },
  {
    id: "sentry-billing-unresolved",
    title: "Unresolved Sentry issues in billing",
    prompt:
      "List the ids of all UNRESOLVED Sentry issues in the 'billing' project, and state exactly how many there are.",
    verify: (text, w) => {
      const hits = w.sentryIssues.filter((i) => i.status === "unresolved" && i.project === "billing");
      const ids = hits.map((i) => i.id);
      const pass = hasNumber(text, hits.length) && fractionPresent(text, ids) >= 0.7;
      return { pass, expected: { count: hits.length, ids } };
    },
  },
  {
    id: "merged-prs-open-linear",
    title: "Merged PRs closing not-done Linear issues (JOIN)",
    prompt:
      "Find every MERGED pull request that closes a Linear issue whose state is NOT 'done'. " +
      "Report each PR number together with the Linear issue id it closes, and the total count.",
    verify: (text, w) => {
      const byId = new Map(w.linearIssues.map((i) => [i.id, i]));
      const hits = w.githubPrs.filter(
        (p) => p.state === "merged" && p.closes_linear && byId.get(p.closes_linear) && byId.get(p.closes_linear)!.state !== "done",
      );
      const prNums = hits.map((p) => String(p.number));
      const pass = hasNumber(text, hits.length) && fractionPresent(text, prNums) >= 0.6;
      return { pass, expected: { count: hits.length, prs: hits.map((p) => ({ pr: p.number, closes: p.closes_linear })) } };
    },
  },
  {
    id: "busiest-assignee",
    title: "Assignee with most in-progress Linear issues (GROUP BY + max)",
    prompt:
      "Which single person has the most Linear issues in the 'in_progress' state assigned to them, and exactly how many do they have? Give their login and the count.",
    verify: (text, w) => {
      const counts = new Map<string, number>();
      for (const i of w.linearIssues) if (i.state === "in_progress") counts.set(i.assignee, (counts.get(i.assignee) ?? 0) + 1);
      let top = "";
      let max = -1;
      for (const [k, v] of counts) if (v > max) ((max = v), (top = k));
      // Ties: accept any assignee that ties the max.
      const tied = [...counts.entries()].filter(([, v]) => v === max).map(([k]) => k);
      const pass = hasNumber(text, max) && tied.some((k) => norm(text).includes(norm(k)));
      return { pass, expected: { top, count: max, tied } };
    },
  },
  {
    id: "high-urgency-triggered",
    title: "High-urgency PagerDuty incidents still triggered",
    prompt:
      "How many HIGH-urgency PagerDuty incidents are still in the 'triggered' state (not acknowledged, not resolved)? List their ids.",
    verify: (text, w) => {
      const hits = w.pagerIncidents.filter((i) => i.urgency === "high" && i.status === "triggered");
      const ids = hits.map((i) => i.id);
      const pass = hasNumber(text, hits.length) && fractionPresent(text, ids) >= 0.7;
      return { pass, expected: { count: hits.length, ids } };
    },
  },
  {
    id: "email-top-error",
    title: "Email oncall about the worst unresolved error (write)",
    requiresWrites: true,
    prompt:
      "Find the UNRESOLVED Sentry issue with the highest event count. Then send an email to 'oncall@acme.io' " +
      "with the subject 'Top error' whose body contains that issue's exact title. Confirm what you sent.",
    verify: (_text, w) => {
      const worst = [...w.sentryIssues.filter((i) => i.status === "unresolved")].sort((a, b) => b.count - a.count)[0];
      const sent = w.outbox.filter((o) => o.kind === "email.send");
      const match = sent.find((o) => {
        const p = o.payload as { to?: string; subject?: string; body?: string };
        return norm(p.to ?? "") === "oncall@acme.io" && norm(p.body ?? "").includes(norm(worst.title));
      });
      return { pass: Boolean(match), expected: { title: worst.title, count: worst.count, id: worst.id }, note: `${sent.length} email(s) sent` };
    },
  },
  {
    id: "compose-verify-issues",
    title: "Open a verify issue per merged PR that closes Linear (compose/write)",
    requiresWrites: true,
    prompt:
      "For every MERGED pull request in ANY repository that closes a Linear issue, open one new GitHub issue " +
      "(always in the 'acme/web' repository) whose title is exactly 'Verify: ' followed by that pull request's title. " +
      "Do not skip any repository. Then tell me exactly how many issues you opened.",
    verify: (text, w) => {
      const expected = w.githubPrs.filter((p) => p.state === "merged" && p.closes_linear).length;
      const opened = w.outbox.filter((o) => o.kind === "github.create_issue" && norm(String((o.payload as { title?: string }).title ?? "")).startsWith("verify:"));
      const pass = opened.length === expected && hasNumber(text, expected);
      return { pass, expected: { count: expected }, note: `${opened.length} issue(s) opened` };
    },
  },
  {
    id: "incident-branch",
    title: "Decide-and-act: all-clear to Slack OR alert email (branching write)",
    requiresWrites: true,
    prompt:
      "Check PagerDuty. If there are NO incidents with urgency 'high' currently in the 'triggered' state, post exactly " +
      "'All clear.' to the 'incidents' Slack channel and do nothing else. If there ARE any, do NOT post to Slack — " +
      "instead send ONE email to 'oncall@acme.io' with the subject 'Triage' whose body lists every such incident's id. " +
      "Then tell me which action you took and how many such incidents there are.",
    verify: (text, w) => {
      const live = w.pagerIncidents.filter((i) => i.urgency === "high" && i.status === "triggered");
      const ids = live.map((i) => i.id);
      const mails = w.outbox.filter(
        (o) => o.kind === "email.send" && norm(String((o.payload as { subject?: string }).subject ?? "")).includes("triage"),
      );
      const slacks = w.outbox.filter(
        (o) => o.kind === "slack.post_message" && norm(String((o.payload as { text?: string }).text ?? "")).includes("all clear"),
      );
      if (ids.length > 0) {
        const body = mails.length === 1 ? String((mails[0].payload as { body?: string }).body ?? "") : "";
        const pass =
          mails.length === 1 && slacks.length === 0 && fractionPresent(body, ids) >= 0.75 && hasNumber(text, ids.length);
        return { pass, expected: { branch: "email", count: ids.length, ids }, note: `${mails.length} mail(s), ${slacks.length} slack(s)` };
      }
      const pass = slacks.length === 1 && mails.length === 0;
      return { pass, expected: { branch: "slack", count: 0 }, note: `${mails.length} mail(s), ${slacks.length} slack(s)` };
    },
  },
  {
    id: "open-prs-breakdown",
    title: "Two-part: total open PRs, then which repo leads (reuse)",
    prompt:
      "Two related questions — answer both precisely: (a) exactly how many OPEN pull requests are there across all " +
      "repositories? (b) among those open pull requests, which repository has the most, and how many does it have?",
    verify: (text, w) => {
      const open = w.githubPrs.filter((p) => p.state === "open");
      const byRepo = new Map<string, number>();
      for (const p of open) byRepo.set(p.repo, (byRepo.get(p.repo) ?? 0) + 1);
      const max = Math.max(...byRepo.values());
      const leaders = [...byRepo.entries()].filter(([, n]) => n === max).map(([r]) => r);
      const t = norm(text);
      const pass = hasNumber(text, open.length) && hasNumber(text, max) && leaders.some((r) => t.includes(norm(r)));
      return { pass, expected: { total: open.length, top: leaders, topCount: max } };
    },
  },
  // ── the complex suite: multi-hop composition, negation, conditional fan-out ──
  {
    id: "reconcile-ghost-issues",
    title: "Negation join: 'done' issues whose closing PR never merged",
    prompt:
      "Quality audit: find every Linear issue whose state is 'done' but that is NOT actually closed by any MERGED " +
      "pull request — consider only issues that at least one pull request claims to close (via its closes_linear " +
      "field). Report the exact count and every such issue id.",
    verify: (text, w) => {
      const byIssue = new Map<string, string[]>();
      for (const p of w.githubPrs) {
        if (p.closes_linear) byIssue.set(p.closes_linear, [...(byIssue.get(p.closes_linear) ?? []), p.state]);
      }
      const ghosts = w.linearIssues
        .filter((i) => i.state === "done" && byIssue.has(i.id) && !byIssue.get(i.id)!.includes("merged"))
        .map((i) => i.id);
      const pass = hasNumber(text, ghosts.length) && fractionPresent(text, ghosts) >= 0.99;
      return { pass, expected: { count: ghosts.length, ids: ghosts } };
    },
  },
  {
    id: "repo-health-report",
    title: "Multi-metric grouped report across every repository",
    prompt:
      "Produce a per-repository health report. For EACH repository give exactly two numbers: (1) how many OPEN " +
      "pull requests it has, and (2) how many of its MERGED pull requests close a Linear issue. Then name the " +
      "repository with the most open pull requests.",
    verify: (text, w) => {
      const per = new Map<string, { open: number; mc: number }>();
      for (const p of w.githubPrs) {
        const e = per.get(p.repo) ?? { open: 0, mc: 0 };
        if (p.state === "open") e.open++;
        if (p.state === "merged" && p.closes_linear) e.mc++;
        per.set(p.repo, e);
      }
      const entries = [...per.entries()];
      const max = Math.max(...entries.map(([, e]) => e.open));
      const leaders = entries.filter(([, e]) => e.open === max).map(([r]) => r);
      const t = norm(text);
      const numbers = entries.flatMap(([, e]) => [e.open, e.mc]);
      const present = numbers.filter((n) => hasNumber(text, n)).length;
      const reposNamed = entries.filter(([r]) => t.includes(norm(r))).length;
      const pass = present >= numbers.length - 1 && reposNamed === entries.length && leaders.some((r) => t.includes(norm(r))) && hasNumber(text, max);
      return { pass, expected: { perRepo: Object.fromEntries(entries), top: leaders }, note: `${present}/${numbers.length} numbers, ${reposNamed}/${entries.length} repos named` };
    },
  },
  {
    id: "escalate-hot-services",
    title: "Conditional escalation: ack fan-out + rollup email OR all-clear (write)",
    requiresWrites: true,
    prompt:
      "Escalation sweep. A service is HOT if it has MORE THAN 5 unresolved Sentry issues (the Sentry 'project' " +
      "field is the service name). If there are NO hot services, post exactly 'Sentry stable.' to the 'incidents' " +
      "Slack channel and stop. Otherwise: (1) acknowledge EVERY PagerDuty incident currently in 'triggered' status " +
      "whose service is hot (any urgency), and (2) send ONE email to 'oncall@acme.io' with subject 'Escalation' " +
      "whose body lists each hot service and its unresolved issue count. Finally report how many hot services there " +
      "are and how many incidents you acknowledged.",
    verify: (text, w) => {
      const unres = new Map<string, number>();
      for (const si of w.sentryIssues) {
        if (si.status === "unresolved") unres.set(si.project, (unres.get(si.project) ?? 0) + 1);
      }
      const hot = [...unres.entries()].filter(([, n]) => n > 5).map(([svc]) => svc);
      const expectAck = w.pagerIncidents.filter((i) => i.status === "triggered" && hot.includes(i.service)).map((i) => i.id);
      const acked = w.outbox.filter((o) => o.kind === "pagerduty.ack").map((o) => String((o.payload as { id?: string }).id));
      const mails = w.outbox.filter(
        (o) => o.kind === "email.send" && norm(String((o.payload as { subject?: string }).subject ?? "")).includes("escalation"),
      );
      const stable = w.outbox.filter(
        (o) => o.kind === "slack.post_message" && norm(String((o.payload as { text?: string }).text ?? "")).includes("sentry stable"),
      );
      if (hot.length === 0) {
        return { pass: stable.length === 1 && mails.length === 0 && acked.length === 0, expected: { branch: "slack" } };
      }
      const ackSet = new Set(acked);
      const ackedRight = expectAck.every((id) => ackSet.has(id)) && acked.length === expectAck.length;
      const body = mails.length === 1 ? String((mails[0].payload as { body?: string }).body ?? "") : "";
      const bodyNames = hot.filter((svc) => norm(body).includes(norm(svc))).length;
      const pass =
        ackedRight && mails.length === 1 && stable.length === 0 && bodyNames >= Math.ceil(hot.length * 0.75) &&
        hasNumber(text, hot.length) && hasNumber(text, expectAck.length);
      return {
        pass,
        expected: { branch: "email", hot, acks: expectAck },
        note: `acked ${acked.length}/${expectAck.length}, ${mails.length} mail(s), body named ${bodyNames}/${hot.length}`,
      };
    },
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
