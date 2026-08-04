/**
 * The worker's half of a builder API — which is deliberately almost nothing.
 *
 * The recorder a script actually touches is built *inside* the vm context, by
 * `mkBuilder` in `bridge.ts`. It has to be: every value crossing into the
 * context is deep-copied, and a Proxy whose whole behaviour lives in traps
 * has no own keys, so a copy of one is `{}`. The property that makes the
 * sandbox a sandbox makes a proxy built out here useless in there.
 *
 * So this side only carries the description across — the constructor's name,
 * which methods finish the document, the enums a script reads off an instance
 * — plus one function that ships a finished recording to the host. The bridge
 * recognises the marker, binds that function into the context, and builds the
 * real recorder there.
 */
import type { BuilderOp, BuilderShape } from "./protocol";

/** What `bridge.ts` looks for, and what it needs to build the recorder. */
export interface BuilderCarrier {
  name: string;
  terminal: string[];
  statics: Record<string, unknown>;
  data: Record<string, unknown>;
  /** Send a finished recording to the host and resolve with its result. */
  flush(ops: BuilderOp[]): Promise<unknown>;
}

export interface BuilderHost {
  flush(name: string, ops: BuilderOp[]): Promise<unknown>;
}

/**
 * A carrier the bridge turns into an in-context constructor.
 *
 * A function rather than an object because the bridge's namespace walk
 * dispatches on `typeof`, and because anything a script can reach should look
 * like what it is — a constructor.
 */
export function makeBuilder(shape: BuilderShape, host: BuilderHost): unknown {
  const carrier = function (): void {
    throw new Error(
      `${shape.name} must be constructed with new: const x = new ${shape.name}()`,
    );
  };
  const meta: BuilderCarrier = {
    name: shape.name,
    terminal: shape.terminal,
    statics: shape.statics,
    data: shape.data,
    flush: (ops) => host.flush(shape.name, ops),
  };
  (carrier as unknown as Record<string, unknown>).__glove_builder = meta;
  Object.defineProperty(carrier, "name", { value: shape.name, configurable: true });
  return carrier;
}
