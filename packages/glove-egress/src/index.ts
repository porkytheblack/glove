/**
 * `glove-egress` — turn the one-eval-tool sandbox→context boundary into an
 * exfiltration boundary, and measure it.
 *
 * Three layers, all framework-agnostic (they build on `glove-scratchpad/fns`):
 *
 *   • {@link ./meter} — Quantitative Information Flow metering. Shannon
 *     self-information (a throughput headline), min-entropy leakage and g-leakage
 *     (the security-grounded rulers), and a {@link BoundaryMeter} that records
 *     every value crossing the boundary and scores it against a canary set
 *     (empirical extraction — the operational ground truth).
 *
 *   • {@link ./gate} — the ENFORCED egress gate. A return-whitelist of decision
 *     combinators ({@link egressFns}: assert / count / choose / bucket / report,
 *     the last redacting credential/PII tokens), a per-session min-entropy bit
 *     budget, and an outbound-effect allowlist ({@link guardEffectFns}). Mount
 *     the combinators on any REPL surface; only decisions leave the sandbox.
 *
 *   • {@link ./redteam} — an adaptive-extraction simulation: how many queries a
 *     boolean/assertion channel leaks a secret in, and how a bit budget bounds it
 *     (QIF composition, not differential privacy).
 *
 * See `benches/scratchpad-bench/EXFIL-PAPER.md` for the study that motivated it.
 */
export {
  log2,
  selfInfo,
  charEntropyBitsPerChar,
  contentBits,
  serialize,
  minEntropyLeak,
  gLeak,
  BoundaryMeter,
  type Channel,
  type Crossing,
  type CanarySpec,
  type BoundaryReport,
} from "./meter";

export {
  isDecision,
  looksSecret,
  redactSecrets,
  egressFns,
  guardEffectFns,
  newLedger,
  DEFAULT_EGRESS_POLICY,
  type Decision,
  type EgressPolicy,
  type GateLedger,
} from "./gate";

export {
  simulateExtraction,
  anomalyScore,
  residualGuarantee,
  type Strategy,
  type ProbeStep,
  type ExtractionRun,
} from "./redteam";
