/** JSON object member order is not significant (e.g. PostgreSQL JSONB).
 * Array order is significant: it defines goal/item progression and history.
 */
export function equalGoalData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, index) => equalGoalData(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  // Optional undefined properties disappear during JSON persistence.
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) =>
    Object.hasOwn(right, key) && equalGoalData(left[key], right[key]));
}
