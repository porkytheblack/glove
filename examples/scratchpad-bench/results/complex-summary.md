# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (32 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 7 | 6 | 16.0k | 82.9k/3.1k | 0 | 0.0201 |
| reconcile-ghost-issues | scratchpad | ✅ | 5 | 4 | 3.1k | 12.3k/688 | 0 | 0.0031 |
| reconcile-ghost-issues | lisp | ✅ | 16 | 15 | 5.1k | 61.3k/1.8k | 0 | 0.0146 |
| reconcile-ghost-issues | both | ✅ | 18 | 17 | 7.8k | 90.0k/2.9k | 0 | 0.0216 |
| repo-health-report | baseline | ❌ | 6 | 5 | 12.6k | 45.1k/1.1k | 0 | 0.0107 |
| repo-health-report | scratchpad | ❌ | 3 | 2 | 2.7k | 6.7k/441 | 0 | 0.0017 |
| repo-health-report | lisp | ✅ | 6 | 5 | 3.7k | 17.6k/1.1k | 0 | 0.0044 |
| repo-health-report | both | ✅ | 4 | 3 | 3.0k | 10.6k/564 | 0 | 0.0026 |
| escalate-hot-services | baseline | ✅ | 14 | 12 | 14.1k | 115.4k/1.8k | 1 | 0.0271 |
| escalate-hot-services | scratchpad | ✅ | 16 | 15 | 5.3k | 58.1k/1.7k | 0 | 0.0139 |
| escalate-hot-services | lisp | ✅ | 14 | 12 | 11.5k | 104.1k/2.6k | 1 | 0.0247 |
| escalate-hot-services | both | ✅ | 9 | 8 | 4.4k | 30.0k/1.3k | 0 | 0.0073 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ❌ | 3 | 14 | 5.4k | 12.4k/912 | 0 | 0.0011 |
| reconcile-ghost-issues | scratchpad | ✅ | 6 | 5 | 2.5k | 12.4k/1.8k | 0 | 0.0015 |
| reconcile-ghost-issues | lisp | ✅ | 3 | 2 | 3.3k | 7.5k/915 | 0 | 0.0008 |
| reconcile-ghost-issues | both | ❌ | 3 | 2 | 2.4k | 6.4k/709 | 0 | 0.0007 |
| repo-health-report | baseline | ❌ | 2 | 2 | 9.6k | 12.6k/1.3k | 0 | 0.0013 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 2.1k | 5.7k/590 | 0 | 0.0006 |
| repo-health-report | lisp | ❌ | 4 | 3 | 3.1k | 10.1k/1.4k | 0 | 0.0011 |
| repo-health-report | both | ❌ | 1 | 0 | 1.9k | 1.9k/212 | 0 | 0.0002 |
| escalate-hot-services | baseline | ✅ | 4 | 8 | 7.2k | 24.0k/1.4k | 0 | 0.0020 |
| escalate-hot-services | scratchpad | ✅ | 5 | 6 | 2.8k | 11.3k/1.3k | 0 | 0.0012 |
| escalate-hot-services | lisp | ❌ | 10 | 9 | 5.7k | 39.0k/4.4k | 0 | 0.0041 |
| escalate-hot-services | both | ❌ | 9 | 8 | 3.9k | 27.4k/2.3k | 0 | 0.0026 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 4 | 20 | 15.6k | 28.6k/3.9k | 0 | 0.0041 |
| reconcile-ghost-issues | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/313 | 0 | 0.0005 |
| reconcile-ghost-issues | lisp | ✅ | 8 | 7 | 3.9k | 24.8k/1.6k | 0 | 0.0030 |
| reconcile-ghost-issues | both | ✅ | 2 | 1 | 2.4k | 4.5k/393 | 0 | 0.0006 |
| repo-health-report | baseline | ✅ | 2 | 2 | 11.7k | 15.6k/785 | 0 | 0.0019 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/405 | 0 | 0.0008 |
| repo-health-report | lisp | ✅ | 4 | 3 | 3.2k | 10.5k/918 | 0 | 0.0014 |
| repo-health-report | both | ✅ | 3 | 2 | 2.5k | 7.0k/411 | 0 | 0.0008 |
| escalate-hot-services | baseline | ✅ | 4 | 8 | 9.1k | 29.6k/2.1k | 0 | 0.0037 |
| escalate-hot-services | scratchpad | ✅ | 6 | 8 | 3.5k | 16.0k/1.3k | 0 | 0.0021 |
| escalate-hot-services | lisp | ✅ | 7 | 6 | 4.5k | 23.9k/2.1k | 0 | 0.0031 |
| escalate-hot-services | both | ✅ | 6 | 11 | 3.8k | 17.0k/1.2k | 0 | 0.0021 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 5 | 4 | 15.4k | 36.7k/2.7k | 0 | 0.0057 |
| reconcile-ghost-issues | scratchpad | ✅ | 11 | 10 | 7.5k | 38.5k/1.8k | 0 | 0.0055 |
| reconcile-ghost-issues | lisp | ✅ | 5 | 4 | 3.7k | 14.5k/1.6k | 0 | 0.0025 |
| reconcile-ghost-issues | both | ✅ | 8 | 7 | 5.0k | 26.3k/2.0k | 0 | 0.0041 |
| repo-health-report | baseline | ✅ | 5 | 4 | 13.8k | 37.8k/1.8k | 0 | 0.0054 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 2.2k | 5.7k/622 | 0 | 0.0010 |
| repo-health-report | lisp | ✅ | 5 | 4 | 2.9k | 12.3k/869 | 0 | 0.0019 |
| repo-health-report | both | ✅ | 3 | 2 | 2.4k | 6.4k/512 | 0 | 0.0010 |
| escalate-hot-services | baseline | ❌ | 7 | 13 | 12.7k | 67.4k/6.3k | 0 | 0.0111 |
| escalate-hot-services | scratchpad | ✅ | 8 | 7 | 3.3k | 19.9k/2.0k | 0 | 0.0033 |
| escalate-hot-services | lisp | ❌ | 9 | 8 | 3.9k | 27.2k/1.7k | 0 | 0.0041 |
| escalate-hot-services | both | ✅ | 13 | 12 | 7.1k | 53.5k/2.1k | 0 | 0.0074 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ❌ | 2 | 2 | 10.4k | 11.7k/2.5k | 0 | 0.0095 |
| reconcile-ghost-issues | scratchpad | ❌ | 3 | 3 | 2.0k | 5.3k/4.5k | 0 | 0.0111 |
| reconcile-ghost-issues | lisp | ✅ | 2 | 1 | 2.4k | 4.3k/560 | 0 | 0.0027 |
| reconcile-ghost-issues | both | ERR | 16 | 22 | 6.4k | 62.7k/4.2k | 0 | 0.0320 |
| repo-health-report | baseline | ✅ | 2 | 2 | 7.7k | 9.0k/943 | 0 | 0.0053 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 1.9k | 5.0k/526 | 0 | 0.0029 |
| repo-health-report | lisp | ✅ | 3 | 2 | 2.5k | 6.6k/612 | 0 | 0.0037 |
| repo-health-report | both | ✅ | 3 | 2 | 2.0k | 5.4k/573 | 0 | 0.0032 |
| escalate-hot-services | baseline | ✅ | 4 | 8 | 5.5k | 16.3k/1.6k | 0 | 0.0094 |
| escalate-hot-services | scratchpad | ❌ | 8 | 7 | 2.9k | 17.5k/1.4k | 0 | 0.0095 |
| escalate-hot-services | lisp | ✅ | 8 | 7 | 3.8k | 24.4k/1.3k | 0 | 0.0118 |
| escalate-hot-services | both | ✅ | 8 | 7 | 3.3k | 20.3k/1.6k | 0 | 0.0109 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 5 | 4 | 10.5k | 28.3k/540 | 0 | 0.0228 |
| reconcile-ghost-issues | scratchpad | ❌ | 2 | 1 | 1.7k | 3.2k/405 | 0 | 0.0038 |
| reconcile-ghost-issues | lisp | ✅ | 11 | 10 | 5.2k | 38.3k/2.1k | 0 | 0.0358 |
| reconcile-ghost-issues | both | ✅ | 2 | 1 | 1.9k | 3.5k/415 | 0 | 0.0040 |
| repo-health-report | baseline | ✅ | 2 | 2 | 7.7k | 9.0k/773 | 0 | 0.0094 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 1.9k | 5.0k/494 | 0 | 0.0054 |
| repo-health-report | lisp | ✅ | 3 | 2 | 2.5k | 6.4k/509 | 0 | 0.0066 |
| repo-health-report | both | ✅ | 3 | 2 | 2.1k | 5.7k/351 | 0 | 0.0054 |
| escalate-hot-services | baseline | ✅ | 4 | 8 | 5.7k | 16.5k/1.0k | 0 | 0.0159 |
| escalate-hot-services | scratchpad | ✅ | 10 | 9 | 2.9k | 22.2k/826 | 0 | 0.0193 |
| escalate-hot-services | lisp | ✅ | 7 | 6 | 4.3k | 21.4k/1.8k | 0 | 0.0220 |
| escalate-hot-services | both | ✅ | 18 | 19 | 6.0k | 77.3k/2.9k | 0 | 0.0673 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ❌ | 2 | 2 | 12.5k | 15.6k/1.8k | 0 | 0.0128 |
| reconcile-ghost-issues | scratchpad | ✅ | 5 | 4 | 2.5k | 10.6k/895 | 0 | 0.0081 |
| reconcile-ghost-issues | lisp | ✅ | 5 | 4 | 3.0k | 12.6k/995 | 0 | 0.0095 |
| reconcile-ghost-issues | both | ✅ | 2 | 1 | 2.2k | 4.2k/585 | 0 | 0.0036 |
| repo-health-report | baseline | ✅ | 2 | 2 | 9.7k | 12.7k/3.0k | 0 | 0.0134 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 2.1k | 5.6k/583 | 0 | 0.0045 |
| repo-health-report | lisp | ✅ | 4 | 3 | 3.1k | 10.6k/743 | 0 | 0.0078 |
| repo-health-report | both | ✅ | 3 | 2 | 2.4k | 6.5k/362 | 0 | 0.0046 |
| escalate-hot-services | baseline | ✅ | 3 | 8 | 7.3k | 17.3k/1.0k | 0 | 0.0124 |
| escalate-hot-services | scratchpad | ✅ | 6 | 7 | 3.0k | 14.5k/1.1k | 0 | 0.0108 |
| escalate-hot-services | lisp | ✅ | 4 | 4 | 6.4k | 17.0k/1.2k | 0 | 0.0124 |
| escalate-hot-services | both | ✅ | 4 | 3 | 2.5k | 9.1k/847 | 0 | 0.0071 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 3 | 4 | 12.5k | 22.8k/1.9k | 0 | 0.0091 |
| reconcile-ghost-issues | scratchpad | ❌ | 3 | 2 | 2.4k | 6.4k/681 | 0 | 0.0027 |
| reconcile-ghost-issues | lisp | ✅ | 7 | 6 | 4.1k | 22.7k/2.7k | 0 | 0.0100 |
| reconcile-ghost-issues | both | ✅ | 5 | 4 | 3.4k | 13.8k/1.5k | 0 | 0.0059 |
| repo-health-report | baseline | ✅ | 2 | 1 | 11.3k | 14.4k/772 | 0 | 0.0052 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 2.3k | 6.3k/309 | 0 | 0.0023 |
| repo-health-report | lisp | ✅ | 3 | 2 | 2.6k | 7.3k/327 | 0 | 0.0026 |
| repo-health-report | both | ✅ | 3 | 2 | 2.6k | 7.1k/399 | 0 | 0.0026 |
| escalate-hot-services | baseline | ✅ | 3 | 9 | 7.7k | 17.8k/1.0k | 0 | 0.0066 |
| escalate-hot-services | scratchpad | ✅ | 7 | 12 | 3.9k | 21.6k/1.3k | 0 | 0.0081 |
| escalate-hot-services | lisp | ✅ | 20 | 19 | 5.7k | 74.9k/2.4k | 0 | 0.0253 |
| escalate-hot-services | both | ❌ | 7 | 7 | 4.0k | 21.8k/1.5k | 0 | 0.0083 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 4 | 5 | 11.2k | 29.3k/4.5k | 0 | 0.0034 |
| reconcile-ghost-issues | scratchpad | ✅ | 9 | 10 | 5.3k | 33.8k/4.7k | 0 | 0.0039 |
| reconcile-ghost-issues | lisp | ✅ | 13 | 19 | 5.6k | 54.1k/2.7k | 0 | 0.0054 |
| reconcile-ghost-issues | both | ✅ | 8 | 11 | 7.5k | 37.2k/3.3k | 0 | 0.0039 |
| repo-health-report | baseline | ✅ | 2 | 2 | 9.7k | 12.6k/1.9k | 0 | 0.0015 |
| repo-health-report | scratchpad | ✅ | 3 | 2 | 2.3k | 6.3k/418 | 0 | 0.0006 |
| repo-health-report | lisp | ✅ | 5 | 4 | 3.0k | 13.0k/617 | 0 | 0.0013 |
| repo-health-report | both | ✅ | 3 | 2 | 2.7k | 7.3k/517 | 0 | 0.0007 |
| escalate-hot-services | baseline | ✅ | 3 | 9 | 7.9k | 17.9k/1.6k | 0 | 0.0019 |
| escalate-hot-services | scratchpad | ✅ | 7 | 14 | 4.4k | 22.1k/2.5k | 0 | 0.0024 |
| escalate-hot-services | lisp | ✅ | 9 | 15 | 8.0k | 56.0k/2.0k | 0 | 0.0054 |
| escalate-hot-services | both | ✅ | 5 | 8 | 4.1k | 16.3k/1.7k | 0 | 0.0018 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ❌ | 20 | 18 | 8.8k | 122.1k/743 | 1 | 0.0062 |
| reconcile-ghost-issues | scratchpad | ❌ | 4 | 3 | 2.3k | 7.9k/265 | 0 | 0.0004 |
| reconcile-ghost-issues | lisp | ❌ | 2 | 1 | 2.3k | 4.3k/140 | 0 | 0.0002 |
| reconcile-ghost-issues | both | ❌ | 3 | 2 | 2.4k | 6.4k/205 | 0 | 0.0004 |
| repo-health-report | baseline | ❌ | 4 | 11 | 13.4k | 40.4k/379 | 0 | 0.0021 |
| repo-health-report | scratchpad | ❌ | 2 | 1 | 1.8k | 3.5k/139 | 0 | 0.0002 |
| repo-health-report | lisp | ❌ | 9 | 8 | 4.3k | 28.7k/2.1k | 0 | 0.0018 |
| repo-health-report | both | ❌ | 3 | 2 | 2.5k | 6.7k/537 | 0 | 0.0004 |
| escalate-hot-services | baseline | ❌ | 4 | 3 | 7.6k | 25.3k/95 | 0 | 0.0013 |
| escalate-hot-services | scratchpad | ❌ | 12 | 14 | 3.7k | 35.1k/835 | 0 | 0.0019 |
| escalate-hot-services | lisp | ❌ | 11 | 10 | 6.8k | 46.0k/4.1k | 0 | 0.0031 |
| escalate-hot-services | both | ❌ | 31 | 30 | 7.1k | 137.7k/7.4k | 1 | 0.0083 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| reconcile-ghost-issues | baseline | ✅ | 3 | 2 | 8.1k | 15.5k/5.5k | 0 | 0.0043 |
| reconcile-ghost-issues | scratchpad | ❌ | 3 | 2 | 2.0k | 5.5k/7.5k | 0 | 0.0040 |
| reconcile-ghost-issues | lisp | ERR | 2 | 2 | 2.3k | 4.3k/5.7k | 0 | 0.0031 |
| reconcile-ghost-issues | both | ❌ | 2 | 1 | 2.2k | 4.1k/4.1k | 0 | 0.0023 |
| repo-health-report | baseline | ❌ | 2 | 2 | 10.9k | 13.9k/4.9k | 0 | 0.0039 |
| repo-health-report | scratchpad | ❌ | 2 | 1 | 1.9k | 3.5k/4.4k | 0 | 0.0024 |
| repo-health-report | lisp | ERR | 3 | 3 | 2.8k | 7.2k/7.4k | 0 | 0.0042 |
| repo-health-report | both | ❌ | 1 | 0 | 1.9k | 1.9k/1.7k | 0 | 0.0010 |
| escalate-hot-services | baseline | ERR | 2 | 4 | 7.0k | 10.1k/7.3k | 0 | 0.0045 |
| escalate-hot-services | scratchpad | ERR | 3 | 3 | 2.2k | 5.9k/6.8k | 0 | 0.0038 |
| escalate-hot-services | lisp | ERR | 2 | 2 | 2.3k | 4.4k/8.7k | 0 | 0.0044 |
| escalate-hot-services | both | ERR | 5 | 5 | 2.6k | 11.6k/8.6k | 0 | 0.0053 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 67% | 4.3 | 6.2 | 10.2k | 29.9k | 2.2k | 0.06 | 0.0077 |
| scratchpad | 67% | 5.2 | 5.1 | 2.9k | 13.4k | 1.6k | 0.00 | 0.0043 |
| lisp | 73% | 6.8 | 6.3 | 4.2k | 24.8k | 2.1k | 0.03 | 0.0074 |
| both | 67% | 6.5 | 6.2 | 3.6k | 22.7k | 1.8k | 0.03 | 0.0070 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 1.2×, peak context 3.5×, input tokens 2.2×, cost 1.8×.

**Reduction factors (baseline ÷ lisp):** tool calls 1.0×, peak context 2.4×, input tokens 1.2×, cost 1.0×.

**Reduction factors (baseline ÷ both):** tool calls 1.0×, peak context 2.8×, input tokens 1.3×, cost 1.1×.
