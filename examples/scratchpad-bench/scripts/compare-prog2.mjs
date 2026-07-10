#!/usr/bin/env node
/** Compare repl-noise-prog (progressive, eager shapes, no search) vs
 *  repl-noise-prog2 (progressive, LAZY shapes + search_functions tier).
 *  Reconciles: discovery hop-mix, search adoption, pass rate, peak context. */
import { readFileSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const A = load("../results/repl-noise-prog-results.json");   // baseline
const B = load("../results/repl-noise-prog2-results.json");  // lazy + search

const ARMS = ["pyrepl", "jsrepl", "lispfns"];
const DISC = ["list_servers", "list_functions", "describe_function", "search_functions"];

function key(r) { return `${r.modelKey}/${r.scenario}/${r.arm}`; }
const byKey = (rows) => Object.fromEntries(rows.map((r) => [key(r), r]));

function sumMix(rows, arm, tool) {
  return rows.filter((r) => r.arm === arm).reduce((s, r) => s + (r.toolMix?.[tool] ?? 0), 0);
}
function passes(rows, arm) {
  const a = rows.filter((r) => r.arm === arm);
  return `${a.filter((r) => r.ok).length}/${a.length}`;
}
function medianPeak(rows, arm) {
  const v = rows.filter((r) => r.arm === arm).map((r) => r.peakContextTokens).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

console.log(`# repl-noise-prog  →  repl-noise-prog2   (A=${A.length} cells, B=${B.length} cells)\n`);

console.log("## Per-arm discovery hop-mix (summed across all cells)");
console.log("arm      | list_servers | list_functions | describe_function | search_functions | pass A→B | medianPeak A→B");
for (const arm of ARMS) {
  const ls = `${sumMix(A, arm, "list_servers")}→${sumMix(B, arm, "list_servers")}`;
  const lf = `${sumMix(A, arm, "list_functions")}→${sumMix(B, arm, "list_functions")}`;
  const df = `${sumMix(A, arm, "describe_function")}→${sumMix(B, arm, "describe_function")}`;
  const sf = `${sumMix(A, arm, "search_functions")}→${sumMix(B, arm, "search_functions")}`;
  const pass = `${passes(A, arm)}→${passes(B, arm)}`;
  const peak = `${(medianPeak(A, arm) / 1000).toFixed(1)}k→${(medianPeak(B, arm) / 1000).toFixed(1)}k`;
  console.log(`${arm.padEnd(8)} | ${ls.padEnd(12)} | ${lf.padEnd(14)} | ${df.padEnd(17)} | ${sf.padEnd(16)} | ${pass.padEnd(8)} | ${peak}`);
}

console.log("\n## Totals across all fn arms");
const allA = A.filter((r) => ARMS.includes(r.arm));
const allB = B.filter((r) => ARMS.includes(r.arm));
const tot = (rows, tool) => rows.reduce((s, r) => s + (r.toolMix?.[tool] ?? 0), 0);
for (const tool of DISC) console.log(`  ${tool.padEnd(18)}: ${tot(allA, tool)} → ${tot(allB, tool)}`);
console.log(`  browse hops (servers+functions): ${tot(allA, "list_servers") + tot(allA, "list_functions")} → ${tot(allB, "list_servers") + tot(allB, "list_functions")}`);
console.log(`  pass rate (all fn arms): ${allA.filter((r) => r.ok).length}/${allA.length} → ${allB.filter((r) => r.ok).length}/${allB.length}`);

console.log("\n## qwen30b (the weak-tail model) — did search recover it?");
for (const arm of ARMS) {
  const qa = A.filter((r) => r.modelKey === "qwen30b" && r.arm === arm);
  const qb = B.filter((r) => r.modelKey === "qwen30b" && r.arm === arm);
  const mixB = qb.map((r) => `${r.scenario.slice(0,6)}:${JSON.stringify(r.toolMix)}`).join("  ");
  console.log(`  ${arm.padEnd(8)} pass ${qa.filter((r)=>r.ok).length}/${qa.length}→${qb.filter((r)=>r.ok).length}/${qb.length}  | B toolMix: ${mixB}`);
}

console.log("\n## Per-cell toolMix delta (search vs browse), all cells");
const bk = byKey(A);
for (const r of B) {
  const a = bk[key(r)];
  const am = a?.toolMix ?? {};
  const bm = r.toolMix ?? {};
  const fmt = (m) => DISC.filter((t) => m[t]).map((t) => `${t.replace("_functions","_fn").replace("list_","")}=${m[t]}`).join(",") || "—";
  const flip = (a?.ok ? "P" : "F") + "→" + (r.ok ? "P" : "F");
  console.log(`  ${key(r).padEnd(34)} ${flip}  [${fmt(am)}]  ⇒  [${fmt(bm)}]`);
}
