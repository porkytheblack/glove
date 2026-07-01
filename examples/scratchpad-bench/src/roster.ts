/** Roster analysis: per-model + per-tier baseline vs scratchpad A/B. No API. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./harness/runner";
import { MODELS } from "./models";

const RES = join(import.meta.dirname, "..", "results");
const file = process.argv[2] ?? "roster-results.json";
const rows: RunResult[] = JSON.parse(readFileSync(join(RES, file), "utf8"));
const tierOf = new Map(MODELS.map((m) => [m.key, m.tier]));
const labelOf = new Map(MODELS.map((m) => [m.key, m.label]));

const cell = (modelKey: string, arm: string) => rows.filter((r) => r.modelKey === modelKey && r.arm === arm);
const rate = (rs: RunResult[]) => `${rs.filter((r) => r.ok).length}/${rs.length}`;
const med = (rs: RunResult[], f: (r: RunResult) => number) => {
  const s = rs.map(f).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const models = [...new Set(rows.map((r) => r.modelKey))].sort(
  (a, b) => ["frontier", "mid", "weak"].indexOf(tierOf.get(a) ?? "z") - ["frontier", "mid", "weak"].indexOf(tierOf.get(b) ?? "z"),
);

console.log(`Roster A/B (${file})\n`);
console.log(`${"model".padEnd(18)} ${"tier".padEnd(9)} pass(base→scr)  peak(base→scr)   toolcalls(base→scr)`);
console.log("-".repeat(82));
for (const m of models) {
  const base = cell(m, "baseline");
  const scr = cell(m, "scratchpad");
  if (!base.length && !scr.length) continue;
  const pk = (rs: RunResult[]) => (rs.length ? med(rs, (r) => r.peakContextTokens) : 0);
  console.log(
    `${(labelOf.get(m) ?? m).padEnd(18)} ${(tierOf.get(m) ?? "?").padEnd(9)} ` +
      `${rate(base).padStart(4)} → ${rate(scr).padEnd(4)}    ` +
      `${String(pk(base)).padStart(5)} → ${String(pk(scr)).padEnd(5)}   ` +
      `${String(med(base, (r) => r.toolCalls)).padStart(2)} → ${med(scr, (r) => r.toolCalls)}`,
  );
}

for (const tier of ["frontier", "mid", "weak"]) {
  const keys = models.filter((m) => tierOf.get(m) === tier);
  if (!keys.length) continue;
  const base = keys.flatMap((m) => cell(m, "baseline"));
  const scr = keys.flatMap((m) => cell(m, "scratchpad"));
  if (!base.length && !scr.length) continue;
  console.log(
    `\n${tier.toUpperCase()}: pass base ${rate(base)} → scr ${rate(scr)} · ` +
      `avg peak base ${base.length ? Math.round(base.reduce((s, r) => s + r.peakContextTokens, 0) / base.length) : "–"} → ` +
      `scr ${scr.length ? Math.round(scr.reduce((s, r) => s + r.peakContextTokens, 0) / scr.length) : "–"}`,
  );
}
