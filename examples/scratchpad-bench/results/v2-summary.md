# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/94 | 0 | 0.0008 |
| sentry-billing-unresolved | scratchpad | ✅ | 5 | 4 | 3.3k | 12.9k/523 | 0 | 0.0031 |
| merged-prs-open-linear | scratchpad | ✅ | 9 | 8 | 4.5k | 24.6k/1.2k | 0 | 0.0060 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.1k | 5.5k/289 | 0 | 0.0014 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 2.2k | 5.6k/359 | 0 | 0.0014 |
| email-top-error | scratchpad | ✅ | 6 | 5 | 2.7k | 13.0k/691 | 0 | 0.0032 |
| compose-verify-issues | scratchpad | ✅ | 8 | 7 | 3.7k | 21.5k/902 | 0 | 0.0052 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 3 | 2 | 1.6k | 4.4k/181 | 0 | 0.0003 |
| sentry-billing-unresolved | scratchpad | ❌ | 3 | 2 | 1.8k | 4.8k/1.3k | 0 | 0.0008 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.2k | 5.4k/756 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ❌ | 2 | 1 | 1.5k | 2.9k/242 | 0 | 0.0003 |
| high-urgency-triggered | scratchpad | ❌ | 3 | 2 | 1.6k | 4.6k/327 | 0 | 0.0004 |
| email-top-error | scratchpad | ❌ | 4 | 3 | 2.0k | 7.2k/534 | 0 | 0.0006 |
| compose-verify-issues | scratchpad | ✅ | 8 | 7 | 2.2k | 15.0k/982 | 0 | 0.0013 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.6k | 3.2k/93 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.9k | 5.2k/299 | 0 | 0.0006 |
| merged-prs-open-linear | scratchpad | ✅ | 4 | 3 | 2.4k | 7.9k/577 | 0 | 0.0010 |
| busiest-assignee | scratchpad | ✅ | 5 | 4 | 2.2k | 9.3k/432 | 0 | 0.0011 |
| high-urgency-triggered | scratchpad | ✅ | 5 | 4 | 2.4k | 9.5k/530 | 0 | 0.0011 |
| email-top-error | scratchpad | ❌ | 5 | 4 | 2.1k | 9.2k/386 | 0 | 0.0011 |
| compose-verify-issues | scratchpad | ✅ | 6 | 6 | 2.7k | 13.3k/1.0k | 0 | 0.0017 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.5k | 2.9k/123 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 1.6k | 3.0k/203 | 0 | 0.0005 |
| merged-prs-open-linear | scratchpad | ✅ | 8 | 7 | 2.9k | 17.1k/1.0k | 0 | 0.0025 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/267 | 0 | 0.0007 |
| high-urgency-triggered | scratchpad | ❌ | 2 | 1 | 1.5k | 2.9k/195 | 0 | 0.0004 |
| email-top-error | scratchpad | ❌ | 4 | 3 | 1.9k | 6.7k/465 | 0 | 0.0010 |
| compose-verify-issues | scratchpad | ✅ | 4 | 3 | 2.8k | 8.1k/903 | 0 | 0.0014 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 3 | 2 | 1.5k | 4.1k/189 | 0 | 0.0019 |
| sentry-billing-unresolved | scratchpad | ❌ | 3 | 2 | 1.7k | 4.3k/408 | 0 | 0.0024 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.0k | 4.9k/628 | 0 | 0.0031 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.5k | 4.1k/268 | 0 | 0.0021 |
| high-urgency-triggered | scratchpad | ❌ | 3 | 2 | 1.5k | 4.0k/223 | 0 | 0.0020 |
| email-top-error | scratchpad | ❌ | 4 | 3 | 1.6k | 5.8k/844 | 0 | 0.0039 |
| compose-verify-issues | scratchpad | ✅ | 6 | 7 | 2.9k | 12.7k/942 | 0 | 0.0067 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 71% | 4.1 | 3.2 | 2.1k | 7.8k | 525 | 0.00 | 0.0018 |
