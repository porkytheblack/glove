/**
 * Readable keys and SQL identifier hygiene.
 *
 * The reference an agent holds *is* the physical root table name, so a subagent
 * can write `SELECT … FROM <ref>` directly. Child tables derived by
 * normalization are named `<ref>__<field>`. All identifiers are sanitised to a
 * safe Postgres form and clamped to the 63-byte identifier limit.
 */

const MAX_IDENT = 63;

/** Deterministic short hash (djb2) → base36, used to keep clamped names unique. */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Coerce an arbitrary string into a safe, lowercase Postgres identifier.
 * Non-alphanumeric runs collapse to `_`; a leading digit is prefixed with `_`.
 * Over-long names are truncated with a stable hash suffix so distinct inputs
 * don't collide after clamping.
 */
export function sanitizeIdent(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (s.length === 0) s = "f";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  if (s.length > MAX_IDENT) {
    const suffix = `_${shortHash(name)}`;
    s = s.slice(0, MAX_IDENT - suffix.length) + suffix;
  }
  return s;
}

/** Double-quote an identifier for safe interpolation into SQL. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Derive a child table name for a normalized nested array. */
export function childTableName(rootRef: string, field: string): string {
  const raw = `${rootRef}__${sanitizeIdent(field)}`;
  if (raw.length <= MAX_IDENT) return raw;
  const suffix = `_${shortHash(raw)}`;
  return raw.slice(0, MAX_IDENT - suffix.length) + suffix;
}

/**
 * Counter-suffix a sanitised identifier until `isFree` accepts it, re-clamping
 * every candidate so it can never exceed the 63-byte limit.
 */
function allocate(base: string, isFree: (cand: string) => boolean): string {
  const root = sanitizeIdent(base);
  if (isFree(root)) return root;
  for (let i = 2; ; i++) {
    const suffix = `_${i}`;
    const candidate =
      root.length + suffix.length <= MAX_IDENT
        ? `${root}${suffix}`
        : root.slice(0, MAX_IDENT - suffix.length) + suffix;
    if (isFree(candidate)) return candidate;
  }
}

/**
 * Disambiguate a column identifier against the names already used in the same
 * table. Re-clamps each candidate, so two long field names that sanitise to the
 * same identifier still produce distinct names within the 63-byte limit instead
 * of growing past it by appending `_`.
 */
export function uniqueColumn(base: string, used: ReadonlySet<string>): string {
  return allocate(base, (cand) => !used.has(cand));
}

/**
 * Pick a reference (root table name) that doesn't collide with anything already
 * in the store. A candidate is rejected not only when the name itself is taken
 * but also when its child-table namespace (`<cand>__…`) is already occupied —
 * normalization later derives `childTableName(cand, field)`, which would
 * otherwise collide with an existing physical table. Appends `_2`, `_3`, … on
 * collision.
 */
export function uniqueRef(base: string, taken: ReadonlySet<string>): string {
  return allocate(base, (cand) => {
    if (taken.has(cand)) return false;
    const prefix = `${cand}__`;
    for (const t of taken) if (t.startsWith(prefix)) return false;
    return true;
  });
}
