/** Choice study + complex-suite analysis for the "both" arm. No API.
 *  Usage: npx tsx src/both-analysis.ts [bothstudy-results.json] [complex-results.json] */
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
const study = load(process.argv[2] ?? "bothstudy-results.json");
const complex = load(process.argv[3] ?? "complex-results.json");

const mix = (r: RunResult) => {
  const m = (r.toolMix ?? {}) as Record<string, number>;
  const sql = (m.execute_sql ?? 0) + (m.explain_sql ?? 0);
  const lisp = (m.execute_lisp ?? 0) + (m.explain_lisp ?? 0);
  return { sql, lisp };
};
const lean = (r: RunResult): "sql" | "lisp" | "mixed" | "none" => {
  const { sql, lisp } = mix(r);
  if (sql > 0 && lisp === 0) return "sql";
  if (lisp > 0 && sql === 0) return "lisp";
  if (sql > 0 && lisp > 0) return "mixed";
  return "none";
};

if (study.length) {
  console.log("═══ CHOICE STUDY — arm 'both', 9 scenarios ═══\n");
  const models = [...new Set(study.map((r) => r.modelKey))];
  console.log(`${"model".padEnd(10)} pass    sql-only  lisp-only  mixed   (cells)`);
  for (const m of models) {
    const rows = study.filter((r) => r.modelKey === m);
    const p = rows.filter((r) => r.ok).length;
    const byLean = { sql: 0, lisp: 0, mixed: 0, none: 0 };
    for (const r of rows) byLean[lean(r)]++;
    console.log(
      `${m.padEnd(10)} ${String(p).padStart(2)}/${rows.length}    ${String(byLean.sql).padStart(3)}       ${String(byLean.lisp).padStart(3)}       ${String(byLean.mixed).padStart(3)}`,
    );
  }
  console.log("\nper-scenario surface lean (cells choosing sql / lisp / mixed):");
  const scens = [...new Set(study.map((r) => r.scenario))];
  for (const s of scens) {
    const rows = study.filter((r) => r.scenario === s);
    const byLean = { sql: 0, lisp: 0, mixed: 0, none: 0 };
    for (const r of rows) byLean[lean(r)]++;
    const p = rows.filter((r) => r.ok).length;
    console.log(`  ${s.padEnd(28)} sql ${byLean.sql}  lisp ${byLean.lisp}  mixed ${byLean.mixed}   pass ${p}/${rows.length}`);
  }
  const tot = { sql: 0, lisp: 0, mixed: 0, none: 0 };
  for (const r of study) tot[lean(r)]++;
  const pass = study.filter((r) => r.ok).length;
  const err = study.filter((r) => r.errored).length;
  console.log(`\nTOTAL: pass ${pass}/${study.length} (${err} provider errors) · sql-only ${tot.sql} · lisp-only ${tot.lisp} · mixed ${tot.mixed}`);
  const passBy = (l: string) => {
    const rows = study.filter((r) => lean(r) === l);
    return rows.length ? `${rows.filter((r) => r.ok).length}/${rows.length}` : "—";
  };
  console.log(`pass when sql-only ${passBy("sql")} · lisp-only ${passBy("lisp")} · mixed ${passBy("mixed")}`);
}

if (complex.length) {
  console.log("\n═══ COMPLEX SUITE — 3 scenarios × 4 arms ═══\n");
  const scens = [...new Set(complex.map((r) => r.scenario))];
  const arms = ["baseline", "scratchpad", "lisp", "both"];
  console.log(`${"scenario".padEnd(26)} ${arms.map((a) => a.padEnd(11)).join("")}`);
  for (const s of scens) {
    const cells = arms.map((a) => {
      const rows = complex.filter((r) => r.scenario === s && r.arm === a);
      if (!rows.length) return "—".padEnd(11);
      const p = rows.filter((r) => r.ok).length;
      const e = rows.filter((r) => r.errored).length;
      return `${p}/${rows.length}${e ? `(${e}e)` : ""}`.padEnd(11);
    });
    console.log(`${s.padEnd(26)} ${cells.join("")}`);
  }
  for (const a of arms) {
    const rows = complex.filter((r) => r.arm === a);
    if (!rows.length) continue;
    const p = rows.filter((r) => r.ok).length;
    const medPeak = [...rows.map((r) => r.peakContextTokens)].sort((x, y) => x - y)[Math.floor(rows.length / 2)];
    console.log(`  ${a.padEnd(11)} total ${p}/${rows.length} · median peak ${medPeak?.toLocaleString()}`);
  }
  console.log("\ncomplex 'both' cells — surface lean:");
  for (const r of complex.filter((r) => r.arm === "both")) {
    const { sql, lisp } = mix(r);
    console.log(`  ${r.modelKey.padEnd(10)} ${r.scenario.padEnd(26)} ${r.ok ? "PASS" : r.errored ? "ERR " : "FAIL"} sql=${sql} lisp=${lisp}`);
  }
}
