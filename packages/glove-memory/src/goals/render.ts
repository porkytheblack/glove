import { renderPreparation } from "glove-facts";
import type { GoalStatus } from "./types";

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrs(values: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => ` ${name}="${escape(String(value))}"`)
    .join("");
}

const GUIDANCE = "Record what is known without repeating settled questions. Deferred means follow-up, not done. Revise remaining goals when context changes; preserve stable keys and give a reason.";

/**
 * A standalone `<goals>` section, including deferred follow-ups after
 * progression ends. XML so the model can tell goal state apart from the
 * conversation around it, wherever it appears (runtime context or history).
 * Every value is escaped: labels and notes can carry user-supplied text.
 */
export function renderGoalStatus(status: GoalStatus | null): string {
  if (!status) return "";
  const lines = [
    `<goals${attrs({ program: status.programKey, version: status.version, status: status.status, active_goal: status.activeGoal })}>`,
    `<guidance>${escape(GUIDANCE)}</guidance>`,
  ];
  for (const goal of status.goals) {
    if (goal.status === "retired") continue;
    const head = `<goal${attrs({ ordinal: goal.ordinal, key: goal.definition.key, status: goal.status, locked: goal.definition.locked })}>`;
    if (goal.status === "completed") {
      lines.push(`${head}<title>${escape(goal.definition.title)}</title></goal>`);
      continue;
    }
    lines.push(head, `<title>${escape(goal.definition.title)}</title>`, `<objective>${escape(goal.definition.objective)}</objective>`);
    for (const { definition, state } of goal.items) {
      if (definition.retired) continue;
      const note = state?.note ? `<note>${escape(state.note)}</note>` : "";
      lines.push(`<item${attrs({ key: definition.key, status: state?.disposition ?? "pending", locked: definition.locked })}>${escape(definition.label)}${note}</item>`);
    }
    lines.push("</goal>");
  }
  if (status.deferred.length) {
    lines.push(`<deferred note="Follow-ups that remain open after completion.">`);
    for (const item of status.deferred) {
      const note = item.note ? `<note>${escape(item.note)}</note>` : "";
      lines.push(`<item${attrs({ goal: item.goalKey, key: item.itemKey, retired: item.retired })}>${escape(item.label)}${note}</item>`);
    }
    lines.push("</deferred>");
  }
  if (status.preparation) lines.push(`<preparation>${escape(renderPreparation(status.preparation))}</preparation>`);
  lines.push("</goals>");
  return lines.join("\n");
}
