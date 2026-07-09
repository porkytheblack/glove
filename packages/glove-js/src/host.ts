/**
 * Host constructors the model may reach via `new` (or call): the ONLY things
 * `new` is allowed on. Branded so members.ts can expose their statics
 * (`Date.now`) and interp.ts can route `new X()` / `X()` without an import cycle.
 */
export class HostCtor {
  constructor(
    readonly name: string,
    /** `new X(...args)`. */
    readonly construct: (args: unknown[]) => unknown,
    /** `X(...args)` without `new`, when the builtin allows it (Date, RegExp, Error). */
    readonly callable?: (args: unknown[]) => unknown,
    /** Static members readable as `X.member` (e.g. `Date.now`). */
    readonly statics: Record<string, unknown> = {},
  ) {}
}

export function hostConstructors(): Record<string, HostCtor> {
  return {
    Set: new HostCtor("Set", (a) => new Set(a[0] as Iterable<unknown> | undefined)),
    Map: new HostCtor("Map", (a) => new Map(a[0] as Iterable<[unknown, unknown]> | undefined)),
    Date: new HostCtor(
      "Date",
      (a) => new (Date as unknown as new (...args: unknown[]) => Date)(...a),
      () => new Date().toString(),
      { now: () => Date.now() },
    ),
    RegExp: new HostCtor(
      "RegExp",
      (a) => new RegExp(a[0] as string, a[1] as string | undefined),
      (a) => new RegExp(a[0] as string, a[1] as string | undefined),
    ),
    Error: new HostCtor(
      "Error",
      (a) => new Error(a[0] === undefined ? "" : String(a[0])),
      (a) => new Error(a[0] === undefined ? "" : String(a[0])),
    ),
  };
}
