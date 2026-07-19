# glove-egress

## 0.2.0

### Minor Changes

- [#41](https://github.com/porkytheblack/glove/pull/41) [`34773d2`](https://github.com/porkytheblack/glove/commit/34773d2a31ce79936365b36e9f9dc3109f7bb3be) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New package **glove-egress** — turn the one-eval-tool sandbox→context boundary
  into an _exfiltration_ boundary, and measure it.

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

### Patch Changes

- Updated dependencies [[`ae39b72`](https://github.com/porkytheblack/glove/commit/ae39b725b244e147999e71d416a74447ca1b2169), [`7b4aa99`](https://github.com/porkytheblack/glove/commit/7b4aa9912c23540e5a91a6f3b2047b826de65297), [`618528a`](https://github.com/porkytheblack/glove/commit/618528a4d135b35830c0ccf7176f9c22e1913be0)]:
  - glove-scratchpad@2.0.0
