/**
 * Run every scenario against every model and report three things: whether the
 * conversation collected the right answers, how the model handled the surface,
 * and — the number this benchmark exists for — how much context the form
 * actually cost.
 *
 *   pnpm bench                          # all models, all scenarios
 *   pnpm bench -- --models a,b
 *   pnpm bench -- --scenarios held-value,over-cap
 *   pnpm bench -- --reps 3              # repetitions per cell, for a real rate
 *   pnpm bench -- --budget 0.50
 *
 * The budget is checked before each cell and is a hard stop, not a warning.
 * Partial results are flushed after every cell, so an abort keeps whatever was
 * already paid for.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { runAgent, type RunTranscript } from "./agent";
import { complete } from "./openrouter";
import { makeCell } from "./harness";
import { SCENARIOS, type Check } from "./scenarios";
import { discoveryTokens, formSurfaceTokens } from "./tokens";

/**
 * Cheap, tool-capable, and spread across vendors so the differences mean
 * something. Prices move — `--models` overrides, and OpenRouter reports actual
 * spend per call, so the budget holds regardless of what's picked.
 */
const DEFAULT_MODELS = [
  "openai/gpt-5-nano",
  "z-ai/glm-4.7-flash",
  "qwen/qwen3.7-flash",
  "deepseek/deepseek-v4-flash-0731",
];

interface Result {
  model: string;
  scenario: string;
  rep: number;
  checks: Check[];
  passed: boolean;
  transcript: RunTranscript;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set");
    process.exit(1);
  }

  const models = (arg("models") ?? DEFAULT_MODELS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const only = arg("scenarios");
  const scenarios = only
    ? SCENARIOS.filter((s) => only.split(",").includes(s.name))
    : SCENARIOS;
  const budget = Number(arg("budget", "0.75"));
  const reps = Math.max(1, Number(arg("reps", "1")));

  const outDir = new URL("../results/", import.meta.url).pathname;
  await mkdir(outDir, { recursive: true });

  const results: Result[] = [];
  let spent = 0;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const flush = async (): Promise<void> => {
    await writeFile(`${outDir}${stamp}-raw.json`, JSON.stringify(results, null, 2));
    await writeFile(`${outDir}${stamp}-report.md`, renderReport(results, spent, budget));
  };

  console.log(
    `${models.length} models × ${scenarios.length} scenarios × ${reps} rep${reps > 1 ? "s" : ""} ` +
      `= ${models.length * scenarios.length * reps} runs · budget $${budget.toFixed(2)}\n`,
  );

  outer: for (const model of models) {
    for (const scenario of scenarios) {
      for (let rep = 1; rep <= reps; rep++) {
        if (spent >= budget) {
          console.log(
            `\n!! budget of $${budget.toFixed(2)} reached — stopping before ${model} / ${scenario.name}`,
          );
          break outer;
        }
        process.stdout.write(
          `${model.padEnd(32)} ${scenario.name.padEnd(16)} ${reps > 1 ? `r${rep} ` : ""}`,
        );

        const cell = await makeCell();
        const transcript = await runAgent({
          runner: cell.runner,
          adapter: cell.adapter,
          compiled: cell.compiled,
          instanceId: cell.instanceId,
          model,
          userTurns: scenario.userTurns,
          complete,
        });
        transcript.scenario = scenario.name;
        spent += costOf(transcript);

        let checks: Check[];
        try {
          checks = await scenario.grade({
            compiled: cell.compiled,
            adapter: cell.adapter,
            subject: cell.subject,
            transcript,
          });
        } catch (e) {
          checks = [
            { name: "grading", ok: false, detail: e instanceof Error ? e.message : String(e) },
          ];
        }
        const passed = checks.length > 0 && checks.every((c) => c.ok);
        results.push({ model, scenario: scenario.name, rep, checks, passed, transcript });
        await flush();

        const l = transcript.ledger;
        console.log(
          `${passed ? "PASS" : "FAIL"}  ${checks.filter((c) => c.ok).length}/${checks.length} · ` +
            `${l.calls} calls · ${l.promptTokens} prompt tok · ` +
            `form ${formSurfaceTokens(l)} tok · $${costOf(transcript).toFixed(4)}` +
            `${transcript.stopReason === "error" ? ` · ${transcript.error}` : ""}`,
        );
      }
    }
  }

  const report = renderReport(results, spent, budget);
  await writeFile(`${outDir}${stamp}-raw.json`, JSON.stringify(results, null, 2));
  await writeFile(`${outDir}${stamp}-report.md`, report);
  // Latest aliases, so a diff against the previous stamped run stays possible.
  await writeFile(`${outDir}raw.json`, JSON.stringify(results, null, 2));
  await writeFile(`${outDir}report.md`, report);
  console.log(`\n${report}`);
  console.log(
    `\nWrote ${outDir}${stamp}-report.md (and report.md/raw.json as latest) · total spend $${spent.toFixed(4)}`,
  );
}

/** OpenRouter reports real spend per call, so this is billed cost, not a model of it. */
function costOf(t: RunTranscript): number {
  return t.ledger.cost;
}

/** Wilson score interval lower bound — honest about small samples. */
function wilsonLower(passes: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = passes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - spread) / d);
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

function renderReport(results: Result[], spent: number, budget: number): string {
  const models = [...new Set(results.map((r) => r.model))];
  const scenarios = [...new Set(results.map((r) => r.scenario))];
  const lines: string[] = ["# glove-memory/forms — agent evaluation", ""];

  if (results.length === 0) return lines.concat("No runs completed.").join("\n");

  const passes = results.filter((r) => r.passed).length;
  const rate = (passes / results.length) * 100;
  const lower = wilsonLower(passes, results.length) * 100;
  lines.push(
    `**Collection rate: ${rate.toFixed(1)}%** (${passes}/${results.length} runs) · 95% lower bound ${lower.toFixed(1)}%`,
    "",
    `Spend $${spent.toFixed(4)} of $${budget.toFixed(2)} budget.`,
    "",
  );

  // A run that died on an upstream error collected nothing, so it scores as a
  // failure — but it says nothing about the model, and burying that turns a
  // rate limit into a capability claim.
  const errored = results.filter((r) => r.transcript.stopReason === "error");
  if (errored.length > 0) {
    lines.push(
      `> **${errored.length} run(s) ended on an upstream error** and are counted as failures:`,
      ...errored.map(
        (r) => `> \`${r.model}\` / ${r.scenario} r${r.rep} — ${(r.transcript.error ?? "").slice(0, 120)}`,
      ),
      "> Re-run those cells before reading them as anything about the model.",
      "",
    );
  }

  // A truncated completion returns no content and no tool call, which scores
  // identically to a model that ignored its tools. If any showed up, the
  // numbers below are about the token ceiling, not about the models.
  const truncated = sum(results.map((r) => r.transcript.behaviour.truncatedCompletions));
  if (truncated > 0) {
    const who = [
      ...new Set(
        results
          .filter((r) => r.transcript.behaviour.truncatedCompletions > 0)
          .map((r) => r.model),
      ),
    ];
    lines.push(
      `> **${truncated} completion(s) hit the token ceiling** (${who.join(", ")}). A reasoning`,
      "> model that spends its whole budget thinking returns nothing at all, which grades the same",
      "> as ignoring its tools. Raise `max_tokens` in `openrouter.ts` and re-run before reading",
      "> anything below as a finding about these models.",
      "",
    );
  }

  // ─── Outcomes ───────────────────────────────────────────────────────────
  lines.push(
    "## Outcomes",
    "",
    `| Model | ${scenarios.join(" | ")} | rate |`,
    `|---|${scenarios.map(() => "---").join("|")}|---|`,
  );
  for (const model of models) {
    const mine = results.filter((r) => r.model === model);
    const cells = scenarios.map((s) => {
      const runs = mine.filter((x) => x.scenario === s);
      if (runs.length === 0) return "–";
      const ok = runs.filter((x) => x.passed).length;
      if (runs.length === 1) {
        const r = runs[0];
        return r.passed ? "✅" : `❌ ${r.checks.filter((c) => c.ok).length}/${r.checks.length}`;
      }
      return `${ok}/${runs.length}${ok === runs.length ? " ✅" : ""}`;
    });
    const modelRate = ((mine.filter((r) => r.passed).length / mine.length) * 100).toFixed(0);
    lines.push(`| \`${model}\` | ${cells.join(" | ")} | ${modelRate}% |`);
  }

  // ─── Context ────────────────────────────────────────────────────────────
  lines.push(
    "",
    "## Context cost",
    "",
    "`prompt` is what the provider billed for, summed over every completion in the run.",
    "The breakdown is measured with one fixed tokenizer (`o200k_base`) over the exact strings",
    "injected, so the split is comparable across models even where their own tokenizers differ.",
    "",
    "`discovery` is what the model spent learning *what to ask*: the tier-0 line plus whatever it",
    "chose to pull from `status`/`inspect`. `eager` is the like-for-like alternative — the whole",
    "form inlined in the system prompt and re-sent every call. Write verbs and their results are",
    "common to both designs and excluded from both sides.",
    "",
    "| Model | calls | prompt | form surface | % of prompt | tier-0 | tiered reads | discovery | eager | saved |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const model of models) {
    const ls = results.filter((r) => r.model === model).map((r) => r.transcript.ledger);
    const calls = sum(ls.map((l) => l.calls));
    const prompt = sum(ls.map((l) => l.promptTokens));
    const surface = sum(ls.map(formSurfaceTokens));
    const tier0 = sum(ls.map((l) => l.tier0Tokens));
    const reads = sum(ls.map((l) => l.readResultTokens));
    const discovery = sum(ls.map(discoveryTokens));
    const eager = sum(ls.map((l) => l.eagerBaselineTokens));
    const saved = eager > 0 ? ((1 - discovery / eager) * 100).toFixed(0) + "%" : "–";
    const pct = prompt > 0 ? ((surface / prompt) * 100).toFixed(0) + "%" : "–";
    lines.push(
      `| \`${model}\` | ${calls} | ${prompt} | ${surface} | ${pct} | ${tier0} | ${reads} | ${discovery} | ${eager} | ${saved} |`,
    );
  }

  const allLedgers = results.map((r) => r.transcript.ledger);
  const totalDiscovery = sum(allLedgers.map(discoveryTokens));
  const totalEager = sum(allLedgers.map((l) => l.eagerBaselineTokens));
  if (totalEager > 0) {
    lines.push(
      "",
      `Across every run: **${totalDiscovery} tokens of discovery against ${totalEager} eager** — ` +
        `${(totalEager / Math.max(1, totalDiscovery)).toFixed(1)}× less context spent on ` +
        `telling the model what the form wants.`,
    );
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────
  lines.push(
    "",
    "## Instruction following",
    "",
    "`batch` is fields per write call — the surface asks for everything learned in one call, so",
    "higher is better. `redundant` re-sent a value already stored. `unknown` invented a field id.",
    "",
    "| Model | fills | batch | status | inspect | revise | rejected | redundant | unknown | tool errors | truncated |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const model of models) {
    const bs = results.filter((r) => r.model === model).map((r) => r.transcript.behaviour);
    const fills = sum(bs.map((b) => b.fillCalls));
    const writes = fills + sum(bs.map((b) => b.reviseCalls + b.startCalls));
    const fields = sum(bs.map((b) => b.fieldsWritten));
    lines.push(
      `| \`${model}\` | ${fills} | ${writes ? (fields / writes).toFixed(1) : "–"} | ` +
        `${sum(bs.map((b) => b.statusCalls))} | ${sum(bs.map((b) => b.inspectCalls))} | ` +
        `${sum(bs.map((b) => b.reviseCalls))} | ${sum(bs.map((b) => b.rejectedValues))} | ` +
        `${sum(bs.map((b) => b.redundantWrites))} | ${sum(bs.map((b) => b.unknownFieldAttempts))} | ` +
        `${sum(bs.map((b) => b.toolErrors))} | ${sum(bs.map((b) => b.truncatedCompletions))} |`,
    );
  }

  // ─── Failures ───────────────────────────────────────────────────────────
  lines.push("", "## Failed checks", "");
  const failing = results.filter((r) => !r.passed);
  if (failing.length === 0) lines.push("None — every conversation collected what it should.");
  for (const r of failing) {
    lines.push(
      `**\`${r.model}\` · ${r.scenario}${r.rep > 1 ? ` (rep ${r.rep})` : ""}**` +
        `${r.transcript.stopReason === "error" ? ` — ${r.transcript.error}` : ""}`,
    );
    for (const c of r.checks.filter((x) => !x.ok)) {
      lines.push(`- ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    lines.push("");
  }

  lines.push("## What each scenario probes", "");
  for (const s of SCENARIOS.filter((s) => scenarios.includes(s.name))) {
    lines.push(`- **${s.name}** — ${s.probes}`);
  }

  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
