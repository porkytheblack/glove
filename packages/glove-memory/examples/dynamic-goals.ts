/** Run after building: pnpm --filter glove-memory exec node --import tsx examples/dynamic-goals.ts */
import { defineGoalProgram, GoalRunner, InMemoryGoalAdapter } from "glove-memory";

const adapter = new InMemoryGoalAdapter();
const runner = new GoalRunner(adapter, {
  scope: { subject: "firm:demo/matter:123", key: "intake", agent: "assistant" },
  actor: "intake-agent",
  source: "conversation:456",
});
const intake = defineGoalProgram({
  key: "client-intake",
  goals: [
    { key: "identity", title: "Confirm identity", objective: "Know who is speaking",
      items: [{ key: "client", label: "Verify the client", locked: true }] },
    { key: "account", title: "Collect the account", objective: "Understand what happened",
      items: [{ key: "details", label: "Client's account" }] },
  ],
});
await runner.start(intake);
const known = await runner.update({ goalKey: "identity", completed: ["client"], reason: "Existing client verified from the firm's records" });

// The agent learns this is a continuation of an existing matter. Retain the
// settled identity, retire the full account, and introduce a contextual goal.
const followup = defineGoalProgram({
  ...intake,
  goals: [intake.goals[0], { ...intake.goals[1], retired: true }, {
    key: "updates", title: "Matter updates", objective: "Capture changes since the previous conversation",
    items: [{ key: "changes", label: "What changed?" }, { key: "documents", label: "New documents" }],
  }],
});
await runner.revise(followup, { ifVersion: known.version, reason: "Returning client continuing an existing matter" });
await runner.update({ goalKey: "updates", completed: ["changes"], deferred: ["documents"], reason: "Update recorded; client will send documents later" });

// Recreating a runner needs no code registry: definitions and state live in
// the adapter. Production supplies a durable GoalAdapter instead of this Map.
const resumed = new GoalRunner(adapter, { scope: { subject: "firm:demo/matter:123", key: "intake", agent: "assistant" } });
const status = await resumed.status();
console.log(JSON.stringify(status, null, 2));
if (status?.status !== "completed" || status.deferred.length !== 1) throw new Error("Unexpected follow-up state");
await resumed.update({ goalKey: "updates", completed: ["documents"], reason: "Documents received" });
console.log("Deferred follow-up resolved without repeating intake.");
