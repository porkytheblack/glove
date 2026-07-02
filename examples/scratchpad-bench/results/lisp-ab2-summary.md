# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.2k | 4.3k/90 | 0 | 0.0010 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/205 | 0 | 0.0011 |
| merged-prs-open-linear | lisp | ✅ | 12 | 11 | 4.9k | 41.0k/1.7k | 0 | 0.0100 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 3.3k | 16.3k/556 | 0 | 0.0039 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/221 | 0 | 0.0011 |
| email-top-error | lisp | ✅ | 8 | 7 | 3.9k | 24.0k/1.1k | 0 | 0.0059 |
| compose-verify-issues | lisp | ❌ | 15 | 14 | 9.3k | 86.9k/3.2k | 0 | 0.0210 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.9k | 3.8k/165 | 0 | 0.0003 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.1k | 8.1k/1.5k | 0 | 0.0011 |
| merged-prs-open-linear | lisp | ❌ | 4 | 3 | 2.4k | 8.5k/821 | 0 | 0.0008 |
| busiest-assignee | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/236 | 0 | 0.0003 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.2k | 6.2k/389 | 0 | 0.0005 |
| email-top-error | lisp | ❌ | 2 | 1 | 2.2k | 4.1k/528 | 0 | 0.0005 |
| compose-verify-issues | lisp | ❌ | 8 | 7 | 3.1k | 20.3k/5.7k | 0 | 0.0035 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 3 | 2 | 2.5k | 7.0k/227 | 0 | 0.0008 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.4k | 6.7k/306 | 0 | 0.0008 |
| merged-prs-open-linear | lisp | ✅ | 6 | 5 | 3.5k | 16.8k/1.2k | 0 | 0.0021 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 2.7k | 14.6k/608 | 0 | 0.0017 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.4k | 4.4k/424 | 0 | 0.0006 |
| email-top-error | lisp | ✅ | 4 | 3 | 2.6k | 9.5k/512 | 0 | 0.0011 |
| compose-verify-issues | lisp | ✅ | 6 | 6 | 3.4k | 17.1k/920 | 0 | 0.0021 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/121 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.1k | 6.0k/252 | 0 | 0.0008 |
| merged-prs-open-linear | lisp | ✅ | 5 | 4 | 3.2k | 12.5k/912 | 0 | 0.0019 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 2.9k | 14.3k/550 | 0 | 0.0020 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.2k | 4.2k/171 | 0 | 0.0006 |
| email-top-error | lisp | ✅ | 5 | 4 | 2.5k | 11.2k/879 | 0 | 0.0018 |
| compose-verify-issues | lisp | ✅ | 5 | 4 | 3.6k | 12.0k/522 | 0 | 0.0017 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.8k | 3.5k/122 | 0 | 0.0016 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 1.9k | 3.6k/340 | 0 | 0.0020 |
| merged-prs-open-linear | lisp | ❌ | 4 | 3 | 2.7k | 8.7k/5.0k | 0 | 0.0133 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 2.5k | 13.0k/701 | 0 | 0.0063 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/271 | 0 | 0.0019 |
| email-top-error | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/379 | 0 | 0.0022 |
| compose-verify-issues | lisp | ✅ | 4 | 3 | 3.7k | 10.8k/833 | 0 | 0.0057 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.8k | 3.5k/102 | 0 | 0.0030 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 1.9k | 3.6k/275 | 0 | 0.0036 |
| merged-prs-open-linear | lisp | ✅ | 7 | 6 | 3.2k | 17.1k/889 | 0 | 0.0158 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.1k | 5.8k/182 | 0 | 0.0050 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 1.9k | 3.6k/197 | 0 | 0.0034 |
| email-top-error | lisp | ✅ | 4 | 3 | 2.4k | 8.4k/444 | 0 | 0.0078 |
| compose-verify-issues | lisp | ✅ | 3 | 2 | 2.4k | 6.1k/307 | 0 | 0.0056 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.9k | 3.9k/207 | 0 | 0.0027 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/227 | 0 | 0.0028 |
| merged-prs-open-linear | lisp | ✅ | 7 | 6 | 2.6k | 15.4k/793 | 0 | 0.0107 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.2k | 6.3k/228 | 0 | 0.0042 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/222 | 0 | 0.0028 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.2k | 6.2k/497 | 0 | 0.0047 |
| compose-verify-issues | lisp | ✅ | 6 | 5 | 4.2k | 16.9k/546 | 0 | 0.0112 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.2k | 4.4k/55 | 0 | 0.0014 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.3k | 6.7k/253 | 0 | 0.0023 |
| merged-prs-open-linear | lisp | ✅ | 3 | 2 | 2.7k | 7.2k/551 | 0 | 0.0028 |
| busiest-assignee | lisp | ✅ | 4 | 3 | 2.6k | 9.6k/261 | 0 | 0.0032 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.3k | 6.7k/209 | 0 | 0.0023 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.4k | 6.9k/407 | 0 | 0.0026 |
| compose-verify-issues | lisp | ✅ | 7 | 6 | 3.0k | 17.5k/622 | 0 | 0.0060 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.2k | 4.3k/126 | 0 | 0.0004 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 3.2k | 7.7k/457 | 0 | 0.0008 |
| merged-prs-open-linear | lisp | ✅ | 6 | 6 | 4.1k | 19.0k/1.7k | 0 | 0.0020 |
| busiest-assignee | lisp | ✅ | 7 | 6 | 3.4k | 19.1k/854 | 0 | 0.0019 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.4k | 4.5k/263 | 0 | 0.0005 |
| email-top-error | lisp | ✅ | 4 | 3 | 2.7k | 9.8k/482 | 0 | 0.0010 |
| compose-verify-issues | lisp | ✅ | 8 | 7 | 5.5k | 27.0k/1.4k | 0 | 0.0027 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/34 | 0 | 0.0002 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.0k/147 | 0 | 0.0002 |
| merged-prs-open-linear | lisp | ❌ | 20 | 19 | 7.3k | 90.0k/4.9k | 0 | 0.0054 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 2.5k | 11.1k/502 | 0 | 0.0007 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.0k | 3.9k/125 | 0 | 0.0002 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.3k | 6.3k/333 | 0 | 0.0004 |
| compose-verify-issues | lisp | ❌ | 3 | 2 | 2.8k | 6.9k/293 | 0 | 0.0004 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ❌ | 2 | 1 | 2.0k | 3.9k/499 | 0 | 0.0007 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.2k | 8.2k/4.5k | 0 | 0.0030 |
| merged-prs-open-linear | lisp | ERR | 2 | 2 | 2.1k | 4.0k/3.8k | 0 | 0.0022 |
| busiest-assignee | lisp | ERR | 1 | 1 | 1.9k | 1.9k/2.4k | 0 | 0.0013 |
| high-urgency-triggered | lisp | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| email-top-error | lisp | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| compose-verify-issues | lisp | ERR | 2 | 2 | 2.1k | 4.0k/2.9k | 0 | 0.0018 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| lisp | 83% | 4.0 | 3.1 | 2.6k | 10.7k | 843 | 0.00 | 0.0030 |
