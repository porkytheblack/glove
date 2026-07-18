/** Three-arm comparison: baseline vs scratchpad(SQL) vs lisp, per model. No API.
 *  Sources: baseline+scratchpad from the paper's runs (v5 for the original five,
 *  roster/lastmile for the newer six); lisp from the run named in argv[2]
 *  (default lisp-ab3). */
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

const lispFile = process.argv[2] ?? "lisp-ab3-results.json";
const lisp = load(lispFile).filter((r) => r.arm === "lisp");
// Best-known SQL/baseline cells: later files override earlier ones per (model, scenario, arm).
const known = new Map<string, RunResult>();
for (const f of ["agentic-results.json", "v5-results.json", "roster-results.json", "lastmile-results.json"]) {
  for (const r of load(f)) known.set(`${r.modelKey}|${r.scenario}|${r.arm}`, r);
}
const MODELS = [
  ["kimi27", "Kimi K2.7 Code", "frontier"],
  ["glm5", "GLM-5", "frontier"],
  ["minimax3", "MiniMax M3", "frontier"],
  ["deepseek", "DeepSeek V3.2", "frontier"],
  ["kimi", "Kimi K2.5", "mid"],
  ["minimax", "MiniMax M2.5", "mid"],
  ["xiaomi", "Xiaomi MiMo v2.5", "mid"],
  ["glm", "GLM 4.7 Flash", "mid"],
  ["dsflash", "DeepSeek V4 Flash", "weak"],
  ["qwen30b", "Qwen3 30B A3B", "weak"],
  ["qwen8b", "Qwen3 8B", "weak"],
] as const;
const SCEN = ["count-open-prs", "sentry-billing-unresolved", "merged-prs-open-linear", "busiest-assignee", "high-urgency-triggered", "email-top-error", "compose-verify-issues"];

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const cellPass = (m: string, arm: string) =>
  SCEN.filter((s) => (arm === "lisp" ? lisp.find((r) => r.modelKey === m && r.scenario === s) : known.get(`${m}|${s}|${arm}`))?.ok).length;
const cellsHave = (m: string, arm: string) =>
  SCEN.filter((s) => (arm === "lisp" ? lisp.find((r) => r.modelKey === m && r.scenario === s) : known.get(`${m}|${s}|${arm}`))).length;

console.log(`Three arms, same servers, same tasks, same graders (lisp: ${lispFile})\n`);
console.log(`${"model".padEnd(18)} tier      baseline  scratchpad  lisp    lisp peak-ctx (median)`);
console.log("-".repeat(86));
const tot = { b: 0, bn: 0, s: 0, sn: 0, l: 0, ln: 0 };
for (const [key, label, tier] of MODELS) {
  const b = cellPass(key, "baseline");
  const bn = cellsHave(key, "baseline");
  const s = cellPass(key, "scratchpad");
  const sn = cellsHave(key, "scratchpad");
  const l = cellPass(key, "lisp");
  const ln = cellsHave(key, "lisp");
  const peak = median(lisp.filter((r) => r.modelKey === key).map((r) => r.peakContextTokens));
  tot.b += b;
  tot.bn += bn;
  tot.s += s;
  tot.sn += sn;
  tot.l += l;
  tot.ln += ln;
  console.log(
    `${label.padEnd(18)} ${tier.padEnd(9)} ${bn ? `${b}/${bn}` : "  — "}      ${sn ? `${s}/${sn}` : "  — "}        ${ln ? `${l}/${ln}` : " — "}    ${peak ? peak.toLocaleString() : ""}`,
  );
}
console.log("-".repeat(86));
console.log(
  `${"TOTAL".padEnd(18)}           ${tot.b}/${tot.bn}    ${tot.s}/${tot.sn}      ${tot.l}/${tot.ln}` +
    `   (${Math.round((tot.b / Math.max(1, tot.bn)) * 100)}% / ${Math.round((tot.s / Math.max(1, tot.sn)) * 100)}% / ${Math.round((tot.l / Math.max(1, tot.ln)) * 100)}%)`,
);
const errored = lisp.filter((r) => r.errored).length;
if (errored) console.log(`\nlisp cells lost to provider errors (not graded failures): ${errored}`);
console.log("\nlisp fails:");
for (const r of lisp.filter((r) => !r.ok)) {
  console.log(`  ${r.modelKey.padEnd(9)} ${r.scenario.padEnd(26)} ${r.errored ? "(PROVIDER ERROR)" : ""} turns=${r.turns} | ${String(r.finalText).slice(0, 70)}`);
}
