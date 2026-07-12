/**
 * ReDoS guard. The interpreter runs regexes on the native engine, which does
 * exponential backtracking with no fuel accounting and no abort checkpoint — a
 * program like `/(a+)+$/.test("a".repeat(30) + "!")` blocks the event loop for
 * minutes and can't be interrupted. So we reject the shape that causes it —
 * a repetition nested inside another repetition (regex "star height" ≥ 2) — at
 * construction and before any string method compiles a pattern.
 *
 * The check is deliberately conservative: it can reject a safe regex (the model
 * gets a clear error and rewrites), but it does not let a catastrophic one
 * through. Simple non-nested repetition (`a+`, `\d*`, `(ab)+`, `(a|b)*`) is fine.
 */
import { JsError } from "./errors";

/** True if `source` has a quantified group whose body is itself quantified. */
export function isDangerousRegex(source: string): boolean {
  const stack: { hasRepeat: boolean }[] = [];
  let inClass = false;
  let i = 0;
  const isQuant = (c: string | undefined): boolean => c === "*" || c === "+" || c === "{";

  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      i++;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      i++;
      continue;
    }
    if (ch === "(") {
      stack.push({ hasRepeat: false });
      i++;
      continue;
    }
    if (ch === ")") {
      const group = stack.pop() ?? { hasRepeat: false };
      i++;
      const next = source[i];
      // A group followed by an unbounded/repeating quantifier.
      let quantified = false;
      if (next === "*" || next === "+") quantified = true;
      else if (next === "{") {
        const close = source.indexOf("}", i);
        const body = close > i ? source.slice(i + 1, close) : "";
        quantified = body.includes(","); // {n,} or {n,m} — repetition
      }
      if (quantified) {
        if (group.hasRepeat) return true; // repetition nested in a repetition
        if (stack.length) stack[stack.length - 1].hasRepeat = true; // this group repeats within its parent
      }
      continue;
    }
    if (ch === "*" || ch === "+") {
      if (stack.length) stack[stack.length - 1].hasRepeat = true;
      i++;
      continue;
    }
    if (ch === "{") {
      const close = source.indexOf("}", i);
      const body = close > i ? source.slice(i + 1, close) : "";
      if (body.includes(",") && stack.length) stack[stack.length - 1].hasRepeat = true;
      i = close > i ? close + 1 : i + 1;
      continue;
    }
    i++;
  }
  void isQuant;
  return false;
}

/** Throw if `source` is a catastrophic-backtracking risk. */
export function assertSafeRegex(source: string): void {
  if (isDangerousRegex(source)) {
    throw new JsError(
      "this regular expression risks catastrophic backtracking (a repetition nested inside a repetition, e.g. (a+)+) and is not allowed — rewrite it without nested quantifiers.",
    );
  }
}
