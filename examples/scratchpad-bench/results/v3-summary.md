# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.9k | 3.7k/98 | 0 | 0.0009 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 2.7k | 9.0k/524 | 0 | 0.0022 |
| merged-prs-open-linear | scratchpad | ✅ | 7 | 6 | 3.8k | 18.1k/1.0k | 0 | 0.0045 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.3k | 6.1k/278 | 0 | 0.0015 |
| high-urgency-triggered | scratchpad | ✅ | 5 | 4 | 2.5k | 10.9k/446 | 0 | 0.0026 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.7k | 11.4k/551 | 0 | 0.0028 |
| compose-verify-issues | scratchpad | ✅ | 8 | 7 | 3.8k | 22.2k/925 | 0 | 0.0054 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 3 | 2 | 1.7k | 5.0k/194 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/323 | 0 | 0.0004 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.5k | 6.2k/1.6k | 0 | 0.0010 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/282 | 0 | 0.0004 |
| high-urgency-triggered | scratchpad | ✅ | 5 | 4 | 1.9k | 8.8k/514 | 0 | 0.0007 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.0k | 7.3k/462 | 0 | 0.0006 |
| compose-verify-issues | scratchpad | ❌ | 2 | 1 | 1.7k | 3.3k/445 | 0 | 0.0004 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.8k | 3.6k/90 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.1k | 5.7k/225 | 0 | 0.0007 |
| merged-prs-open-linear | scratchpad | ✅ | 2 | 1 | 2.2k | 4.0k/712 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.0k | 5.7k/183 | 0 | 0.0007 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.9k | 3.7k/224 | 0 | 0.0004 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.2k | 8.0k/366 | 0 | 0.0009 |
| compose-verify-issues | scratchpad | ✅ | 6 | 6 | 2.7k | 13.5k/540 | 0 | 0.0016 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/111 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.0k | 5.4k/373 | 0 | 0.0008 |
| merged-prs-open-linear | scratchpad | ✅ | 2 | 1 | 2.0k | 3.6k/423 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/248 | 0 | 0.0008 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/209 | 0 | 0.0005 |
| email-top-error | scratchpad | ✅ | 3 | 2 | 1.9k | 5.2k/408 | 0 | 0.0008 |
| compose-verify-issues | scratchpad | ✅ | 5 | 4 | 3.4k | 12.9k/1.2k | 0 | 0.0021 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.5k | 2.9k/123 | 0 | 0.0013 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/291 | 0 | 0.0023 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.2k | 5.3k/792 | 0 | 0.0036 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.7k | 4.6k/281 | 0 | 0.0023 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 1.7k | 4.6k/233 | 0 | 0.0022 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.0k | 8.5k/573 | 0 | 0.0044 |
| compose-verify-issues | scratchpad | ✅ | 4 | 4 | 2.4k | 7.9k/576 | 0 | 0.0041 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 97% | 3.5 | 2.6 | 2.2k | 7.0k | 454 | 0.00 | 0.0016 |
