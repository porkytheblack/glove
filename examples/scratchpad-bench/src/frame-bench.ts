/**
 * Frame A/B benchmark — does the FRAMING of the eval tool change how a model
 * uses it?
 *
 * The scratchpad/REPL papers folded an agent's capabilities behind ONE code-eval
 * tool and showed the model computes over results in the sandbox instead of
 * round-tripping every intermediate. But a behavioral failure remained: models
 * degrade the surface back into an incremental tool-call loop — run one form,
 * look, run another — instead of authoring one program that does the whole task.
 * The diagnosis (see FRAME-PAPER.md) is a naming prior: "REPL" and
 * `execute_js` pattern-match to interactive, line-by-line sessions.
 *
 * This bench holds EVERYTHING constant — same mock org, same catalog, same
 * scenarios, same models, same runtime — and varies ONLY the eval tool's framing:
 *
 *   - repl      — `execute_js`          + the classic persistent-REPL priming
 *   - program   — `execute_js_program`  + a complete-program priming
 *   - workflow  — `execute_js_workflow` + a one-shot-workflow priming that
 *                                         de-REPLs the frame (author the WHOLE
 *                                         task as one program; cross-call state is
 *                                         a retry fallback, not a working style)
 *
 * Headline metric: eval calls per task and the SINGLE-CALL RATE (fraction of runs
 * that did the whole task in exactly one eval call) — the "2 → 1" push the design
 * predicts. Pass rate is carried alongside so a framing can't win by degrading
 * correctness.
 *
 *   pnpm --filter glove-scratchpad-bench frame-bench --budget=1.0
 *   pnpm --filter glove-scratchpad-bench frame-bench --langs=js,py --models=glm,deepseek --frames=repl,workflow
 *
 * Writes results/frames-*.{json,csv,md} and logs/frames/*.jsonl (git-tracked).
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { modelByKey, type BenchModel } from "./models";
import { scenarioById, type Scenario } from "./scenarios";
import { runOne, type RunResult } from "./harness/runner";
import type { ArmName, FrameName } from "./harness/arms";

const ROOT = join(import.meta.dirname, "..");
const LOGS = join(ROOT, "logs", "frames");
const RESULTS = join(ROOT, "results");

// ── the three languages under test, and how to name their eval tool per frame ──
type Lang = "js" | "py" | "lisp";
const LANG_ARM: Record<Lang, ArmName> = { js: "jsrepl", py: "pyrepl", lisp: "lispfns" };
const EVAL_BASE: Record<Lang, string> = { js: "execute_js", py: "execute_python", lisp: "execute_lisp" };
const FRAMES: FrameName[] = ["repl", "program", "workflow"];
const DISCOVERY_TOOLS = ["search_functions", "list_servers", "list_functions", "describe_function"];

function evalToolName(lang: Lang, frame: FrameName): string {
  const base = EVAL_BASE[lang];
  return frame === "program" ? `${base}_program` : frame === "workflow" ? `${base}_workflow` : base;
}

/** One frame-bench cell: a RunResult plus the framing-derived counts. */
interface FrameRow extends RunResult {
  lang: Lang;
  frameName: FrameName;
  /** How many times the model invoked the eval tool (the "did it split?" signal). */
  evalCalls: number;
  /** Discovery tool calls (search/list/describe) — separate from eval calls. */
  discoveryCalls: number;
  /** Whole task done in exactly one eval call. */
  singleCall: boolean;
}

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

/** Default: complexity-skewed, multi-step, cross-service tasks — the place a
 *  model is most tempted to peek-then-split and where composing the whole task in
 *  one program is hardest (a cross-service join, a negation join, a multi-metric
 *  grouped report, a decide-and-act branch, a conditional ack fan-out + rollup
 *  write, and a 5-service write chain). Override with --scenarios. */
const DEFAULT_SCENARIOS = [
  "merged-prs-open-linear",
  "reconcile-ghost-issues",
  "repo-health-report",
  "incident-branch",
  "escalate-hot-services",
  "incident-commander",
];
/** Default to cheap-but-capable models that actually spiral; override with --models. */
const DEFAULT_MODELS = ["glm", "deepseek"];

const selModels: BenchModel[] = (list(args.models).length ? list(args.models) : DEFAULT_MODELS)
  .map((k) => modelByKey(k))
  .filter(Boolean) as BenchModel[];
const selScenarios: Scenario[] = (list(args.scenarios).length ? list(args.scenarios) : DEFAULT_SCENARIOS)
  .map((id) => scenarioById(id))
  .filter(Boolean) as Scenario[];
const selLangs: Lang[] = (list(args.langs).length ? list(args.langs) : ["js"]).filter(
  (l): l is Lang => l === "js" || l === "py" || l === "lisp",
);
const selFrames: FrameName[] = (list(args.frames).length ? list(args.frames) : FRAMES).filter(
  (f): f is FrameName => (FRAMES as string[]).includes(f),
);

// Discovery `full` by default: prime the function shapes so the ONLY variable is
// the framing (a REPL-framed model has no shape-peek excuse to split either).
const discovery: "progressive" | "full" | "auto" =
  args.discovery === "progressive" || args.discovery === "auto" ? args.discovery : "full";

const opts = {
  prime: true,
  discovery,
  distractors: num(args.distractors, 0),
  maxTurns: num(args.maxTurns, 24),
  compactionContextLimit: num(args.contextLimit, 100_000),
  maxTokens: num(args.maxTokens, 4096),
  timeoutMs: num(args.timeout, 150_000),
  scale: num(args.scale, Number(process.env.BENCH_SCALE ?? 1)),
  seed: num(args.seed, 1337),
  echo: Boolean(args.echo),
};
const budget = num(args.budget, Infinity);
const outPrefix = typeof args.out === "string" && args.out.length ? args.out : "frames";

// ── metric helpers ─────────────────────────────────────────────────────────────
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function toRow(lang: Lang, frame: FrameName, r: RunResult): FrameRow {
  const mix = r.toolMix ?? {};
  const evalCalls = mix[evalToolName(lang, frame)] ?? 0;
  const discoveryCalls = DISCOVERY_TOOLS.reduce((a, t) => a + (mix[t] ?? 0), 0);
  return { ...r, lang, frameName: frame, evalCalls, discoveryCalls, singleCall: evalCalls === 1 };
}

// ── writers ─────────────────────────────────────────────────────────────────────
function safe(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-");
}
function writeTranscript(r: FrameRow, transcript: unknown[]) {
  // Namespace by run (--out) so a second run at a different discovery mode
  // doesn't overwrite the first's per-cell transcripts.
  const dir = join(LOGS, outPrefix);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safe(r.modelKey)}__${safe(r.scenario)}__${r.lang}__${r.frameName}.jsonl`);
  const { finalText, ...meta } = r;
  const lines = [
    JSON.stringify({ kind: "meta", ...meta }),
    JSON.stringify({ kind: "final_answer", text: finalText }),
    ...transcript.map((e) => JSON.stringify(e)),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
}

function csvOf(rows: FrameRow[]): string {
  const cols = [
    "modelKey", "model", "scenario", "lang", "frameName", "ok", "errored", "turns", "toolCalls",
    "evalCalls", "discoveryCalls", "singleCall", "toolErrors", "mcpRoundTrips", "tokensIn", "tokensOut",
    "peakContextTokens", "compactions", "wallMs", "costUsd",
  ];
  const body = rows.map((r) =>
    cols
      .map((c) => {
        const v = (r as unknown as Record<string, unknown>)[c];
        if (typeof v === "boolean") return v ? "1" : "0";
        return typeof v === "number" ? (c === "costUsd" ? v.toFixed(6) : String(v)) : JSON.stringify(v ?? "");
      })
      .join(","),
  );
  return [cols.join(","), ...body].join("\n");
}

interface Agg {
  n: number;
  pass: number;
  single: number;
  evalAvg: number;
  evalMed: number;
  toolAvg: number;
  discAvg: number;
  turnsAvg: number;
  inAvg: number;
  outAvg: number;
  peakAvg: number;
  costAvg: number;
}
function aggregate(rows: FrameRow[]): Agg {
  const n = rows.length || 1;
  const sum = (f: (r: FrameRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    n: rows.length,
    pass: sum((r) => (r.ok ? 1 : 0)) / n,
    single: sum((r) => (r.singleCall ? 1 : 0)) / n,
    evalAvg: sum((r) => r.evalCalls) / n,
    evalMed: median(rows.map((r) => r.evalCalls)),
    toolAvg: sum((r) => r.toolCalls) / n,
    discAvg: sum((r) => r.discoveryCalls) / n,
    turnsAvg: sum((r) => r.turns) / n,
    inAvg: sum((r) => r.tokensIn) / n,
    outAvg: sum((r) => r.tokensOut) / n,
    peakAvg: sum((r) => r.peakContextTokens) / n,
    costAvg: sum((r) => r.costUsd) / n,
  };
}

function summaryMd(rows: FrameRow[]): string {
  const L: string[] = [];
  L.push("# Frame A/B — does the eval tool's FRAMING change how a model uses it?\n");
  L.push(
    `Same mock org, same catalog, same scenarios, same models, same runtime — only the eval tool's NAME + priming vary ` +
      `(\`repl\` = execute_*, \`program\` = execute_*_program, \`workflow\` = execute_*_workflow). ` +
      `Config: discovery=${discovery}, scale=${opts.scale}, maxTurns=${opts.maxTurns}, maxTokens=${opts.maxTokens}.\n`,
  );
  L.push(
    "**Headline: eval calls per task + single-call rate** — the fraction of runs that did the whole task in exactly ONE eval call. " +
      "Pass rate is carried alongside so a framing can't win by degrading correctness.\n",
  );

  // ── the aggregate table, one row per (lang, frame) ──
  L.push("## Aggregate — per (language × frame)\n");
  L.push("| lang | frame | n | pass | single-call | eval calls (avg / median) | disc calls | tool calls | turns | tok in/out | peak | cost $ |");
  L.push("|---|---|--:|:--:|:--:|--:|--:|--:|--:|--:|--:|--:|");
  const langsPresent = [...new Set(rows.map((r) => r.lang))];
  for (const lang of langsPresent) {
    for (const frame of FRAMES) {
      const g = rows.filter((r) => r.lang === lang && r.frameName === frame);
      if (!g.length) continue;
      const a = aggregate(g);
      L.push(
        `| ${lang} | ${frame} | ${a.n} | ${(a.pass * 100).toFixed(0)}% | ${(a.single * 100).toFixed(0)}% | ` +
          `${a.evalAvg.toFixed(2)} / ${a.evalMed} | ${a.discAvg.toFixed(1)} | ${a.toolAvg.toFixed(1)} | ${a.turnsAvg.toFixed(1)} | ` +
          `${fmt(Math.round(a.inAvg))}/${fmt(Math.round(a.outAvg))} | ${fmt(Math.round(a.peakAvg))} | ${a.costAvg.toFixed(4)} |`,
      );
    }
  }

  // ── head-to-head: repl → workflow, per language ──
  L.push("\n## repl → workflow (per language)\n");
  L.push("| lang | Δ single-call | Δ pass | eval calls repl→workflow | eval-call reduction |");
  L.push("|---|:--:|:--:|--:|--:|");
  for (const lang of langsPresent) {
    const repl = rows.filter((r) => r.lang === lang && r.frameName === "repl");
    const wf = rows.filter((r) => r.lang === lang && r.frameName === "workflow");
    if (!repl.length || !wf.length) continue;
    const ar = aggregate(repl);
    const aw = aggregate(wf);
    const red = aw.evalAvg > 0 ? ar.evalAvg / aw.evalAvg : 0;
    L.push(
      `| ${lang} | ${((aw.single - ar.single) * 100).toFixed(0)} pts | ${((aw.pass - ar.pass) * 100).toFixed(0)} pts | ` +
        `${ar.evalAvg.toFixed(2)} → ${aw.evalAvg.toFixed(2)} | ${red ? red.toFixed(2) + "×" : "—"} |`,
    );
  }

  // ── per-model breakdown (so a single model doesn't hide the effect) ──
  L.push("\n## Per model × frame (single-call rate / pass rate / avg eval calls)\n");
  const models = [...new Set(rows.map((r) => r.modelKey))];
  L.push("| model | " + FRAMES.map((f) => `${f}`).join(" | ") + " |");
  L.push("|---|" + FRAMES.map(() => ":--:").join("|") + "|");
  for (const mk of models) {
    const cells = FRAMES.map((f) => {
      const g = rows.filter((r) => r.modelKey === mk && r.frameName === f);
      if (!g.length) return "—";
      const a = aggregate(g);
      return `${(a.single * 100).toFixed(0)}% / ${(a.pass * 100).toFixed(0)}% / ${a.evalAvg.toFixed(1)}`;
    });
    L.push(`| ${mk} | ${cells.join(" | ")} |`);
  }
  L.push("\n_Cells are single-call% / pass% / avg eval calls. Higher single-call% at equal-or-higher pass% is the win._\n");

  return L.join("\n") + "\n";
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Aborting.");
    process.exit(1);
  }
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });

  const matrix: Array<{ m: BenchModel; s: Scenario; lang: Lang; frame: FrameName }> = [];
  for (const m of selModels) for (const s of selScenarios) for (const lang of selLangs) for (const frame of selFrames)
    matrix.push({ m, s, lang, frame });

  console.log(`\nFrame bench: ${selModels.length} models × ${selScenarios.length} scenarios × ${selLangs.length} langs × ${selFrames.length} frames = ${matrix.length} runs`);
  console.log(`Models: ${selModels.map((m) => m.key).join(", ")}`);
  console.log(`Langs: ${selLangs.join(", ")}   Frames: ${selFrames.join(", ")}   discovery=${discovery}`);
  console.log(`Scenarios: ${selScenarios.map((s) => s.id).join(", ")}`);
  console.log(`Budget: ${budget === Infinity ? "unbounded" : "$" + budget.toFixed(2)}\n`);

  const rows: FrameRow[] = [];
  const done = new Set<string>();
  const cellKey = (mk: string, s: string, lang: string, frame: string) => `${mk}|${s}|${lang}|${frame}`;
  if (args.append) {
    try {
      const prior = JSON.parse(readFileSync(join(RESULTS, `${outPrefix}-results.json`), "utf8")) as FrameRow[];
      for (const r of prior) {
        rows.push(r);
        done.add(cellKey(r.modelKey, r.scenario, r.lang, r.frameName));
      }
      console.log(`Appending: loaded ${prior.length} prior run(s); will skip those cells.\n`);
    } catch {
      /* no prior file — start fresh */
    }
  }

  let spent = 0;
  const hdr = "model      scenario                  lang frame     pass  eval disc  turns   in/out(tok)      $";
  console.log(hdr);
  console.log("-".repeat(hdr.length + 4));

  for (const cell of matrix) {
    if (done.has(cellKey(cell.m.key, cell.s.id, cell.lang, cell.frame))) continue;
    if (spent >= budget) {
      console.log(`\n⚠ budget $${budget.toFixed(2)} reached ($${spent.toFixed(4)} spent) — stopping after ${rows.length} runs.`);
      break;
    }
    let out;
    try {
      out = await runOne(cell.m, cell.s, LANG_ARM[cell.lang], { ...opts, frame: cell.frame });
    } catch (err) {
      console.log(`${cell.m.key} / ${cell.s.id} / ${cell.lang} / ${cell.frame}  → HARNESS ERROR: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const row = toRow(cell.lang, cell.frame, out.result);
    rows.push(row);
    spent += row.costUsd;
    writeTranscript(row, out.transcript);

    const pass = row.errored ? "ERR " : row.ok ? "PASS" : "FAIL";
    console.log(
      `${row.modelKey.padEnd(10)} ${row.scenario.padEnd(25)} ${cell.lang.padEnd(4)} ${cell.frame.padEnd(9)} ${pass} ` +
        `${String(row.evalCalls).padStart(4)} ${String(row.discoveryCalls).padStart(4)} ${String(row.turns).padStart(5)} ` +
        `${(row.tokensIn + "/" + row.tokensOut).padStart(14)} ${row.costUsd.toFixed(4)}` +
        (row.errored ? `  ⟵ ${row.errorMessage?.slice(0, 50)}` : "") +
        (row.singleCall && row.ok ? "  ✓1" : ""),
    );

    // Persist incrementally so a crash/budget-stop still leaves usable artifacts.
    writeFileSync(join(RESULTS, `${outPrefix}-results.json`), JSON.stringify(rows, null, 2));
    writeFileSync(join(RESULTS, `${outPrefix}-results.csv`), csvOf(rows));
    writeFileSync(join(RESULTS, `${outPrefix}-summary.md`), summaryMd(rows));
  }

  console.log(`\nDone. ${rows.length} runs, estimated spend $${spent.toFixed(4)}.`);
  console.log(`Artifacts: results/${outPrefix}-summary.md, results/${outPrefix}-results.{json,csv}, logs/frames/*.jsonl`);
}

main().catch((err) => {
  console.error("\nFRAME BENCH CRASHED:\n", err);
  process.exit(1);
});
