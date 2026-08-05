/** ESM fixture for pure-module tests: tiny, synchronous, dependency-free. */
export function double(n) {
  return n * 2;
}
export function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}
export function sumBy(rows, iteratee) {
  const get = typeof iteratee === "function" ? iteratee : (r) => r[iteratee];
  return rows.reduce((n, r) => n + Number(get(r) ?? 0), 0);
}
export function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key]] ??= []).push(r);
  return out;
}
/** Returns a FUNCTION — pinned by a test as the thing that does not cross. */
export function makeCounter() {
  let n = 0;
  return () => ++n;
}
export const VERSION = "1.2.3";
