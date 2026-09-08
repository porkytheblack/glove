/** Compile-only public API checks. */
import type { IGloveRunnable } from "glove-core";
import { GoalRunner, InMemoryGoalAdapter, defineGoalProgram, type GoalAdapter, type GoalStatus } from "../src";
import { useGoalRunner } from "../src/tools";
import type { GoalProgram } from "../src/goals";

declare const glove: IGloveRunnable;
const adapter: GoalAdapter = new InMemoryGoalAdapter();
const program: GoalProgram = defineGoalProgram({ key: "intake", goals: [] });
const { runner } = useGoalRunner(glove, adapter, { scope: { subject: "conversation", key: "intake" }, tools: { deny: ["start"] } });
const standalone: GoalRunner = runner;
const status: Promise<GoalStatus> = standalone.start(program);
void status;
// @ts-expect-error Definition edits require an explicit version.
void runner.revise(program, { reason: "Changed context" });
// @ts-expect-error Progress updates require a reason.
void runner.update({ goalKey: "identity", completed: ["client"] });
// @ts-expect-error A scope needs an independent set key as well as a subject.
new GoalRunner(adapter, { scope: { subject: "conversation" } });
