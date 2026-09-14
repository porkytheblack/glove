import { createHash } from "node:crypto";
import type { IGloveRunnable, RuntimeContextProvider } from "glove-core";
import { FactPreparation, FactStore, useFacts, type FactAdapter, type FactScope, type FactInput } from "glove-facts";
import type { GoalAdapter, GoalProgram, GoalRunner, GoalScope } from "glove-memory/goals";
import type { FormAdapter, FormRunner } from "glove-memory/forms";
import { useGoalRunner, useFormRunner, type UseGoalRunnerConfig, type UseFormRunnerConfig } from "glove-memory/tools";
import type { AgentAssemblyContext } from "./definition.js";

/** Conversation isolation is the default. Instance scope deliberately shares conversations. */
export type FoundryGuidanceScope = "conversation" | "instance";
export interface FoundryFactsOptions {
  readonly adapter: FactAdapter;
  readonly scope?: FoundryGuidanceScope | FactScope;
  readonly maxRevisions?: number;
  readonly onUrgent?: ConstructorParameters<typeof FactStore>[1]["onUrgent"];
  /** A dedicated native runnable, never the conversational runnable. */
  readonly preparationAgent?: IGloveRunnable;
  readonly source?: () => { source: FactInput["source"]; operationId: string };
}
export interface FoundryGoalsOptions extends Omit<UseGoalRunnerConfig<IGloveRunnable>, "scope" | "preparation"> {
  readonly adapter: GoalAdapter;
  readonly scope?: FoundryGuidanceScope | GoalScope;
  /** Starts only if absent. Revisions require the native runner's explicit CAS operation. */
  readonly program?: GoalProgram;
  readonly preparation?: Omit<NonNullable<UseGoalRunnerConfig["preparation"]>, "preparer">;
}
export interface FoundryFormsOptions extends Omit<UseFormRunnerConfig, "subject" | "preparation"> {
  readonly adapter: FormAdapter;
  readonly scope?: FoundryGuidanceScope | { readonly subject: string };
  readonly preparation?: Omit<NonNullable<UseFormRunnerConfig["preparation"]>, "preparer">;
}
/** Pure, composable configuration values; these helpers create no runtime state. */
export const defineFacts = <T extends FoundryFactsOptions>(options: T): Readonly<T> => Object.freeze({ ...options });
export const defineGoals = <T extends FoundryGoalsOptions>(options: T): Readonly<T> => Object.freeze({ ...options });
export const defineForms = <T extends FoundryFormsOptions>(options: T): Readonly<T> => Object.freeze({ ...options });

export interface FoundryGuidanceHandles {
  readonly facts?: FactStore;
  readonly goals?: GoalRunner;
  readonly forms?: FormRunner;
}

/** Stable, bounded ownership key, unrelated to an execution/run id. */
export function foundryGuidanceSubject(context: Pick<AgentAssemblyContext, "workspaceId" | "agentId" | "conversationId">, scope: FoundryGuidanceScope = "conversation"): string {
  return `foundry:${scope}:${createHash("sha256").update(JSON.stringify([
    context.workspaceId, context.agentId, ...(scope === "conversation" ? [context.conversationId] : []),
  ])).digest("hex")}`;
}

export async function mountFoundryGuidance(glove: IGloveRunnable, context: AgentAssemblyContext, options: {
  facts?: FoundryFactsOptions;
  goals?: FoundryGoalsOptions;
  forms?: FoundryFormsOptions;
  contextProviders: ReadonlyArray<RuntimeContextProvider>;
}): Promise<{ handles: FoundryGuidanceHandles; snapshot: () => Promise<void>; dispose: () => void }> {
  const { facts, goals, forms } = options;
  const subject = (scope?: FoundryGuidanceScope | { readonly subject: string }) =>
    typeof scope === "object" ? scope.subject : foundryGuidanceSubject(context, scope);
  const handles: { facts?: FactStore; goals?: GoalRunner; forms?: FormRunner } = {};
  let preparer: FactPreparation | undefined;
  if (facts) {
    handles.facts = new FactStore(facts.adapter, {
      scope: typeof facts.scope === "object" ? facts.scope : { subject: subject(facts.scope), context: "conversation-evidence" },
      maxRevisions: facts.maxRevisions, onUrgent: facts.onUrgent,
    });
    if (facts.preparationAgent) {
      if (facts.preparationAgent === glove) throw new Error("Fact preparation requires a dedicated agent.");
      preparer = new FactPreparation(handles.facts, { agent: facts.preparationAgent });
    }
    useFacts(glove, handles.facts, facts.source ?? (() => ({
      source: { kind: "message", id: context.message.id ?? context.runId },
      operationId: context.message.id ?? context.runId,
    })));
  }
  if ((goals?.preparation || forms?.preparation) && !preparer) {
    throw new Error("Guidance preparation requires facts with a dedicated preparationAgent.");
  }
  if (goals) {
    const scope = typeof goals.scope === "object" ? goals.scope : {
      subject: subject(goals.scope), key: goals.program?.key ?? "conversation",
    };
    if (goals.preparation && preparer!.facts.scope().subject !== scope.subject) throw new Error("Goals and facts must share the same subject.");
    handles.goals = useGoalRunner(glove, goals.adapter, {
      ...goals, scope,
      preparation: goals.preparation ? { ...goals.preparation, preparer: preparer! } : undefined,
    }).runner;
    if (goals.program) await handles.goals.start(goals.program, "Initialize definition-provided goals; preserve existing progress.");
  }
  if (forms) {
    if (forms.preparation && preparer!.facts.scope().subject !== subject(forms.scope)) throw new Error("Forms and facts must share the same subject.");
    handles.forms = useFormRunner(glove, forms.adapter, {
      ...forms, subject: subject(forms.scope),
      preparation: forms.preparation ? { ...forms.preparation, preparer: preparer! } : undefined,
    }).runner;
  }
  let previous = "";
  const snapshot = async () => {
    if (!facts && !goals && !forms && options.contextProviders.length === 0) return;
    // Metadata only: do not copy answers, fact text, or custom context into retained telemetry.
    const goalState = await handles.goals?.status();
    const factState = await handles.facts?.inspect();
    const formState = forms ? await forms.adapter.findInstances({ subject: subject(forms.scope) }) : undefined;
    const state = {
      goals: goalState ? { version: goalState.version, status: goalState.status, activeGoal: goalState.activeGoal,
        items: goalState.goals.map(g => ({ key: g.definition.key, title: g.definition.title, status: g.status,
          completed: g.items.filter(i => i.state?.done).length, total: g.items.length })) } : null,
      facts: factState ? { version: factState.version, revisions: factState.facts.length,
        claims: factState.claims.length, urgent: factState.facts.filter(f => f.urgent).length } : null,
      forms: formState?.map(f => ({ id: f.id, definitionId: f.defId, version: f.version, status: f.status,
        answered: Object.values(f.entries).filter(e => e.cursor >= 0).length,
        pendingHooks: Object.keys(f.pendingHooks ?? {}).length, blockedOn: f.blockedOn ?? null })) ?? null,
      contextProviders: options.contextProviders.length,
    };
    const encoded = JSON.stringify(state);
    if (encoded !== previous) { context.controls.emit({ type: "foundry.guidance.state", data: state }); previous = encoded; }
  };
  const cleanups: Array<() => void> = [];
  try {
    for (const provider of options.contextProviders) cleanups.push(glove.addContextProvider(provider));
    if (facts || goals || forms) {
      await snapshot();
      cleanups.push(glove.addContextProvider(async () => { await snapshot(); return null; }));
    }
    return { handles, snapshot, dispose: () => { for (const remove of cleanups.reverse()) remove(); } };
  } catch (error) { for (const remove of cleanups.reverse()) remove(); throw error; }
}
