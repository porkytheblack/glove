/**
 * The adaptive red-team simulation (NO API) — the deterministic proof of the
 * thesis's §3.4 worst case: a boolean/assertion channel, if UNBOUNDED, is not
 * safe just because each answer is "one bit". An adversary (or an injection
 * steering the planner) issues *adaptive* predicates and binary-searches a secret
 * out one bit at a time. This module makes that curve concrete, and then shows
 * the two enforced defenses the gate provides:
 *
 *   • a per-session min-entropy BIT BUDGET caps recoverable hypotheses to 2^B,
 *     guaranteeing a residual candidate set of ≥ |S|/2^B no matter how cleverly
 *     the adversary probes (this is QIF composition, not differential privacy);
 *   • an ANOMALY signal — a burst of high-information (narrow) predicates is an
 *     extraction fingerprint that a benign workload does not produce.
 *
 * Pure and deterministic: strategies are fixed, the secret is passed in. No
 * randomness, so the figures are reproducible.
 */
import { log2 } from "./meter";

export type Strategy = "binary" | "equality";

export interface ProbeStep {
  q: number; // query index (1-based)
  /** Remaining candidate count consistent with all answers so far. */
  support: number;
  /** Cumulative min-entropy leakage L∞ = log2(|S| / support). */
  minEntLeak: number;
  /** Information of THIS probe = log2(supportBefore / supportAfter). */
  probeBits: number;
  /** True once support == 1 (secret pinned). */
  recovered: boolean;
  /** True on the step the bit budget refused further egress. */
  budgetHalted?: boolean;
}

export interface ExtractionRun {
  strategy: Strategy;
  N: number;
  budgetBits: number;
  steps: ProbeStep[];
  /** Queries until the secret was pinned (or the budget halted extraction). */
  queries: number;
  recovered: boolean;
  /** Residual candidate set when the run ended (1 iff recovered). */
  residualSupport: number;
  /** log2(N) — the information-theoretic floor for full recovery. */
  floorQueries: number;
}

/**
 * Simulate adaptive extraction of a secret in [0, N) through a decision channel.
 *
 *   "binary"   — each probe is the balanced predicate `secret <= mid` over the
 *                current interval: ~1 bit each, log2(N) queries to full recovery.
 *   "equality" — each probe is `secret == guess` (the lopsided predicate DEMO 1
 *                warned about): mostly 0-information "no"s, but a "yes" pins the
 *                whole secret in one crossing. Worst case N-1 queries; the point
 *                is that a single boolean CAN carry log2(N) bits.
 *
 * With `budgetBits < log2(N)`, egress is refused once cumulative min-entropy
 * leakage reaches the budget: the run halts with residual support ≥ N/2^budget.
 */
export function simulateExtraction(opts: {
  N: number;
  secret: number;
  strategy?: Strategy;
  budgetBits?: number;
}): ExtractionRun {
  const { N, secret } = opts;
  const strategy = opts.strategy ?? "binary";
  const budgetBits = opts.budgetBits ?? Infinity;
  const steps: ProbeStep[] = [];

  // Posterior support as an explicit set is O(N); we track it structurally.
  // binary: an interval [lo, hi]. equality: a shrinking "not yet excluded" count.
  let lo = 0;
  let hi = N - 1;
  let support = N;
  let guess = 0; // for equality strategy
  let q = 0;
  let recovered = false;

  while (support > 1) {
    q++;
    const before = support;
    if (strategy === "binary") {
      const mid = Math.floor((lo + hi) / 2);
      if (secret <= mid) hi = mid;
      else lo = mid + 1;
      support = hi - lo + 1;
    } else {
      // equality: probe `secret == guess`
      if (secret === guess) {
        support = 1;
      } else {
        // "no" excludes exactly one candidate
        support = before - 1;
        guess++;
        if (guess === secret && support === 1) support = 1;
      }
    }
    const minEntLeak = log2(N / support);
    const probeBits = log2(before / support);
    // Budget check: refuse egress once we'd exceed the budget.
    if (minEntLeak > budgetBits) {
      // Roll back this probe's disclosure — the gate would have refused it.
      support = before;
      steps.push({
        q,
        support,
        minEntLeak: log2(N / support),
        probeBits: 0,
        recovered: false,
        budgetHalted: true,
      });
      break;
    }
    recovered = support === 1;
    steps.push({ q, support, minEntLeak, probeBits, recovered });
    if (recovered) break;
    if (strategy === "equality" && q > N + 2) break; // safety
  }

  return {
    strategy,
    N,
    budgetBits: Number.isFinite(budgetBits) ? budgetBits : log2(N),
    steps,
    queries: steps.length,
    recovered,
    residualSupport: support,
    floorQueries: Math.ceil(log2(N)),
  };
}

/**
 * Anomaly detection: a benign workload asks a handful of LOW-information
 * questions ("how many open PRs"); an extraction attack asks a BURST of
 * HIGH-information ones (each narrowing the secret sharply). Score = fraction of
 * probes above a per-probe information threshold. A benign session scores ~0; a
 * binary-search extraction scores ~1.
 */
export function anomalyScore(probeBitsSeries: number[], perProbeThreshold = 0.5): number {
  if (probeBitsSeries.length === 0) return 0;
  const hot = probeBitsSeries.filter((b) => b >= perProbeThreshold).length;
  return hot / probeBitsSeries.length;
}

/** The min-entropy budget's guarantee, stated numerically: residual ≥ N/2^B. */
export function residualGuarantee(N: number, budgetBits: number): number {
  return N / 2 ** budgetBits;
}
