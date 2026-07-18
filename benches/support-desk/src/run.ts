/**
 * Support-desk bench — does delegating per-ticket triage to a CHEAP model match
 * the planner doing it itself, cheaper, without leaking customer PII?
 *
 *   solo      — a SOTA open-source planner reads every ticket body and classifies
 *               them itself.
 *   delegated — the same planner authors a workflow that hands each ticket to a
 *               cheap delegate; only { category, escalate } comes back.
 *
 * Per cell we measure QUALITY (escalation F1 + category accuracy, deterministic),
 * COST (planner $ + delegate $), and SECURITY (did a customer's pasted PII cross
 * into the planner's context — an exact canary scan via glove-egress).
 *
 *   pnpm --filter support-desk-bench bench --budget=3.0
 *   pnpm --filter support-desk-bench bench --planners=deepseek,glm5 --delegates=dsflash
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createAdapter } from "glove-core";
import { PLANNERS, DELEGATES, modelByKey, estimateCost, type DeskModel } from "./models";
import { buildWorld } from "./world";
import { buildDeskArm, type DeskArm } from "./arms";
import { TASK_PROMPT, grade } from "./task";

const ROOT = join(import.meta.dirname, "..");
const RESULTS = join(ROOT, "results");
const LOGS = join(ROOT, "logs");

export interface DeskResult {
  planner: string;
  delegate: string | null;
  arm: DeskArm;
  escalationF1: number;
  escalationPrecision: number;
  escalationRecall: number;
  categoryAccuracy: number;
  plannerTokensIn: number;
  plannerTokensOut: number;
  plannerCost: number;
  delegateCalls: number;
  delegateTokensIn: number;
  delegateTokensOut: number;
  delegateCost: number;
  totalCost: number;
  peakContextTokens: number;
  bytesCrossed: number;
  leaked: boolean;
  leakedIds: string[];
  turns: number;
  wallMs: number;
  errored: boolean;
  errorMessage?: string;
  finalText: string;
  predictedEscalations: string[];
}

function finalTextOf(res: unknown): string {
  const r = res as { messages?: Array<{ text?: string }>; text?: string };
  if (Array.isArray(r?.messages)) return r.messages.map((m) => m.text ?? "").join("\n").trim();
  return (r?.text ?? "").trim();
}

async function runCell(planner: DeskModel, delegate: DeskModel | null, arm: DeskArm, opts: { maxTurns: number; contextLimit: number; maxTokens: number; timeoutMs: number; echo?: boolean }): Promise<{ result: DeskResult; transcript: unknown[] }> {
  const world = buildWorld();
  const plannerAdapter = createAdapter({ provider: "openrouter", model: planner.model, maxTokens: opts.maxTokens, stream: false });
  const built = buildDeskArm({
    world, arm, planner: plannerAdapter, delegate: delegate ?? undefined,
    maxTurns: opts.maxTurns, contextLimit: opts.contextLimit, maxTokens: opts.maxTokens, echo: opts.echo,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const t0 = Date.now();
  let errored = false, errorMessage: string | undefined, finalText = "";
  try {
    const res = await built.runnable.processRequest(TASK_PROMPT, controller.signal);
    finalText = finalTextOf(res);
  } catch (err) {
    errored = true;
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  const wallMs = Date.now() - t0;

  built.meter.cross("output", finalText, { label: "final" });
  const report = built.meter.report(world.canaries);
  const g = errored ? null : grade(finalText, world);

  const m = built.sub.metrics;
  const plannerCost = estimateCost(planner, m.tokensIn, m.tokensOut);
  const du = built.delegateUsage;
  const delegateCost = du && delegate ? estimateCost(delegate, du.tokensIn, du.tokensOut) : 0;

  const result: DeskResult = {
    planner: planner.key,
    delegate: delegate?.key ?? null,
    arm,
    escalationF1: g?.escalationF1 ?? 0,
    escalationPrecision: g?.escalationPrecision ?? 0,
    escalationRecall: g?.escalationRecall ?? 0,
    categoryAccuracy: g?.categoryAccuracy ?? 0,
    plannerTokensIn: m.tokensIn,
    plannerTokensOut: m.tokensOut,
    plannerCost,
    delegateCalls: du?.calls ?? 0,
    delegateTokensIn: du?.tokensIn ?? 0,
    delegateTokensOut: du?.tokensOut ?? 0,
    delegateCost,
    totalCost: plannerCost + delegateCost,
    peakContextTokens: m.peakContextTokens,
    bytesCrossed: report.bytesCrossed,
    leaked: report.canariesRecovered.length > 0,
    leakedIds: report.canariesRecovered,
    turns: m.turns,
    wallMs,
    errored,
    errorMessage,
    finalText,
    predictedEscalations: g?.predictedEscalations ?? [],
  };
  return { result, transcript: built.sub.transcript };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
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

const selPlanners = (list(args.planners).length ? list(args.planners) : PLANNERS.map((m) => m.key)).map(modelByKey).filter(Boolean) as DeskModel[];
const selDelegates = (list(args.delegates).length ? list(args.delegates) : [DELEGATES[0].key, DELEGATES[1].key]).map(modelByKey).filter(Boolean) as DeskModel[];
const selArms = (list(args.arms).length ? list(args.arms) : ["solo", "delegated"]) as DeskArm[];
const opts = {
  maxTurns: num(args.maxTurns, 14),
  contextLimit: num(args.contextLimit, 100_000),
  maxTokens: num(args.maxTokens, 3000),
  timeoutMs: num(args.timeout, 150_000),
  echo: Boolean(args.echo),
};
const budget = num(args.budget, Infinity);

function buildMatrix(): Array<{ planner: DeskModel; delegate: DeskModel | null; arm: DeskArm }> {
  const cells: Array<{ planner: DeskModel; delegate: DeskModel | null; arm: DeskArm }> = [];
  for (const planner of selPlanners) {
    if (selArms.includes("solo")) cells.push({ planner, delegate: null, arm: "solo" });
    if (selArms.includes("delegated")) for (const delegate of selDelegates) cells.push({ planner, delegate, arm: "delegated" });
  }
  return cells;
}

// ── writers ────────────────────────────────────────────────────────────────
const pct = (x: number) => `${Math.round(x * 100)}%`;
const avg = (xs: DeskResult[], f: (r: DeskResult) => number) => (xs.length ? xs.reduce((a, r) => a + f(r), 0) / xs.length : 0);

function summaryMd(rows: DeskResult[]): string {
  const L: string[] = [];
  L.push("# Support-desk — can a cheap delegate triage at par, cheaper, without leaking?\n");
  L.push(`A SOTA open-source planner triages a ${buildWorld().tickets.length}-ticket inbox. \`solo\` reads every body itself; \`delegated\` hands each ticket to a cheap model. Quality = escalation F1 + category accuracy (deterministic); cost = planner $ + delegate $; security = customer PII crossing into the planner's context.\n`);

  const solo = rows.filter((r) => r.arm === "solo");
  const del = rows.filter((r) => r.arm === "delegated");

  L.push("## Solo (planner does it all)\n");
  L.push("| planner | esc F1 | category acc | planner $ | PII leaked | peak ctx | turns |");
  L.push("|---|--:|--:|--:|:--:|--:|--:|");
  for (const r of solo) L.push(`| ${r.planner} | ${pct(r.escalationF1)} | ${pct(r.categoryAccuracy)} | ${r.totalCost.toFixed(4)} | ${r.leaked ? "**yes**" : "no"} | ${(r.peakContextTokens / 1000).toFixed(1)}k | ${r.turns} |`);

  L.push("\n## Delegated (planner orchestrates, cheap model classifies)\n");
  L.push("| planner | delegate | esc F1 | category acc | total $ | (planner / delegate) | PII leaked | Δcost vs solo |");
  L.push("|---|---|--:|--:|--:|--:|:--:|--:|");
  for (const r of del) {
    const s = solo.find((x) => x.planner === r.planner);
    const delta = s && s.totalCost > 0 ? `${Math.round((r.totalCost / s.totalCost) * 100)}% of solo` : "—";
    L.push(`| ${r.planner} | ${r.delegate} | ${pct(r.escalationF1)} | ${pct(r.categoryAccuracy)} | ${r.totalCost.toFixed(4)} | ${r.plannerCost.toFixed(4)} / ${r.delegateCost.toFixed(4)} | ${r.leaked ? "yes" : "**no**"} | ${delta} |`);
  }

  L.push("\n## Headline (averaged)\n");
  L.push("| arm | esc F1 | category acc | total $ | PII leak rate |");
  L.push("|---|--:|--:|--:|--:|");
  L.push(`| solo | ${pct(avg(solo, (r) => r.escalationF1))} | ${pct(avg(solo, (r) => r.categoryAccuracy))} | ${avg(solo, (r) => r.totalCost).toFixed(4)} | ${pct(avg(solo, (r) => (r.leaked ? 1 : 0)))} |`);
  L.push(`| delegated | ${pct(avg(del, (r) => r.escalationF1))} | ${pct(avg(del, (r) => r.categoryAccuracy))} | ${avg(del, (r) => r.totalCost).toFixed(4)} | ${pct(avg(del, (r) => (r.leaked ? 1 : 0)))} |`);
  L.push("");
  return L.join("\n") + "\n";
}

const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-");

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Aborting.");
    process.exit(1);
  }
  mkdirSync(RESULTS, { recursive: true });
  mkdirSync(LOGS, { recursive: true });
  const matrix = buildMatrix();
  console.log(`\nSupport-desk bench: ${matrix.length} cells`);
  console.log(`Planners: ${selPlanners.map((m) => m.key).join(", ")}   Delegates: ${selDelegates.map((m) => m.key).join(", ")}`);
  console.log(`Budget: ${budget === Infinity ? "unbounded" : "$" + budget.toFixed(2)}\n`);

  const rows: DeskResult[] = [];
  let spent = 0;
  const hdr = "planner    arm        delegate   escF1  catAcc  total$   leak  turns";
  console.log(hdr);
  console.log("-".repeat(hdr.length + 2));

  for (const cell of matrix) {
    if (spent >= budget) {
      console.log(`\n⚠ budget $${budget.toFixed(2)} reached ($${spent.toFixed(4)}) — stopping after ${rows.length} cells.`);
      break;
    }
    let out;
    try {
      out = await runCell(cell.planner, cell.delegate, cell.arm, opts);
    } catch (err) {
      console.log(`${cell.planner.key} / ${cell.arm} / ${cell.delegate?.key ?? "-"} → HARNESS ERROR: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const r = out.result;
    rows.push(r);
    spent += r.totalCost;
    console.log(
      `${r.planner.padEnd(10)} ${r.arm.padEnd(10)} ${(r.delegate ?? "-").padEnd(10)} ${pct(r.escalationF1).padStart(5)} ${pct(r.categoryAccuracy).padStart(6)} ` +
        `${r.totalCost.toFixed(4)} ${(r.leaked ? "LEAK" : "safe").padStart(5)} ${String(r.turns).padStart(5)}` +
        (r.errored ? `  ⟵ ${r.errorMessage?.slice(0, 40)}` : ""),
    );
    writeFileSync(join(RESULTS, "desk-results.json"), JSON.stringify(rows, null, 2));
    writeFileSync(join(RESULTS, "desk-summary.md"), summaryMd(rows));
    const { finalText, ...meta } = r;
    writeFileSync(join(LOGS, `${safe(r.planner)}__${r.arm}__${safe(r.delegate ?? "none")}.jsonl`), [JSON.stringify({ entry: "meta", ...meta }), JSON.stringify({ entry: "final", text: finalText }), ...out.transcript.map((e) => JSON.stringify(e))].join("\n") + "\n");
  }

  console.log(`\nDone. ${rows.length} cells, estimated spend $${spent.toFixed(4)}.`);
  console.log("Artifacts: results/desk-summary.md, results/desk-results.json, logs/*.jsonl");
}

main().catch((err) => {
  console.error("\nSUPPORT-DESK BENCH CRASHED:\n", err);
  process.exit(1);
});
