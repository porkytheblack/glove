# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (4 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.3k | 4.2k/58 | 0 | 0.0010 |
| sentry-billing-unresolved | both | ✅ | 3 | 2 | 2.6k | 7.0k/243 | 0 | 0.0017 |
| merged-prs-open-linear | both | ✅ | 6 | 5 | 3.7k | 17.1k/905 | 0 | 0.0042 |
| busiest-assignee | both | ✅ | 2 | 1 | 2.3k | 4.5k/148 | 0 | 0.0011 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.4k | 4.3k/110 | 0 | 0.0010 |
| email-top-error | both | ✅ | 6 | 5 | 3.2k | 16.1k/731 | 0 | 0.0039 |
| compose-verify-issues | both | ✅ | 6 | 5 | 3.7k | 17.5k/685 | 0 | 0.0043 |
| incident-branch | both | ✅ | 3 | 2 | 2.7k | 7.1k/278 | 0 | 0.0017 |
| open-prs-breakdown | both | ✅ | 10 | 9 | 3.8k | 29.9k/1.1k | 0 | 0.0072 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.0k | 3.9k/203 | 0 | 0.0003 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.1k | 4.0k/548 | 0 | 0.0005 |
| merged-prs-open-linear | both | ✅ | 5 | 4 | 2.7k | 11.5k/1.6k | 0 | 0.0013 |
| busiest-assignee | both | ✅ | 3 | 2 | 2.2k | 6.2k/783 | 0 | 0.0007 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.1k | 4.0k/291 | 0 | 0.0004 |
| email-top-error | both | ✅ | 3 | 2 | 2.2k | 6.1k/392 | 0 | 0.0005 |
| compose-verify-issues | both | ✅ | 4 | 3 | 2.6k | 8.9k/1.0k | 0 | 0.0009 |
| incident-branch | both | ❌ | 3 | 2 | 2.3k | 6.5k/1.0k | 0 | 0.0008 |
| open-prs-breakdown | both | ❌ | 3 | 2 | 2.3k | 6.3k/402 | 0 | 0.0005 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.2k | 4.3k/171 | 0 | 0.0005 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.3k | 4.3k/194 | 0 | 0.0005 |
| merged-prs-open-linear | both | ✅ | 4 | 3 | 3.3k | 10.5k/926 | 0 | 0.0014 |
| busiest-assignee | both | ✅ | 3 | 2 | 2.4k | 6.8k/214 | 0 | 0.0008 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.2k | 4.3k/162 | 0 | 0.0005 |
| email-top-error | both | ✅ | 3 | 2 | 2.4k | 6.8k/532 | 0 | 0.0009 |
| compose-verify-issues | both | ✅ | 5 | 5 | 2.8k | 12.3k/606 | 0 | 0.0015 |
| incident-branch | both | ✅ | 3 | 2 | 2.5k | 6.9k/317 | 0 | 0.0008 |
| open-prs-breakdown | both | ✅ | 4 | 3 | 2.7k | 9.8k/702 | 0 | 0.0012 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.0k | 3.9k/120 | 0 | 0.0005 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.1k | 4.0k/190 | 0 | 0.0006 |
| merged-prs-open-linear | both | ✅ | 2 | 1 | 2.3k | 4.2k/360 | 0 | 0.0007 |
| busiest-assignee | both | ✅ | 2 | 1 | 2.0k | 4.0k/173 | 0 | 0.0006 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.0k | 4.0k/219 | 0 | 0.0006 |
| email-top-error | both | ✅ | 3 | 2 | 2.3k | 6.4k/538 | 0 | 0.0010 |
| compose-verify-issues | both | ✅ | 6 | 5 | 4.6k | 18.2k/1.5k | 0 | 0.0029 |
| incident-branch | both | ✅ | 3 | 2 | 2.5k | 6.9k/519 | 0 | 0.0011 |
| open-prs-breakdown | both | ✅ | 5 | 4 | 2.4k | 10.7k/489 | 0 | 0.0015 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 1.7k | 3.3k/105 | 0 | 0.0015 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 1.8k | 3.4k/225 | 0 | 0.0017 |
| merged-prs-open-linear | both | ✅ | 3 | 2 | 2.1k | 5.4k/479 | 0 | 0.0030 |
| busiest-assignee | both | ✅ | 3 | 2 | 2.0k | 5.4k/245 | 0 | 0.0025 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 1.7k | 3.4k/186 | 0 | 0.0016 |
| email-top-error | both | ✅ | 3 | 2 | 1.9k | 5.3k/446 | 0 | 0.0029 |
| compose-verify-issues | both | ✅ | 4 | 4 | 2.7k | 9.0k/565 | 0 | 0.0045 |
| incident-branch | both | ✅ | 3 | 2 | 2.0k | 5.6k/466 | 0 | 0.0030 |
| open-prs-breakdown | both | ✅ | 3 | 3 | 2.1k | 5.6k/428 | 0 | 0.0030 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 1.7k | 3.3k/106 | 0 | 0.0028 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 1.8k | 3.4k/229 | 0 | 0.0033 |
| merged-prs-open-linear | both | ✅ | 3 | 2 | 2.3k | 5.8k/533 | 0 | 0.0062 |
| busiest-assignee | both | ✅ | 3 | 2 | 2.0k | 5.6k/233 | 0 | 0.0049 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 1.8k | 3.4k/209 | 0 | 0.0032 |
| email-top-error | both | ✅ | 3 | 2 | 1.9k | 5.3k/288 | 0 | 0.0049 |
| compose-verify-issues | both | ✅ | 4 | 3 | 2.8k | 9.2k/521 | 0 | 0.0086 |
| incident-branch | both | ✅ | 3 | 2 | 1.9k | 5.4k/278 | 0 | 0.0050 |
| open-prs-breakdown | both | ✅ | 3 | 3 | 2.1k | 5.7k/371 | 0 | 0.0055 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.0k | 3.9k/121 | 0 | 0.0026 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.1k | 4.0k/209 | 0 | 0.0028 |
| merged-prs-open-linear | both | ✅ | 3 | 3 | 2.6k | 6.8k/792 | 0 | 0.0056 |
| busiest-assignee | both | ✅ | 2 | 1 | 2.0k | 3.9k/169 | 0 | 0.0027 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.0k | 4.0k/278 | 0 | 0.0029 |
| email-top-error | both | ✅ | 3 | 2 | 2.2k | 6.3k/427 | 0 | 0.0046 |
| compose-verify-issues | both | ✅ | 5 | 4 | 3.0k | 12.8k/542 | 0 | 0.0087 |
| incident-branch | both | ✅ | 3 | 2 | 2.2k | 6.3k/373 | 0 | 0.0045 |
| open-prs-breakdown | both | ✅ | 4 | 4 | 2.4k | 8.7k/529 | 0 | 0.0063 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.2k | 4.3k/99 | 0 | 0.0014 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.4k | 4.5k/345 | 0 | 0.0018 |
| merged-prs-open-linear | both | ✅ | 2 | 1 | 2.5k | 4.6k/524 | 0 | 0.0020 |
| busiest-assignee | both | ✅ | 2 | 1 | 2.3k | 4.4k/187 | 0 | 0.0016 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.3k | 4.4k/146 | 0 | 0.0015 |
| email-top-error | both | ✅ | 3 | 2 | 2.7k | 7.3k/709 | 0 | 0.0031 |
| compose-verify-issues | both | ✅ | 3 | 3 | 2.9k | 7.7k/373 | 0 | 0.0028 |
| incident-branch | both | ✅ | 4 | 4 | 3.2k | 10.8k/2.0k | 0 | 0.0057 |
| open-prs-breakdown | both | ✅ | 2 | 1 | 2.3k | 4.5k/195 | 0 | 0.0016 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.2k | 4.3k/132 | 0 | 0.0004 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.3k | 4.4k/205 | 0 | 0.0004 |
| merged-prs-open-linear | both | ✅ | 4 | 4 | 3.4k | 11.4k/847 | 0 | 0.0012 |
| busiest-assignee | both | ✅ | 3 | 2 | 2.5k | 7.0k/251 | 0 | 0.0007 |
| high-urgency-triggered | both | ✅ | 3 | 2 | 2.4k | 6.8k/299 | 0 | 0.0007 |
| email-top-error | both | ✅ | 5 | 4 | 2.9k | 12.7k/662 | 0 | 0.0013 |
| compose-verify-issues | both | ✅ | 4 | 4 | 4.1k | 12.1k/1.4k | 0 | 0.0013 |
| incident-branch | both | ✅ | 3 | 2 | 2.7k | 7.3k/421 | 0 | 0.0007 |
| open-prs-breakdown | both | ✅ | 4 | 3 | 2.8k | 9.9k/461 | 0 | 0.0010 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.0k | 3.9k/35 | 0 | 0.0002 |
| sentry-billing-unresolved | both | ❌ | 2 | 1 | 2.1k | 4.0k/114 | 0 | 0.0002 |
| merged-prs-open-linear | both | ✅ | 2 | 1 | 2.4k | 4.3k/297 | 0 | 0.0003 |
| busiest-assignee | both | ✅ | 2 | 1 | 2.0k | 3.9k/74 | 0 | 0.0002 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.0k | 4.0k/90 | 0 | 0.0002 |
| email-top-error | both | ✅ | 3 | 2 | 2.2k | 6.2k/167 | 0 | 0.0003 |
| compose-verify-issues | both | ✅ | 3 | 2 | 2.3k | 6.3k/154 | 0 | 0.0003 |
| incident-branch | both | ✅ | 2 | 1 | 2.2k | 4.2k/178 | 0 | 0.0002 |
| open-prs-breakdown | both | ❌ | 15 | 15 | 3.9k | 44.1k/1.5k | 0 | 0.0025 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | both | ✅ | 2 | 1 | 2.0k | 3.9k/540 | 0 | 0.0007 |
| sentry-billing-unresolved | both | ✅ | 2 | 1 | 2.1k | 4.0k/1.6k | 0 | 0.0012 |
| merged-prs-open-linear | both | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| busiest-assignee | both | ✅ | 2 | 1 | 2.0k | 3.9k/2.2k | 0 | 0.0015 |
| high-urgency-triggered | both | ✅ | 2 | 1 | 2.1k | 4.0k/1.0k | 0 | 0.0009 |
| email-top-error | both | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| compose-verify-issues | both | ✅ | 4 | 3 | 2.4k | 8.6k/4.9k | 0 | 0.0032 |
| incident-branch | both | ❌ | 2 | 1 | 2.2k | 4.2k/4.4k | 0 | 0.0025 |
| open-prs-breakdown | both | ❌ | 2 | 2 | 2.1k | 4.0k/2.8k | 0 | 0.0017 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| both | 92% | 3.0 | 2.2 | 2.4k | 6.9k | 576 | 0.00 | 0.0021 |
