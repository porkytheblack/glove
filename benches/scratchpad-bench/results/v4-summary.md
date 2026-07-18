# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/98 | 0 | 0.0009 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 2.7k | 9.2k/393 | 0 | 0.0022 |
| merged-prs-open-linear | scratchpad | ✅ | 7 | 6 | 3.9k | 19.2k/995 | 0 | 0.0047 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/136 | 0 | 0.0009 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.1k | 3.9k/148 | 0 | 0.0009 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.7k | 11.5k/619 | 0 | 0.0028 |
| compose-verify-issues | scratchpad | ✅ | 8 | 7 | 3.5k | 21.4k/861 | 0 | 0.0052 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/134 | 0 | 0.0003 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/361 | 0 | 0.0005 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.4k | 5.9k/939 | 0 | 0.0007 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/215 | 0 | 0.0004 |
| high-urgency-triggered | scratchpad | ✅ | 4 | 3 | 1.9k | 7.2k/406 | 0 | 0.0006 |
| email-top-error | scratchpad | ✅ | 3 | 2 | 2.0k | 5.4k/411 | 0 | 0.0005 |
| compose-verify-issues | scratchpad | ✅ | 6 | 5 | 2.3k | 12.1k/659 | 0 | 0.0010 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.9k | 3.6k/102 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.1k | 5.8k/260 | 0 | 0.0007 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.6k | 6.5k/573 | 0 | 0.0008 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.1k | 5.8k/172 | 0 | 0.0007 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.0k | 3.7k/173 | 0 | 0.0004 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.3k | 8.1k/328 | 0 | 0.0009 |
| compose-verify-issues | scratchpad | ✅ | 8 | 8 | 3.3k | 19.9k/785 | 0 | 0.0023 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/114 | 0 | 0.0005 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/177 | 0 | 0.0005 |
| merged-prs-open-linear | scratchpad | ✅ | 2 | 1 | 2.0k | 3.7k/382 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.9k | 5.4k/229 | 0 | 0.0008 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/189 | 0 | 0.0005 |
| email-top-error | scratchpad | ✅ | 3 | 2 | 1.9k | 5.4k/500 | 0 | 0.0009 |
| compose-verify-issues | scratchpad | ❌ | 20 | 19 | 5.3k | 70.0k/3.3k | 0 | 0.0100 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.5k | 2.9k/117 | 0 | 0.0013 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.7k | 4.8k/273 | 0 | 0.0023 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.1k | 5.3k/519 | 0 | 0.0030 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/313 | 0 | 0.0024 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/260 | 0 | 0.0023 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 1.9k | 6.6k/471 | 0 | 0.0034 |
| compose-verify-issues | scratchpad | ✅ | 4 | 3 | 2.0k | 7.2k/539 | 0 | 0.0038 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 97% | 3.9 | 2.9 | 2.2k | 8.6k | 460 | 0.00 | 0.0017 |
