---
"glove-egress": minor
---

New package **glove-egress** — turn the one-eval-tool sandbox→context boundary
into an *exfiltration* boundary, and measure it.

- **QIF metering** — Shannon self-information (throughput headline), min-entropy
  leakage and g-leakage (the security-grounded rulers), and a `BoundaryMeter`
  that scores every crossing against a canary set (empirical extraction, the
  operational ground truth).
- **An enforced egress gate** — `egressFns` (a return-whitelist of
  assert/count/choose/bucket/report decisions, the last redacting credential/PII
  tokens), a per-session min-entropy bit budget, and `guardEffectFns` (an
  outbound-effect recipient/secret-shape allowlist). The combinators are ordinary
  `glove-scratchpad` `ToolFn`s, so they mount on any REPL surface.
- **A red-team simulation** — `simulateExtraction` / `anomalyScore` /
  `residualGuarantee`: how fast a boolean channel leaks a secret and how a bit
  budget bounds it (QIF composition, not differential privacy).

Extracted from the exfiltration study in `benches/scratchpad-bench`
(`EXFIL-PAPER.md`), which now consumes it.
