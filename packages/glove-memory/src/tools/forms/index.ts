import type { ContentPart, GloveFoldArgs, Message, ModelPromptResult } from "glove-core";
import type { DisplayManagerAdapter } from "glove-core";
import type { FormAdapter } from "../../forms/adapter";
import type { FormMemoryAdapters } from "../../forms/bridge";
import type { FormRegistry } from "../../forms/registry";
import { FormRunner } from "../../forms/runner";
import { buildFormAbandonTool } from "./abandon";
import { buildFormFillTool } from "./fill";
import { buildFormHistoryTool, type FormReaderOptions } from "./history";
import { buildFormInspectTool } from "./inspect";
import { buildFormListTool } from "./list";
import { buildFormReviseTool } from "./revise";
import { buildFormStartTool } from "./start";
import { buildFormStatusTool } from "./status";

export {
  buildFormAbandonTool,
  buildFormFillTool,
  buildFormHistoryTool,
  buildFormInspectTool,
  buildFormListTool,
  buildFormReviseTool,
  buildFormStartTool,
  buildFormStatusTool,
};
export type { FormReaderOptions };

/** The full write surface. Order matches §7. */
export function buildFormRunnerTools(runner: FormRunner): Array<GloveFoldArgs<any>> {
  return [
    buildFormListTool(runner),
    buildFormStartTool(runner),
    buildFormStatusTool(runner),
    buildFormInspectTool(runner),
    buildFormFillTool(runner),
    buildFormReviseTool(runner),
    buildFormAbandonTool(runner),
  ];
}

export function buildFormReaderTools(
  adapter: FormAdapter,
  options: FormReaderOptions = {},
): Array<GloveFoldArgs<any>> {
  return [buildFormHistoryTool(adapter, options)];
}

/**
 * Minimal interface `useFormRunner` relies on — `fold` for tool registration
 * plus the system-prompt accessors, so `processRequest` can be wrapped to
 * inject the tier-0 line on every turn. Same shape as `ContextEnableTarget`.
 */
export interface FormEnableTarget {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string): void;
  processRequest(
    request: string | ContentPart[],
    signal?: AbortSignal,
  ): Promise<ModelPromptResult | Message>;
}

export interface UseFormRunnerConfig {
  registry: FormRegistry;
  /** Conversation id / user id / matter id. A thunk when it varies per turn. */
  subject: string | (() => string);
  /** Wired into `ctx.memory` for executors. */
  memory?: FormMemoryAdapters;
  display?: DisplayManagerAdapter;
  actor?: string;
  source?: string;
  /** Skip the tier-0 system-prompt injection and drive it yourself. */
  injectStatus?: boolean;
}

/**
 * Attach the form tool surface to a Glove and wire tier-0 injection.
 *
 * 1. Folds `glove_form_list`, `_start`, `_status`, `_inspect`, `_fill`,
 *    `_revise`, `_abandon`.
 *
 * 2. Wraps `processRequest` so each turn appends one standing line to the
 *    system prompt — the open step, its pending field labels, and a one-line
 *    preview of each step still to come. Modelled on the inbox: a cheap
 *    notification, detail pulled on demand.
 *
 *    The line is re-rendered every turn from stored state, so a fill that
 *    happened mid-turn is reflected on the next one, and a form the host
 *    started out of band shows up without the agent being told.
 *
 *    Injection goes *after* the developer's system prompt, for the same
 *    reason `useContext`'s does: the developer prompt sets character and
 *    guardrails, and per-conversation state modifies engagement within them.
 *
 * Returns the runner alongside the glove so hosts can start instances,
 * resolve checkpoints, and read tier 0 without going through the model.
 */
export function useFormRunner<G extends FormEnableTarget>(
  glove: G,
  adapter: FormAdapter,
  config: UseFormRunnerConfig,
): { glove: G; runner: FormRunner } {
  const runner = new FormRunner(adapter, {
    registry: config.registry,
    subject: config.subject,
    memory: config.memory,
    display: config.display,
    actor: config.actor,
    source: config.source,
  });

  for (const tool of buildFormRunnerTools(runner)) glove.fold(tool);

  if (config.injectStatus !== false) {
    // Snapshot the developer prompt once — `setSystemPrompt` overwrites the
    // live one, so re-deriving from it would compound last turn's injection.
    const basePrompt = glove.getSystemPrompt();
    const original = glove.processRequest.bind(glove);

    glove.processRequest = async function wrappedProcessRequest(
      request: string | ContentPart[],
      signal?: AbortSignal,
    ): Promise<ModelPromptResult | Message> {
      let line = "";
      try {
        line = await runner.tier0();
      } catch {
        // A form that can't be read must not take the turn down with it.
        line = "";
      }
      glove.setSystemPrompt(line ? `${basePrompt}\n\n${line}` : basePrompt);
      return original(request, signal);
    };
  }

  return { glove, runner };
}

/** Read past fills. No writes, no executors. */
export function useFormReader<G extends { fold: <I>(args: GloveFoldArgs<I>) => unknown }>(
  glove: G,
  adapter: FormAdapter,
  options: FormReaderOptions = {},
): G {
  for (const tool of buildFormReaderTools(adapter, options)) glove.fold(tool);
  return glove;
}
