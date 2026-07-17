/** Compare v1 vs v2 scratchpad runs (weak-model hardening before/after). No API. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./harness/runner";

const RES = join(import.meta.dirname, "..", "results");
const load = (f: string): RunResult[] => JSON.parse(readFileSync(join(RES, f), "utf8"));

const [fa = "agentic-results.json", fb = "v2-results.json"] = process.argv.slice(2);
console.log(`Comparing ${fa} → ${fb} (scratchpad arm)\n`);
const v1 = load(fa).filter((r) => r.arm === "scratchpad");
const v2 = load(fb).filter((r) => r.arm === "scratchpad");
const key = (r: RunResult) => `${r.modelKey}|${r.scenario}`;
const v2map = new Map(v2.map((r) => [key(r), r]));

const models = [...new Set(v1.map((r) => r.modelKey))];
console.log("Scratchpad arm: v1 → v2 (weak-model hardening)\n");
console.log(`${"model".padEnd(9)} ${"scenario".padEnd(26)} pass       toolcalls    turns     peakctx`);
console.log("-".repeat(78));
for (const m of models) {
  for (const a of v1.filter((r) => r.modelKey === m)) {
    const b = v2map.get(key(a));
    if (!b) continue;
    const pf = (r: RunResult) => (r.errored ? "ERR" : r.ok ? "✓" : "✗");
    const d = (x: number, y: number) => (y - x >= 0 ? `+${y - x}` : `${y - x}`);
    console.log(
      `${m.padEnd(9)} ${a.scenario.padEnd(26)} ${pf(a)}→${pf(b)}    ${String(a.toolCalls).padStart(3)}→${String(b.toolCalls).padEnd(3)}(${d(a.toolCalls, b.toolCalls)})  ` +
        `${String(a.turns).padStart(2)}→${String(b.turns).padEnd(2)}   ${String(a.peakContextTokens).padStart(5)}→${b.peakContextTokens}`,
    );
  }
}

const agg = (rows: RunResult[]) => ({
  pass: rows.filter((r) => r.ok).length,
  n: rows.length,
  spirals: rows.filter((r) => r.turns >= 29).length,
  medTc: [...rows].map((r) => r.toolCalls).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  avgPeak: Math.round(rows.reduce((s, r) => s + r.peakContextTokens, 0) / rows.length),
  avgTurns: (rows.reduce((s, r) => s + r.turns, 0) / rows.length).toFixed(1),
});
const a1 = agg(v1);
const a2 = agg(v2.filter((r) => v1.some((x) => key(x) === key(r))));
console.log("\nAGGREGATE (scratchpad):");
console.log(`  v1: pass ${a1.pass}/${a1.n}, spirals(≥29 turns) ${a1.spirals}, median toolcalls ${a1.medTc}, avg turns ${a1.avgTurns}, avg peak ${a1.avgPeak}`);
console.log(`  v2: pass ${a2.pass}/${a2.n}, spirals(≥29 turns) ${a2.spirals}, median toolcalls ${a2.medTc}, avg turns ${a2.avgTurns}, avg peak ${a2.avgPeak}`);
