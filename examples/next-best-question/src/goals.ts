import type { IGloveRunnable } from "glove-core";
import type { GoalProgram, GoalRunner, GoalStatus } from "glove-memory/goals";
import { speakerTurns } from "./forms";
import { renderPlan, type Candidate, type NextBestPlanner, type Plan, type Turn } from "./planner";

/** What the planner needs to know about a goal program. Keys are `goalKey/itemKey`. */
export interface GoalPlanConfig {
  /** `goalKey/itemKey` → statements that are true once the speaker has covered the item (see `Candidate.covered`). */
  covered?: Record<string, string | string[]>;
  /** Goal key → a statement that is true of a message about that goal. Defaults to its objective. */
  groups?: Record<string, string>;
}

/**
 * Pending items in every unfinished goal, not only the active one.
 *
 * The active goal is the first unsettled goal in program order. A
 * conversation that reaches budget before rapport still owes rapport, but
 * the budget question is the one to ask while the speaker is on it.
 */
export function goalCandidates(status: GoalStatus, config: GoalPlanConfig = {}): Candidate[] {
  const live = status.goals.filter((g) => g.status === "active" || g.status === "pending");
  return live.flatMap((goal, gi) =>
    goal.items.flatMap((item, ii) => {
      if (item.definition.retired || (item.state?.disposition ?? "pending") !== "pending") return [];
      const id = `${goal.definition.key}/${item.definition.key}`;
      return [{
        id,
        label: item.definition.label,
        group: goal.definition.key,
        // Goal order dominates; item order breaks ties inside a goal.
        prior: 1 - (gi + ii / goal.items.length) / live.length,
        covered: config.covered?.[id] ?? `The speaker has already said: ${item.definition.label.toLowerCase()}.`,
      } satisfies Candidate];
    }),
  );
}

export function goalGroups(status: GoalStatus, config: GoalPlanConfig = {}): Record<string, string> {
  return Object.fromEntries(status.goals
    .filter((g) => g.status === "active" || g.status === "pending")
    .map((g) => [g.definition.key, config.groups?.[g.definition.key] ?? `The speaker is talking about ${g.definition.objective.toLowerCase()}.`]));
}

export async function planGoals(planner: NextBestPlanner, status: GoalStatus, config: GoalPlanConfig, turns: Turn[], signal?: AbortSignal): Promise<Plan> {
  return planner.plan({ candidates: goalCandidates(status, config), turns, groups: goalGroups(status, config) }, signal);
}

/**
 * Advisory: the plan as a line after the goal status. Covered items are
 * shown as things to confirm. Completing them stays with the agent (or the
 * host), through `glove_goal_update` with a reason, because a classifier's
 * "probably said" is not evidence that the obligation was met.
 */
export function useNextBestGoals(
  glove: IGloveRunnable,
  options: { runner: GoalRunner; planner: NextBestPlanner; config?: GoalPlanConfig },
): () => void {
  let cached: { key: string; line: string } | undefined;
  return glove.addContextProvider(async (signal) => {
    const status = await options.runner.status();
    if (!status || status.status === "completed") return "";
    const turns = speakerTurns(await glove.store.getMessages());
    const key = `${status.version}:${turns.at(-1)?.id ?? ""}`;
    if (cached?.key === key) return cached.line;
    const plan = await planGoals(options.planner, status, options.config ?? {}, turns, signal);
    cached = { key, line: renderPlan(plan, { tag: `next-best: ${status.programKey}` }) };
    return cached.line;
  });
}

export interface Refocus {
  plan: Plan;
  from: string | null;
  /** The goal moved in front of `from`, when the program was revised. */
  to?: string;
  status: GoalStatus;
  reason: string;
}

/**
 * Authoritative: move a goal ahead of the active one when the speaker is
 * clearly on it.
 *
 * Program order decides the active goal, so refocusing is a `revise` with the
 * goals reordered. That keeps progress, respects locks (locks pin a goal's
 * content, not its position), records the reason in history and fires the
 * goal's `onEnter` hook, which is what a host uses to swap tools or prompts.
 *
 * It costs a revision, so it needs more than a ranking: the latest message
 * has to be about that goal (`minFocus`), and the goal's best question has to
 * beat the active goal's best by `margin`. Call it once per speaker turn,
 * before the agent runs, never from a context provider: providers run on
 * every model iteration and should not write.
 */
export async function refocusGoals(
  runner: GoalRunner,
  planner: NextBestPlanner,
  turns: Turn[],
  options: { config?: GoalPlanConfig; minFocus?: number; margin?: number; signal?: AbortSignal } = {},
): Promise<Refocus | null> {
  const status = await runner.status();
  if (!status || status.status === "completed") return null;
  const plan = await planGoals(planner, status, options.config ?? {}, turns, options.signal);
  const from = status.activeGoal;
  const best = plan.ask[0];
  const bestActive = plan.ask.find((m) => m.candidate.group === from);
  const to = best?.candidate.group;
  const hold = (reason: string): Refocus => ({ plan, from, status, reason });
  if (!best || !to || to === from) return hold("the active goal already has the best question");
  if (!plan.focus || plan.focus.group !== to || plan.focus.p < (options.minFocus ?? 0.6)) return hold(`"${best.candidate.label}" ranks first, but the speaker isn't on it`);
  if (bestActive && best.score - bestActive.score < (options.margin ?? 0.1)) return hold("not decisively better than staying");

  const reason = `Speaker raised ${to} (${Math.round(plan.focus.p * 100)}%): "${best.candidate.label}" moves ahead of ${from}`;
  const program: GoalProgram = { key: status.programKey, goals: status.goals.map((g) => g.definition) };
  const next = await runner.revise(moveBefore(program, to, from), { ifVersion: status.version, reason });
  return { plan, from, to, status: next, reason };
}

function moveBefore(program: GoalProgram, key: string, anchor: string | null): GoalProgram {
  const moving = program.goals.find((g) => g.key === key)!;
  const rest = program.goals.filter((g) => g.key !== key);
  const at = anchor ? rest.findIndex((g) => g.key === anchor) : 0;
  rest.splice(at < 0 ? 0 : at, 0, moving);
  return { ...program, goals: rest };
}
