/**
 * Run every scenario against every model and report two things: whether the
 * deliverable exists, and — more usefully — every place the model bounced off
 * the environment.
 *
 *   pnpm bench                       # all models, all scenarios
 *   pnpm bench -- --models a,b       # subset
 *   pnpm bench -- --scenarios pdf-report
 *   pnpm bench -- --reps 3           # repetitions per cell, for a real rate
 *   pnpm bench -- --budget 2.50
 *
 * A delivery *rate* needs repetitions: one run per cell tells you whether a
 * model happened to succeed once, not how often it succeeds. Temperature is
 * 0, but tool-calling models are not deterministic in practice, and the
 * spread between reps is the number that matters.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { runAgent, type RunTranscript, type ToolEvent } from "./agent";
import { SCENARIOS, makeScenarioEnv, type Check } from "./scenarios";

const DEFAULT_MODELS = ["xiaomi/mimo-v2.5", "z-ai/glm-4.7-flash", "minimax/minimax-m2.5", "z-ai/glm-5.2"];

interface Result {
  model: string;
  scenario: string;
  rep: number;
  checks: Check[];
  passed: boolean;
  transcript: RunTranscript;
  gradeError?: string;
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

  const models = (arg("models") ?? DEFAULT_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const only = arg("scenarios");
  const scenarios = only ? SCENARIOS.filter((s) => only.split(",").includes(s.name)) : SCENARIOS;
  const budget = Number(arg("budget", "4.00"));
  const reps = Math.max(1, Number(arg("reps", "1")));

  const outDir = new URL("../results/", import.meta.url).pathname;
  await mkdir(outDir, { recursive: true });

  const results: Result[] = [];
  let spent = 0;

  outer: for (const model of models) {
    for (const scenario of scenarios) {
      for (let rep = 1; rep <= reps; rep++) {
        if (spent >= budget) {
          console.log(`\n!! budget of $${budget.toFixed(2)} reached — stopping before ${model} / ${scenario.name} rep ${rep}`);
          break outer;
        }
        process.stdout.write(`${model.padEnd(24)} ${scenario.name.padEnd(16)} ${reps > 1 ? `r${rep} ` : ""}`);

        const env = await makeScenarioEnv(scenario);
        const transcript = await runAgent({ env, model, task: scenario.task, maxTurns: scenario.maxTurns });
        transcript.scenario = scenario.name;
        spent += transcript.usage.cost ?? 0;

        let checks: Check[] = [];
        let gradeError: string | undefined;
        try {
          checks = await scenario.grade(env);
        } catch (e) {
          gradeError = e instanceof Error ? e.message : String(e);
          checks = [{ name: "grading", ok: false, detail: gradeError }];
        }
        const passed = checks.length > 0 && checks.every((c) => c.ok);
        results.push({ model, scenario: scenario.name, rep, checks, passed, transcript, gradeError });

        const failed = transcript.events.filter((e) => e.status === "error").length;
        console.log(
          `${passed ? "PASS" : "FAIL"}  ${checks.filter((c) => c.ok).length}/${checks.length} checks · ` +
            `${transcript.events.length} calls (${failed} errored) · ${transcript.turns} turns · ` +
            `$${(transcript.usage.cost ?? 0).toFixed(4)}${transcript.stopReason === "error" ? ` · ${transcript.error}` : ""}`,
        );
      }
    }
  }

  const report = renderReport(results, spent, reps);
  // Keep every run. Comparing a fix against its baseline is the whole point
  // of running this twice, and an earlier version of this file overwrote the
  // baseline the moment you tried — which is exactly when you need it.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await writeFile(`${outDir}${stamp}-raw.json`, JSON.stringify(results, null, 2));
  await writeFile(`${outDir}${stamp}-report.md`, report);
  await writeFile(`${outDir}raw.json`, JSON.stringify(results, null, 2));
  await writeFile(`${outDir}report.md`, report);
  console.log(`\n${report}`);
  console.log(`\nWrote ${outDir}${stamp}-report.md (and report.md/raw.json as latest) · total spend $${spent.toFixed(3)}`);
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

function renderReport(results: Result[], spent: number, reps: number): string {
  const models = [...new Set(results.map((r) => r.model))];
  const scenarios = [...new Set(results.map((r) => r.scenario))];
  const lines: string[] = ["# Working environment — agent evaluation", ""];

  const passes = results.filter((r) => r.passed).length;
  const rate = results.length === 0 ? 0 : (passes / results.length) * 100;
  // Wilson lower bound at 95%: with a handful of runs a raw percentage
  // flatters itself, and "over 90% of the time" is a claim about the floor.
  const lower = wilsonLower(passes, results.length) * 100;
  lines.push(
    `**Delivery rate: ${rate.toFixed(1)}%** (${passes}/${results.length} runs) · 95% lower bound ${lower.toFixed(1)}%`,
    "",
  );

  lines.push("## Outcomes", "", `| Model | ${scenarios.join(" | ")} | rate | calls | errored | $ |`, `|---|${scenarios.map(() => "---").join("|")}|---|---|---|---|`);
  for (const model of models) {
    const mine = results.filter((r) => r.model === model);
    const cells = scenarios.map((s) => {
      const runs = mine.filter((x) => x.scenario === s);
      if (runs.length === 0) return "–";
      const ok = runs.filter((x) => x.passed).length;
      if (runs.length === 1) return runs[0].passed ? "✅" : `❌ ${runs[0].checks.filter((c) => c.ok).length}/${runs[0].checks.length}`;
      return `${ok}/${runs.length}${ok === runs.length ? " ✅" : ""}`;
    });
    const modelRate = mine.length ? ((mine.filter((r) => r.passed).length / mine.length) * 100).toFixed(0) + "%" : "–";
    const calls = mine.reduce((n, r) => n + r.transcript.events.length, 0);
    const errored = mine.reduce((n, r) => n + r.transcript.events.filter((e) => e.status === "error").length, 0);
    const cost = mine.reduce((n, r) => n + (r.transcript.usage.cost ?? 0), 0);
    lines.push(`| \`${model}\` | ${cells.join(" | ")} | ${modelRate} | ${calls} | ${errored} | ${cost.toFixed(3)} |`);
  }

  lines.push("", "## Failed checks", "");
  const anyFail = results.some((r) => !r.passed);
  if (!anyFail) lines.push("None — every scenario produced its deliverable.");
  for (const r of results.filter((x) => !x.passed)) {
    lines.push(`**\`${r.model}\` · ${r.scenario}${r.rep > 1 || reps > 1 ? ` (rep ${r.rep})` : ""}** (${r.transcript.stopReason})`);
    for (const c of r.checks.filter((x) => !x.ok)) lines.push(`- ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    lines.push("");
  }

  // The friction report: what the models tried that the environment refused.
  lines.push("## Friction — every errored tool call", "");
  const byMessage = new Map<string, { count: number; tools: Set<string>; models: Set<string>; sample: ToolEvent }>();
  for (const r of results) {
    for (const e of r.transcript.events.filter((x) => x.status === "error")) {
      const key = normalizeMessage(e.message ?? "");
      const hit = byMessage.get(key) ?? { count: 0, tools: new Set<string>(), models: new Set<string>(), sample: e };
      hit.count += 1;
      hit.tools.add(e.name);
      hit.models.add(r.model);
      byMessage.set(key, hit);
    }
  }
  if (byMessage.size === 0) lines.push("No tool call failed.");
  for (const [msg, info] of [...byMessage.entries()].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`### ×${info.count} · ${[...info.tools].join(", ")}`);
    lines.push("```");
    lines.push(msg.slice(0, 400));
    lines.push("```");
    lines.push(`Models: ${[...info.models].join(", ")}`);
    lines.push(`Args: \`${JSON.stringify(info.sample.args).slice(0, 240)}\``, "");
  }

  lines.push("## Tool usage", "");
  const usage = new Map<string, number>();
  for (const r of results) for (const e of r.transcript.events) usage.set(e.name, (usage.get(e.name) ?? 0) + 1);
  lines.push("| Verb | calls |", "|---|---|");
  for (const [name, n] of [...usage.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| \`${name}\` | ${n} |`);

  lines.push("", `Total spend: $${spent.toFixed(3)}`, "");
  return lines.join("\n");
}

/** Collapse per-path detail so the same class of failure groups together. */
function normalizeMessage(m: string): string {
  return m
    .replace(/\/[\w./-]+/g, "<path>")
    .replace(/\d+/g, "N")
    .trim();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
