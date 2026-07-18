# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (367 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | baseline | ✅ | 9 | 7 | 44.8k | 300.2k/832 | 2 | 0.0690 |
| incident-commander | scratchpad | ✅ | 17 | 16 | 6.8k | 88.8k/1.8k | 0 | 0.0210 |
| incident-commander | pyrepl | ✅ | 8 | 6 | 21.9k | 148.8k/1.1k | 1 | 0.0344 |
| incident-commander | jsrepl | ✅ | 10 | 8 | 22.3k | 192.4k/1.7k | 1 | 0.0446 |
| incident-commander | lispfns | ✅ | 9 | 7 | 24.6k | 193.1k/1.0k | 1 | 0.0446 |
| heavy-pr-audit | baseline | ✅ | 3 | 6 | 47.0k | 136.3k/1.2k | 0 | 0.0316 |
| heavy-pr-audit | scratchpad | ✅ | 7 | 6 | 4.8k | 29.1k/902 | 0 | 0.0070 |
| heavy-pr-audit | pyrepl | ✅ | 13 | 10 | 21.7k | 233.0k/1.5k | 2 | 0.0539 |
| heavy-pr-audit | jsrepl | ✅ | 3 | 2 | 21.9k | 63.4k/1.2k | 0 | 0.0149 |
| heavy-pr-audit | lispfns | ✅ | 10 | 8 | 24.7k | 218.2k/1.1k | 1 | 0.0503 |
| needle-sweep | baseline | ✅ | 5 | 3 | 48.8k | 178.2k/778 | 1 | 0.0411 |
| needle-sweep | scratchpad | ❌ | 11 | 10 | 5.7k | 49.9k/1.4k | 0 | 0.0119 |
| needle-sweep | pyrepl | ✅ | 9 | 7 | 22.7k | 172.0k/2.2k | 1 | 0.0401 |
| needle-sweep | jsrepl | ❌ | 8 | 6 | 22.3k | 149.1k/1.1k | 1 | 0.0345 |
| needle-sweep | lispfns | ❌ | 2 | 1 | 24.1k | 47.6k/437 | 0 | 0.0111 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | baseline | ✅ | 5 | 7 | 47.1k | 184.9k/862 | 1 | 0.1126 |
| incident-commander | scratchpad | ✅ | 6 | 8 | 4.4k | 22.9k/1.1k | 0 | 0.0158 |
| incident-commander | pyrepl | ✅ | 8 | 6 | 20.2k | 139.2k/860 | 1 | 0.0852 |
| incident-commander | jsrepl | ✅ | 8 | 6 | 20.4k | 139.5k/1.2k | 1 | 0.0859 |
| incident-commander | lispfns | ✅ | 5 | 4 | 22.9k | 113.3k/1.1k | 0 | 0.0701 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 46.7k | 91.7k/1.1k | 0 | 0.0571 |
| heavy-pr-audit | scratchpad | ✅ | 4 | 3 | 3.7k | 13.6k/656 | 0 | 0.0094 |
| heavy-pr-audit | pyrepl | ✅ | 6 | 5 | 20.2k | 118.6k/915 | 0 | 0.0729 |
| heavy-pr-audit | jsrepl | ✅ | 2 | 1 | 19.7k | 39.1k/445 | 0 | 0.0243 |
| heavy-pr-audit | lispfns | ✅ | 4 | 3 | 22.6k | 89.6k/450 | 0 | 0.0546 |
| needle-sweep | baseline | ✅ | 2 | 3 | 53.4k | 98.5k/1.2k | 0 | 0.0615 |
| needle-sweep | scratchpad | ✅ | 3 | 2 | 3.9k | 10.7k/634 | 0 | 0.0076 |
| needle-sweep | pyrepl | ✅ | 3 | 4 | 21.0k | 60.9k/1.1k | 0 | 0.0387 |
| needle-sweep | jsrepl | ✅ | 3 | 2 | 20.3k | 59.6k/1.0k | 0 | 0.0378 |
| needle-sweep | lispfns | ✅ | 2 | 1 | 22.9k | 45.1k/839 | 0 | 0.0287 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | baseline | ✅ | 7 | 7 | 59.3k | 290.1k/969 | 2 | 0.0307 |
| incident-commander | scratchpad | ✅ | 11 | 14 | 6.2k | 52.6k/2.0k | 0 | 0.0061 |
| incident-commander | pyrepl | ✅ | 10 | 8 | 20.8k | 182.7k/1.2k | 1 | 0.0195 |
| incident-commander | jsrepl | ✅ | 3 | 2 | 20.9k | 60.7k/1.0k | 0 | 0.0067 |
| incident-commander | lispfns | ✅ | 4 | 8 | 24.3k | 94.4k/1.1k | 0 | 0.0102 |
| heavy-pr-audit | baseline | ✅ | 2 | 1 | 58.8k | 115.6k/1.1k | 0 | 0.0125 |
| heavy-pr-audit | scratchpad | ✅ | 3 | 2 | 4.0k | 10.8k/458 | 0 | 0.0013 |
| heavy-pr-audit | pyrepl | ✅ | 5 | 4 | 21.0k | 101.0k/1.3k | 0 | 0.0110 |
| heavy-pr-audit | jsrepl | ✅ | 2 | 1 | 19.9k | 39.4k/308 | 0 | 0.0042 |
| heavy-pr-audit | lispfns | ✅ | 3 | 2 | 22.9k | 67.8k/462 | 0 | 0.0072 |
| needle-sweep | baseline | ✅ | 4 | 4 | 57.2k | 171.1k/499 | 1 | 0.0181 |
| needle-sweep | scratchpad | ✅ | 4 | 5 | 4.5k | 15.5k/858 | 0 | 0.0019 |
| needle-sweep | pyrepl | ✅ | 9 | 7 | 20.9k | 161.2k/1.2k | 1 | 0.0173 |
| needle-sweep | jsrepl | ❌ | 7 | 5 | 22.0k | 123.3k/2.3k | 1 | 0.0136 |
| needle-sweep | lispfns | ✅ | 5 | 4 | 23.9k | 115.7k/1.6k | 0 | 0.0126 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | baseline | ❌ | 5 | 3 | 45.5k | 179.0k/136 | 1 | 0.0090 |
| incident-commander | scratchpad | ✅ | 13 | 17 | 5.3k | 57.9k/875 | 0 | 0.0031 |
| incident-commander | pyrepl | ✅ | 2 | 1 | 20.1k | 39.6k/345 | 0 | 0.0020 |
| incident-commander | jsrepl | ERR | 10 | 9 | 21.1k | 182.4k/3.3k | 1 | 0.0097 |
| incident-commander | lispfns | ❌ | 27 | 22 | 24.0k | 505.0k/2.7k | 5 | 0.0258 |
| heavy-pr-audit | baseline | ❌ | 3 | 6 | 44.7k | 133.0k/295 | 0 | 0.0067 |
| heavy-pr-audit | scratchpad | ❌ | 6 | 5 | 3.9k | 20.8k/439 | 0 | 0.0011 |
| heavy-pr-audit | pyrepl | ❌ | 2 | 1 | 19.8k | 39.3k/267 | 0 | 0.0020 |
| heavy-pr-audit | jsrepl | ✅ | 14 | 11 | 20.3k | 238.3k/1.6k | 2 | 0.0122 |
| heavy-pr-audit | lispfns | ❌ | 8 | 6 | 24.5k | 164.3k/410 | 1 | 0.0083 |
| needle-sweep | baseline | ❌ | 11 | 11 | 46.4k | 358.9k/694 | 3 | 0.0181 |
| needle-sweep | scratchpad | ❌ | 3 | 2 | 3.7k | 10.2k/301 | 0 | 0.0006 |
| needle-sweep | pyrepl | ❌ | 2 | 1 | 19.9k | 39.4k/303 | 0 | 0.0020 |
| needle-sweep | jsrepl | ❌ | 14 | 11 | 21.2k | 243.0k/3.2k | 2 | 0.0128 |
| needle-sweep | lispfns | ❌ | 25 | 20 | 23.6k | 485.3k/3.3k | 4 | 0.0249 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 75% | 4.8 | 4.9 | 50.0k | 186.4k | 811 | 0.92 | 0.0390 |
| scratchpad | 75% | 7.3 | 7.5 | 4.7k | 31.9k | 948 | 0.00 | 0.0072 |
| pyrepl | 83% | 6.4 | 5.0 | 20.8k | 119.6k | 1.0k | 0.58 | 0.0316 |
| jsrepl | 67% | 7.0 | 5.3 | 21.0k | 127.5k | 1.5k | 0.75 | 0.0251 |
| lispfns | 67% | 8.7 | 7.2 | 23.8k | 178.3k | 1.2k | 1.00 | 0.0290 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 0.7×, peak context 10.5×, input tokens 5.8×, cost 5.4×.

**Reduction factors (baseline ÷ pyrepl):** tool calls 1.0×, peak context 2.4×, input tokens 1.6×, cost 1.2×.

**Reduction factors (baseline ÷ jsrepl):** tool calls 0.9×, peak context 2.4×, input tokens 1.5×, cost 1.6×.

**Reduction factors (baseline ÷ lispfns):** tool calls 0.7×, peak context 2.1×, input tokens 1.0×, cost 1.3×.
