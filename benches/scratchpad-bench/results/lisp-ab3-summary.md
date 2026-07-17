# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.3k/57 | 0 | 0.0010 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.4k | 4.6k/202 | 0 | 0.0011 |
| merged-prs-open-linear | lisp | ✅ | 6 | 5 | 3.4k | 16.7k/889 | 0 | 0.0041 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 3.0k | 16.2k/453 | 0 | 0.0039 |
| high-urgency-triggered | lisp | ✅ | 4 | 3 | 2.6k | 9.6k/311 | 0 | 0.0023 |
| email-top-error | lisp | ✅ | 8 | 7 | 4.2k | 26.1k/869 | 0 | 0.0063 |
| compose-verify-issues | lisp | ERR | 26 | 25 | 8.6k | 126.9k/3.0k | 1 | 0.0301 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/148 | 0 | 0.0003 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/285 | 0 | 0.0004 |
| merged-prs-open-linear | lisp | ✅ | 5 | 4 | 4.7k | 14.3k/1.7k | 0 | 0.0015 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 2.5k | 11.6k/804 | 0 | 0.0010 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/266 | 0 | 0.0004 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.4k | 6.6k/600 | 0 | 0.0006 |
| compose-verify-issues | lisp | ✅ | 6 | 5 | 3.2k | 14.4k/896 | 0 | 0.0012 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.2k | 4.3k/126 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.5k | 9.5k/292 | 0 | 0.0011 |
| merged-prs-open-linear | lisp | ✅ | 3 | 3 | 3.0k | 7.7k/702 | 0 | 0.0010 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 2.7k | 12.3k/458 | 0 | 0.0014 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.4k | 6.9k/244 | 0 | 0.0008 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.5k | 6.9k/345 | 0 | 0.0008 |
| compose-verify-issues | lisp | ✅ | 5 | 4 | 3.8k | 13.9k/534 | 0 | 0.0016 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/104 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.2k | 6.4k/265 | 0 | 0.0009 |
| merged-prs-open-linear | lisp | ✅ | 3 | 2 | 2.6k | 6.8k/611 | 0 | 0.0011 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.4k | 6.7k/301 | 0 | 0.0009 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.2k | 6.3k/229 | 0 | 0.0009 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.4k | 6.6k/419 | 0 | 0.0010 |
| compose-verify-issues | lisp | ✅ | 6 | 5 | 3.3k | 14.6k/669 | 0 | 0.0021 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/116 | 0 | 0.0016 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.0k | 5.7k/294 | 0 | 0.0027 |
| merged-prs-open-linear | lisp | ✅ | 10 | 9 | 3.6k | 27.6k/1.5k | 0 | 0.0133 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.2k | 6.1k/289 | 0 | 0.0029 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.9k | 3.8k/268 | 0 | 0.0020 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.1k | 5.9k/408 | 0 | 0.0030 |
| compose-verify-issues | lisp | ✅ | 5 | 4 | 2.6k | 11.3k/553 | 0 | 0.0053 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/114 | 0 | 0.0031 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.0k | 3.8k/243 | 0 | 0.0037 |
| merged-prs-open-linear | lisp | ✅ | 3 | 2 | 2.4k | 6.1k/494 | 0 | 0.0063 |
| busiest-assignee | lisp | ✅ | 2 | 1 | 2.0k | 3.8k/247 | 0 | 0.0037 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.0k | 3.8k/220 | 0 | 0.0036 |
| email-top-error | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/273 | 0 | 0.0038 |
| compose-verify-issues | lisp | ✅ | 7 | 6 | 5.4k | 24.0k/453 | 0 | 0.0193 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.1k/128 | 0 | 0.0027 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/175 | 0 | 0.0028 |
| merged-prs-open-linear | lisp | ✅ | 2 | 1 | 2.4k | 4.4k/488 | 0 | 0.0036 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.3k | 6.6k/265 | 0 | 0.0045 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/227 | 0 | 0.0029 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.3k | 6.5k/518 | 0 | 0.0049 |
| compose-verify-issues | lisp | ✅ | 5 | 5 | 3.4k | 13.0k/835 | 0 | 0.0094 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/56 | 0 | 0.0014 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.4k | 7.0k/204 | 0 | 0.0023 |
| merged-prs-open-linear | lisp | ✅ | 21 | 20 | 8.3k | 92.8k/2.1k | 0 | 0.0304 |
| busiest-assignee | lisp | ✅ | 4 | 3 | 2.5k | 9.5k/270 | 0 | 0.0032 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.6k | 4.8k/171 | 0 | 0.0016 |
| email-top-error | lisp | ✅ | 2 | 1 | 2.5k | 4.8k/372 | 0 | 0.0019 |
| compose-verify-issues | lisp | ✅ | 6 | 5 | 3.7k | 16.6k/765 | 0 | 0.0059 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.4k/103 | 0 | 0.0004 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 3.3k | 8.0k/358 | 0 | 0.0008 |
| merged-prs-open-linear | lisp | ✅ | 10 | 10 | 4.0k | 31.7k/2.3k | 0 | 0.0033 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 4.5k | 20.3k/606 | 0 | 0.0019 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.7k | 7.4k/308 | 0 | 0.0007 |
| email-top-error | lisp | ✅ | 4 | 3 | 5.3k | 17.4k/554 | 0 | 0.0017 |
| compose-verify-issues | lisp | ✅ | 9 | 9 | 5.1k | 32.4k/1.1k | 0 | 0.0031 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/34 | 0 | 0.0002 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/148 | 0 | 0.0002 |
| merged-prs-open-linear | lisp | ✅ | 2 | 1 | 2.4k | 4.4k/356 | 0 | 0.0003 |
| busiest-assignee | lisp | ✅ | 8 | 7 | 3.0k | 20.2k/785 | 0 | 0.0012 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.2k | 6.3k/209 | 0 | 0.0004 |
| email-top-error | lisp | ✅ | 4 | 3 | 2.5k | 9.0k/379 | 0 | 0.0005 |
| compose-verify-issues | lisp | ❌ | 2 | 1 | 2.2k | 4.2k/131 | 0 | 0.0002 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/622 | 0 | 0.0008 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.2k | 6.2k/4.7k | 0 | 0.0029 |
| merged-prs-open-linear | lisp | ❌ | 2 | 1 | 2.3k | 4.3k/6.1k | 0 | 0.0033 |
| busiest-assignee | lisp | ERR | 3 | 3 | 2.2k | 6.4k/8.4k | 0 | 0.0046 |
| high-urgency-triggered | lisp | ❌ | 2 | 1 | 2.1k | 4.1k/2.5k | 0 | 0.0016 |
| email-top-error | lisp | ✅ | 2 | 1 | 2.1k | 4.2k/1.1k | 0 | 0.0010 |
| compose-verify-issues | lisp | ✅ | 3 | 2 | 2.5k | 6.8k/4.8k | 0 | 0.0030 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| lisp | 94% | 4.0 | 3.1 | 2.8k | 11.5k | 823 | 0.01 | 0.0033 |
