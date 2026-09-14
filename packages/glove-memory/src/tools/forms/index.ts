import type { ContentPart, GloveFoldArgs, Message, ModelPromptResult } from "glove-core";
import { assertRuntimeContext, attachRuntimeContext, type RuntimeContextTarget } from "../runtime-context";
import type { DisplayManagerAdapter } from "glove-core";
import type { FormAdapter } from "../../forms/adapter";
import type { FormMemoryAdapters } from "../../forms/bridge";
import type { FormRegistry } from "../../forms/registry";
import { selectFoldArgs, type ToolSelection } from "../selection";
import type { FormPreparationConfig } from "../../forms/preparation";
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

/** Tool mounting and runtime context injection. Proxies forward addContextProvider to Glove. */
export interface FormEnableTarget extends RuntimeContextTarget {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string): void;
  processRequest(
    request: string | ContentPart[],
    signal?: AbortSignal,
  ): Promise<ModelPromptResult | Message>;
}

export interface UseFormRunnerConfig {
  preparation?: FormPreparationConfig;
  registry: FormRegistry;
  /** Conversation id / user id / matter id. A thunk when it varies per turn. */
  subject: string | (() => string);
  /** Wired into `ctx.memory` for executors. */
  memory?: FormMemoryAdapters;
  display?: DisplayManagerAdapter;
  actor?: string;
  source?: string;
  /** Skip transient tier-0 runtime context and drive it yourself. */
  injectStatus?: boolean;
  /**
   * Narrow the folded surface. `{ deny: ["abandon"] }` leaves the agent
   * unable to close an instance out; `{ allow: ["list", "status", "fill"] }`
   * keeps it to the straight-line path.
   */
  tools?: ToolSelection;
}

/**
 * Mount form tools and an optional transient tier-0 snapshot before every model
 * iteration. Preparation/recovery run before requests; tool commits prepare
 * subsequent steps. System instructions and persisted history are unchanged.
 */
export function useFormRunner<G extends FormEnableTarget>(
  glove: G,
  adapter: FormAdapter,
  config: UseFormRunnerConfig,
): { glove: G; runner: FormRunner } {
  const assertPreparationAgent = () => {
    if (Object.is(config.preparation?.preparer.config.agent, glove)) throw new Error("Preparation requires a dedicated Glove agent, separate from the workflow agent");
  };
  assertPreparationAgent();
  if (config.injectStatus !== false) assertRuntimeContext(glove);
  const runner = new FormRunner(adapter, {
    preparation: config.preparation,
    registry: config.registry,
    subject: config.subject,
    memory: config.memory,
    display: config.display,
    actor: config.actor,
    source: config.source,
  });

  for (const tool of selectFoldArgs(buildFormRunnerTools(runner), config.tools)) {
    glove.fold(tool);
  }

  const synchronize = async () => {
    assertPreparationAgent();
    if (config.preparation) {
      const instance = await runner.activeInstance();
      if (instance) await runner.prepare({ instanceId: instance.id });
      return runner.tier0();
    }
    try { return await runner.tier0(); } catch { return ""; }
  };
  if (config.injectStatus !== false) attachRuntimeContext(glove, async () => {
    if (config.preparation) return runner.tier0();
    try { return await runner.tier0(); } catch { return ""; }
  });
  if (config.preparation) {
    const original = glove.processRequest.bind(glove);
    glove.processRequest = async (request, signal) => { await synchronize(); return original(request, signal); };
  }

  return { glove, runner };
}

/** Read past fills. No writes, no executors. */
export function useFormReader<G extends { fold: <I>(args: GloveFoldArgs<I>) => unknown }>(
  glove: G,
  adapter: FormAdapter,
  options: FormReaderOptions & { tools?: ToolSelection } = {},
): G {
  for (const tool of selectFoldArgs(buildFormReaderTools(adapter, options), options.tools)) {
    glove.fold(tool);
  }
  return glove;
}
