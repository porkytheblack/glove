/** Production-scale analysis: 40 servers / 367 tools / 72 tables, ~95% noise.
 *  Usage: npx tsx src/prod-analysis.ts */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./harness/runner";

const RES = join(import.meta.dirname, "..", "results");
const load = (f: string): RunResult[] => {
  try {
    return JSON.parse(readFileSync(join(RES, f), "utf8"));
  } catch {
    return [];
  }
};
const prod = load("prod-results.json");
const bare = load("prodbare-results.json");
const SCEN = ["incident-commander", "heavy-pr-audit", "needle-sweep"];
const ARMS = ["baseline", "scratchpad", "lisp", "both"];
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

console.log("═══ PRODUCTION SCALE — 40 servers · 367 tools · 72 tables ═══\n");
console.log(`${"scenario".padEnd(22)} ${ARMS.map((a) => a.padEnd(12)).join("")}`);
for (const s of SCEN) {
  const cells = ARMS.map((a) => {
    const rows = prod.filter((r) => r.scenario === s && r.arm === a);
    if (!rows.length) return "—".padEnd(12);
    const p = rows.filter((r) => r.ok).length;
    const e = rows.filter((r) => r.errored).length;
    return `${p}/${rows.length}${e ? `(${e}e)` : ""}`.padEnd(12);
  });
  console.log(`${s.padEnd(22)} ${cells.join("")}`);
}
console.log();
for (const a of ARMS) {
  const rows = prod.filter((r) => r.arm === a);
  if (!rows.length) continue;
  const ok = rows.filter((r) => r.ok).length;
  const graded = rows.filter((r) => !r.errored);
  const peak = median(rows.map((r) => r.peakContextTokens));
  const turns = median(rows.map((r) => r.turns));
  const cost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const tokIn = rows.reduce((s, r) => s + r.tokensIn, 0);
  console.log(
    `${a.padEnd(11)} pass ${ok}/${rows.length} (graded ${graded.filter((r) => r.ok).length}/${graded.length}) · median peak ${peak.toLocaleString()} · median turns ${turns} · arm cost $${cost.toFixed(3)} · tokens-in ${(tokIn / 1e6).toFixed(2)}M`,
  );
}

if (bare.length) {
  console.log("\n─── bare at production scale (no preamble; discovery across 72 tables) ───");
  for (const a of ["scratchpad", "lisp"]) {
    const b = bare.filter((r) => r.arm === a);
    const p = prod.filter((r) => r.arm === a);
    if (!b.length) continue;
    const bp = b.filter((r) => r.ok).length;
    const pp = p.filter((r) => r.ok).length;
    console.log(
      `${a.padEnd(11)} primed ${pp}/${p.length} → bare ${bp}/${b.length} · median peak primed ${median(p.map((r) => r.peakContextTokens)).toLocaleString()} → bare ${median(b.map((r) => r.peakContextTokens)).toLocaleString()}`,
    );
  }
}

console.log("\nfails (graded):");
for (const r of [...prod, ...bare].filter((r) => !r.ok && !r.errored)) {
  const src = prod.includes(r) ? r.arm : `${r.arm}-BARE`;
  console.log(`  ${r.modelKey.padEnd(9)} ${src.padEnd(15)} ${r.scenario.padEnd(20)} turns ${String(r.turns).padStart(2)} peak ${String(r.peakContextTokens).padStart(6)} | ${String(r.finalText).slice(0, 56)}`);
}
