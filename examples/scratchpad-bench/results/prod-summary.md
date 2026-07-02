# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 15 | 14 | 6.3k | 74.9k/1.5k | 0 | 0.0177 |
| incident-commander | lisp | ✅ | 10 | 9 | 6.1k | 50.7k/1.4k | 0 | 0.0121 |
| incident-commander | both | ✅ | 7 | 6 | 5.1k | 31.1k/937 | 0 | 0.0074 |
| incident-commander | baseline | ❌ | 5 | 3 | 46.3k | 178.8k/498 | 1 | 0.0411 |
| heavy-pr-audit | scratchpad | ✅ | 6 | 5 | 4.8k | 24.5k/768 | 0 | 0.0059 |
| heavy-pr-audit | lisp | ✅ | 7 | 6 | 5.1k | 31.5k/712 | 0 | 0.0075 |
| heavy-pr-audit | both | ✅ | 8 | 7 | 5.4k | 37.2k/1.2k | 0 | 0.0089 |
| heavy-pr-audit | baseline | ✅ | 3 | 2 | 50.6k | 141.8k/1.3k | 0 | 0.0329 |
| needle-sweep | scratchpad | ❌ | 8 | 7 | 5.1k | 34.1k/886 | 0 | 0.0081 |
| needle-sweep | lisp | ❌ | 2 | 1 | 4.5k | 8.4k/514 | 0 | 0.0021 |
| needle-sweep | both | ❌ | 5 | 4 | 4.5k | 20.7k/627 | 0 | 0.0050 |
| needle-sweep | baseline | ❌ | 10 | 7 | 48.5k | 358.2k/1.0k | 2 | 0.0824 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 10 | 9 | 4.4k | 38.0k/1.7k | 0 | 0.0029 |
| incident-commander | lisp | ❌ | 14 | 13 | 4.9k | 58.1k/1.4k | 0 | 0.0040 |
| incident-commander | both | ❌ | 6 | 5 | 8.7k | 33.8k/5.8k | 0 | 0.0044 |
| incident-commander | baseline | ❌ | 8 | 8 | 47.3k | 269.1k/642 | 2 | 0.0164 |
| heavy-pr-audit | scratchpad | ❌ | 4 | 3 | 3.6k | 13.5k/1.1k | 0 | 0.0013 |
| heavy-pr-audit | lisp | ✅ | 9 | 8 | 4.4k | 36.0k/1.8k | 0 | 0.0029 |
| heavy-pr-audit | both | ✅ | 6 | 5 | 4.3k | 23.2k/833 | 0 | 0.0017 |
| heavy-pr-audit | baseline | ❌ | 3 | 2 | 47.2k | 137.9k/1.8k | 0 | 0.0090 |
| needle-sweep | scratchpad | ❌ | 6 | 5 | 3.8k | 21.2k/986 | 0 | 0.0017 |
| needle-sweep | lisp | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| needle-sweep | both | ❌ | 2 | 1 | 3.7k | 7.1k/532 | 0 | 0.0006 |
| needle-sweep | baseline | ❌ | 2 | 3 | 56.9k | 100.4k/2.1k | 0 | 0.0069 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 7 | 13 | 5.4k | 31.6k/1.6k | 0 | 0.0038 |
| incident-commander | lisp | ✅ | 7 | 6 | 6.0k | 33.3k/2.2k | 0 | 0.0041 |
| incident-commander | both | ✅ | 8 | 11 | 5.5k | 38.4k/1.8k | 0 | 0.0045 |
| incident-commander | baseline | ✅ | 7 | 6 | 60.8k | 290.7k/1.7k | 2 | 0.0310 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 4 | 4.3k | 19.0k/1.1k | 0 | 0.0023 |
| heavy-pr-audit | lisp | ✅ | 3 | 2 | 4.2k | 11.6k/750 | 0 | 0.0014 |
| heavy-pr-audit | both | ✅ | 2 | 3 | 4.0k | 7.6k/385 | 0 | 0.0009 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 61.0k | 117.8k/2.1k | 0 | 0.0130 |
| needle-sweep | scratchpad | ✅ | 4 | 5 | 4.4k | 15.6k/743 | 0 | 0.0018 |
| needle-sweep | lisp | ❌ | 2 | 1 | 4.1k | 7.7k/927 | 0 | 0.0011 |
| needle-sweep | both | ✅ | 3 | 6 | 4.3k | 11.8k/663 | 0 | 0.0014 |
| needle-sweep | baseline | ✅ | 4 | 5 | 61.0k | 175.3k/333 | 1 | 0.0185 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 11 | 10 | 4.8k | 44.1k/2.1k | 0 | 0.0063 |
| incident-commander | lisp | ❌ | 31 | 30 | 6.7k | 164.6k/4.5k | 1 | 0.0219 |
| incident-commander | both | ❌ | 6 | 5 | 5.2k | 25.5k/1.6k | 0 | 0.0038 |
| incident-commander | baseline | ❌ | 6 | 6 | 47.8k | 228.0k/1.6k | 1 | 0.0281 |
| heavy-pr-audit | scratchpad | ❌ | 3 | 2 | 3.6k | 10.0k/973 | 0 | 0.0017 |
| heavy-pr-audit | lisp | ✅ | 3 | 2 | 3.9k | 11.1k/595 | 0 | 0.0016 |
| heavy-pr-audit | both | ❌ | 4 | 3 | 3.9k | 14.5k/597 | 0 | 0.0020 |
| heavy-pr-audit | baseline | ❌ | 3 | 2 | 47.6k | 135.6k/1.4k | 0 | 0.0169 |
| needle-sweep | scratchpad | ❌ | 3 | 4 | 3.9k | 10.8k/735 | 0 | 0.0016 |
| needle-sweep | lisp | ❌ | 2 | 1 | 4.1k | 7.7k/615 | 0 | 0.0012 |
| needle-sweep | both | ❌ | 3 | 2 | 4.0k | 11.1k/691 | 0 | 0.0017 |
| needle-sweep | baseline | ❌ | 5 | 7 | 60.8k | 208.2k/2.3k | 1 | 0.0261 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 11 | 14 | 5.2k | 48.7k/2.1k | 0 | 0.0224 |
| incident-commander | lisp | ✅ | 6 | 5 | 4.6k | 24.5k/1.0k | 0 | 0.0113 |
| incident-commander | both | ✅ | 4 | 3 | 3.8k | 13.8k/996 | 0 | 0.0072 |
| incident-commander | baseline | ❌ | 6 | 13 | 39.0k | 184.3k/1.3k | 1 | 0.0716 |
| heavy-pr-audit | scratchpad | ✅ | 4 | 3 | 3.5k | 12.9k/717 | 0 | 0.0063 |
| heavy-pr-audit | lisp | ✅ | 7 | 6 | 4.3k | 26.0k/1.1k | 0 | 0.0119 |
| heavy-pr-audit | both | ✅ | 6 | 5 | 3.9k | 20.7k/783 | 0 | 0.0093 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 38.7k | 73.9k/1.2k | 0 | 0.0301 |
| needle-sweep | scratchpad | ✅ | 3 | 2 | 3.6k | 9.9k/689 | 0 | 0.0051 |
| needle-sweep | lisp | ❌ | 2 | 1 | 3.7k | 7.0k/490 | 0 | 0.0036 |
| needle-sweep | both | ❌ | 2 | 1 | 3.4k | 6.5k/342 | 0 | 0.0031 |
| needle-sweep | baseline | ✅ | 2 | 3 | 51.5k | 86.8k/1.4k | 0 | 0.0354 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 12 | 11 | 5.2k | 52.1k/2.2k | 0 | 0.0462 |
| incident-commander | lisp | ❌ | 4 | 3 | 4.2k | 15.0k/4.5k | 0 | 0.0269 |
| incident-commander | both | ✅ | 9 | 10 | 5.2k | 38.7k/971 | 0 | 0.0321 |
| incident-commander | baseline | ❌ | 4 | 6 | 26.1k | 100.2k/379 | 0 | 0.0755 |
| heavy-pr-audit | scratchpad | ✅ | 4 | 3 | 3.4k | 12.7k/328 | 0 | 0.0106 |
| heavy-pr-audit | lisp | ✅ | 4 | 3 | 4.0k | 14.6k/629 | 0 | 0.0130 |
| heavy-pr-audit | both | ✅ | 4 | 3 | 3.7k | 13.8k/317 | 0 | 0.0114 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 26.0k | 48.5k/1.0k | 0 | 0.0395 |
| needle-sweep | scratchpad | ✅ | 3 | 2 | 3.7k | 10.0k/775 | 0 | 0.0101 |
| needle-sweep | lisp | ✅ | 4 | 3 | 4.2k | 15.2k/1.1k | 0 | 0.0150 |
| needle-sweep | both | ✅ | 3 | 2 | 4.3k | 11.3k/595 | 0 | 0.0105 |
| needle-sweep | baseline | ✅ | 2 | 3 | 38.8k | 61.3k/609 | 0 | 0.0475 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 5 | 5 | 4.0k | 18.1k/1.0k | 0 | 0.0128 |
| incident-commander | lisp | ✅ | 6 | 5 | 4.9k | 25.0k/1.7k | 0 | 0.0183 |
| incident-commander | both | ✅ | 6 | 5 | 4.3k | 23.2k/1.1k | 0 | 0.0161 |
| incident-commander | baseline | ✅ | 9 | 6 | 48.3k | 324.1k/775 | 2 | 0.1959 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 4 | 3.7k | 17.1k/558 | 0 | 0.0113 |
| heavy-pr-audit | lisp | ✅ | 3 | 2 | 4.5k | 11.7k/572 | 0 | 0.0081 |
| heavy-pr-audit | both | ✅ | 5 | 5 | 4.1k | 18.6k/704 | 0 | 0.0125 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 48.6k | 93.6k/1.9k | 0 | 0.0597 |
| needle-sweep | scratchpad | ✅ | 3 | 4 | 3.9k | 10.8k/621 | 0 | 0.0076 |
| needle-sweep | lisp | ✅ | 3 | 2 | 4.1k | 11.4k/866 | 0 | 0.0085 |
| needle-sweep | both | ✅ | 3 | 2 | 4.1k | 11.3k/446 | 0 | 0.0077 |
| needle-sweep | baseline | ✅ | 2 | 3 | 61.5k | 106.5k/1.3k | 0 | 0.0664 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 6 | 6 | 4.7k | 24.4k/1.1k | 0 | 0.0087 |
| incident-commander | lisp | ✅ | 6 | 6 | 5.2k | 27.3k/914 | 0 | 0.0093 |
| incident-commander | both | ✅ | 7 | 7 | 5.2k | 31.3k/1.3k | 0 | 0.0109 |
| incident-commander | baseline | ✅ | 5 | 6 | 45.5k | 175.6k/1.6k | 1 | 0.0546 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 4 | 4.1k | 18.6k/716 | 0 | 0.0065 |
| heavy-pr-audit | lisp | ✅ | 5 | 4 | 5.0k | 22.3k/777 | 0 | 0.0076 |
| heavy-pr-audit | both | ✅ | 4 | 4 | 4.6k | 16.3k/762 | 0 | 0.0058 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 45.6k | 87.6k/1.6k | 0 | 0.0282 |
| needle-sweep | scratchpad | ✅ | 3 | 2 | 4.4k | 11.8k/356 | 0 | 0.0040 |
| needle-sweep | lisp | ✅ | 5 | 5 | 5.3k | 22.3k/1.2k | 0 | 0.0081 |
| needle-sweep | both | ✅ | 3 | 2 | 4.8k | 12.8k/706 | 0 | 0.0047 |
| needle-sweep | baseline | ✅ | 2 | 6 | 58.6k | 100.6k/1.2k | 0 | 0.0316 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ✅ | 6 | 12 | 5.7k | 28.8k/1.6k | 0 | 0.0029 |
| incident-commander | lisp | ✅ | 10 | 13 | 6.7k | 56.1k/2.0k | 0 | 0.0054 |
| incident-commander | both | ✅ | 5 | 8 | 5.7k | 25.1k/1.6k | 0 | 0.0025 |
| incident-commander | baseline | ERR | 14 | 38 | 60.9k | 476.3k/5.3k | 4 | 0.0438 |
| heavy-pr-audit | scratchpad | ✅ | 5 | 5 | 4.8k | 20.3k/1.3k | 0 | 0.0021 |
| heavy-pr-audit | lisp | ✅ | 5 | 5 | 4.6k | 21.0k/710 | 0 | 0.0020 |
| heavy-pr-audit | both | ✅ | 4 | 3 | 4.4k | 16.3k/682 | 0 | 0.0016 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 45.9k | 88.1k/1.2k | 0 | 0.0082 |
| needle-sweep | scratchpad | ✅ | 3 | 4 | 4.4k | 11.9k/686 | 0 | 0.0012 |
| needle-sweep | lisp | ❌ | 5 | 8 | 11.7k | 49.5k/1.1k | 0 | 0.0047 |
| needle-sweep | both | ❌ | 4 | 5 | 5.1k | 18.3k/937 | 0 | 0.0018 |
| needle-sweep | baseline | ✅ | 3 | 5 | 62.3k | 156.9k/2.0k | 0 | 0.0145 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ❌ | 18 | 17 | 5.3k | 75.8k/907 | 0 | 0.0040 |
| incident-commander | lisp | ❌ | 31 | 30 | 6.3k | 143.0k/3.6k | 1 | 0.0078 |
| incident-commander | both | ERR | 30 | 29 | 8.8k | 175.1k/9.2k | 1 | 0.0105 |
| incident-commander | baseline | ❌ | 11 | 7 | 46.6k | 358.6k/428 | 3 | 0.0180 |
| heavy-pr-audit | scratchpad | ✅ | 4 | 3 | 3.5k | 13.3k/304 | 0 | 0.0007 |
| heavy-pr-audit | lisp | ✅ | 16 | 15 | 7.9k | 89.1k/3.8k | 0 | 0.0052 |
| heavy-pr-audit | both | ✅ | 8 | 7 | 4.2k | 30.3k/474 | 0 | 0.0016 |
| heavy-pr-audit | baseline | ❌ | 41 | 99 | 46.0k | 1338.6k/3.6k | 11 | 0.0676 |
| needle-sweep | scratchpad | ❌ | 4 | 3 | 3.8k | 13.9k/388 | 0 | 0.0008 |
| needle-sweep | lisp | ❌ | 3 | 2 | 3.9k | 11.1k/416 | 0 | 0.0006 |
| needle-sweep | both | ❌ | 2 | 1 | 3.7k | 7.1k/228 | 0 | 0.0004 |
| needle-sweep | baseline | ❌ | 11 | 10 | 48.0k | 361.7k/389 | 3 | 0.0182 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | scratchpad | ERR | 2 | 2 | 3.3k | 6.5k/9.1k | 0 | 0.0049 |
| incident-commander | lisp | ERR | 5 | 5 | 4.9k | 21.1k/10.3k | 0 | 0.0072 |
| incident-commander | both | ERR | 6 | 6 | 5.4k | 26.2k/7.6k | 0 | 0.0066 |
| incident-commander | baseline | ERR | 1 | 6 | 44.0k | 44.0k/867 | 0 | 0.0057 |
| heavy-pr-audit | scratchpad | ✅ | 3 | 4 | 3.7k | 10.1k/2.6k | 0 | 0.0024 |
| heavy-pr-audit | lisp | ERR | 5 | 5 | 4.9k | 21.0k/6.5k | 0 | 0.0055 |
| heavy-pr-audit | both | ❌ | 1 | 0 | 3.4k | 3.4k/1.2k | 0 | 0.0009 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 48.0k | 91.9k/3.1k | 0 | 0.0124 |
| needle-sweep | scratchpad | ERR | 1 | 1 | 3.1k | 3.1k/719 | 0 | 0.0007 |
| needle-sweep | lisp | ERR | 5 | 5 | 4.1k | 18.9k/8.6k | 0 | 0.0061 |
| needle-sweep | both | ❌ | 2 | 3 | 3.7k | 7.1k/2.8k | 0 | 0.0021 |
| needle-sweep | baseline | ❌ | 2 | 3 | 47.9k | 91.8k/2.5k | 0 | 0.0122 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 70% | 5.8 | 5.8 | 4.3k | 23.3k | 1.3k | 0.00 | 0.0069 |
| lisp | 58% | 7.0 | 6.4 | 4.9k | 32.5k | 2.0k | 0.06 | 0.0075 |
| both | 61% | 5.4 | 5.1 | 4.7k | 23.9k | 1.5k | 0.03 | 0.0061 |
| baseline | 52% | 5.6 | 8.2 | 48.9k | 205.8k | 1.5k | 1.06 | 0.0381 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 1.4×, peak context 11.4×, input tokens 8.8×, cost 5.6×.

**Reduction factors (baseline ÷ lisp):** tool calls 1.3×, peak context 9.9×, input tokens 6.3×, cost 5.1×.

**Reduction factors (baseline ÷ both):** tool calls 1.6×, peak context 10.4×, input tokens 8.6×, cost 6.2×.
