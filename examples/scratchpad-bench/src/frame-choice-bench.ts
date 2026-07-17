/**
 * Frame CHOICE benchmark — revealed preference over the eval tool's framing.
 *
 * The frame A/B (frame-bench.ts) mounts ONE framing per run and measures how it
 * changes behavior. This asks the complementary question, the way the polyglot
 * language study does for JS-vs-Python-vs-Lisp: mount ALL THREE framings at once
 * over the SAME session and catalog, give them BYTE-IDENTICAL tool descriptions
 * (so the only thing that differs is the NAME — execute_js vs execute_js_program
 * vs execute_js_workflow) and a neutral preamble, and see which one the model
 * reaches for. Presentation + fold order is counterbalanced so a preference is a
 * genuine pull toward a name, not a first-listed artifact.
 *
 *   pnpm --filter glove-scratchpad-bench frame-choice-bench --budget=1.0
 *
 * Writes results/frames-choice-*.{json,csv,md} and logs/frames/frames-choice/*.jsonl.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdapter, Glove, Displaymanager, MemoryStore, type ModelAdapter } from "glove-core";
import { JsSession, buildExecuteJsTool, buildDiscoveryTools, type Frame } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { sampleResultShapes, fnSignature, type ToolFn } from "glove-scratchpad/fns";
import type { GloveFoldArgs } from "glove-core/glove";
import { buildMockOrg, type MockOrg } from "./mcp/index";
import { scenarioById, type Scenario } from "./scenarios";
import { modelByKey, estimateCost, type BenchModel } from "./models";
import { BenchSubscriber } from "./harness/instrument";

const ROOT = join(import.meta.dirname, "..");
const LOGS = join(ROOT, "logs", "frames", "frames-choice");
const RESULTS = join(ROOT, "results");

const FRAMES: Frame[] = ["repl", "program", "workflow"];
const FRAME_TOOL: Record<Frame, string> = {
  repl: "execute_js",
  program: "execute_js_program",
  workflow: "execute_js_workflow",
};
const NAME_TO_FRAME: Record<string, Frame> = { execute_js: "repl", execute_js_program: "program", execute_js_workflow: "workflow" };

/** Byte-identical for all three tools — the ONLY thing the model sees differ is
 *  the tool name. Deliberately neutral: no "REPL", no "workflow", no "program". */
const NEUTRAL_DESC =
  "Run a JavaScript program (the `code` string) against your capability session (persistent across calls). " +
  "Your capabilities are FUNCTIONS you call INSIDE the program — github.list_pull_requests({ state: \"open\" }) — not tools you call directly. " +
  "Compute in the program (.length / .filter / .reduce) and let the LAST expression be the answer; top-level const persists. " +
  "Discover with search_functions / list_servers / list_functions / describe_function. " +
  "This is one of three interchangeable eval tools — they behave identically.";

/** Neutral preamble: the JS language card + a frame-agnostic discipline + the
 *  three tool names presented in `order`. Nothing favors any name. */
function buildChoicePreamble(order: Frame[], fns: ToolFn[]): string {
  const names = order.map((f) => FRAME_TOOL[f]);
  const sigs = fns.map((fn) => `- ${fnSignature(fn)}`).join("\n");
  return `You have THREE interchangeable tools that each run a JavaScript program against the SAME persistent set of capability functions. They behave IDENTICALLY — same runtime, same functions, same persistence. Use whichever you prefer; do not use more than one for a task.

  - ${names[0]}
  - ${names[1]}
  - ${names[2]}

Everything you do is a JavaScript program you pass as a "code" string. Your capabilities are FUNCTIONS you call INSIDE that program — github.list_pull_requests({ state: "open" }) — they are NOT tools you can call directly. Arguments go in ONE object; promises resolve automatically.

Language: const/let, arrow functions, template literals, destructuring, spread, optional chaining, for…of / for / while, if/else, try/catch. Array methods (map/filter/reduce/find/some/every/sort/slice/flat/includes/join), Object.keys/values/entries, Math, JSON, new Set/Map/Date, console.log. NO class, import, eval, fetch, for…in, var.

Discipline: DISCOVER with search_functions / list_servers / list_functions / describe_function (or search()/servers()/fns()/describe() inside the program). INSPECT a row before filtering on a field. COMPUTE in the program and let the LAST expression be the answer — data flows between functions inside the program, it does not round-trip through you. Return counts / small selections; bind big intermediates to a const. Calling an effectful function FIRES it immediately (no staging).

Functions you can call (signatures show INPUTS only; inspect a row for its fields):
${sigs}`;
}

/** ROLES mode — the two tools are NOT interchangeable; each is given a distinct
 *  job (explore-and-inspect vs commit-the-whole-task), so the model can route
 *  between them the way it already understands a REPL vs a script. */
const ROLE_DESC: Record<Frame, string> = {
  repl:
    "An interactive REPL for EXPLORING before you commit: inspect one row's shape (Object.keys(rows[0])), check a value, or try a snippet. Each expression's value is echoed back. Persistent across calls. Use it to LOOK — not to carry out a whole multi-step task.",
  workflow:
    "Author the COMPLETE task as ONE program that runs start to finish — discover, read, compute, branch, and act — and returns only the final expression's value. Use it to DO the task in a single call once you know what to do.",
  program: "",
};

function buildRolesPreamble(order: Frame[], fns: ToolFn[]): string {
  const sigs = fns.map((fn) => `- ${fnSignature(fn)}`).join("\n");
  const cards = order
    .map((f) =>
      f === "repl"
        ? `  - ${FRAME_TOOL.repl} — EXPLORE: inspect a row's shape, check a value, try a snippet. Each expression's value is echoed back. For looking before you leap.`
        : `  - ${FRAME_TOOL.workflow} — DO: author the whole task as ONE complete program; only the final expression's value returns.`,
    )
    .join("\n");
  return `You have TWO tools over the SAME persistent set of capability functions, for TWO different jobs:

${cards}

They share one runtime and one session (a top-level const declared through one is visible to the other). Prefer to carry out the actual multi-step task as a SINGLE ${FRAME_TOOL.workflow} program; reach for ${FRAME_TOOL.repl} only when you genuinely need to explore — to learn a row's shape or a value you don't know yet — before composing that workflow.

Everything you do is a JavaScript program you pass as a "code" string. Your capabilities are FUNCTIONS you call INSIDE that program — github.list_pull_requests({ state: "open" }) — not tools you call directly. Arguments go in ONE object; promises resolve automatically. Compute in the program and let the LAST expression be the answer; discover with search_functions / list_servers / list_functions / describe_function.

Language: const/let, arrow functions, template literals, destructuring, spread, optional chaining, for…of / for / while, if/else, try/catch. Array methods (map/filter/reduce/find/some/every/sort/slice/flat/includes/join), Object.keys/values/entries, Math, JSON, new Set/Map/Date, console.log. NO class, import, eval, fetch, for…in, var.

Functions you can call (signatures show INPUTS only; inspect a row for its fields):
${sigs}`;
}

async function catalogFromOrg(org: MockOrg): Promise<ToolFn[]> {
  const fns = (await Promise.all(org.connections.map((c) => fnsFromMcp(c)))).flat();
  await sampleResultShapes(fns); // discovery=full parity — shapes primed, no per-frame peek excuse
  return fns;
}

const SHARED_ROLE =
  "You are an engineering-operations assistant for Acme. Answer the user's request precisely and concisely, " +
  "grounding every claim in data you actually retrieved. When the answer is a list or a count, state the exact " +
  "numbers/ids. Do not ask clarifying questions — make reasonable assumptions and finish the task.";

const COMPACTION =
  "Summarize the conversation so far, preserving every concrete fact already retrieved (ids, counts, names, states) " +
  "and the user's outstanding request, so work can continue without re-fetching.";

interface ChoiceCfg {
  maxTurns: number;
  maxTokens: number;
  timeoutMs: number;
  compactionContextLimit: number;
  scale?: number;
  seed?: number;
  echo?: boolean;
}

type Mode = "identical" | "roles";

function buildChoiceArm(model: ModelAdapter, fns: ToolFn[], order: Frame[], cfg: ChoiceCfg, mode: Mode) {
  const preamble = mode === "roles" ? buildRolesPreamble(order, fns) : buildChoicePreamble(order, fns);
  const glove = new Glove({
    store: new MemoryStore(`choice_${Math.floor(Math.random() * 1e9)}`),
    model,
    displayManager: new Displaymanager(),
    systemPrompt: `${preamble}\n\n${SHARED_ROLE}`,
    serverMode: true,
    maxRetries: 2,
    compaction_config: { max_turns: cfg.maxTurns, compaction_instructions: COMPACTION, compaction_context_limit: cfg.compactionContextLimit },
  });
  const runnable = glove.build();

  const session = JsSession.create();
  session.registerAll(fns);

  // Fold the eval tools in the counterbalanced order. In `identical` mode every
  // tool gets the SAME neutral description (only the NAME differs); in `roles`
  // mode each gets its distinct job description.
  for (const frame of order) {
    const tool = buildExecuteJsTool(session, { frame }) as GloveFoldArgs<{ code: string }>;
    tool.description = mode === "roles" ? ROLE_DESC[frame] : NEUTRAL_DESC;
    glove.fold(tool as GloveFoldArgs<unknown>);
  }
  // One shared discovery set.
  for (const t of buildDiscoveryTools(session)) glove.fold(t as GloveFoldArgs<unknown>);

  const sub = new BenchSubscriber({ echo: cfg.echo });
  glove.addSubscriber(sub);
  return { runnable, sub };
}

// Counterbalanced presentation/fold orders. `identical` mode has all three tools;
// `roles` mode is the two distinct-affordance tools (repl + workflow).
function ordersFor(mode: Mode): Record<string, Frame[]> {
  return mode === "roles"
    ? { A: ["repl", "workflow"], B: ["workflow", "repl"] }
    : { A: ["repl", "program", "workflow"], B: ["workflow", "program", "repl"] };
}

interface ChoiceRow {
  modelKey: string;
  model: string;
  scenario: string;
  order: string;
  ok: boolean;
  errored: boolean;
  errorMessage?: string;
  turns: number;
  /** eval-tool calls by frame this run. */
  chose: Record<Frame, number>;
  /** The frame the model used most (its revealed pick); null if it used none. */
  pick: Frame | null;
  evalCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  finalText: string;
}

function finalText(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const r = res as { messages?: Array<{ text?: string }>; text?: string };
  if (Array.isArray(r.messages)) return r.messages.map((m) => m.text ?? "").join("\n").trim();
  if (typeof r.text === "string") return r.text.trim();
  return "";
}

async function runChoiceCell(bm: BenchModel, scenario: Scenario, orderKey: string, cfg: ChoiceCfg, mode: Mode) {
  const org = await buildMockOrg({ seed: cfg.seed ?? 1337, scale: cfg.scale });
  const fns = await catalogFromOrg(org);
  const model = createAdapter({ provider: "openrouter", model: bm.model, maxTokens: cfg.maxTokens, stream: false });
  const { runnable, sub } = buildChoiceArm(model, fns, ordersFor(mode)[orderKey], cfg, mode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let errored = false, errorMessage: string | undefined, text = "";
  try {
    text = finalText(await runnable.processRequest(scenario.prompt, controller.signal));
  } catch (err) {
    errored = true;
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  let ok = false;
  if (!errored) {
    try { ok = scenario.verify(text, org.world).pass; } catch { /* verify error → fail */ }
  }
  const mix = sub.metrics.toolCallsByName;
  const chose: Record<Frame, number> = { repl: 0, program: 0, workflow: 0 };
  for (const [name, n] of Object.entries(mix)) {
    const f = NAME_TO_FRAME[name];
    if (f) chose[f] += n;
  }
  const evalCalls = chose.repl + chose.program + chose.workflow;
  let pick: Frame | null = null, best = 0;
  for (const f of FRAMES) if (chose[f] > best) { best = chose[f]; pick = f; }

  const row: ChoiceRow = {
    modelKey: bm.key, model: bm.model, scenario: scenario.id, order: orderKey,
    ok, errored, errorMessage, turns: sub.metrics.turns, chose, pick, evalCalls,
    tokensIn: sub.metrics.tokensIn, tokensOut: sub.metrics.tokensOut,
    costUsd: estimateCost(bm, sub.metrics.tokensIn, sub.metrics.tokensOut), finalText: text,
  };
  await org.close();
  return { row, transcript: sub.transcript };
}

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) out[m[1]] = m[2] === undefined ? true : m[2]; }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const list = (v: unknown): string[] => (typeof v === "string" && v.length ? v.split(",").map((s) => s.trim()) : []);
const num = (v: unknown, d: number): number => (typeof v === "string" && v.length && !Number.isNaN(Number(v)) ? Number(v) : d);

const DEFAULT_SCENARIOS = ["merged-prs-open-linear", "reconcile-ghost-issues", "repo-health-report", "incident-branch", "escalate-hot-services", "incident-commander"];
const DEFAULT_MODELS = ["glm", "deepseek", "xiaomi", "qwen30b"];

const MODE: Mode = args.mode === "roles" ? "roles" : "identical";
const selModels = (list(args.models).length ? list(args.models) : DEFAULT_MODELS).map((k) => modelByKey(k)).filter(Boolean) as BenchModel[];
const selScenarios = (list(args.scenarios).length ? list(args.scenarios) : DEFAULT_SCENARIOS).map((id) => scenarioById(id)).filter(Boolean) as Scenario[];
const selOrders = list(args.orders).length ? list(args.orders).filter((o) => o in ordersFor(MODE)) : ["A", "B"];
const budget = num(args.budget, Infinity);
const outPrefix = typeof args.out === "string" && args.out.length ? args.out : MODE === "roles" ? "frames-dual" : "frames-choice";
const cfg: ChoiceCfg = {
  maxTurns: num(args.maxTurns, 14), maxTokens: num(args.maxTokens, 4096),
  timeoutMs: num(args.timeout, 150_000), compactionContextLimit: num(args.contextLimit, 100_000),
  scale: num(args.scale, Number(process.env.BENCH_SCALE ?? 1)), seed: num(args.seed, 1337), echo: Boolean(args.echo),
};

// ── writers ─────────────────────────────────────────────────────────────────────
const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-");
function writeTranscript(r: ChoiceRow, transcript: unknown[]) {
  const dir = join(ROOT, "logs", "frames", outPrefix);
  mkdirSync(dir, { recursive: true });
  const { finalText: ft, ...meta } = r;
  const lines = [JSON.stringify({ kind: "meta", ...meta }), JSON.stringify({ kind: "final_answer", text: ft }), ...transcript.map((e) => JSON.stringify(e))];
  writeFileSync(join(dir, `${safe(r.modelKey)}__${safe(r.scenario)}__${r.order}.jsonl`), lines.join("\n") + "\n");
}
function csvOf(rows: ChoiceRow[]): string {
  const cols = ["modelKey", "model", "scenario", "order", "pick", "ok", "errored", "turns", "evalCalls", "repl", "program", "workflow", "tokensIn", "tokensOut", "costUsd"];
  const body = rows.map((r) => cols.map((c) => {
    if (c === "repl" || c === "program" || c === "workflow") return String(r.chose[c as Frame]);
    const v = (r as unknown as Record<string, unknown>)[c];
    if (typeof v === "boolean") return v ? "1" : "0";
    return typeof v === "number" ? (c === "costUsd" ? v.toFixed(6) : String(v)) : JSON.stringify(v ?? "");
  }).join(","));
  return [cols.join(","), ...body].join("\n");
}
function pct(n: number, d: number): string { return d ? `${Math.round((100 * n) / d)}%` : "—"; }
function summaryMd(rows: ChoiceRow[]): string {
  const L: string[] = [];
  if (MODE === "roles") {
    L.push("# Frame DUAL — repl + workflow mounted together, with DISTINCT roles\n");
    L.push(`Both \`execute_js\` (repl · EXPLORE) and \`execute_js_workflow\` (workflow · DO) mounted over one session, each with its own role description, presentation order counterbalanced (A = repl-first, B = workflow-first). Config: maxTurns=${cfg.maxTurns}, discovery=full-shapes. Question: does the model route — workflow to compose the task, repl to explore — and does giving both beat either alone?\n`);
  } else {
    L.push("# Frame CHOICE — revealed preference over the eval tool's name\n");
    L.push(`All three eval tools mounted over one session with BYTE-IDENTICAL descriptions (only the NAME differs), neutral preamble, presentation order counterbalanced (A = repl-first, B = workflow-first). Config: maxTurns=${cfg.maxTurns}, discovery=full-shapes.\n`);
  }
  const picked = rows.filter((r) => r.pick);
  const pass = rows.filter((r) => r.ok).length;
  L.push(`Runs with a pick: ${picked.length}/${rows.length} · pass ${pass}/${rows.length} (${pct(pass, rows.length)}).\n`);
  // Tool-usage — did the model use each surface at all? (roles mode's key question)
  const used = (rs: ChoiceRow[], f: Frame) => rs.filter((r) => r.chose[f] > 0).length;
  const both = rows.filter((r) => r.chose.repl > 0 && r.chose.workflow > 0).length;
  const wfOnly = rows.filter((r) => r.chose.workflow > 0 && r.chose.repl === 0).length;
  const replOnly = rows.filter((r) => r.chose.repl > 0 && r.chose.workflow === 0).length;
  const oneWf = rows.filter((r) => r.chose.workflow === 1).length;
  L.push("## Tool usage (did the model reach for each surface?)\n");
  L.push(`- used \`execute_js_workflow\` ≥1: **${used(rows, "workflow")}/${rows.length}** (${pct(used(rows, "workflow"), rows.length)}); the whole task in exactly one workflow call: ${oneWf}/${rows.length} (${pct(oneWf, rows.length)})`);
  L.push(`- used \`execute_js\` (repl) ≥1: ${used(rows, "repl")}/${rows.length} (${pct(used(rows, "repl"), rows.length)})`);
  L.push(`- used BOTH: ${both}/${rows.length} · workflow-only: ${wfOnly}/${rows.length} · repl-only: ${replOnly}/${rows.length}\n`);
  // overall preference share (by run pick)
  L.push("## Preference share (by which tool the model used most)\n");
  L.push("| cohort | n | picks execute_js | picks _program | picks _workflow |");
  L.push("|---|--:|:--:|:--:|:--:|");
  const cohort = (rs: ChoiceRow[], label: string) => {
    const p = rs.filter((r) => r.pick);
    const c = { repl: 0, program: 0, workflow: 0 } as Record<Frame, number>;
    for (const r of p) c[r.pick as Frame]++;
    L.push(`| ${label} | ${p.length} | ${c.repl} (${pct(c.repl, p.length)}) | ${c.program} (${pct(c.program, p.length)}) | ${c.workflow} (${pct(c.workflow, p.length)}) |`);
  };
  cohort(rows, "all");
  cohort(rows.filter((r) => r.order === "A"), "order A (repl-first)");
  cohort(rows.filter((r) => r.order === "B"), "order B (workflow-first)");
  L.push("");
  L.push("_A preference stable across A and B is a genuine pull toward the name, not a first-listed effect._\n");
  // by model
  L.push("## Per model (picks: execute_js / _program / _workflow)\n");
  L.push("| model | n | execute_js | _program | _workflow |");
  L.push("|---|--:|:--:|:--:|:--:|");
  for (const mk of [...new Set(rows.map((r) => r.modelKey))]) {
    const p = rows.filter((r) => r.modelKey === mk && r.pick);
    const c = { repl: 0, program: 0, workflow: 0 } as Record<Frame, number>;
    for (const r of p) c[r.pick as Frame]++;
    L.push(`| ${mk} | ${p.length} | ${c.repl} | ${c.program} | ${c.workflow} |`);
  }
  return L.join("\n") + "\n";
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.OPENROUTER_API_KEY) { console.error("OPENROUTER_API_KEY is not set. Aborting."); process.exit(1); }
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  const matrix: Array<{ m: BenchModel; s: Scenario; o: string }> = [];
  for (const m of selModels) for (const s of selScenarios) for (const o of selOrders) matrix.push({ m, s, o });

  console.log(`\nFrame ${MODE === "roles" ? "DUAL (repl+workflow, distinct roles)" : "CHOICE (3 tools, identical descriptions)"}: ${selModels.length} models × ${selScenarios.length} scenarios × ${selOrders.length} orders = ${matrix.length} runs`);
  console.log(`Models: ${selModels.map((m) => m.key).join(", ")}   Orders: ${selOrders.join(", ")}   Budget: ${budget === Infinity ? "unbounded" : "$" + budget.toFixed(2)}\n`);

  const rows: ChoiceRow[] = [];
  const done = new Set<string>();
  const key = (mk: string, s: string, o: string) => `${mk}|${s}|${o}`;
  if (args.append) {
    try {
      const prior = JSON.parse(readFileSync(join(RESULTS, `${outPrefix}-results.json`), "utf8")) as ChoiceRow[];
      for (const r of prior) { rows.push(r); done.add(key(r.modelKey, r.scenario, r.order)); }
      console.log(`Appending: loaded ${prior.length} prior run(s).\n`);
    } catch { /* fresh */ }
  }

  let spent = 0;
  const hdr = "model      scenario                  order  pick        eval(js/prog/wf)  pass   $";
  console.log(hdr);
  console.log("-".repeat(hdr.length + 4));
  for (const cell of matrix) {
    if (done.has(key(cell.m.key, cell.s.id, cell.o))) continue;
    if (spent >= budget) { console.log(`\n⚠ budget $${budget.toFixed(2)} reached ($${spent.toFixed(4)}) — stopping after ${rows.length}.`); break; }
    let out;
    try { out = await runChoiceCell(cell.m, cell.s, cell.o, cfg, MODE); }
    catch (err) { console.log(`${cell.m.key}/${cell.s.id}/${cell.o} → HARNESS ERROR: ${err instanceof Error ? err.message : String(err)}`); continue; }
    rows.push(out.row); spent += out.row.costUsd; writeTranscript(out.row, out.transcript);
    const r = out.row;
    console.log(
      `${r.modelKey.padEnd(10)} ${r.scenario.padEnd(25)} ${r.order.padEnd(6)} ${(r.pick ?? "none").padEnd(11)} ` +
      `${(r.chose.repl + "/" + r.chose.program + "/" + r.chose.workflow).padStart(14)}  ${r.errored ? "ERR " : r.ok ? "PASS" : "FAIL"}  ${r.costUsd.toFixed(4)}`,
    );
    writeFileSync(join(RESULTS, `${outPrefix}-results.json`), JSON.stringify(rows, null, 2));
    writeFileSync(join(RESULTS, `${outPrefix}-results.csv`), csvOf(rows));
    writeFileSync(join(RESULTS, `${outPrefix}-summary.md`), summaryMd(rows));
  }
  console.log(`\nDone. ${rows.length} runs, estimated spend $${spent.toFixed(4)}.`);
}

main().catch((err) => { console.error("\nFRAME CHOICE CRASHED:\n", err); process.exit(1); });
