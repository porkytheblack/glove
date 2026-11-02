import { appendFile, mkdir, readFile } from "node:fs/promises";
import type { FoundryActivationRecord, FoundryApproval } from "glove-foundry";
import { projectGoalStatus } from "glove-memory/goals";
import { plansScope, plansStore } from "./memory.js";
import { dataDir, dataPath } from "./paths.js";
import { museId } from "./people.js";

// Muse's log: everything it did, and everything it plans to do. What it did
// is written by Foundry's side of the run (a subscriber on every tool call,
// the Sentinel on every request leaving the browser, and the browser's host
// code when it opens a browser or hands one over), not by the model, so
// Muse cannot leave anything out. What it plans is Foundry's own data: the
// schedules and wake-ups it set, the steps of its plans not done yet, and the
// approvals waiting on the person.

export interface Activity {
  readonly at: string;
  readonly person: string;
  readonly kind: "tool" | "sentinel" | "browser";
  readonly what: string;
  readonly outcome: string;
  readonly detail?: string;
}

const file = () => dataPath("activity.jsonl");

export async function logActivity(entry: Omit<Activity, "at">): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await appendFile(file(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export async function activityOf(person: string): Promise<Activity[]> {
  try {
    return (await readFile(file(), "utf8")).trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as Activity)
      .filter((entry) => entry.person === person);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

/** What your app's Activity page needs from Foundry: the runtime in a script, the typed client in your app. */
export interface FoundryPlans {
  readonly activations: (workspaceId: string) => Promise<ReadonlyArray<FoundryActivationRecord>>;
  readonly pendingApprovals: () => Promise<ReadonlyArray<FoundryApproval>>;
}

/** The steps of a person's plans still to do (pending or put off), from the goals Muse keeps. */
export async function openSteps(person: string) {
  const plans = await plansStore(person, museId(person)).get(plansScope(person, museId(person)));
  if (!plans) return [];
  return projectGoalStatus(plans).goals.filter((goal) => goal.status !== "completed" && goal.status !== "retired")
    .flatMap((goal) => goal.items
      .filter((item) => !item.definition.retired && ["pending", "deferred"].includes(item.state?.disposition ?? "pending"))
      .map((item) => ({ plan: goal.definition.title, step: item.definition.label })));
}

/** A person's plans, each step with where it stands, for their app's Plans screen. */
export async function plansOf(person: string) {
  const plans = await plansStore(person, museId(person)).get(plansScope(person, museId(person)));
  if (!plans) return [];
  return projectGoalStatus(plans).goals.filter((goal) => goal.status !== "retired").map((goal) => ({
    key: goal.definition.key,
    title: goal.definition.title,
    status: goal.status,
    steps: goal.items.filter((item) => !item.definition.retired).map((item) => ({
      key: item.definition.key,
      label: item.definition.label,
      state: item.state?.disposition ?? "pending",
    })),
  }));
}

/** Done and planned, for one person's Activity page. */
export async function logFor(foundry: FoundryPlans, person: string) {
  const [done, activations, approvals, steps] = await Promise.all([
    activityOf(person),
    foundry.activations(person),
    foundry.pendingApprovals(),
    openSteps(person),
  ]);
  return {
    done,
    planned: [
      ...activations.filter((item) => item.status === "active").map((item) => ({ kind: "scheduled" as const, message: item.message, timing: item.timing })),
      ...steps.map((item) => ({ kind: "plan step" as const, ...item })),
      ...approvals.filter((item) => item.workspaceId === person).map((item) => ({ kind: "waiting for you" as const, tool: item.toolName, input: item.toolInput })),
    ],
  };
}
