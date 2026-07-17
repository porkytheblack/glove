/**
 * Five-arm comparison from ONE results file (all arms run on the same seed,
 * models, scenarios, and graders): baseline vs scratchpad(SQL) vs lisp vs
 * jsrepl vs lispfns. No API.
 *
 *   npx tsx src/js-compare.ts [js-ab-results.json]
 *
 * Prints: per-model pass table across arms, per-arm totals + pass%, median peak
 * context per arm (the off-context benefit), the JS-vs-Clojure and
 * function-vs-table head-to-heads, and a dump of every non-passing cell.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./harness/runner";

const RES = join(import.meta.dirname, "..", "results");
const file = process.argv[2] ?? "js-ab-results.json";
const rows: RunResult[] = JSON.parse(readFileSync(join(RES, file), "utf8"));

const ARMS = ["baseline", "scratchpad", "lisp", "jsrepl", "lispfns", "pyrepl"] as const;
const ARM_LABEL: Record<string, string> = {
  baseline: "baseline",
  scratchpad: "SQL",
  lisp: "lisp",
  jsrepl: "jsrepl",
  lispfns: "lispfns",
  pyrepl: "pyrepl",
};
const MODEL_LABEL: Record<string, string> = {
  kimi27: "Kimi K2.7 Code",
  glm5: "GLM-5",
  minimax3: "MiniMax M3",
  deepseek: "DeepSeek V3.2",
  kimi: "Kimi K2.5",
  minimax: "MiniMax M2.5",
  xiaomi: "Xiaomi MiMo v2.5",
  glm: "GLM 4.7 Flash",
  dsflash: "DeepSeek V4 Flash",
  qwen30b: "Qwen3 30B A3B",
  qwen8b: "Qwen3 8B",
};
const TIER: Record<string, string> = {
  kimi27: "frontier", glm5: "frontier", minimax3: "frontier", deepseek: "frontier",
  kimi: "mid", minimax: "mid", xiaomi: "mid", glm: "mid",
  dsflash: "weak", qwen30b: "weak", qwen8b: "weak",
};

const armsPresent = ARMS.filter((a) => rows.some((r) => r.arm === a));
const models = [...new Set(rows.map((r) => r.modelKey))].sort(
  (a, b) => Object.keys(MODEL_LABEL).indexOf(a) - Object.keys(MODEL_LABEL).indexOf(b),
);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const cell = (m: string, a: string) => rows.filter((r) => r.modelKey === m && r.arm === a);
const pass = (rs: RunResult[]) => rs.filter((r) => r.ok).length;
const graded = (rs: RunResult[]) => rs.filter((r) => !r.errored).length;

console.log(`Five arms, same servers/tasks/graders — ${file}\n`);
const head = `${"model".padEnd(18)}${"tier".padEnd(10)}` + armsPresent.map((a) => ARM_LABEL[a].padStart(10)).join("");
console.log(head);
console.log("-".repeat(head.length));

const totals: Record<string, { p: number; n: number }> = {};
for (const a of armsPresent) totals[a] = { p: 0, n: 0 };

for (const m of models) {
  const tier = TIER[m] ?? "";
  let line = `${(MODEL_LABEL[m] ?? m).padEnd(18)}${tier.padEnd(10)}`;
  for (const a of armsPresent) {
    const rs = cell(m, a);
    const p = pass(rs);
    const n = graded(rs);
    totals[a].p += p;
    totals[a].n += n;
    line += `${(n ? `${p}/${n}` : "—").padStart(10)}`;
  }
  console.log(line);
}
console.log("-".repeat(head.length));
let totLine = `${"TOTAL".padEnd(18)}${"".padEnd(10)}`;
for (const a of armsPresent) totLine += `${`${totals[a].p}/${totals[a].n}`.padStart(10)}`;
console.log(totLine);
let pctLine = `${"pass%".padEnd(18)}${"".padEnd(10)}`;
for (const a of armsPresent) pctLine += `${`${Math.round((totals[a].p / Math.max(1, totals[a].n)) * 100)}%`.padStart(10)}`;
console.log(pctLine);

console.log("\nPeak context (median tokens per cell), and reduction vs baseline:");
const baselinePeak = median(rows.filter((r) => r.arm === "baseline").map((r) => r.peakContextTokens));
for (const a of armsPresent) {
  const p = median(rows.filter((r) => r.arm === a).map((r) => r.peakContextTokens));
  const factor = a === "baseline" || !p ? "" : `  (${(baselinePeak / p).toFixed(1)}× less than baseline)`;
  console.log(`  ${ARM_LABEL[a].padEnd(10)} ${p.toLocaleString().padStart(7)}${factor}`);
}

// Head-to-heads on the shared function catalog.
const h2h = (a: string, b: string) => {
  let aw = 0;
  let bw = 0;
  let tie = 0;
  for (const m of models)
    for (const s of [...new Set(rows.map((r) => r.scenario))]) {
      const ra = rows.find((r) => r.modelKey === m && r.scenario === s && r.arm === a);
      const rb = rows.find((r) => r.modelKey === m && r.scenario === s && r.arm === b);
      if (!ra || !rb || ra.errored || rb.errored) continue;
      if (ra.ok && !rb.ok) aw++;
      else if (rb.ok && !ra.ok) bw++;
      else tie++;
    }
  return `${ARM_LABEL[a]} ${aw} — ${bw} ${ARM_LABEL[b]}  (${tie} ties)`;
};
if (armsPresent.includes("jsrepl") && armsPresent.includes("lispfns"))
  console.log(`\nJS vs Clojure (same fn catalog): ${h2h("jsrepl", "lispfns")}`);
if (armsPresent.includes("lispfns") && armsPresent.includes("lisp"))
  console.log(`function mode vs table mode (lisp): ${h2h("lispfns", "lisp")}`);
if (armsPresent.includes("jsrepl") && armsPresent.includes("scratchpad"))
  console.log(`jsrepl vs SQL: ${h2h("jsrepl", "scratchpad")}`);
if (armsPresent.includes("pyrepl") && armsPresent.includes("jsrepl"))
  console.log(`\nPython vs JS (same fn catalog): ${h2h("pyrepl", "jsrepl")}`);
if (armsPresent.includes("pyrepl") && armsPresent.includes("lispfns"))
  console.log(`Python vs Clojure (same fn catalog): ${h2h("pyrepl", "lispfns")}`);

const errored = rows.filter((r) => r.errored);
if (errored.length) console.log(`\ncells lost to provider errors (not graded failures): ${errored.length}`);
console.log("\nnon-passing cells:");
for (const r of rows.filter((r) => !r.ok)) {
  console.log(
    `  ${r.modelKey.padEnd(9)} ${r.arm.padEnd(11)} ${r.scenario.padEnd(26)} ${r.errored ? "(PROVIDER ERROR)" : ""} turns=${r.turns} | ${String(r.finalText).slice(0, 64)}`,
  );
}
