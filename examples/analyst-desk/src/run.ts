/**
 * Run the desk against real models and report what came out.
 *
 * Two things this harness takes seriously:
 *
 * **A hard budget.** The ceiling is checked before every call, not tallied
 * afterwards, so an overrun stops the run rather than being discovered in the
 * summary. Agent spend and judge spend are tracked separately because they
 * answer different questions — one is what the work cost, the other is what
 * verifying it cost.
 *
 * **A stronger verifier than the worker.** The agents are the cheap tier; the
 * judge is the model that scored highest in the earlier benchmark. Grading a
 * model with itself measures self-consistency, which is not what anyone wants
 * to know.
 */
import { runAgent } from "./agent";
import { judge, type Verdict } from "./judge";
import { extractArtifacts, groundTruthText, openDesk } from "./desk";
import { SCENARIOS, type CheckResult } from "./scenarios";

const AGENT_MODELS = ["z-ai/glm-4.7-flash", "xiaomi/mimo-v2.5", "minimax/minimax-m2.5"];

/**
 * The verifier. GLM-5.2 rather than a frontier model: it took 16/16 in the
 * earlier benchmark where the agents here took 9–15, so the gap is measured
 * rather than assumed, and it costs about a quarter of the alternatives.
 * `xiaomi/mimo-v2.5-pro` is the other reasonable pick — pass --judge to swap.
 */
const DEFAULT_JUDGE = "z-ai/glm-5.2";

const DEFAULT_BUDGET_USD = 5;

interface Args {
  models: string[];
  scenarios: string[];
  judgeModel: string;
  budget: number;
  reps: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (flag: string, fallback: string[]): string[] => {
    const v = get(flag);
    return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
  };
  return {
    models: list("--models", AGENT_MODELS),
    scenarios: list("--scenarios", SCENARIOS.map((s) => s.id)),
    judgeModel: get("--judge") ?? DEFAULT_JUDGE,
    budget: Number(get("--budget") ?? DEFAULT_BUDGET_USD),
    reps: Number(get("--reps") ?? 1),
  };
}

interface Row {
  scenario: string;
  model: string;
  rep: number;
  checks: CheckResult[];
  verdicts: Verdict[];
  turns: number;
  errored: number;
  agentCost: number;
  judgeCost: number;
  stopReason: string;
  note?: string;
}

const money = (n: number) => `$${n.toFixed(4)}`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. `pnpm selfcheck` runs the same scenarios for free.");
    process.exit(1);
  }

  const chosen = SCENARIOS.filter((s) => args.scenarios.includes(s.id));
  if (chosen.length === 0) {
    console.error(`no scenarios matched. available: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }

  const planned = chosen.length * args.models.length * args.reps;
  console.log(`analyst-desk — ${planned} run(s), judged by ${args.judgeModel}, ceiling ${money(args.budget)}\n`);

  const rows: Row[] = [];
  let agentSpend = 0;
  let judgeSpend = 0;
  let stoppedEarly = false;

  outer: for (let rep = 1; rep <= args.reps; rep++) {
    for (const scenario of chosen) {
      for (const model of args.models) {
        const spent = agentSpend + judgeSpend;
        if (spent >= args.budget) {
          console.log(`\n!! budget ceiling ${money(args.budget)} reached after ${money(spent)} — stopping.`);
          stoppedEarly = true;
          break outer;
        }

        process.stdout.write(`  ${scenario.id.padEnd(14)} ${model.padEnd(24)} `);
        const { env, truth } = await openDesk();
        let row: Row;

        try {
          const transcript = await runAgent({
            env,
            model,
            task: scenario.task,
            maxTurns: scenario.maxTurns,
          });
          agentSpend += transcript.usage.cost ?? 0;

          const checks = await scenario.check(env, truth);
          const questions = scenario.questions(truth);

          let verdicts: Verdict[] = [];
          let judgeCost = 0;
          let note: string | undefined;

          if (questions.length > 0) {
            const result = await judge({
              model: args.judgeModel,
              scenario: scenario.task,
              groundTruth: groundTruthText(truth),
              evidence: { artifacts: await extractArtifacts(env, scenario.artifacts) },
              questions,
            });
            verdicts = result.verdicts;
            judgeCost = result.usage.cost ?? 0;
            judgeSpend += judgeCost;
            note = result.error;
          }

          row = {
            scenario: scenario.id,
            model,
            rep,
            checks,
            verdicts,
            turns: transcript.turns,
            errored: transcript.events.filter((e) => e.status === "error").length,
            agentCost: transcript.usage.cost ?? 0,
            judgeCost,
            stopReason: transcript.stopReason,
            note,
          };
        } finally {
          await env.close();
        }

        rows.push(row);
        const c = row.checks.filter((x) => x.passed).length;
        const v = row.verdicts.filter((x) => x.pass).length;
        const clean = c === row.checks.length && v === row.verdicts.length;
        console.log(
          `${clean ? "PASS" : "FAIL"}  checks ${c}/${row.checks.length}  judge ${v}/${row.verdicts.length}  ` +
            `${row.turns} turns  ${money(row.agentCost + row.judgeCost)}`,
        );
      }
    }
  }

  report(rows, { agentSpend, judgeSpend, stoppedEarly, judgeModel: args.judgeModel });
}

function report(
  rows: Row[],
  meta: { agentSpend: number; judgeSpend: number; stoppedEarly: boolean; judgeModel: string },
): void {
  console.log(`\n${"=".repeat(78)}\n`);

  const scenarioIds = [...new Set(rows.map((r) => r.scenario))];
  console.log("By scenario\n");
  for (const id of scenarioIds) {
    const mine = rows.filter((r) => r.scenario === id);
    const fullPass = mine.filter(
      (r) => r.checks.every((c) => c.passed) && r.verdicts.every((v) => v.pass),
    ).length;
    console.log(`  ${id.padEnd(14)} ${fullPass}/${mine.length} complete`);

    // Which specific checks failed matters more than the count: a scenario
    // failing on one figure and a scenario producing nothing look identical
    // in a pass rate and are entirely different problems.
    const failedChecks = new Map<string, number>();
    for (const r of mine) for (const c of r.checks) if (!c.passed) failedChecks.set(c.name, (failedChecks.get(c.name) ?? 0) + 1);
    for (const [name, n] of [...failedChecks].sort((a, b) => b[1] - a[1])) {
      console.log(`      × ${name} — failed ${n}/${mine.length}`);
    }
    const failedVerdicts = new Map<string, number>();
    for (const r of mine) for (const v of r.verdicts) if (!v.pass) failedVerdicts.set(v.id, (failedVerdicts.get(v.id) ?? 0) + 1);
    for (const [id2, n] of [...failedVerdicts].sort((a, b) => b[1] - a[1])) {
      const example = rows.flatMap((r) => r.verdicts).find((v) => v.id === id2 && !v.pass);
      console.log(`      ? judge:${id2} — failed ${n}/${mine.length}: ${example?.reason ?? ""}`);
    }
  }

  console.log("\nBy model\n");
  for (const model of [...new Set(rows.map((r) => r.model))]) {
    const mine = rows.filter((r) => r.model === model);
    const fullPass = mine.filter((r) => r.checks.every((c) => c.passed) && r.verdicts.every((v) => v.pass)).length;
    const errored = mine.reduce((n, r) => n + r.errored, 0);
    const cost = mine.reduce((n, r) => n + r.agentCost + r.judgeCost, 0);
    console.log(
      `  ${model.padEnd(24)} ${String(fullPass).padStart(2)}/${mine.length}  ` +
        `${mine.reduce((n, r) => n + r.turns, 0)} turns  ${errored} errored calls  ${money(cost)}`,
    );
  }

  const total = meta.agentSpend + meta.judgeSpend;
  console.log(
    `\nSpend: ${money(total)} total — ${money(meta.agentSpend)} agents, ${money(meta.judgeSpend)} judge (${meta.judgeModel})`,
  );
  if (meta.stoppedEarly) console.log("NOTE: the run stopped at the budget ceiling; results above are partial.");

  const judgeBroken = rows.filter((r) => r.note);
  if (judgeBroken.length > 0) {
    console.log(`\nJudge problems on ${judgeBroken.length} run(s) — those verdicts default to FAIL:`);
    for (const r of judgeBroken.slice(0, 5)) console.log(`  ${r.scenario}/${r.model}: ${r.note}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
