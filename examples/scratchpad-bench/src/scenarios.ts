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
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
