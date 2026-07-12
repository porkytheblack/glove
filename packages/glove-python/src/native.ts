/** A host callable the interpreter can apply — a builtin or a bound tool
 *  function. Receives positional args, keyword args, and the interpreter API
 *  (for callbacks / fuel). Kept separate from members.ts to avoid an import
 *  cycle. */
import type { InterpApi } from "./members";

export type NativeCall = (
  args: unknown[],
  kwargs: Record<string, unknown>,
  api: InterpApi,
) => unknown | Promise<unknown>;

export class NativeFn {
  constructor(
    readonly name: string,
    readonly call: NativeCall,
    /** Marks a registered ToolFn (so the interpreter bookkeeps the call). */
    readonly toolName?: string,
  ) {}
}
