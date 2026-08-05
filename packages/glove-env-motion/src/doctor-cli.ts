/**
 * `pnpm exec glove-motion-doctor` — the whole configuration story in one
 * command: what this host can render, and the exact line that fixes anything
 * it cannot.
 */
import { doctor } from "./doctor";

const report = await doctor({ resolveFrom: process.cwd() });

for (const check of report.checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.name.padEnd(11)} ${check.detail}`);
  if (check.fix) console.log(`  ${" ".repeat(11)} fix: ${check.fix}`);
}

console.log(
  report.ok
    ? "\nready — env:motion can render on this host"
    : "\nnot ready — apply the fix lines above, then run this again",
);
process.exit(report.ok ? 0 : 1);
