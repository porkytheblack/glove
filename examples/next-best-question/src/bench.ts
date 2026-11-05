/**
 * Simulated intake calls: does classifier ordering ask fewer, better questions?
 *
 * Every scenario is a caller with a hidden profile. The caller opens with a
 * message, then answers whatever the "agent" asks. The agent is a policy, not
 * an LLM, so runs are deterministic and cost nothing:
 *
 * - `static`: the form engine's own order: the first `ask: true` field.
 * - `oracle`: knows exactly what the caller has said. Confirms all of it in
 *   one turn, then asks in engine order. The ceiling for coverage detection.
 * - `advisory`: follows the planner's line: confirm what it thinks was said,
 *   otherwise ask its top question.
 * - `steered`: confirms like `advisory`, but asks in engine order over a form
 *   whose open step the planner moves with `{ jump }`.
 *
 * A confirm turn checks everything the policy believes was said at once.
 * Confirming something the caller never said fails (`phantom`), and the agent
 * asks it on the next turn. A wrong guess at the claim type is corrected by
 * the caller (`wrong branch`). Turns are counted two ways: with every
 * confirmation as a turn of its own, and folded into the next question ("Got
 * it, the King Street car park. What's the registration?"), where only the
 * questions count (a failed confirmation's retry is a question). Every answer is written to a
 * real FormRunner, so applicability, steps and completion are the engine's.
 *
 *   pnpm --filter glove-next-best-question-example bench
 *   CLASSIFIER=jev pnpm --filter glove-next-best-question-example bench
 */
import { mkdir, writeFile } from "node:fs/promises";
import { MemorySchema } from "glove-memory/core";
import { FormRunner, type FormDef } from "glove-memory/forms";
import { InMemoryFormAdapter } from "glove-memory/in-memory";
import { claimForm, claimPlan, claimRegistry, type ClaimFieldId } from "./claim-form";
import { pickClassifier } from "./classifiers";
import { formCandidates, planForm, withNextBestRouting } from "./forms";
import { NextBestPlanner, type Plan, type Turn } from "./planner";
import { answerFor, scenarios, valueFor, type Scenario } from "./scenarios";

type Policy = "static" | "oracle" | "advisory" | "steered";
const POLICIES: Policy[] = ["static", "oracle", "advisory", "steered"];
const MAX_TURNS = 40;

interface Run {
  scenario: string;
  policy: Policy;
  /** Agent turns until the form completed, with each confirmation its own turn. */
  turns: number;
  /** The same, with confirmations folded into the next question; failed ones still cost the retry. */
  foldedTurns: number;
  asks: number;
  confirms: number;
  /** Asked for something the caller had already said. */
  redundant: number;
  /** Tried to confirm something the caller never said. */
  phantom: number;
  /** Guessed the claim type wrong and was corrected. */
  wrongBranch: number;
  /** The turn on which the claim type was settled. */
  branchSettledAt: number;
  /** Consecutive questions from different steps. */
  stepSwitches: number;
  classifierCalls: number;
  classifierMs: number;
  log: string[];
}

async function run(s: Scenario, policy: Policy, planner: NextBestPlanner): Promise<Run> {
  const turns: Turn[] = [{ id: s.opening, text: s.opening }];
  const said = new Set<ClaimFieldId>(s.said);
  if (s.branchStated) said.add("incidentType");
  const phantoms = new Set<string>();
  const retry: ClaimFieldId[] = [];
  const r: Run = {
    scenario: s.id, policy, turns: 0, foldedTurns: 0, asks: 0, confirms: 0, redundant: 0, phantom: 0, wrongBranch: 0,
    branchSettledAt: 0, stepSwitches: 0, classifierCalls: 0, classifierMs: 0, log: [],
  };
  const def: FormDef<any> = policy === "steered"
    ? withNextBestRouting(claimForm, {
        planner,
        config: claimPlan,
        turns: () => turns,
        onRoute: ({ plan }) => {
          r.classifierCalls += plan.calls;
          r.classifierMs += plan.ms;
        },
      })
    : claimForm;
  const runner = new FormRunner(new InMemoryFormAdapter({ schema: new MemorySchema() }), {
    registry: claimRegistry(def),
    subject: `${s.id}:${policy}`,
  });
  await runner.start("claim");

  let lastStep: string | undefined;
  const capture = async (field: ClaimFieldId) => {
    await runner.fill({ [field]: valueFor(s, field) });
    if (field === "incidentType") r.branchSettledAt = r.turns;
  };

  while (r.turns < MAX_TURNS) {
    const { compiled, instance } = await runner.resolve();
    if (instance.status === "complete") break;
    const engineNext = (await runner.status()).fields.find((f) => f.ask)?.id as ClaimFieldId | undefined;

    let plan: Plan | undefined;
    if (policy === "advisory" || policy === "steered") {
      plan = await planForm(planner, compiled, instance, claimPlan, turns);
      r.classifierCalls += plan.calls;
      r.classifierMs += plan.ms;
    }

    // ─── Choose a move ───────────────────────────────────────────────────
    let confirm: Array<{ field: ClaimFieldId; value?: string }> = [];
    let ask: ClaimFieldId | undefined;
    if (policy === "oracle") {
      const open = new Set(formCandidates(compiled, instance, claimPlan).candidates.map((c) => c.id));
      confirm = [...said].filter((f) => open.has(f)).map((field) => ({ field }));
    } else if (plan) {
      confirm = plan.confirm
        .filter((m) => !phantoms.has(m.candidate.id))
        .map((m) => ({ field: m.candidate.id as ClaimFieldId, value: m.value }));
    }
    if (confirm.length === 0) {
      // A failed confirm turns into a question straight away: "Sorry, where did it happen?"
      ask = retry.shift() ?? (policy === "advisory" ? (plan!.ask[0]?.candidate.id as ClaimFieldId | undefined) : engineNext);
    }

    // ─── Play it out ─────────────────────────────────────────────────────
    r.turns++;
    if (confirm.length > 0) {
      r.confirms++;
      const ok: string[] = [];
      for (const { field, value } of confirm) {
        if (field === "incidentType") {
          if (value !== undefined && value !== s.branch) r.wrongBranch++;
          await capture(field);
          ok.push(`${field}=${s.branch}${value !== undefined && value !== s.branch ? ` (guessed ${value})` : ""}`);
        } else if (said.has(field)) {
          await capture(field);
          ok.push(field);
        } else {
          r.phantom++;
          phantoms.add(field);
          retry.push(field);
          ok.push(`${field}?`);
        }
      }
      r.log.push(`confirm ${ok.join(", ")}`);
      continue;
    }
    if (!ask) {
      r.log.push("stuck: nothing to ask");
      break;
    }
    r.asks++;
    const reasked = said.has(ask);
    if (reasked) r.redundant++;
    const step = compiled.fieldById.get(ask)?.stepId;
    if (lastStep && step !== lastStep) r.stepSwitches++;
    lastStep = step;
    const reply = answerFor(s, ask);
    turns.push({ id: `${r.turns}:${reply.text}`, text: reply.text });
    said.add(ask);
    for (const f of reply.also) said.add(f);
    await capture(ask);
    r.log.push(`ask ${ask}${reasked ? " (already said)" : ""}`);
  }
  r.foldedTurns = r.asks;
  return r;
}

// ─── Classifier quality on the opening message ───────────────────────────

interface OpeningEval {
  scenario: string;
  branch: { truth: string; choice: string; p: number };
  /** Field → probability the opening covers it, for fields that apply under the true branch. */
  covered: Record<string, { p: number; truth: boolean }>;
}

async function evalOpening(s: Scenario, planner: NextBestPlanner): Promise<OpeningEval> {
  const runner = new FormRunner(new InMemoryFormAdapter({ schema: new MemorySchema() }), { registry: claimRegistry(), subject: s.id });
  await runner.start("claim");
  const { compiled, instance } = await runner.resolve();
  const turns = [{ id: s.opening, text: s.opening }];
  const plan = await planForm(planner, compiled, instance, claimPlan, turns);
  const covered: OpeningEval["covered"] = {};
  for (const m of [...plan.confirm, ...plan.ask]) {
    const c = m.candidate;
    if (c.decidesBranch || (c.appliesTo && !c.appliesTo.includes(s.branch))) continue;
    covered[c.id] = { p: m.kind === "confirm" ? m.p : m.covered, truth: s.said.includes(c.id as ClaimFieldId) };
  }
  return { scenario: s.id, branch: { truth: s.branch, choice: plan.branch!.choice, p: plan.branch!.p }, covered };
}

function prf(evals: OpeningEval[], at: number) {
  let tp = 0, fp = 0, fn = 0;
  for (const e of evals) for (const { p, truth } of Object.values(e.covered)) {
    if (p >= at && truth) tp++;
    else if (p >= at) fp++;
    else if (truth) fn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return { at, tp, fp, fn, precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall) };
}

// ─── Main ────────────────────────────────────────────────────────────────

const classifier = await pickClassifier();
const planner = new NextBestPlanner(classifier, { confirmAt: Number(process.env.CONFIRM_AT ?? 0.8) });
console.log(`classifier: ${classifier.name}  scenarios: ${scenarios.length}`);

const openings: OpeningEval[] = [];
for (const s of scenarios) openings.push(await evalOpening(s, planner));

const runs: Run[] = [];
for (const s of scenarios) for (const p of POLICIES) runs.push(await run(s, p, planner));

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const summary = POLICIES.map((policy) => {
  const rs = runs.filter((r) => r.policy === policy);
  return {
    policy,
    turns: mean(rs.map((r) => r.turns)),
    foldedTurns: mean(rs.map((r) => r.foldedTurns)),
    asks: mean(rs.map((r) => r.asks)),
    redundant: rs.reduce((a, r) => a + r.redundant, 0),
    phantom: rs.reduce((a, r) => a + r.phantom, 0),
    wrongBranch: rs.reduce((a, r) => a + r.wrongBranch, 0),
    branchSettledAt: mean(rs.map((r) => r.branchSettledAt)),
    stepSwitches: mean(rs.map((r) => r.stepSwitches)),
    msPerTurn: rs.reduce((a, r) => a + r.classifierMs, 0) / Math.max(1, rs.reduce((a, r) => a + r.turns, 0)),
    callsPerTurn: rs.reduce((a, r) => a + r.classifierCalls, 0) / Math.max(1, rs.reduce((a, r) => a + r.turns, 0)),
    incomplete: rs.filter((r) => r.turns >= MAX_TURNS || r.log.at(-1)?.startsWith("stuck")).length,
  };
});

const branchRight = openings.filter((o) => o.branch.choice === o.branch.truth);
const confident = openings.filter((o) => o.branch.p >= planner.confirmAt);
const quality = {
  branchAccuracy: branchRight.length / openings.length,
  confidentBranch: { n: confident.length, correct: confident.filter((o) => o.branch.choice === o.branch.truth).length },
  coverage: [prf(openings, 0.5), prf(openings, 0.8), prf(openings, 0.9)],
};

console.log("\nOpening message — what the classifier can tell");
console.log(`branch accuracy ${(quality.branchAccuracy * 100).toFixed(0)}%; confident (≥${planner.confirmAt}) ${quality.confidentBranch.correct}/${quality.confidentBranch.n} correct`);
for (const c of quality.coverage) console.log(`covered ≥ ${c.at}: precision ${c.precision.toFixed(2)} recall ${c.recall.toFixed(2)} F1 ${c.f1.toFixed(2)} (tp ${c.tp} fp ${c.fp} fn ${c.fn})`);
for (const o of openings) {
  const wrong = Object.entries(o.covered).filter(([, v]) => (v.p >= 0.8) !== v.truth).map(([k, v]) => `${k}${v.truth ? "−" : "+"}${v.p.toFixed(2)}`);
  console.log(`  ${o.scenario.padEnd(14)} ${o.branch.truth.padEnd(8)} → ${o.branch.choice.padEnd(8)} ${(o.branch.p * 100).toFixed(0).padStart(3)}%  ${wrong.join(" ")}`);
}

console.log("\nSimulated calls (means per call; totals for error counts)");
console.log("| Policy | Turns | Turns, confirms folded | Re-asked | Phantom confirms | Wrong type guesses | Type settled at turn | Step switches | Classifier ms/turn |");
console.log("| --- | --: | --: | --: | --: | --: | --: | --: | --: |");
for (const x of summary) {
  console.log(`| ${x.policy} | ${x.turns.toFixed(1)} | ${x.foldedTurns.toFixed(1)} | ${x.redundant} | ${x.phantom} | ${x.wrongBranch} | ${x.branchSettledAt.toFixed(1)} | ${x.stepSwitches.toFixed(1)} | ${x.msPerTurn.toFixed(0)} |${x.incomplete ? ` (${x.incomplete} incomplete)` : ""}`);
}

const suffix = planner.confirmAt === 0.8 ? "" : `@${planner.confirmAt}`;
const out = new URL(`../results/${classifier.name.replace(/[^a-z0-9.-]+/gi, "_")}${suffix}.json`, import.meta.url);
await mkdir(new URL("../results/", import.meta.url), { recursive: true });
await writeFile(out, JSON.stringify({ classifier: classifier.name, confirmAt: planner.confirmAt, at: new Date().toISOString(), quality, summary, openings, runs }, null, 2));
console.log(`\nwrote ${out.pathname}`);
