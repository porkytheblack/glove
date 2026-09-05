# glove-site

## 3.0.2

### Patch Changes

- Updated dependencies []:
  - glove-react@4.0.1

## 3.0.1

### Patch Changes

- Report the exact model-token consumption for a compaction request on the
  `compaction_end` subscriber event, including provider-reported prompt-cache
  reads and writes. Consumers no longer need to infer compaction usage from the
  cumulative pre-compaction context counter, which can double-count earlier
  requests when used for billing.
- Updated dependencies [[`866e30b`](https://github.com/porkytheblack/glove/commit/866e30bb791a0d8459f31e6ecff8cb95b025316d)]:
  - glove-react@4.0.0
