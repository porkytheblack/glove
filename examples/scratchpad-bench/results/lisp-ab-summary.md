# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/81 | 0 | 0.0010 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.3k | 4.3k/247 | 0 | 0.0011 |
| merged-prs-open-linear | lisp | ✅ | 10 | 9 | 3.5k | 26.3k/1.2k | 0 | 0.0064 |
| busiest-assignee | lisp | ✅ | 21 | 20 | 4.8k | 72.4k/1.7k | 0 | 0.0172 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/251 | 0 | 0.0010 |
| email-top-error | lisp | ❌ | 7 | 6 | 3.3k | 19.0k/731 | 0 | 0.0046 |
| compose-verify-issues | lisp | ✅ | 12 | 11 | 4.6k | 40.2k/1.3k | 0 | 0.0097 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.8k | 3.6k/106 | 0 | 0.0003 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/804 | 0 | 0.0005 |
| merged-prs-open-linear | lisp | ❌ | 4 | 3 | 7.6k | 21.6k/485 | 0 | 0.0015 |
| busiest-assignee | lisp | ❌ | 3 | 2 | 2.2k | 6.0k/568 | 0 | 0.0006 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.0k | 5.7k/346 | 0 | 0.0005 |
| email-top-error | lisp | ❌ | 10 | 9 | 3.0k | 24.4k/2.1k | 0 | 0.0023 |
| compose-verify-issues | lisp | ❌ | 6 | 5 | 3.0k | 13.9k/946 | 0 | 0.0012 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/161 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.3k | 6.4k/280 | 0 | 0.0008 |
| merged-prs-open-linear | lisp | ✅ | 10 | 9 | 4.4k | 31.9k/1.8k | 0 | 0.0039 |
| busiest-assignee | lisp | ✅ | 7 | 6 | 3.0k | 18.4k/597 | 0 | 0.0021 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.2k | 4.2k/201 | 0 | 0.0005 |
| email-top-error | lisp | ❌ | 2 | 1 | 2.2k | 4.1k/260 | 0 | 0.0005 |
| compose-verify-issues | lisp | ✅ | 6 | 6 | 3.1k | 15.3k/772 | 0 | 0.0018 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/120 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.8k | 7.2k/326 | 0 | 0.0010 |
| merged-prs-open-linear | lisp | ✅ | 6 | 5 | 4.8k | 19.8k/843 | 0 | 0.0028 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 2.9k | 14.0k/906 | 0 | 0.0021 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.0k | 3.8k/266 | 0 | 0.0006 |
| email-top-error | lisp | ✅ | 4 | 3 | 2.6k | 8.7k/737 | 0 | 0.0014 |
| compose-verify-issues | lisp | ❌ | 11 | 10 | 7.6k | 42.5k/4.6k | 0 | 0.0073 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.7k | 3.3k/129 | 0 | 0.0015 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 1.8k | 3.4k/299 | 0 | 0.0019 |
| merged-prs-open-linear | lisp | ✅ | 5 | 4 | 2.5k | 10.4k/949 | 0 | 0.0058 |
| busiest-assignee | lisp | ✅ | 7 | 6 | 2.5k | 14.7k/719 | 0 | 0.0069 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.7k | 3.4k/234 | 0 | 0.0017 |
| email-top-error | lisp | ✅ | 3 | 2 | 1.8k | 5.2k/602 | 0 | 0.0032 |
| compose-verify-issues | lisp | ✅ | 8 | 7 | 4.1k | 19.8k/678 | 0 | 0.0088 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.7k | 3.3k/89 | 0 | 0.0027 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 1.8k | 3.4k/183 | 0 | 0.0031 |
| merged-prs-open-linear | lisp | ✅ | 7 | 6 | 3.0k | 16.1k/1.3k | 0 | 0.0163 |
| busiest-assignee | lisp | ✅ | 8 | 7 | 3.0k | 19.6k/570 | 0 | 0.0165 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.7k | 3.4k/225 | 0 | 0.0033 |
| email-top-error | lisp | ✅ | 5 | 4 | 2.4k | 10.1k/479 | 0 | 0.0091 |
| compose-verify-issues | lisp | ✅ | 5 | 4 | 2.6k | 10.6k/656 | 0 | 0.0101 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.8k | 3.6k/150 | 0 | 0.0025 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/286 | 0 | 0.0028 |
| merged-prs-open-linear | lisp | ✅ | 2 | 1 | 2.1k | 4.0k/479 | 0 | 0.0033 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 2.5k | 13.1k/705 | 0 | 0.0092 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/225 | 0 | 0.0027 |
| email-top-error | lisp | ✅ | 4 | 3 | 2.3k | 8.4k/493 | 0 | 0.0060 |
| compose-verify-issues | lisp | ✅ | 7 | 6 | 4.1k | 18.6k/779 | 0 | 0.0126 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/56 | 0 | 0.0013 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.2k | 6.4k/268 | 0 | 0.0022 |
| merged-prs-open-linear | lisp | ✅ | 10 | 9 | 4.0k | 28.4k/1.2k | 0 | 0.0100 |
| busiest-assignee | lisp | ✅ | 14 | 13 | 3.8k | 41.7k/1.2k | 0 | 0.0139 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.2k | 4.2k/212 | 0 | 0.0015 |
| email-top-error | lisp | ❌ | 5 | 4 | 2.7k | 12.1k/508 | 0 | 0.0042 |
| compose-verify-issues | lisp | ✅ | 6 | 5 | 4.2k | 16.9k/482 | 0 | 0.0056 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/120 | 0 | 0.0004 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.5k | 9.1k/363 | 0 | 0.0009 |
| merged-prs-open-linear | lisp | ✅ | 13 | 14 | 4.3k | 40.8k/2.4k | 0 | 0.0041 |
| busiest-assignee | lisp | ✅ | 8 | 7 | 3.3k | 20.8k/1.1k | 0 | 0.0021 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.5k | 6.7k/308 | 0 | 0.0007 |
| email-top-error | lisp | ✅ | 13 | 13 | 4.6k | 45.4k/3.0k | 0 | 0.0046 |
| compose-verify-issues | lisp | ✅ | 9 | 9 | 4.7k | 30.8k/2.3k | 0 | 0.0032 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.8k | 3.6k/34 | 0 | 0.0002 |
| sentry-billing-unresolved | lisp | ❌ | 2 | 1 | 1.9k | 3.7k/129 | 0 | 0.0002 |
| merged-prs-open-linear | lisp | ❌ | 2 | 1 | 2.2k | 4.0k/411 | 0 | 0.0003 |
| busiest-assignee | lisp | ✅ | 24 | 23 | 6.4k | 93.7k/3.8k | 0 | 0.0054 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/130 | 0 | 0.0002 |
| email-top-error | lisp | ✅ | 6 | 5 | 2.7k | 13.0k/681 | 0 | 0.0008 |
| compose-verify-issues | lisp | ❌ | 2 | 1 | 2.4k | 4.2k/163 | 0 | 0.0002 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.8k | 3.6k/543 | 0 | 0.0007 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.0k | 5.6k/6.2k | 0 | 0.0035 |
| merged-prs-open-linear | lisp | ❌ | 5 | 4 | 2.4k | 10.5k/6.2k | 0 | 0.0040 |
| busiest-assignee | lisp | ERR | 3 | 3 | 2.2k | 6.2k/8.5k | 0 | 0.0046 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/3.6k | 0 | 0.0021 |
| email-top-error | lisp | ❌ | 2 | 1 | 2.0k | 3.8k/3.8k | 0 | 0.0022 |
| compose-verify-issues | lisp | ❌ | 4 | 3 | 2.6k | 8.7k/5.5k | 0 | 0.0035 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| lisp | 81% | 5.1 | 4.2 | 2.8k | 13.7k | 1.1k | 0.00 | 0.0037 |
