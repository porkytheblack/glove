/**
 * Agentic A/B benchmark CLI.
 *
 *   pnpm bench                       # all models × all scenarios × both arms
 *   pnpm bench --models=deepseek,glm --scenarios=count-open-prs --arms=baseline,scratchpad
 *   pnpm bench --budget=1.0 --scale=1 --maxTurns=20 --maxTokens=4096 --echo
 *
 * Writes a JSONL transcript per cell to ./logs and a JSON/CSV/Markdown summary
 * to ./results — all git-tracked.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS, modelByKey, type BenchModel } from "./models";
import { SCENARIOS, scenarioById, type Scenario } from "./scenarios";
import { runOne, type RunResult } from "./harness/runner";
import type { ArmName } from "./harness/arms";

const ROOT = join(import.meta.dirname, "..");
const LOGS = join(ROOT, "logs");
const RESULTS = join(ROOT, "results");

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const list = (v: unknown): string[] => (typeof v === "string" && v.length ? v.split(",").map((s) => s.trim()) : []);
const num = (v: unknown, d: number): number => (typeof v === "string" && v.length && !Number.isNaN(Number(v)) ? Number(v) : d);

const selModels: BenchModel[] = list(args.models).length ? list(args.models).map((k) => modelByKey(k)).filter(Boolean) as BenchModel[] : MODELS;
const selScenarios: Scenario[] = list(args.scenarios).length ? list(args.scenarios).map((id) => scenarioById(id)).filter(Boolean) as Scenario[] : SCENARIOS;
const selArms: ArmName[] = (list(args.arms).length ? list(args.arms) : ["baseline", "scratchpad"]) as ArmName[];

const opts = {
  maxTurns: num(args.maxTurns, 24),
  compactionContextLimit: num(args.contextLimit, 100_000),
  maxTokens: num(args.maxTokens, 4096),
  timeoutMs: num(args.timeout, 150_000),
  scale: num(args.scale, Number(process.env.BENCH_SCALE ?? 1)),
  seed: num(args.seed, 1337),
  echo: Boolean(args.echo),
};
const budget = num(args.budget, Infinity);
const outPrefix = typeof args.out === "string" && args.out.length ? args.out : "agentic";

// ── write helpers ───────────────────────────────────────────────────────────
function safe(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-");
}
function writeTranscript(r: RunResult, transcript: unknown[]) {
  // Default ("agentic") logs live in logs/; every other experiment gets its own
  // subdir so runs with different scale/limit never clobber each other's transcripts.
  const dir = outPrefix === "agentic" ? LOGS : join(LOGS, outPrefix);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safe(r.modelKey)}__${safe(r.scenario)}__${r.arm}.jsonl`);
  const { finalText, ...meta } = r;
  const lines = [JSON.stringify({ kind: "meta", ...meta }), JSON.stringify({ kind: "final_answer", text: finalText }), ...transcript.map((e) => JSON.stringify(e))];
  writeFileSync(file, lines.join("\n") + "\n");
}

function csvOf(rows: RunResult[]): string {
  const cols = [
    "modelKey", "model", "scenario", "arm", "ok", "errored", "turns", "toolCalls", "toolErrors",
    "mcpRoundTrips", "servicesTouched", "tokensIn", "tokensOut", "peakContextTokens", "compactions",
    "toolsInContext", "wallMs", "costUsd",
  ];
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => {
    const v = (r as unknown as Record<string, unknown>)[c];
    return typeof v === "number" ? (c === "costUsd" ? v.toFixed(6) : String(v)) : JSON.stringify(v ?? "");
  }).join(","));
  return [head, ...body].join("\n");
}

// ── comparison markdown ───────────────────────────────────────────────────────
function fmt(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function summaryMd(rows: RunResult[]): string {
  const lines: string[] = [];
  lines.push("# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad\n");
  lines.push(`Config: scale=${opts.scale}, maxTurns=${opts.maxTurns}, contextLimit=${opts.compactionContextLimit}, maxTokens=${opts.maxTokens}.`);
  lines.push(`Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (${rows[0]?.toolsInContext ?? "?"} baseline tools).`);
  lines.push("Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.\n");

  // Per-scenario, per-model, baseline vs scratchpad.
  const byModel = [...new Set(rows.map((r) => r.modelKey))];
  for (const mk of byModel) {
    const mrows = rows.filter((r) => r.modelKey === mk);
    lines.push(`\n## ${mrows[0]?.model ?? mk}\n`);
    lines.push("| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |");
    lines.push("|---|---|:--:|--:|--:|--:|--:|--:|--:|");
    for (const s of [...new Set(mrows.map((r) => r.scenario))]) {
      for (const arm of ["baseline", "scratchpad"] as ArmName[]) {
        const r = mrows.find((x) => x.scenario === s && x.arm === arm);
        if (!r) continue;
        const pass = r.errored ? "ERR" : r.ok ? "✅" : "❌";
        lines.push(`| ${s} | ${arm} | ${pass} | ${r.turns} | ${r.toolCalls} | ${fmt(r.peakContextTokens)} | ${fmt(r.tokensIn)}/${fmt(r.tokensOut)} | ${r.compactions} | ${r.costUsd.toFixed(4)} |`);
      }
    }
  }

  // Aggregate reduction (scratchpad vs baseline), successful pairs only.
  lines.push("\n## Aggregate: scratchpad vs baseline\n");
  lines.push("Averaged over all runs (lower is better for every column except pass-rate).\n");
  lines.push("| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |");
  lines.push("|---|:--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const arm of ["baseline", "scratchpad"] as ArmName[]) {
    const a = rows.filter((r) => r.arm === arm);
    if (!a.length) continue;
    const avg = (f: (r: RunResult) => number) => a.reduce((s, r) => s + f(r), 0) / a.length;
    const passRate = a.filter((r) => r.ok).length / a.length;
    lines.push(`| ${arm} | ${(passRate * 100).toFixed(0)}% | ${avg((r) => r.turns).toFixed(1)} | ${avg((r) => r.toolCalls).toFixed(1)} | ${fmt(Math.round(avg((r) => r.peakContextTokens)))} | ${fmt(Math.round(avg((r) => r.tokensIn)))} | ${fmt(Math.round(avg((r) => r.tokensOut)))} | ${avg((r) => r.compactions).toFixed(2)} | ${avg((r) => r.costUsd).toFixed(4)} |`);
  }
  const base = rows.filter((r) => r.arm === "baseline");
  const scr = rows.filter((r) => r.arm === "scratchpad");
  if (base.length && scr.length) {
    const avg = (arr: RunResult[], f: (r: RunResult) => number) => arr.reduce((s, r) => s + f(r), 0) / arr.length;
    const ratio = (f: (r: RunResult) => number) => (avg(base, f) / Math.max(1e-9, avg(scr, f)));
    lines.push("\n**Reduction factors (baseline ÷ scratchpad):** " +
      `tool calls ${ratio((r) => r.toolCalls).toFixed(1)}×, ` +
      `peak context ${ratio((r) => r.peakContextTokens).toFixed(1)}×, ` +
      `input tokens ${ratio((r) => r.tokensIn).toFixed(1)}×, ` +
      `cost ${ratio((r) => r.costUsd).toFixed(1)}×.`);
  }
  return lines.join("\n") + "\n";
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set (expected via --env-file=../../.env). Aborting.");
    process.exit(1);
  }
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });

  const matrix: Array<{ m: BenchModel; s: Scenario; arm: ArmName }> = [];
  for (const m of selModels) for (const s of selScenarios) for (const arm of selArms) matrix.push({ m, s, arm });

  console.log(`\nBenchmark matrix: ${selModels.length} models × ${selScenarios.length} scenarios × ${selArms.length} arms = ${matrix.length} runs`);
  console.log(`Models: ${selModels.map((m) => m.key).join(", ")}`);
  console.log(`Scenarios: ${selScenarios.map((s) => s.id).join(", ")}`);
  console.log(`Budget: ${budget === Infinity ? "unbounded" : "$" + budget.toFixed(2)}   (options: ${JSON.stringify(opts)})\n`);

  // --append: resume by loading prior results and skipping cells already run.
  const results: RunResult[] = [];
  const done = new Set<string>();
  const cellKey = (mk: string, s: string, arm: string) => `${mk}|${s}|${arm}`;
  if (args.append) {
    try {
      const prior = JSON.parse(readFileSync(join(RESULTS, `${outPrefix}-results.json`), "utf8")) as RunResult[];
      for (const r of prior) { results.push(r); done.add(cellKey(r.modelKey, r.scenario, r.arm)); }
      console.log(`Appending: loaded ${prior.length} prior run(s); will skip those cells.\n`);
    } catch { /* no prior file — start fresh */ }
  }

  let spent = 0;
  const hdr = "model      scenario                  arm         pass turns  tc  rt   in/out(tok)     peak   cmp   $";
  console.log(hdr);
  console.log("-".repeat(hdr.length + 6));

  for (const cell of matrix) {
    if (done.has(cellKey(cell.m.key, cell.s.id, cell.arm))) continue;
    if (spent >= budget) {
      console.log(`\n⚠ budget $${budget.toFixed(2)} reached ($${spent.toFixed(4)} spent) — stopping early after ${results.length} runs.`);
      break;
    }
    let out;
    try {
      out = await runOne(cell.m, cell.s, cell.arm, opts);
    } catch (err) {
      console.log(`${cell.m.key} / ${cell.s.id} / ${cell.arm}  → HARNESS ERROR: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const r = out.result;
    results.push(r);
    spent += r.costUsd;
    writeTranscript(r, out.transcript);

    const pass = r.errored ? "ERR " : r.ok ? "PASS" : "FAIL";
    const row =
      `${r.modelKey.padEnd(10)} ${r.scenario.padEnd(25)} ${r.arm.padEnd(11)} ${pass} ` +
      `${String(r.turns).padStart(4)} ${String(r.toolCalls).padStart(3)} ${String(r.mcpRoundTrips).padStart(3)} ` +
      `${(r.tokensIn + "/" + r.tokensOut).padStart(14)} ${String(r.peakContextTokens).padStart(6)} ${String(r.compactions).padStart(3)} ${r.costUsd.toFixed(4)}`;
    console.log(row + (r.errored ? `  ⟵ ${r.errorMessage?.slice(0, 60)}` : ""));

    // Persist incrementally so a crash/budget-stop still leaves usable artifacts.
    writeFileSync(join(RESULTS, `${outPrefix}-results.json`), JSON.stringify(results, null, 2));
    writeFileSync(join(RESULTS, `${outPrefix}-results.csv`), csvOf(results));
    writeFileSync(join(RESULTS, `${outPrefix}-summary.md`), summaryMd(results));
  }

  console.log(`\nDone. ${results.length} runs, estimated spend $${spent.toFixed(4)}.`);
  console.log(`Artifacts: results/${outPrefix}-summary.md, results/${outPrefix}-results.{json,csv}, logs/*.jsonl`);
}

main().catch((err) => {
  console.error("\nBENCH CRASHED:\n", err);
  process.exit(1);
});
