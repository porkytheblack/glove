/**
 * The planner wired into real Glove agents, without calling a model.
 *
 * Each part prints the runtime context a model would receive on its next
 * iteration (`glove.getRuntimeContext()`): the form's or goals' own status,
 * followed by the planner's line. The "agent" moves in between are scripted
 * so the run is deterministic; in an application the model makes them
 * through `glove_form_fill` / `glove_goal_update`.
 *
 *   pnpm --filter glove-next-best-question-example demo
 */
import { Displaymanager, Glove, MemoryStore, type IGloveRunnable, type ModelAdapter } from "glove-core";
import { MemorySchema } from "glove-memory/core";
import { FormRunner } from "glove-memory/forms";
import { InMemoryFormAdapter, InMemoryGoalAdapter } from "glove-memory/in-memory";
import { useFormRunner, useGoalRunner } from "glove-memory/tools";
import { claimForm, claimPlan, claimRegistry } from "./claim-form";
import { pickClassifier } from "./classifiers";
import { discovery, discoveryPlan } from "./discovery-goals";
import { planForm, speakerTurns, useNextBestForm, withNextBestRouting } from "./forms";
import { planGoals, refocusGoals, useNextBestGoals } from "./goals";
import { NextBestPlanner, type Turn } from "./planner";

const offline: ModelAdapter = {
  name: "offline",
  async prompt() {
    throw new Error("the demo shows model input; it never calls a model");
  },
  setSystemPrompt() {},
};

function agent(id: string, systemPrompt: string): IGloveRunnable {
  return new Glove({
    store: new MemoryStore(id),
    model: offline,
    displayManager: new Displaymanager(),
    systemPrompt,
    serverMode: true,
    compaction_config: { compaction_instructions: "Summarise the conversation so far." },
  }).build();
}

let n = 0;
async function say(glove: IGloveRunnable, text: string): Promise<void> {
  console.log(`\n  caller: "${text}"`);
  await glove.store.appendMessages([{ sender: "user", id: `u${++n}`, text }]);
}

async function show(glove: IGloveRunnable, title: string): Promise<void> {
  console.log(`\n  ${title}`);
  for (const m of await glove.getRuntimeContext()) console.log(m.text.replace(/^/gm, "    │ "));
}

const heading = (s: string) => console.log(`\n${"─".repeat(78)}\n${s}\n${"─".repeat(78)}`);

const classifier = await pickClassifier();
const planner = new NextBestPlanner(classifier);
console.log(`classifier: ${classifier.name}`);

// ─── 1. A form, advisory ─────────────────────────────────────────────────

heading("1. Claim form: the plan as one more line of runtime context");
const claims = agent("claim-call", "You take first notice of loss for an insurer.");
const { runner: claim } = useFormRunner(claims, new InMemoryFormAdapter({ schema: new MemorySchema() }), {
  registry: claimRegistry(),
  subject: "call-1",
});
useNextBestForm(claims, { runner: claim, planner, config: claimPlan });
await claim.start("claim");
await show(claims, "Before the caller speaks, the form asks in definition order:");

await say(claims, "Hi, my name's Dana Reyes. Someone reversed into my car in the Tesco car park on King Street yesterday afternoon and drove off. The rear bumper's hanging off but it still drives.");
await show(claims, "After the opening:");

// The agent reads the line, confirms with the caller, and records only what
// the caller agreed to. These are the values it would take from the opening.
const heard: Record<string, unknown> = {
  fullName: "Dana Reyes", incidentType: "vehicle", incidentDate: "yesterday afternoon",
  location: "Tesco car park, King Street", otherParty: true, driveable: true,
};
const { compiled, instance } = await claim.resolve();
const plan = await planForm(planner, compiled, instance, claimPlan, speakerTurns(await claims.store.getMessages()));
const confirmed = Object.fromEntries(plan.confirm.flatMap((m) => (m.candidate.id in heard ? [[m.candidate.id, heard[m.candidate.id]]] : [])));
console.log(`\n  agent: confirms ${Object.keys(confirmed).join(", ") || "nothing"} and records them with glove_form_fill`);
await claim.fill(confirmed);
await say(claims, "Yes, that's all right.");
await show(claims, "Next iteration:");

// ─── 2. A form, steered ──────────────────────────────────────────────────

heading("2. Claim form: the plan moves the open step with { jump }");
const turns: Turn[] = [];
const routed = claimRegistry(withNextBestRouting(claimForm, {
  planner,
  config: claimPlan,
  turns: () => turns,
  onRoute: (d) => console.log(`  router: on "${d.from}" → ${d.jump ? `jump to "${d.jump}"` : "stay"} (${d.reason})`),
}));
const opening = "Hi, I'm Tom Becker, policy LB-77120. My elderly mother tripped over a loose paving slab outside our house this morning and hurt her hip.";
console.log(`\n  caller: "${opening}"`);
turns.push({ id: "t1", text: opening });
const control = new FormRunner(new InMemoryFormAdapter({ schema: new MemorySchema() }), { registry: claimRegistry(), subject: "control" });
await control.start("claim");
console.log(`\n  unrouted tier 0:\n    │ ${(await control.tier0()).split("\n")[0]}`);
const runner = new FormRunner(new InMemoryFormAdapter({ schema: new MemorySchema() }), { registry: routed, subject: "call-2" });
await runner.start("claim", { seed: { fullName: "Tom Becker", policyNumber: "LB-77120" } });
console.log(`\n  routed tier 0 (name and policy confirmed and seeded):\n    │ ${(await runner.tier0()).split("\n")[0]}`);
turns.push({ id: "t2", text: "It's my mum who got hurt, so it's an injury claim." });
console.log(`\n  caller: "${turns[1]!.text}"`);
await runner.fill({ incidentType: "injury", injuredPerson: "mother" });
console.log(`\n  routed tier 0:\n    │ ${(await runner.tier0()).split("\n")[0]}`);

// ─── 3. Goals ────────────────────────────────────────────────────────────

heading("3. Discovery call: goal focus follows the prospect");
const sales = agent("discovery-call", "You run discovery calls for a feedback-management product.");
const { runner: goals } = useGoalRunner(sales, new InMemoryGoalAdapter(), {
  scope: { subject: "prospect:acme", key: "discovery" },
  hooks: { onEnter: ({ goal }) => console.log(`  onEnter(${goal.definition.key}): a host would swap in this goal's tools here`) },
});
useNextBestGoals(sales, { runner: goals, planner, config: discoveryPlan });
await goals.start(discovery);

await say(sales, "Hi, we're a 40-person design agency and client feedback is scattered across email and Slack. It's chaos.");
await show(sales, "After the opening:");
// The agent confirms what the plan says was covered, then records it.
const opened = await planGoals(planner, (await goals.status())!, discoveryPlan, speakerTurns(await sales.store.getMessages()));
const byGoal = new Map<string, string[]>();
for (const m of opened.confirm) byGoal.set(m.candidate.group!, [...(byGoal.get(m.candidate.group!) ?? []), m.candidate.id.split("/")[1]!]);
for (const [goalKey, keys] of byGoal) {
  console.log(`\n  agent: confirms ${keys.map((k) => `${goalKey}/${k}`).join(", ")} and records them with glove_goal_update`);
  await goals.update({ goalKey, completed: keys, reason: "Confirmed with the prospect on the call" });
}

await say(sales, "Honestly, before anything else I need to know what this costs. Is it priced per seat?");
const refocus = await refocusGoals(goals, planner, speakerTurns(await sales.store.getMessages()), { config: discoveryPlan });
console.log(`\n  refocus: ${refocus?.to ? `moved "${refocus.to}" ahead of "${refocus.from}"` : "kept the order"} (${refocus?.reason})`);
await show(sales, "Next iteration:");
const history = await goals.history();
console.log(`\n  goal history: ${history.map((h) => `v${h.version} ${h.kind}: ${h.reason}`).join(" · ")}`);
