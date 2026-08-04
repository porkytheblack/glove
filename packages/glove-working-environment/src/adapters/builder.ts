/**
 * The host half of a builder API: replay a recording against the real
 * library.
 *
 * `defineBuilder` is what an adapter author uses to expose a library with its
 * genuine API — `new PptxGenJS()`, `doc.addSlide()`, `slide.addText(...)` —
 * rather than a spec of our own invention. The value of that is not
 * aesthetic: models have read the real library's documentation and examples,
 * and every API that differs from it makes the model translate. The
 * analyst-desk eval caught exactly that, with a model reaching for a name our
 * API did not have because the real library does.
 */
import { BUILDER, type BuilderOp, type BuilderSpec } from "../executor/protocol";

export interface DefineBuilderOptions<T> {
  /** Constructor name as the script sees it. Must match the real library. */
  name: string;
  /** Construct the underlying object. Receives whatever the script passed. */
  construct(args: unknown[]): T | Promise<T>;
  /**
   * Method names that may be replayed, on the root object and on anything it
   * returns.
   *
   * Required, not optional. Replaying a script-chosen name against a live
   * host object is a sandbox escape: without this, `constructor`,
   * `__proto__`, `valueOf` and every other inherited member is callable, and
   * `constructor.constructor` is the classic route to the host realm.
   */
  allow: string[];
  /**
   * Terminal methods, and what each one does. These are the only calls that
   * produce a result, and they are where the artifact reaches the VFS —
   * a library's own `writeFile` must never run, or it would write to the
   * host filesystem.
   */
  finish: Record<string, (target: T, args: unknown[]) => Promise<unknown>>;
  /** Static properties the script can read off the constructor. */
  statics?: Record<string, unknown>;
  /** Data properties readable off an instance, e.g. `pptx.ShapeType`. */
  data?: Record<string, unknown>;
}

/**
 * Every method a live object actually exposes, walking its prototype chain.
 *
 * The allowlist is meant to be *the library's surface*, so it is read off the
 * library rather than typed out. A hand-written list is wrong the day the
 * dependency adds a method — and being wrong here is invisible, because the
 * symptom is a model writing correct code from the real documentation and
 * being told the method does not exist.
 *
 * Stops at `Object.prototype`, which is where the inherited members a script
 * must not reach begin.
 */
export function methodsOf(instance: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = instance; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (suspicious(name)) continue;
      let value: unknown;
      try {
        value = (o as Record<string, unknown>)[name];
      } catch {
        continue; // a getter that throws off a bare instance
      }
      if (typeof value === "function") names.add(name);
    }
  }
  return [...names].sort();
}

/** True for anything reachable on a prototype rather than the library's own API. */
function suspicious(method: string): boolean {
  return (
    method.startsWith("__") ||
    method === "constructor" ||
    method === "prototype" ||
    Object.prototype.hasOwnProperty.call(Object.prototype, method)
  );
}

/**
 * Expose a builder-shaped library to scripts.
 *
 * The returned value is an ordinary object carrying a marker; the shape
 * describer turns it into a recorded constructor in the worker, and the
 * replay below runs on the host.
 */
export function defineBuilder<T extends object>(options: DefineBuilderOptions<T>): unknown {
  const allow = new Set(options.allow);
  const terminal = Object.keys(options.finish);

  for (const name of allow) {
    if (suspicious(name)) {
      throw new Error(
        `builder "${options.name}" allows "${name}", which is reachable on Object.prototype or is an internal — ` +
          `an allowlist containing it is not an allowlist. List only the library's own methods.`,
      );
    }
  }

  const spec: BuilderSpec = {
    name: options.name,
    terminal,
    statics: options.statics,
    data: options.data,
    allow: options.allow,

    async replay(ops: BuilderOp[]): Promise<unknown> {
      // Objects the recording refers to, by ref. Only ever populated by
      // replaying an op, so a script cannot name a host object we did not
      // hand out.
      const refs = new Map<number, unknown>();

      const describe = (index: number, method: string): string =>
        `call #${index + 1} ${method}()`;

      for (const [index, op] of ops.entries()) {
        try {
          if (op.op === "new") {
            refs.set(op.ref, await options.construct(op.args));
            continue;
          }

          const target = refs.get(op.target);
          if (target === undefined) {
            throw new Error("refers to an object that was never created");
          }

          if (op.op === "set") {
            if (suspicious(op.prop)) throw new Error(`cannot assign to "${op.prop}"`);
            (target as Record<string, unknown>)[op.prop] = op.value;
            continue;
          }

          if (op.op === "end") {
            const finish = options.finish[op.method];
            if (!finish) throw new Error(`"${op.method}" is not a way to finish a ${options.name}`);
            return await finish(target as T, op.args);
          }

          // op.op === "call"
          if (!allow.has(op.method)) {
            throw new Error(
              `${options.name} has no method "${op.method}". Available: ${options.allow.slice(0, 24).join(", ")}` +
                (options.allow.length > 24 ? ", …" : ""),
            );
          }
          const fn = (target as Record<string, unknown>)[op.method];
          if (typeof fn !== "function") {
            throw new Error(`"${op.method}" is not callable on this object`);
          }
          const result = await (fn as (...a: unknown[]) => unknown).apply(target, op.args);
          // A library that returns nothing is chaining on `this`; recording
          // assumed a new object, so bind the ref to whichever it is.
          refs.set(op.ref, result === undefined || result === null ? target : result);
        } catch (e) {
          // The recording is replayed all at once, so without this the error
          // would point at the flush and not at the line that caused it.
          const method = op.op === "new" ? "new " + options.name : (op as { method?: string }).method ?? (op as { prop?: string }).prop ?? "?";
          throw new Error(`${describe(index, method)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      throw new Error(
        `nothing was written — a ${options.name} only produces a file when you call ` +
          `${terminal.map((t) => `${t}()`).join(" or ")}, and it must be awaited.`,
      );
    },
  };

  return { [BUILDER]: spec };
}
