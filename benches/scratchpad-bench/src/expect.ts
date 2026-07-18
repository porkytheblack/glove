/** Print each scenario's computed expected value (no API) — catches degenerate verifiers. */
import { buildWorld } from "./mcp/seed";
import { SCENARIOS } from "./scenarios";

const scale = Number(process.env.BENCH_SCALE ?? process.argv[2] ?? 1);
const w = buildWorld(1337, scale);
console.log(`scale=${scale}: ${w.githubPrs.length} PRs, ${w.linearIssues.length} Linear, ${w.sentryIssues.length} Sentry, ${w.pagerIncidents.length} PD, ${w.emails.length} emails\n`);
for (const s of SCENARIOS) {
  const v = s.verify("", w);
  console.log(`${s.id.padEnd(26)} write=${s.requiresWrites ? "Y" : "n"}  expected=${JSON.stringify(v.expected).slice(0, 140)}`);
}
