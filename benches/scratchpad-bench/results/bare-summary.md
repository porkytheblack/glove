# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.5k | 4.6k/280 | 0 | 0.0011 |
| count-open-prs | lisp | ✅ | 3 | 2 | 3.2k | 7.1k/151 | 0 | 0.0017 |
| sentry-billing-unresolved | scratchpad | ✅ | 5 | 4 | 1.9k | 6.7k/538 | 0 | 0.0017 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 1.9k | 5.6k/437 | 0 | 0.0014 |
| merged-prs-open-linear | scratchpad | ✅ | 10 | 9 | 3.6k | 19.1k/1.6k | 0 | 0.0049 |
| merged-prs-open-linear | lisp | ✅ | 6 | 5 | 3.0k | 11.1k/1.0k | 0 | 0.0029 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 1.6k | 4.7k/393 | 0 | 0.0012 |
| busiest-assignee | lisp | ✅ | 7 | 6 | 3.6k | 16.9k/789 | 0 | 0.0042 |
| high-urgency-triggered | scratchpad | ✅ | 10 | 9 | 2.6k | 17.1k/921 | 0 | 0.0042 |
| high-urgency-triggered | lisp | ✅ | 5 | 4 | 2.1k | 7.7k/452 | 0 | 0.0019 |
| email-top-error | scratchpad | ❌ | 12 | 11 | 3.4k | 24.5k/1.6k | 0 | 0.0062 |
| email-top-error | lisp | ✅ | 9 | 8 | 5.5k | 33.7k/1.1k | 0 | 0.0081 |
| compose-verify-issues | scratchpad | ERR | 13 | 13 | 6.4k | 45.2k/3.3k | 0 | 0.0115 |
| compose-verify-issues | lisp | ERR | 25 | 24 | 6.7k | 95.0k/2.7k | 1 | 0.0227 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.1k | 3.6k/307 | 0 | 0.0003 |
| count-open-prs | lisp | ✅ | 2 | 1 | 621 | 1.2k/135 | 0 | 0.0001 |
| sentry-billing-unresolved | scratchpad | ✅ | 7 | 6 | 1.4k | 7.3k/536 | 0 | 0.0007 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 1.5k | 4.4k/870 | 0 | 0.0006 |
| merged-prs-open-linear | scratchpad | ✅ | 10 | 11 | 3.8k | 21.7k/1.5k | 0 | 0.0019 |
| merged-prs-open-linear | lisp | ❌ | 12 | 11 | 2.1k | 17.9k/1.3k | 0 | 0.0016 |
| busiest-assignee | scratchpad | ✅ | 5 | 4 | 1.3k | 4.9k/498 | 0 | 0.0005 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 1.5k | 5.8k/481 | 0 | 0.0005 |
| high-urgency-triggered | scratchpad | ✅ | 7 | 6 | 1.5k | 7.3k/706 | 0 | 0.0007 |
| high-urgency-triggered | lisp | ✅ | 5 | 4 | 1.3k | 5.5k/395 | 0 | 0.0005 |
| email-top-error | scratchpad | ❌ | 11 | 10 | 1.6k | 13.2k/1.2k | 0 | 0.0013 |
| email-top-error | lisp | ✅ | 5 | 4 | 1.6k | 6.1k/467 | 0 | 0.0006 |
| compose-verify-issues | scratchpad | ❌ | 4 | 3 | 1.2k | 3.8k/605 | 0 | 0.0005 |
| compose-verify-issues | lisp | ❌ | 15 | 14 | 4.8k | 40.8k/2.3k | 0 | 0.0034 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.3k | 4.1k/225 | 0 | 0.0005 |
| count-open-prs | lisp | ✅ | 4 | 3 | 1.4k | 4.7k/356 | 0 | 0.0006 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.3k | 4.2k/294 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 5 | 4 | 2.3k | 7.9k/366 | 0 | 0.0009 |
| merged-prs-open-linear | scratchpad | ✅ | 4 | 4 | 1.7k | 4.8k/562 | 0 | 0.0007 |
| merged-prs-open-linear | lisp | ✅ | 13 | 13 | 4.0k | 32.3k/2.6k | 0 | 0.0041 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 1.3k | 4.1k/265 | 0 | 0.0005 |
| busiest-assignee | lisp | ✅ | 4 | 3 | 1.5k | 4.8k/334 | 0 | 0.0006 |
| high-urgency-triggered | scratchpad | ✅ | 6 | 5 | 1.5k | 6.7k/416 | 0 | 0.0008 |
| high-urgency-triggered | lisp | ✅ | 4 | 3 | 1.7k | 4.9k/363 | 0 | 0.0006 |
| email-top-error | scratchpad | ✅ | 9 | 8 | 1.9k | 11.8k/1.1k | 0 | 0.0016 |
| email-top-error | lisp | ✅ | 7 | 6 | 4.9k | 22.1k/603 | 0 | 0.0025 |
| compose-verify-issues | scratchpad | ✅ | 7 | 9 | 2.4k | 11.6k/1.1k | 0 | 0.0015 |
| compose-verify-issues | lisp | ✅ | 8 | 8 | 3.5k | 15.6k/736 | 0 | 0.0018 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.1k | 3.6k/328 | 0 | 0.0006 |
| count-open-prs | lisp | ✅ | 2 | 1 | 656 | 1.3k/191 | 0 | 0.0002 |
| sentry-billing-unresolved | scratchpad | ❌ | 4 | 3 | 1.2k | 3.7k/564 | 0 | 0.0007 |
| sentry-billing-unresolved | lisp | ✅ | 5 | 4 | 1.7k | 6.1k/459 | 0 | 0.0010 |
| merged-prs-open-linear | scratchpad | ✅ | 9 | 8 | 2.4k | 12.8k/1.1k | 0 | 0.0021 |
| merged-prs-open-linear | lisp | ❌ | 31 | 30 | 8.9k | 120.1k/4.3k | 1 | 0.0165 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 1.1k | 3.6k/330 | 0 | 0.0006 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 1.7k | 7.7k/513 | 0 | 0.0012 |
| high-urgency-triggered | scratchpad | ✅ | 6 | 5 | 1.4k | 6.3k/537 | 0 | 0.0010 |
| high-urgency-triggered | lisp | ✅ | 10 | 9 | 2.0k | 14.8k/987 | 0 | 0.0022 |
| email-top-error | scratchpad | ✅ | 7 | 6 | 1.6k | 8.1k/830 | 0 | 0.0014 |
| email-top-error | lisp | ✅ | 6 | 5 | 9.0k | 36.6k/630 | 0 | 0.0047 |
| compose-verify-issues | scratchpad | ✅ | 11 | 11 | 4.6k | 23.9k/3.6k | 0 | 0.0046 |
| compose-verify-issues | lisp | ❌ | 13 | 12 | 10.4k | 66.1k/3.3k | 0 | 0.0095 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ❌ | 4 | 3 | 898 | 2.7k/210 | 0 | 0.0015 |
| count-open-prs | lisp | ✅ | 2 | 1 | 458 | 858/118 | 0 | 0.0006 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.1k | 2.9k/548 | 0 | 0.0022 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 1.2k | 3.7k/377 | 0 | 0.0021 |
| merged-prs-open-linear | scratchpad | ✅ | 7 | 6 | 1.6k | 6.8k/698 | 0 | 0.0040 |
| merged-prs-open-linear | lisp | ❌ | 8 | 7 | 2.8k | 12.6k/1.6k | 0 | 0.0079 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 932 | 2.8k/402 | 0 | 0.0019 |
| busiest-assignee | lisp | ❌ | 5 | 4 | 1.4k | 5.0k/384 | 0 | 0.0027 |
| high-urgency-triggered | scratchpad | ✅ | 4 | 3 | 1.1k | 2.9k/363 | 0 | 0.0018 |
| high-urgency-triggered | lisp | ✅ | 4 | 3 | 1.4k | 3.8k/325 | 0 | 0.0021 |
| email-top-error | scratchpad | ❌ | 1 | 0 | 472 | 472/14 | 0 | 0.0002 |
| email-top-error | lisp | ✅ | 6 | 5 | 4.0k | 13.9k/632 | 0 | 0.0065 |
| compose-verify-issues | scratchpad | ✅ | 8 | 8 | 2.9k | 12.5k/1.2k | 0 | 0.0072 |
| compose-verify-issues | lisp | ✅ | 29 | 29 | 5.1k | 82.8k/2.8k | 0 | 0.0367 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 3 | 3 | 1.0k | 2.4k/250 | 0 | 0.0026 |
| count-open-prs | lisp | ✅ | 2 | 1 | 469 | 885/83 | 0 | 0.0009 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 930 | 2.8k/257 | 0 | 0.0029 |
| sentry-billing-unresolved | lisp | ✅ | 5 | 4 | 1.3k | 4.8k/330 | 0 | 0.0047 |
| merged-prs-open-linear | scratchpad | ✅ | 4 | 4 | 1.4k | 3.5k/460 | 0 | 0.0042 |
| merged-prs-open-linear | lisp | ✅ | 14 | 13 | 4.1k | 30.2k/1.5k | 0 | 0.0277 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 901 | 2.8k/256 | 0 | 0.0029 |
| busiest-assignee | lisp | ✅ | 4 | 3 | 1.2k | 3.7k/243 | 0 | 0.0036 |
| high-urgency-triggered | scratchpad | ✅ | 6 | 6 | 1.8k | 6.3k/394 | 0 | 0.0060 |
| high-urgency-triggered | lisp | ✅ | 4 | 3 | 1.2k | 3.6k/227 | 0 | 0.0034 |
| email-top-error | scratchpad | ✅ | 6 | 6 | 1.3k | 5.6k/312 | 0 | 0.0053 |
| email-top-error | lisp | ✅ | 6 | 5 | 1.6k | 6.8k/418 | 0 | 0.0065 |
| compose-verify-issues | scratchpad | ✅ | 10 | 12 | 3.8k | 21.4k/1.1k | 0 | 0.0195 |
| compose-verify-issues | lisp | ✅ | 10 | 9 | 2.7k | 15.4k/704 | 0 | 0.0138 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.0k | 3.4k/201 | 0 | 0.0024 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.9k | 3.5k/115 | 0 | 0.0023 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.1k | 3.4k/279 | 0 | 0.0026 |
| sentry-billing-unresolved | lisp | ✅ | 6 | 5 | 2.0k | 8.0k/435 | 0 | 0.0056 |
| merged-prs-open-linear | scratchpad | ✅ | 4 | 4 | 1.5k | 4.1k/708 | 0 | 0.0038 |
| merged-prs-open-linear | lisp | ✅ | 11 | 10 | 2.9k | 19.2k/1.4k | 0 | 0.0142 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 1.0k | 3.4k/193 | 0 | 0.0024 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 1.4k | 5.3k/227 | 0 | 0.0036 |
| high-urgency-triggered | scratchpad | ✅ | 4 | 3 | 1.3k | 3.7k/418 | 0 | 0.0030 |
| high-urgency-triggered | lisp | ✅ | 6 | 5 | 2.7k | 10.6k/289 | 0 | 0.0069 |
| email-top-error | scratchpad | ✅ | 6 | 6 | 1.4k | 6.5k/450 | 0 | 0.0047 |
| email-top-error | lisp | ✅ | 8 | 7 | 1.7k | 10.3k/386 | 0 | 0.0069 |
| compose-verify-issues | scratchpad | ✅ | 8 | 9 | 3.8k | 15.1k/1.5k | 0 | 0.0120 |
| compose-verify-issues | lisp | ✅ | 10 | 11 | 3.8k | 18.9k/1.1k | 0 | 0.0136 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.4k | 4.6k/212 | 0 | 0.0016 |
| count-open-prs | lisp | ✅ | 2 | 1 | 3.2k | 4.0k/101 | 0 | 0.0013 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.5k | 4.7k/357 | 0 | 0.0018 |
| sentry-billing-unresolved | lisp | ✅ | 5 | 4 | 1.7k | 7.1k/311 | 0 | 0.0025 |
| merged-prs-open-linear | scratchpad | ✅ | 5 | 4 | 2.0k | 7.1k/524 | 0 | 0.0028 |
| merged-prs-open-linear | lisp | ❌ | 31 | 30 | 7.5k | 113.5k/3.5k | 1 | 0.0383 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 1.4k | 4.6k/233 | 0 | 0.0017 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 1.8k | 6.9k/304 | 0 | 0.0024 |
| high-urgency-triggered | scratchpad | ✅ | 4 | 3 | 1.5k | 4.6k/441 | 0 | 0.0019 |
| high-urgency-triggered | lisp | ✅ | 4 | 3 | 1.8k | 5.5k/279 | 0 | 0.0020 |
| email-top-error | scratchpad | ✅ | 8 | 7 | 2.0k | 11.6k/567 | 0 | 0.0042 |
| email-top-error | lisp | ✅ | 5 | 4 | 1.9k | 7.5k/348 | 0 | 0.0027 |
| compose-verify-issues | scratchpad | ✅ | 12 | 11 | 4.6k | 31.1k/1.1k | 0 | 0.0107 |
| compose-verify-issues | lisp | ❌ | 31 | 30 | 6.5k | 113.7k/2.9k | 1 | 0.0376 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.4k | 4.4k/273 | 0 | 0.0004 |
| count-open-prs | lisp | ✅ | 4 | 3 | 1.6k | 5.0k/266 | 0 | 0.0005 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.4k | 4.4k/418 | 0 | 0.0005 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.3k | 5.8k/541 | 0 | 0.0006 |
| merged-prs-open-linear | scratchpad | ✅ | 8 | 11 | 3.5k | 17.4k/1.3k | 0 | 0.0018 |
| merged-prs-open-linear | lisp | ✅ | 11 | 12 | 6.9k | 42.5k/2.7k | 0 | 0.0043 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 1.4k | 4.4k/321 | 0 | 0.0005 |
| busiest-assignee | lisp | ✅ | 5 | 4 | 1.9k | 7.1k/556 | 0 | 0.0007 |
| high-urgency-triggered | scratchpad | ✅ | 4 | 3 | 1.6k | 4.5k/490 | 0 | 0.0005 |
| high-urgency-triggered | lisp | ✅ | 4 | 3 | 1.8k | 5.2k/389 | 0 | 0.0005 |
| email-top-error | scratchpad | ✅ | 8 | 7 | 2.1k | 11.9k/992 | 0 | 0.0012 |
| email-top-error | lisp | ✅ | 9 | 8 | 4.9k | 28.0k/1.2k | 0 | 0.0027 |
| compose-verify-issues | scratchpad | ✅ | 8 | 10 | 5.0k | 21.8k/3.9k | 0 | 0.0027 |
| compose-verify-issues | lisp | ❌ | 11 | 24 | 6.9k | 38.2k/4.1k | 0 | 0.0042 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 754 | 1.4k/35 | 0 | 0.0001 |
| count-open-prs | lisp | ✅ | 2 | 1 | 633 | 1.2k/34 | 0 | 0.0001 |
| sentry-billing-unresolved | scratchpad | ❌ | 3 | 2 | 939 | 2.4k/98 | 0 | 0.0001 |
| sentry-billing-unresolved | lisp | ❌ | 4 | 3 | 1.3k | 3.7k/227 | 0 | 0.0002 |
| merged-prs-open-linear | scratchpad | ❌ | 5 | 4 | 999 | 4.3k/186 | 0 | 0.0003 |
| merged-prs-open-linear | lisp | ❌ | 3 | 2 | 993 | 2.4k/342 | 0 | 0.0002 |
| busiest-assignee | scratchpad | ✅ | 5 | 4 | 1.1k | 4.4k/254 | 0 | 0.0003 |
| busiest-assignee | lisp | ❌ | 17 | 16 | 3.3k | 31.8k/2.1k | 0 | 0.0020 |
| high-urgency-triggered | scratchpad | ❌ | 3 | 2 | 949 | 2.4k/102 | 0 | 0.0001 |
| high-urgency-triggered | lisp | ❌ | 2 | 1 | 673 | 1.3k/83 | 0 | 0.0001 |
| email-top-error | scratchpad | ❌ | 3 | 2 | 967 | 2.4k/129 | 0 | 0.0001 |
| email-top-error | lisp | ❌ | 4 | 3 | 1.4k | 4.0k/269 | 0 | 0.0002 |
| compose-verify-issues | scratchpad | ❌ | 7 | 6 | 1.5k | 7.3k/418 | 0 | 0.0004 |
| compose-verify-issues | lisp | ❌ | 15 | 14 | 3.8k | 31.8k/2.4k | 0 | 0.0021 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ❌ | 1 | 0 | 653 | 653/946 | 0 | 0.0005 |
| count-open-prs | lisp | ✅ | 2 | 1 | 633 | 1.2k/891 | 0 | 0.0005 |
| sentry-billing-unresolved | scratchpad | ❌ | 3 | 3 | 1.1k | 2.5k/3.5k | 0 | 0.0019 |
| sentry-billing-unresolved | lisp | ❌ | 2 | 1 | 659 | 1.2k/2.1k | 0 | 0.0011 |
| merged-prs-open-linear | scratchpad | ❌ | 5 | 4 | 1.1k | 4.5k/5.5k | 0 | 0.0030 |
| merged-prs-open-linear | lisp | ❌ | 2 | 1 | 784 | 1.4k/3.8k | 0 | 0.0019 |
| busiest-assignee | scratchpad | ✅ | 6 | 5 | 1.3k | 5.7k/2.1k | 0 | 0.0016 |
| busiest-assignee | lisp | ❌ | 3 | 2 | 794 | 2.1k/1.9k | 0 | 0.0011 |
| high-urgency-triggered | scratchpad | ❌ | 2 | 1 | 792 | 1.5k/919 | 0 | 0.0006 |
| high-urgency-triggered | lisp | ❌ | 3 | 2 | 794 | 2.1k/3.6k | 0 | 0.0019 |
| email-top-error | scratchpad | ❌ | 2 | 3 | 1.1k | 1.8k/3.6k | 0 | 0.0018 |
| email-top-error | lisp | ❌ | 4 | 3 | 999 | 3.3k/3.7k | 0 | 0.0021 |
| compose-verify-issues | scratchpad | ERR | 7 | 14 | 1.6k | 8.1k/9.3k | 0 | 0.0051 |
| compose-verify-issues | lisp | ❌ | 2 | 1 | 861 | 1.5k/3.6k | 0 | 0.0018 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 77% | 5.5 | 5.0 | 1.7k | 7.7k | 956 | 0.00 | 0.0025 |
| lisp | 71% | 7.4 | 6.7 | 2.7k | 17.5k | 1.1k | 0.05 | 0.0050 |
