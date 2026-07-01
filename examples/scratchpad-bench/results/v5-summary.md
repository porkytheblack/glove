# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/103 | 0 | 0.0009 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 2.7k | 9.2k/394 | 0 | 0.0023 |
| merged-prs-open-linear | scratchpad | ✅ | 5 | 4 | 3.6k | 12.9k/866 | 0 | 0.0032 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.3k | 6.2k/286 | 0 | 0.0015 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 2.3k | 6.2k/294 | 0 | 0.0015 |
| email-top-error | scratchpad | ✅ | 6 | 5 | 3.0k | 14.5k/652 | 0 | 0.0036 |
| compose-verify-issues | scratchpad | ✅ | 9 | 8 | 4.1k | 26.9k/876 | 0 | 0.0065 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/121 | 0 | 0.0002 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.9k | 5.4k/1.1k | 0 | 0.0007 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.1k | 5.4k/805 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/748 | 0 | 0.0006 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/365 | 0 | 0.0005 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.1k | 9.5k/699 | 0 | 0.0009 |
| compose-verify-issues | scratchpad | ✅ | 7 | 6 | 2.4k | 14.3k/1.1k | 0 | 0.0013 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.9k | 3.6k/87 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.1k | 5.8k/253 | 0 | 0.0007 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.7k | 6.6k/600 | 0 | 0.0009 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.1k | 5.8k/180 | 0 | 0.0007 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 2.1k | 5.7k/227 | 0 | 0.0007 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.2k | 8.1k/478 | 0 | 0.0010 |
| compose-verify-issues | scratchpad | ✅ | 5 | 5 | 2.8k | 11.8k/718 | 0 | 0.0014 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/111 | 0 | 0.0005 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/208 | 0 | 0.0005 |
| merged-prs-open-linear | scratchpad | ✅ | 2 | 1 | 2.0k | 3.6k/401 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.9k | 5.4k/258 | 0 | 0.0008 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/189 | 0 | 0.0005 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.1k | 9.5k/734 | 0 | 0.0015 |
| compose-verify-issues | scratchpad | ✅ | 9 | 8 | 3.1k | 20.4k/955 | 0 | 0.0029 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.5k | 2.9k/116 | 0 | 0.0013 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.7k | 4.8k/298 | 0 | 0.0024 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.2k | 5.4k/504 | 0 | 0.0030 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/254 | 0 | 0.0023 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/253 | 0 | 0.0023 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 1.9k | 6.6k/526 | 0 | 0.0036 |
| compose-verify-issues | scratchpad | ✅ | 5 | 5 | 2.7k | 10.9k/617 | 0 | 0.0053 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 100% | 3.7 | 2.8 | 2.2k | 7.6k | 468 | 0.00 | 0.0016 |
