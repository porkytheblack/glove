/**
 * Lexical environments — a parent-chained map. The session's ROOT env persists
 * across `execute` calls, which is what makes `def` a scratchpad: a model can
 * `(def prs (github_pull_requests))` once and keep referring to `prs` for the
 * rest of the conversation without the rows ever entering its context.
 */

export class Env {
  private vars = new Map<string, unknown>();
  constructor(private parent?: Env) {}

  lookup(name: string): { found: boolean; value?: unknown } {
    if (this.vars.has(name)) return { found: true, value: this.vars.get(name) };
    if (this.parent) return this.parent.lookup(name);
    return { found: false };
  }

  set(name: string, value: unknown): void {
    this.vars.set(name, value);
  }

  has(name: string): boolean {
    return this.lookup(name).found;
  }

  /** Names defined at THIS level (not parents) — the session's own defs. */
  ownNames(): string[] {
    return [...this.vars.keys()];
  }

  /** All names visible from here — used for did-you-mean suggestions. */
  allNames(): string[] {
    const names = new Set<string>(this.vars.keys());
    let p = this.parent;
    while (p) {
      for (const n of p.vars.keys()) names.add(n);
      p = p.parent;
    }
    return [...names];
  }
}

/** Small Levenshtein for "unknown symbol — did you mean …" suggestions. */
export function closest(name: string, candidates: string[], maxDistance = 3): string | undefined {
  let best: string | undefined;
  let bestD = maxDistance + 1;
  for (const c of candidates) {
    const d = levenshtein(name, c, bestD);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
