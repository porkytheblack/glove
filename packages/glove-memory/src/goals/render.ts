import { renderPreparation } from "glove-facts";
import type { GoalStatus } from "./types";

/** A standalone section, including deferred follow-ups after progression ends. */
export function renderGoalStatus(status: GoalStatus | null): string {
  if (!status) return "";
  const lines = [`GOALS — ${status.programKey} (version ${status.version}; ${status.status})`,
    "Record what is known without repeating settled questions. Deferred means follow-up, not done. Revise remaining goals when context changes; preserve stable keys and give a reason."];
  for (const goal of status.goals) {
    if (goal.status === "retired") continue;
    lines.push(`${goal.ordinal}. ${goal.definition.title} [${goal.definition.key}; ${goal.status}]${goal.definition.locked ? " (locked)" : ""}`);
    if (goal.status === "completed") continue;
    lines.push(`   Objective: ${goal.definition.objective}`);
    for (const { definition, state } of goal.items) {
      if (definition.retired) continue;
      lines.push(`   - ${definition.key}: ${definition.label} [${state?.disposition ?? "pending"}]${definition.locked ? " (locked)" : ""}${state?.note ? ` — ${state.note}` : ""}`);
    }
  }
  if (status.deferred.length) {
    lines.push("Deferred follow-ups (remain visible after completion):");
    for (const item of status.deferred) lines.push(`- ${item.goalKey}/${item.itemKey}: ${item.label}${item.retired ? " (retired definition)" : ""}${item.note ? ` — ${item.note}` : ""}`);
  }
  if (status.preparation) lines.push(renderPreparation(status.preparation));
  return lines.join("\n");
}
