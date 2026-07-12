/**
 * Lexical scopes — a parent-chained map. The session's ROOT scope persists
 * across `execute` calls, which is what makes a top-level `const`/`let` a
 * scratchpad: a model can `const prs = github.list_pull_requests()` once and
 * keep referring to `prs` for the rest of the conversation without the rows ever
 * entering its context.
 */
import { JsError } from "./errors";

interface Binding {
  value: unknown;
  const: boolean;
}

export class Scope {
  private vars = new Map<string, Binding>();
  constructor(
    private parent?: Scope,
    /** The root scope allows redeclaration (DevTools-style REPL ergonomics). */
    readonly isRoot = false,
  ) {}

  child(): Scope {
    return new Scope(this);
  }

  declare(name: string, value: unknown, isConst: boolean): void {
    if (this.vars.has(name) && !this.isRoot) {
      throw new JsError(`'${name}' has already been declared in this scope.`);
    }
    this.vars.set(name, { value, const: isConst });
  }

  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }

  lookup(name: string): { found: boolean; value?: unknown } {
    const b = this.vars.get(name);
    if (b) return { found: true, value: b.value };
    if (this.parent) return this.parent.lookup(name);
    return { found: false };
  }

  assign(name: string, value: unknown): void {
    const b = this.vars.get(name);
    if (b) {
      if (b.const) throw new JsError(`assignment to constant variable '${name}'.`);
      b.value = value;
      return;
    }
    if (this.parent) {
      this.parent.assign(name, value);
      return;
    }
    throw new JsError(`assignment to undeclared variable '${name}'.`);
  }

  /** Names bound at THIS level (the session's own top-level declarations). */
  ownNames(): string[] {
    return [...this.vars.keys()];
  }

  /** All names visible from here — used for did-you-mean suggestions. */
  allNames(): string[] {
    const names = new Set<string>(this.vars.keys());
    let p = this.parent;
    while (p) {
      for (const n of p.ownNames()) names.add(n);
      p = p.parent;
    }
    return [...names];
  }
}
