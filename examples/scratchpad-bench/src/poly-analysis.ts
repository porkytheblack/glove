/**
 * Preference (choice) analysis for the polyglot arm — which language does a
 * model reach for when execute_python / execute_js / execute_lisp are all
 * mounted over one catalog? Read via toolMix. Counterbalanced: pass the
 * default-order file and the reversed-order file to separate a genuine
 * preference from a first-listed ordering effect.
 *
 *   npx tsx src/poly-analysis.ts [poly-pref-results.json] [poly-pref-rev-results.json]
 */
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

type Lean = "python" | "js" | "lisp" | "mixed" | "none";
const leanOf = (r: RunResult): Lean => {
  const m = (r.toolMix ?? {}) as Record<string, number>;
  const nz = ([["python", m.execute_python], ["js", m.execute_js], ["lisp", m.execute_lisp]] as const).filter(
    ([, n]) => (n ?? 0) > 0,
  );
  if (nz.length === 0) return "none";
  if (nz.length > 1) return "mixed";
  return nz[0][0];
};

const MODEL_ORDER = ["deepseek", "minimax3", "glm5", "xiaomi", "dsflash", "qwen30b"];
const LANGS: Lean[] = ["python", "js", "lisp", "mixed", "none"];

function report(label: string, rows: RunResult[]): void {
  if (!rows.length) {
    console.log(`\n${label}: (no data)\n`);
    return;
  }
  console.log(`\n═══ ${label} — ${rows.length} cells ═══`);
  const models = [...new Set(rows.map((r) => r.modelKey))].sort(
    (a, b) => MODEL_ORDER.indexOf(a) - MODEL_ORDER.indexOf(b),
  );
  console.log(`${"model".padEnd(11)}${LANGS.map((l) => l.padStart(8)).join("")}   pass`);
  for (const m of models) {
    const mr = rows.filter((r) => r.modelKey === m);
    const counts = LANGS.map((l) => mr.filter((r) => leanOf(r) === l).length);
    const p = mr.filter((r) => r.ok).length;
    console.log(`${m.padEnd(11)}${counts.map((c) => String(c || "").padStart(8)).join("")}   ${p}/${mr.length}`);
  }
  const tot = LANGS.map((l) => rows.filter((r) => leanOf(r) === l).length);
  const p = rows.filter((r) => r.ok).length;
  console.log(`${"TOTAL".padEnd(11)}${tot.map((c) => String(c || "").padStart(8)).join("")}   ${p}/${rows.length}`);
  // per-scenario lean (does choice shift by task shape?)
  console.log("\nper-scenario lean:");
  for (const s of [...new Set(rows.map((r) => r.scenario))]) {
    const sr = rows.filter((r) => r.scenario === s);
    const c = LANGS.map((l) => `${l[0]}${l === "js" ? "s" : ""}:${sr.filter((r) => leanOf(r) === l).length}`).filter((x) => !x.endsWith(":0"));
    console.log(`  ${s.padEnd(28)} ${c.join("  ")}`);
  }
}

const def = load(process.argv[2] ?? "poly-pref-results.json");
const rev = load(process.argv[3] ?? "poly-pref-rev-results.json");
report("DEFAULT ORDER (python, js, lisp)", def);
report("REVERSED ORDER (lisp, js, python)", rev);

if (def.length && rev.length) {
  const share = (rows: RunResult[], l: Lean) => Math.round((rows.filter((r) => leanOf(r) === l).length / rows.length) * 100);
  console.log("\n═══ ordering effect ═══");
  for (const l of ["python", "js", "lisp", "mixed"] as Lean[]) {
    console.log(`  ${l.padEnd(8)} default ${String(share(def, l)).padStart(3)}%   reversed ${String(share(rev, l)).padStart(3)}%`);
  }
  console.log(
    "\nRead: if a language's share holds across BOTH orders it's a genuine preference; if it tracks the first-listed slot it's an ordering effect.",
  );
}
