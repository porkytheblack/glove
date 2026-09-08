import { committedPreparation } from "glove-facts";
import { z } from "zod";
import type { FactPreparation, FactRequirement, PreparationReport, RequirementRule } from "glove-facts";
import type { GoalDefinition, GoalInstance, GoalItemDefinition, GoalScope, GoalSnapshot } from "./types";

export interface GoalPreparationConfig {
  preparer: FactPreparation;
  /** Host-owned completion rules. Omit a rule to leave that item entirely manual. */
  rule: (goal: GoalDefinition, item: GoalItemDefinition) => RequirementRule | undefined;
  /** Optional workflow gate, independent of evidence. Default: every live item. */
  eligible?: (goal: GoalDefinition, item: GoalItemDefinition, snapshot: GoalSnapshot) => boolean;
}
export async function prepareGoalCommit<T>(config: GoalPreparationConfig | undefined, scope: GoalScope, before: GoalInstance | null, snapshot: GoalSnapshot, commit: (snapshot: GoalSnapshot) => Promise<T>): Promise<T> {
  if (!config || !config.preparer.enabled()) return commit(snapshot);
  if (config.preparer.facts.scope().subject !== scope.subject) throw new Error("Goal and facts subjects must match");
  const requirements: FactRequirement[] = [];
  for (const goal of snapshot.program.goals) for (const item of goal.items) {
    if (goal.retired || item.retired) continue;
    const rule = config.rule(goal, item);
    if (!rule) continue;
    const state = snapshot.progress[goal.key]?.[item.key];
    requirements.push({ ...rule, schema: z.literal(true), id: `${goal.key}/${item.key}`,
      eligible: config.eligible?.(goal, item, snapshot) ?? true,
      ...(state ? { current: { value: state.done, claimId: state.claimId } } : {}),
    });
  }
  const receipts = (instance: GoalSnapshot) => Object.values(instance.progress).flatMap(items => Object.values(items).flatMap(s => s.claimId ? [s.claimId] : []));
  return config.preparer.run({ consumer: JSON.stringify(["goals", scope.subject, scope.key, scope.agent ?? null]), requirements,
    context: { program: snapshot.program, progress: snapshot.progress }, acceptedClaimIds: before?.history.flatMap(receipts) ?? [],
  }, async report => {
    const next = structuredClone(snapshot);
    if (report) {
      applyGoalEvidence(next, report, config);
      next.preparation = committedPreparation(report);
    }
    return { value: await commit(next), acceptedClaimIds: receipts(next) };
  });
}
function applyGoalEvidence(snapshot: GoalSnapshot, report: PreparationReport, config: GoalPreparationConfig) {
  for (let pass = 0; pass <= report.decisions.length; pass++) {
    let changed = false;
    for (const decision of report.decisions) {
      if (!decision.claim || decision.claim.strength !== "sufficient" || !["sufficient", "ineligible"].includes(decision.status)) continue;
      const [goalKey, itemKey] = decision.requirement.split("/");
      if (snapshot.progress[goalKey]?.[itemKey]) continue;
      const goal = snapshot.program.goals.find(g => g.key === goalKey)!;
      const item = goal.items.find(i => i.key === itemKey)!;
      if (!(config.eligible?.(goal, item, snapshot) ?? true)) continue;
      snapshot.progress[goalKey] ??= {};
      snapshot.progress[goalKey][itemKey] = { disposition: "done", done: true, note: decision.explanation, at: new Date().toISOString(), claimId: decision.claim.id };
      decision.apply = true;
      decision.status = "sufficient";
      changed = true;
    }
    if (!changed) break;
  }
}
