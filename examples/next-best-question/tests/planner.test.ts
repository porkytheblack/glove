import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerFromDistribution,
  type Answer,
  type ClassifierAdapter,
  type ClassifyRequest,
  type ClassifyResult,
  type Questions,
} from "glove-classifier";
import { MemorySchema } from "glove-memory/core";
import { FormRunner, type FormDef } from "glove-memory/forms";
import { GoalRunner } from "glove-memory/goals";
import { InMemoryFormAdapter, InMemoryGoalAdapter } from "glove-memory/in-memory";
import { claimForm, claimPlan, claimRegistry } from "../src/claim-form";
import { discovery, discoveryPlan } from "../src/discovery-goals";
import { decideJump, formCandidates, planForm, withNextBestRouting } from "../src/forms";
import { refocusGoals } from "../src/goals";
import { NextBestPlanner, renderPlan, type Candidate, type Turn } from "../src/planner";

/**
 * A classifier with scripted answers. `noul(state, statement)` is the
 * probability a statement holds of a state; `choice(state, labels)` scores
 * each label's description. Everything unscripted is 0 / uniform.
 */
function fake(script: {
  noul?: (state: string, statement: string) => number;
  choice?: (state: string, descriptions: Record<string, string>) => Record<string, number>;
}): ClassifierAdapter & { calls: number } {
  const clf = {
    name: "fake",
    calls: 0,
    async classify<Q extends Questions>(request: ClassifyRequest<Q>): Promise<ClassifyResult<Q>> {
      clf.calls++;
      const state = String(request.state);
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "noul") answers[id] = answerFromDistribution(q, { true: script.noul?.(state, String(q.instructions)) ?? 0 });
        else if (q.type === "choice") {
          const d = Object.fromEntries(Object.entries(q.criteria).map(([k, v]) => [k, String(v)]));
          const scored = script.choice?.(state, d) ?? {};
          answers[id] = answerFromDistribution(q, Object.fromEntries(Object.keys(d).map((k) => [k, scored[k] ?? 1])));
        }
      }
      return { model: "fake", answers: answers as ClassifyResult<Q>["answers"], usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
  return clf;
}

const turn = (text: string): Turn => ({ id: text, text });
const c = (id: string, prior: number, extra: Partial<Candidate> = {}): Candidate => ({ id, label: id, prior, covered: `${id} said`, ...extra });

test("covered candidates become confirm moves; the rest are asked by priority", async () => {
  const planner = new NextBestPlanner(fake({ noul: (_, s) => (s === "name said" ? 0.95 : 0.1) }));
  const plan = await planner.plan({ candidates: [c("name", 1), c("phone", 0.5), c("email", 0.8)], turns: [turn("I'm Ada")] });
  assert.deepEqual(plan.confirm.map((m) => m.candidate.id), ["name"]);
  assert.deepEqual(plan.ask.map((m) => m.candidate.id), ["email", "phone"]);
});

test("a yes/no candidate is covered when either answer holds", async () => {
  const planner = new NextBestPlanner(fake({ noul: (_, s) => (s === "car cannot be driven" ? 0.9 : 0) }));
  const plan = await planner.plan({
    candidates: [{ id: "driveable", label: "Driveable", prior: 1, covered: ["car can be driven", "car cannot be driven"] }],
    turns: [turn("It won't start")],
  });
  assert.equal(plan.confirm[0]?.candidate.id, "driveable");
});

test("covered questions from an unlikely branch are not confirmed", async () => {
  const branch = { labels: { car: "car", home: "home" } };
  const planner = new NextBestPlanner(fake({ noul: () => 0.95, choice: () => ({ car: 9, home: 1 }) }));
  const plan = await planner.plan({
    candidates: [c("reg", 0.5, { appliesTo: ["car"] }), c("rooms", 0.5, { appliesTo: ["home"] })],
    turns: [turn("x")],
    branch,
  });
  assert.deepEqual(plan.confirm.map((m) => m.candidate.id), ["reg"]);
  assert.deepEqual(plan.ask.map((m) => m.candidate.id), ["rooms"]);
});

test("a confident branch is confirmed together with that branch's covered questions", async () => {
  const planner = new NextBestPlanner(fake({ noul: () => 0.85, choice: () => ({ car: 17, home: 3 }) }));
  const plan = await planner.plan({
    candidates: [c("type", 0.9, { decidesBranch: true, covered: undefined }), c("reg", 0.5, { appliesTo: ["car"] })],
    turns: [turn("x")],
    branch: { labels: { car: "car", home: "home" } },
  });
  // P(car) = 0.85 alone puts reg at 0.85 × 0.85 < 0.8; confirming the branch in the same turn assumes car.
  assert.deepEqual(plan.confirm.map((m) => [m.candidate.id, m.value]), [["type", "car"], ["reg", undefined]]);
});

test("the less certain the branch, the more the deciding question is worth", async () => {
  const candidates = [c("name", 1), c("type", 0.7, { decidesBranch: true, covered: undefined })];
  const branch = { labels: { a: "a", b: "b", c: "c" } };
  const plan = (scores: Record<string, number>) =>
    new NextBestPlanner(fake({ choice: () => scores })).plan({ candidates, turns: [turn("x")], branch });
  const score = (p: Awaited<ReturnType<typeof plan>>) => p.ask.find((m) => m.candidate.id === "type")?.score ?? 0;
  const unsure = await plan({ a: 1, b: 1, c: 1 });
  const leaning = await plan({ a: 7, b: 2, c: 1 });
  assert.equal(unsure.ask[0]?.candidate.id, "type");
  assert.ok(score(unsure) > score(leaning));
  // Sure enough to confirm: it stops being a question at all.
  const sure = await plan({ a: 9, b: 0.5, c: 0.5 });
  assert.deepEqual(sure.confirm.map((m) => [m.candidate.id, m.value]), [["type", "a"]]);
  assert.equal(sure.ask[0]?.candidate.id, "name");
});

test("questions on the latest message's topic move up", async () => {
  const candidates = [c("name", 1, { group: "who" }), c("reg", 0.6, { group: "car" })];
  const groups = { who: "about the person", car: "about the car" };
  const planner = new NextBestPlanner(fake({ choice: (_, d): Record<string, number> => ("car" in d ? { car: 9, who: 0.5, other: 0.5 } : {}) }));
  const plan = await planner.plan({ candidates, turns: [turn("the bumper is hanging off")], groups });
  assert.equal(plan.focus?.group, "car");
  assert.equal(plan.ask[0]?.candidate.id, "reg");
  assert.match(renderPlan(plan), /ask next: reg — on the topic just raised/);
});

test("coverage of a turn is classified once", async () => {
  const clf = fake({});
  const planner = new NextBestPlanner(clf);
  const request = { candidates: [c("a", 1), c("b", 0.5)], turns: [turn("one"), turn("two")] };
  await planner.plan(request);
  assert.equal(clf.calls, 2);
  await planner.plan(request);
  assert.equal(clf.calls, 2);
  await planner.plan({ ...request, turns: [...request.turns, turn("three")] });
  assert.equal(clf.calls, 3);
  // Another conversation reusing turn ids gets its own judgements.
  await planner.plan({ ...request, turns: [{ id: "one", text: "something else" }] });
  assert.equal(clf.calls, 4);
});

// ─── Forms ───────────────────────────────────────────────────────────────

async function claimRunner(def: FormDef<any> = claimForm) {
  const runner = new FormRunner(new InMemoryFormAdapter({ schema: new MemorySchema() }), { registry: claimRegistry(def), subject: "t" });
  await runner.start("claim");
  return runner;
}

test("branch questions are candidates under the branches whose gates would open them", async () => {
  const runner = await claimRunner();
  const { compiled, instance } = await runner.resolve();
  const before = formCandidates(compiled, instance, claimPlan).candidates;
  assert.deepEqual(before.find((x) => x.id === "vehicleReg")?.appliesTo, ["vehicle"]);
  assert.equal(before.find((x) => x.id === "fullName")?.appliesTo, undefined);
  assert.equal(before.find((x) => x.id === "incidentType")?.decidesBranch, true);

  await runner.fill({ incidentType: "theft", fullName: "Ada Lovelace" });
  const after = await runner.resolve();
  const ids = formCandidates(after.compiled, after.instance, claimPlan).candidates.map((x) => x.id);
  assert.ok(ids.includes("policeReport"));
  assert.ok(!ids.includes("vehicleReg") && !ids.includes("fullName") && !ids.includes("incidentType"));
});

test("steering never opens a branch step before its branch is settled", async () => {
  const runner = await claimRunner();
  const { compiled, instance } = await runner.resolve();
  // A car is likely but not certain, and the caller is on about the car, so a
  // vehicle question ranks first. It can't be asked until the branch is settled.
  const planner = new NextBestPlanner(
    fake({ choice: (_, d): Record<string, number> => ("other" in d ? { vehicle: 50 } : { vehicle: 6, property: 1, injury: 1, theft: 1 }) }),
    { weights: { split: 0, focus: 1 } },
  );
  const plan = await planForm(planner, compiled, instance, claimPlan, [turn("my car")]);
  assert.ok(plan.ask[0]?.candidate.appliesTo);
  const decision = decideJump(compiled, instance, plan);
  assert.equal(decision.jump, "incident");
});

test("withNextBestRouting moves the open step through the engine", async () => {
  const turns = [turn("a lorry clipped my mirror")];
  const planner = new NextBestPlanner(fake({ choice: (_, d): Record<string, number> => ("other" in d ? { vehicle: 50 } : { vehicle: 6, property: 1, injury: 1, theft: 1 }) }));
  const runner = await claimRunner(withNextBestRouting(claimForm, { planner, config: claimPlan, turns: () => turns }));
  assert.match(await runner.tier0(), /step 2\/7 "Incident"/);
  await runner.fill({ incidentType: "vehicle" });
  assert.match(await runner.tier0(), /"Vehicle"/);
  const unrouted = await claimRunner();
  assert.match(await unrouted.tier0(), /step 1\/7 "Claimant"/);
});

// ─── Goals ───────────────────────────────────────────────────────────────

test("refocusing moves the raised goal ahead of the active one and keeps progress", async () => {
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope: { subject: "p", key: "discovery" } });
  await runner.start(discovery);
  await runner.update({ goalKey: "context", completed: ["size"], reason: "said" });
  const focusOn = (group: string) => fake({ choice: (_, d) => (group in d ? { [group]: 50 } : {}) });

  const held = await refocusGoals(runner, new NextBestPlanner(focusOn("context")), [turn("we're 40 people")], { config: discoveryPlan });
  assert.equal(held?.to, undefined);

  const moved = await refocusGoals(runner, new NextBestPlanner(focusOn("budget")), [turn("what does it cost?")], { config: discoveryPlan });
  assert.equal(moved?.to, "budget");
  assert.equal(moved?.status.activeGoal, "budget");
  assert.deepEqual(moved?.status.goals.map((g) => g.definition.key), ["budget", "context", "pain", "timeline"]);
  assert.equal(moved?.status.goals.find((g) => g.definition.key === "context")?.items[0]?.state?.disposition, "done");
});
