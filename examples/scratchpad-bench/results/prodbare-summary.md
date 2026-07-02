# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 31 | 30 | 6.3k | 102.9k/3.0k | 1 | 0.0246 |
| incident-commander | lisp | ❌ | 31 | 30 | 6.4k | 115.3k/2.9k | 1 | 0.0274 |
| heavy-pr-audit | scratchpad | ✅ | 10 | 9 | 3.7k | 25.1k/1.3k | 0 | 0.0062 |
| heavy-pr-audit | lisp | ✅ | 10 | 9 | 6.1k | 35.5k/1.1k | 0 | 0.0085 |
| needle-sweep | scratchpad | ✅ | 11 | 10 | 3.3k | 25.1k/1.0k | 0 | 0.0061 |
| needle-sweep | lisp | ❌ | 10 | 9 | 3.6k | 25.9k/1.1k | 0 | 0.0063 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 20 | 19 | 3.9k | 49.2k/2.6k | 0 | 0.0040 |
| incident-commander | lisp | ❌ | 30 | 28 | 5.8k | 97.8k/3.7k | 1 | 0.0073 |
| heavy-pr-audit | scratchpad | ✅ | 8 | 8 | 2.3k | 12.9k/1.4k | 0 | 0.0014 |
| heavy-pr-audit | lisp | ✅ | 10 | 9 | 2.4k | 18.3k/1.0k | 0 | 0.0015 |
| needle-sweep | scratchpad | ❌ | 6 | 5 | 2.0k | 8.4k/991 | 0 | 0.0009 |
| needle-sweep | lisp | ❌ | 5 | 4 | 2.0k | 7.7k/477 | 0 | 0.0007 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 10 | 16 | 4.3k | 25.1k/2.2k | 0 | 0.0032 |
| incident-commander | lisp | ✅ | 17 | 21 | 4.5k | 55.0k/3.1k | 0 | 0.0066 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 7 | 2.4k | 8.1k/597 | 0 | 0.0010 |
| heavy-pr-audit | lisp | ✅ | 4 | 3 | 2.2k | 6.3k/556 | 0 | 0.0008 |
| needle-sweep | scratchpad | ✅ | 6 | 9 | 2.5k | 10.1k/845 | 0 | 0.0013 |
| needle-sweep | lisp | ✅ | 6 | 7 | 3.1k | 13.3k/1.2k | 0 | 0.0017 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 18 | 17 | 4.3k | 50.9k/2.9k | 0 | 0.0075 |
| incident-commander | lisp | ❌ | 31 | 30 | 5.1k | 99.2k/4.4k | 1 | 0.0140 |
| heavy-pr-audit | scratchpad | ✅ | 9 | 8 | 2.5k | 15.4k/1.9k | 0 | 0.0028 |
| heavy-pr-audit | lisp | ✅ | 7 | 6 | 2.4k | 12.2k/1.0k | 0 | 0.0019 |
| needle-sweep | scratchpad | ❌ | 11 | 10 | 2.4k | 19.3k/934 | 0 | 0.0028 |
| needle-sweep | lisp | ❌ | 10 | 9 | 2.7k | 20.9k/998 | 0 | 0.0030 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 9 | 8 | 3.1k | 19.1k/1.5k | 0 | 0.0102 |
| incident-commander | lisp | ERR | 20 | 20 | 4.8k | 62.2k/3.2k | 0 | 0.0297 |
| heavy-pr-audit | scratchpad | ❌ | 6 | 5 | 1.7k | 7.5k/639 | 0 | 0.0041 |
| heavy-pr-audit | lisp | ✅ | 4 | 4 | 2.1k | 5.8k/743 | 0 | 0.0037 |
| needle-sweep | scratchpad | ❌ | 4 | 7 | 1.8k | 4.8k/666 | 0 | 0.0032 |
| needle-sweep | lisp | ✅ | 4 | 5 | 2.5k | 6.3k/865 | 0 | 0.0041 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 14 | 19 | 4.1k | 38.7k/1.3k | 0 | 0.0330 |
| incident-commander | lisp | ❌ | 31 | 30 | 5.5k | 99.6k/1.6k | 1 | 0.0794 |
| heavy-pr-audit | scratchpad | ✅ | 8 | 8 | 3.1k | 15.6k/588 | 0 | 0.0136 |
| heavy-pr-audit | lisp | ✅ | 5 | 4 | 2.0k | 7.0k/638 | 0 | 0.0074 |
| needle-sweep | scratchpad | ✅ | 5 | 5 | 1.8k | 6.2k/530 | 0 | 0.0065 |
| needle-sweep | lisp | ✅ | 8 | 7 | 2.6k | 14.1k/698 | 0 | 0.0129 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 6 | 11 | 2.9k | 11.4k/1.2k | 0 | 0.0091 |
| incident-commander | lisp | ✅ | 11 | 16 | 4.9k | 30.9k/2.2k | 0 | 0.0227 |
| heavy-pr-audit | scratchpad | ❌ | 6 | 7 | 2.1k | 9.1k/678 | 0 | 0.0067 |
| heavy-pr-audit | lisp | ✅ | 6 | 7 | 2.1k | 9.1k/425 | 0 | 0.0063 |
| needle-sweep | scratchpad | ❌ | 4 | 6 | 2.1k | 5.5k/572 | 0 | 0.0044 |
| needle-sweep | lisp | ✅ | 5 | 9 | 3.5k | 9.3k/1.1k | 0 | 0.0076 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 14 | 24 | 5.8k | 49.5k/2.5k | 0 | 0.0178 |
| incident-commander | lisp | ✅ | 29 | 27 | 8.3k | 130.2k/2.6k | 1 | 0.0422 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 4 | 2.3k | 8.2k/640 | 0 | 0.0032 |
| heavy-pr-audit | lisp | ✅ | 10 | 9 | 5.8k | 34.0k/688 | 0 | 0.0110 |
| needle-sweep | scratchpad | ❌ | 5 | 4 | 2.3k | 8.5k/717 | 0 | 0.0034 |
| needle-sweep | lisp | ✅ | 13 | 28 | 5.8k | 41.2k/1.8k | 0 | 0.0145 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 9 | 17 | 4.7k | 29.4k/2.6k | 0 | 0.0031 |
| incident-commander | lisp | ✅ | 13 | 20 | 7.7k | 72.4k/2.8k | 0 | 0.0070 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 9 | 2.9k | 9.4k/960 | 0 | 0.0010 |
| heavy-pr-audit | lisp | ✅ | 7 | 6 | 3.5k | 16.3k/945 | 0 | 0.0016 |
| needle-sweep | scratchpad | ✅ | 5 | 10 | 2.9k | 9.7k/1.1k | 0 | 0.0011 |
| needle-sweep | lisp | ✅ | 12 | 24 | 13.7k | 98.7k/5.1k | 0 | 0.0098 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 14 | 15 | 3.2k | 27.6k/764 | 0 | 0.0015 |
| incident-commander | lisp | ❌ | 31 | 30 | 8.0k | 121.9k/8.8k | 1 | 0.0078 |
| heavy-pr-audit | scratchpad | ❌ | 7 | 6 | 1.2k | 6.6k/331 | 0 | 0.0004 |
| heavy-pr-audit | lisp | ❌ | 4 | 3 | 1.4k | 3.9k/625 | 0 | 0.0003 |
| needle-sweep | scratchpad | ❌ | 4 | 7 | 1.4k | 4.4k/389 | 0 | 0.0003 |
| needle-sweep | lisp | ✅ | 2 | 1 | 857 | 1.5k/232 | 0 | 0.0001 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| incident-commander | lisp | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| heavy-pr-audit | scratchpad | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| heavy-pr-audit | lisp | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| needle-sweep | scratchpad | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| needle-sweep | lisp | ERR | 3 | 3 | 1.1k | 2.6k/4.0k | 0 | 0.0021 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 48% | 8.3 | 9.7 | 2.7k | 18.9k | 1.1k | 0.03 | 0.0056 |
| lisp | 61% | 11.8 | 12.7 | 4.0k | 38.6k | 1.8k | 0.18 | 0.0106 |
