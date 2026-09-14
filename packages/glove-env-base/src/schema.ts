/**
 * Schema-checked writes, and the in-memory half of a query.
 *
 * Two jobs, both of which exist so a provider author does not have to do them
 * and a script author does not have to discover them by failing:
 *
 * - **Before a write leaves base**, values are checked against the
 *   collection's schema. A column that does not exist fails here, naming the
 *   ones that do. A column the backend computes fails here, saying so. A
 *   value of the wrong shape fails here, naming the column. All three are
 *   otherwise a 400 from somewhere downstream that names a JSON path, and the
 *   distance between those two errors is a debugging round trip every time.
 * - **After a query comes back**, whatever the backend could not filter or
 *   sort is applied over the rows. A provider is free to push down nothing at
 *   all; it just has to say so, and the answer is still right.
 */
import type { Column, Condition, DateValue, Page, PropertyValue, Query } from "./model";

/**
 * Column types whose value the backend owns.
 *
 * A provider that knows better sets `computed` on the column and this is not
 * consulted. It is the default because these are computed in every tool that
 * has them, and silently accepting a write to one produces a request that
 * fails as a whole — taking the nine good columns with it.
 */
const COMPUTED_TYPES = new Set([
  "rollup",
  "formula",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "uniqueId",
  "verification",
  "button",
]);

export function isComputed(column: Column): boolean {
  return column.computed ?? COMPUTED_TYPES.has(column.type);
}

/**
 * Check and normalize values against a schema.
 *
 * Returns plain values — this does not build a provider payload, because the
 * payload is the provider's business. What comes back is what the caller
 * meant, with `Date`s turned into ISO strings, single values lifted into the
 * arrays their column expects, and `null` preserved as "clear this".
 */
export function validateWrite(
  schema: Record<string, Column>,
  values: Record<string, unknown>,
  where = "this collection",
): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};

  for (const [name, value] of Object.entries(values ?? {})) {
    const column = schema?.[name];
    if (!column) {
      const known = Object.keys(schema ?? {});
      throw new Error(
        `no column named ${JSON.stringify(name)}` +
          (known.length > 0 ? ` — ${where} has ${known.join(", ")}` : ` — ${where} has no columns`),
      );
    }
    if (isComputed(column)) {
      throw new Error(
        `${JSON.stringify(name)} is a ${column.type} column — the backend computes it and refuses writes. ` +
          `Remove it from the update.`,
      );
    }
    out[name] = coerce(name, column, value);
  }

  return out;
}

/** One value, checked against one column. */
export function coerce(name: string, column: Column, value: unknown): PropertyValue {
  const label = JSON.stringify(name);
  const bad = (want: string): never => {
    throw new Error(`${label} is a ${column.type} column — expected ${want}, got ${describe(value)}`);
  };
  const empty = value === null || value === undefined || value === "";

  switch (column.type) {
    case "title":
    case "text":
      return text(value, bad);

    case "number":
      if (empty) return null;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      // A number arriving as a string is the single commonest shape mismatch
      // (it came out of a CSV, a form, or a template literal) and refusing it
      // teaches nothing.
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
      return bad("a finite number");

    case "select":
    case "status": {
      if (empty) return null;
      const option = text(value, bad);
      checkOption(column, option, bad);
      return option;
    }

    case "multiSelect": {
      if (empty) return [];
      const list = Array.isArray(value) ? value : [value];
      return list.map((entry) => {
        const option = text(entry, bad);
        checkOption(column, option, bad);
        return option;
      });
    }

    case "date":
      return date(value, bad);

    case "checkbox":
      if (typeof value === "boolean") return value;
      if (empty) return false;
      return bad("a boolean");

    case "url":
    case "email":
    case "phone":
      return empty ? null : text(value, bad);

    case "people":
    case "relation": {
      if (empty) return [];
      const list = Array.isArray(value) ? value : [value];
      return list.map((entry) => {
        if (typeof entry === "string") return entry;
        const id = (entry as { id?: unknown } | null)?.id;
        if (typeof id === "string") return id;
        return bad(column.type === "people" ? "an array of user ids" : "an array of page ids");
      });
    }

    case "files": {
      if (empty) return [];
      const list = Array.isArray(value) ? value : [value];
      return list.map((entry) => {
        if (typeof entry === "string") return { name: fileName(entry), url: entry };
        const file = (entry ?? {}) as { name?: unknown; url?: unknown };
        if (typeof file.url !== "string") return bad("an array of URLs or { name, url }");
        return { name: typeof file.name === "string" ? file.name : fileName(file.url), url: file.url };
      });
    }

    default:
      // A column type this model does not name. The provider understands it
      // even though base does not, so the value goes through untouched rather
      // than being refused on the strength of an unrecognized string.
      return value as PropertyValue;
  }
}

function checkOption(column: Column, option: string, bad: (want: string) => never): void {
  if (!column.options || column.options.length === 0) return;
  if (column.options.includes(option)) return;
  // Options are a closed set wherever they are declared, and a typo silently
  // creating a fourteenth status is worse than a refusal.
  bad(`one of ${column.options.map((o) => JSON.stringify(o)).join(", ")} (got ${JSON.stringify(option)})`);
}

function text(value: unknown, bad: (want: string) => never): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.every((v) => v && typeof v === "object" && "text" in (v as object))) {
    return (value as Array<{ text?: string }>).map((v) => v.text ?? "").join("");
  }
  return bad("a string");
}

function date(value: unknown, bad: (want: string) => never): DateValue | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return { start: value.toISOString() };
  if (typeof value === "string") return { start: value };
  if (typeof value === "object") {
    const d = value as { start?: unknown; end?: unknown; timeZone?: unknown };
    if (typeof d.start !== "string") return bad("an ISO date string, a Date, or { start, end? }");
    return {
      start: d.start,
      ...(typeof d.end === "string" ? { end: d.end } : {}),
      ...(typeof d.timeZone === "string" ? { timeZone: d.timeZone } : {}),
    };
  }
  return bad("an ISO date string, a Date, or { start, end? }");
}

function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (value instanceof Date) return "a Date";
  return typeof value;
}

// ------------------------------------------------- the in-memory half

/** Apply the conditions a provider could not push down. */
export function applyWhere(rows: Page[], where: Condition[] | undefined, match: "and" | "or" = "and"): Page[] {
  if (!where || where.length === 0) return rows;
  return rows.filter((row) => {
    const results = where.map((condition) => test(row, condition));
    return match === "or" ? results.some(Boolean) : results.every(Boolean);
  });
}

/** Apply the sorts a provider could not push down. Stable, multi-key. */
export function applySort(rows: Page[], sort: Query["sort"]): Page[] {
  if (!sort || sort.length === 0) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const key of sort) {
        const order = compare(valueOf(a.row, key.property), valueOf(b.row, key.property));
        if (order !== 0) return key.direction === "desc" ? -order : order;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** `title` reads the page title; anything else reads a property. */
function valueOf(row: Page, property: string): unknown {
  if (property === "title") return row.title;
  return row.properties?.[property];
}

function test(row: Page, condition: Condition): boolean {
  const actual = valueOf(row, condition.property);
  const expected = condition.value;

  switch (condition.op) {
    case "isEmpty":
      return isEmpty(actual);
    case "isNotEmpty":
      return !isEmpty(actual);
    case "is":
      return equals(actual, expected);
    case "isNot":
      return !equals(actual, expected);
    case "contains":
      if (Array.isArray(actual)) return actual.some((entry) => equals(entry, expected));
      return string(actual).toLowerCase().includes(string(expected).toLowerCase());
    case "notContains":
      if (Array.isArray(actual)) return !actual.some((entry) => equals(entry, expected));
      return !string(actual).toLowerCase().includes(string(expected).toLowerCase());
    case "startsWith":
      return string(actual).toLowerCase().startsWith(string(expected).toLowerCase());
    case "endsWith":
      return string(actual).toLowerCase().endsWith(string(expected).toLowerCase());
    // A missing value does not satisfy a range comparison. Ordering treats
    // absent as lowest, which is a fine tiebreak for a sort and the wrong
    // answer for a filter: a row with no due date is not due before Friday,
    // it has no due date. Use isEmpty for that.
    case "gt":
      return ordered(actual, expected) && compare(actual, expected) > 0;
    case "gte":
      return ordered(actual, expected) && compare(actual, expected) >= 0;
    case "lt":
      return ordered(actual, expected) && compare(actual, expected) < 0;
    case "lte":
      return ordered(actual, expected) && compare(actual, expected) <= 0;
    default:
      return true;
  }
}

/** Both sides are present and comparable. */
function ordered(actual: unknown, expected: unknown): boolean {
  return !isEmpty(actual) && !isEmpty(expected) && scalar(actual) !== null && scalar(expected) !== null;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function equals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  // A date compares by its start, so `{ op: 'is', value: '2026-09-30' }` works
  // without the caller reconstructing the object.
  const a = scalar(actual);
  const b = scalar(expected);
  if (a !== null && b !== null) return a === b;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value && typeof value === "object" && typeof (value as DateValue).start === "string") {
    return (value as DateValue).start;
  }
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function string(value: unknown): string {
  const flat = scalar(value);
  return flat === null ? "" : String(flat);
}

function compare(a: unknown, b: unknown): number {
  const left = scalar(a);
  const right = scalar(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
  const l = String(left);
  const r = String(right);
  return l < r ? -1 : l > r ? 1 : 0;
}
