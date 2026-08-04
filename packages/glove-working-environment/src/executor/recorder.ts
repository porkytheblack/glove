/**
 * The worker half of a builder API.
 *
 * A script writes what the real library looks like:
 *
 * ```js
 * const pptx = new PptxGenJS();
 * pptx.layout = 'LAYOUT_16x9';
 * const slide = pptx.addSlide();
 * slide.addText('Revenue', { x: 0.5, y: 0.4, fontSize: 32 });
 * await pptx.writeFile({ fileName: '/out/deck.pptx' });
 * ```
 *
 * None of that reaches the host until `writeFile`. Every call before it is
 * recorded locally and returns another recorder, so the API is synchronous
 * and chains exactly as the real one does — which is the point. An API where
 * every call had to be awaited would be a different API, and a model writing
 * from memory would get it wrong.
 *
 * Recording also makes it fast: one round trip per document instead of one
 * per call, and no `Atomics`/`SharedArrayBuffer` shim to fake synchronous
 * RPC.
 *
 * The cost is that a bad call surfaces at the flush rather than where it was
 * written, so every op carries the method and its position and the host
 * reports both.
 */
import type { BuilderOp, BuilderShape } from "./protocol";

/** Property reads that must not be treated as methods to record. */
const PASSTHROUGH = new Set([
  "then",
  "constructor",
  "prototype",
  "__proto__",
  "toJSON",
  "valueOf",
  "inspect",
  Symbol.toPrimitive as unknown as string,
  Symbol.toStringTag as unknown as string,
]);

export interface BuilderHost {
  /** Send the recording to the host and await the result. */
  flush(name: string, ops: BuilderOp[]): Promise<unknown>;
}

/**
 * Build the constructor a script sees for one builder shape.
 *
 * Each `new` starts a fresh recording: two documents built in one script are
 * independent, and neither sees the other's ops.
 */
export function makeBuilder(shape: BuilderShape, host: BuilderHost): unknown {
  const terminal = new Set(shape.terminal);

  function Builder(this: unknown, ...args: unknown[]): unknown {
    const ops: BuilderOp[] = [];
    let nextRef = 0;

    /** A recorder for one object in the graph, identified by `ref`. */
    const node = (ref: number): unknown => {
      const self: Record<string, unknown> = {};
      return new Proxy(self, {
        get(_t, prop) {
          if (typeof prop === "symbol" || PASSTHROUGH.has(prop)) {
            // `then` in particular: returning a recorder for it would make
            // the object look thenable and `await` would hang forever.
            return undefined;
          }
          const method = String(prop);

          // Enums and other instance data: `pptx.ShapeType.rect`. Recording
          // these as calls is the difference between a model's habitual code
          // working and returning a proxy where it expected a string.
          if (Object.prototype.hasOwnProperty.call(shape.data, method)) return shape.data[method];

          if (terminal.has(method)) {
            return async (...callArgs: unknown[]): Promise<unknown> => {
              ops.push({ op: "end", target: ref, method, args: callArgs });
              return host.flush(shape.name, ops);
            };
          }

          return (...callArgs: unknown[]): unknown => {
            const child = nextRef + 1;
            nextRef = child;
            ops.push({ op: "call", ref: child, target: ref, method, args: callArgs });
            // Every non-terminal call yields a recorder, because the real
            // libraries return objects (`addSlide()`) or `this` (chaining),
            // and the script cannot tell which until replay.
            return node(child);
          };
        },
        set(_t, prop, value) {
          if (typeof prop === "symbol") return true;
          ops.push({ op: "set", target: ref, prop: String(prop), value });
          return true;
        },
        // A recorder must not look like a plain object to `Object.keys` or a
        // spread, or a script logging it would silently trigger recordings.
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => undefined,
      });
    };

    ops.push({ op: "new", ref: 0, args });
    return node(0);
  }

  Object.defineProperty(Builder, "name", { value: shape.name, configurable: true });
  for (const [key, value] of Object.entries(shape.statics)) {
    (Builder as unknown as Record<string, unknown>)[key] = value;
  }
  return Builder;
}
