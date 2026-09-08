import { z } from "zod";
import { equalGoalData } from "../../goals/equal";
import type { GloveFoldArgs } from "glove-core";
import type { FormEnableTarget } from "../forms";
import { selectFoldArgs, type ToolSelection } from "../selection";
import { attachPromptSection } from "../prompt-section";
import {
  GoalRunner, GoalPostCommitError, GoalProgramSchema, GoalUpdateSchema, GoalScopeSchema, renderGoalStatus,
  type GoalAdapter, type GoalRunnerConfig, type GoalScope, type GoalStatus,
} from "../../goals";

/** Compatible with the same runnable/proxy seam as useFormRunner. */
export type GoalEnableTarget = FormEnableTarget;
export interface UseGoalRunnerConfig extends GoalRunnerConfig {
  tools?: ToolSelection;
  injectStatus?: boolean;
}

function tool<I>(name: string, description: string, inputSchema: z.ZodType<I>, run: (input: I) => Promise<unknown>): GloveFoldArgs<I> {
  return {
    name: `glove_goal_${name}`, description, inputSchema,
    async do(input) {
      try { return { status: "success", data: await run(inputSchema.parse(input)) }; }
      catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : String(error),
          data: error instanceof GoalPostCommitError ? { committed: true, status: error.status } : {} };
      }
    },
  };
}

/** Scope is host-bound; tools cannot select another subject, set, or agent. */
export function buildGoalRunnerTools(runner: GoalRunner): Array<GloveFoldArgs<any>> {
  return [
    tool("status", "Read the goal set, stable goal/item keys, current version, progress and outstanding deferrals. Read before revising or updating.", z.object({}).strict(), () => runner.status()),
    tool("start", "Start a structured goal program in this conversation's bound goal scope. Existing progress is never reset. For an existing set, use revise with its current version.",
      z.object({ program: GoalProgramSchema, reason: z.string().trim().min(1).max(4000) }).strict(),
      (input) => runner.start(input.program, input.reason)),
    tool("update", "Record named checklist items in any goal. completed means done; deferred and declined settle progression without claiming the work happened. Revisit deferred items with completed, or reopened to make them pending again. Supply a reason and the version you read; a conflict requires reading status again. Unknown keys reject the whole call.",
      GoalUpdateSchema.safeExtend({ ifVersion: z.number().int().positive() }), (input) => runner.update(input)),
    tool("revise", "Adapt the goal definitions to newly learned context. Send the FULL ordered program with the version you read and a reason. Preserve keys for the same obligation; new obligations need new keys. Same-key progress survives edits. Removed/retired items remain in history, including outstanding deferrals. Locked obligations cannot be changed or removed. A new pending item reopens a completed goal.",
      z.object({ program: GoalProgramSchema, ifVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(4000) }).strict(),
      (input) => runner.revise(input.program, input)),
    tool("history", "Inspect the saved definition and progress revision history, including reasons and provenance, for this goal scope.",
      z.object({}).strict(), () => runner.history()),
  ];
}

/**
 * Mount goals independently of forms. The host can start/revise/tick through
 * the returned runner, while tools call exactly the same operations.
 * Status refreshes before every turn and after each committed runner write.
 * Other processes' writes appear next turn (or call refresh explicitly).
 * Like Glove itself, a mounted runnable is for one conversation at a time.
 */
export function useGoalRunner<G extends GoalEnableTarget>(glove: G, adapter: GoalAdapter, config: UseGoalRunnerConfig): { glove: G; runner: GoalRunner; refresh: () => Promise<void> } {
  let section: ReturnType<typeof attachPromptSection> | undefined;
  let latest: { scope: GoalScope; status: GoalStatus | null } | undefined;
  const currentScope = () => GoalScopeSchema.parse(typeof config.scope === "function" ? config.scope() : config.scope);
  const selectStatus = (status: GoalStatus | null): GoalStatus | null => {
    const scope = currentScope();
    if (!latest || !equalGoalData(latest.scope, scope)) latest = { scope, status: null };
    // Storage acknowledgements can arrive out of order even though commits
    // themselves are atomic. Never regress the displayed version or expose
    // another conversation after the host switches its scope thunk.
    if (status && (!equalGoalData(status.scope, scope) ||
        (latest.status && status.version < latest.status.version))) return latest.status;
    // An in-flight read that began before create may return null after the
    // first commit. It must not erase the version high-water mark.
    if (status) latest.status = status;
    return status;
  };
  const runner = new GoalRunner(adapter, {
    ...config,
    async onChange(status) {
      section?.set(renderGoalStatus(selectStatus(status)));
      await config.onChange?.(status);
    },
  });
  // Validate tool selection before mutating either the registry or the prompt.
  const tools = selectFoldArgs(buildGoalRunnerTools(runner), config.tools);
  for (const entry of tools) glove.fold(entry);
  if (config.injectStatus !== false) section = attachPromptSection(glove, async () => renderGoalStatus(selectStatus(await runner.status())));
  return { glove, runner, refresh: async () => { await section?.refresh(); } };
}
