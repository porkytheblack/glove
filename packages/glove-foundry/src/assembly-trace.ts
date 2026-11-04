/**
 * What Foundry composed for a run, step by step: how long each assembly step
 * took and which tools it added. The inspector's Composition view reads the
 * `foundry.assembly.composed` event this produces, so it can say which app,
 * installation or Foundry feature a tool came from.
 */

/** Emitted once per run, when the agent is assembled and before its first turn. */
export const FOUNDRY_ASSEMBLY_COMPOSED_EVENT = "foundry.assembly.composed";

export interface AssemblyStep {
  /** What kind of step: `foundry-core`, `installation`, `mcp`, `repl`, … */
  readonly step: string;
  /** A name for people: "Foundry core tools", an installation's id, … */
  readonly label: string;
  /** Installation steps: the installation's kind and id. */
  readonly kind?: string;
  readonly id?: string;
  /** Tools this step added to the agent, in the order they were folded. */
  readonly tools: ReadonlyArray<string>;
  /** Time since the previous step finished. */
  readonly ms: number;
}

interface ToolHolder {
  readonly tools: ReadonlyArray<{ readonly name: string }>;
}

export interface AssemblyRecorder {
  /**
   * Close a step: the tools `glove` has now that no earlier step had are this
   * step's. A step that added nothing and took no time is left out, unless
   * `keep` is set (an installation that only configures).
   */
  mark(step: string, label: string, options?: { readonly glove?: ToolHolder; readonly kind?: string; readonly id?: string; readonly keep?: boolean }): void;
  readonly steps: ReadonlyArray<AssemblyStep>;
  /** Time since the recorder was created. */
  elapsedMs(): number;
}

export function assemblyRecorder(glove: ToolHolder, now: () => number = Date.now): AssemblyRecorder {
  const started = now();
  let last = started;
  const known = new Set<string>();
  const steps: AssemblyStep[] = [];
  return {
    mark(step, label, options = {}) {
      const names = (options.glove ?? glove).tools.map((tool) => tool.name);
      const added = names.filter((name) => !known.has(name));
      for (const name of names) known.add(name);
      const at = now();
      const ms = at - last;
      last = at;
      if (!added.length && ms < 1 && !options.keep) return;
      steps.push({
        step,
        label,
        ...(options.kind ? { kind: options.kind } : {}),
        ...(options.id ? { id: options.id } : {}),
        tools: added,
        ms,
      });
    },
    steps,
    elapsedMs: () => now() - started,
  };
}
