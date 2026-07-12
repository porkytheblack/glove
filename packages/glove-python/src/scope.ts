/**
 * Scopes. Python has no block scope — `if`/`for`/`while`/`try` bodies run in the
 * enclosing scope — so only function calls and comprehensions push a child
 * scope. The session's ROOT scope persists across `execute` calls, which is what
 * makes a module-level `prs = get_prs()` a scratchpad: bind it once, reuse it in
 * later calls without re-fetching.
 *
 * Simplification vs CPython: assignment always writes the CURRENT scope
 * (functions get a fresh local scope, so they shadow rather than mutate
 * enclosing names — `global`/`nonlocal` are rejected at parse time anyway), and
 * reads walk the lexical chain.
 */
export class Scope {
  private vars = new Map<string, unknown>();
  constructor(
    private parent?: Scope,
    readonly isRoot = false,
  ) {}

  child(): Scope {
    return new Scope(this);
  }

  set(name: string, value: unknown): void {
    this.vars.set(name, value);
  }

  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }

  lookup(name: string): { found: boolean; value?: unknown } {
    if (this.vars.has(name)) return { found: true, value: this.vars.get(name) };
    if (this.parent) return this.parent.lookup(name);
    return { found: false };
  }

  ownNames(): string[] {
    return [...this.vars.keys()];
  }

  allNames(): string[] {
    const names = new Set(this.vars.keys());
    let p = this.parent;
    while (p) {
      for (const n of p.ownNames()) names.add(n);
      p = p.parent;
    }
    return [...names];
  }
}
