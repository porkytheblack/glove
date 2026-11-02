import type { GloveFoldArgs, IGloveRunnable, Tool, ToolResultData } from "glove-core";
import { getToolJsonSchema } from "glove-core";

/**
 * Replace a mounted tool with one built around it, such as an app's send
 * wrapped in the agent's own policy. Glove asks for approval from the tool
 * the model calls, so the outer tool's `requiresPermission` is the one that
 * counts; calling `run` skips the inner tool's. Return undefined to remove it.
 */
export function aroundTool(
  agent: IGloveRunnable,
  name: string,
  wrap: (inner: {
    readonly name: string;
    readonly description: string;
    readonly jsonSchema: Record<string, unknown>;
    readonly run: (input: unknown, signal?: AbortSignal) => Promise<ToolResultData>;
  }) => GloveFoldArgs<any> | undefined,
): void {
  const tool = agent.tools.find((candidate) => candidate.name === name) as Tool<unknown> | undefined;
  if (!tool) return;
  const next = wrap({
    name: tool.name,
    description: tool.description,
    jsonSchema: getToolJsonSchema(tool) as Record<string, unknown>,
    run: (input, signal) => tool.run(input, undefined, signal),
  });
  agent.replaceTools([name], next ? [next] : []);
}
