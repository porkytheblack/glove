import { appendFile, mkdir, readFile } from "node:fs/promises";
import type { FoundryActivationRecord, FoundryApproval } from "glove-foundry";
import { dataDir, dataPath } from "./paths.js";

// Muse's log: everything it did, and everything it plans to do. What it did
// is written by Foundry's side of the run (a subscriber on every tool call,
// and the Sentinel on every request leaving the VM), not by the model, so
// Muse cannot leave anything out. What it plans is Foundry's own data: the
// schedules and wake-ups it set, and the approvals waiting on the person.

export interface Activity {
  readonly at: string;
  readonly person: string;
  readonly kind: "tool" | "sentinel";
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

/** Done and planned, for one person's Activity page. */
export async function logFor(foundry: FoundryPlans, person: string) {
  const [done, activations, approvals] = await Promise.all([
    activityOf(person),
    foundry.activations(person),
    foundry.pendingApprovals(),
  ]);
  return {
    done,
    planned: [
      ...activations.filter((item) => item.status === "active").map((item) => ({ kind: "scheduled" as const, message: item.message, timing: item.timing })),
      ...approvals.filter((item) => item.workspaceId === person).map((item) => ({ kind: "waiting for you" as const, tool: item.toolName, input: item.toolInput })),
    ],
  };
}
