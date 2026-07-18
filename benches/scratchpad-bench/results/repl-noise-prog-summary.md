# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ✅ | 8 | 7 | 7.5k | 42.1k/1.4k | 0 | 0.0101 |
| incident-commander | jsrepl | ✅ | 15 | 14 | 8.8k | 95.6k/2.3k | 0 | 0.0227 |
| incident-commander | lispfns | ✅ | 11 | 10 | 6.4k | 52.2k/1.3k | 0 | 0.0124 |
| heavy-pr-audit | pyrepl | ✅ | 17 | 15 | 9.8k | 105.1k/3.6k | 1 | 0.0253 |
| heavy-pr-audit | jsrepl | ✅ | 8 | 7 | 7.8k | 43.6k/2.3k | 0 | 0.0108 |
| heavy-pr-audit | lispfns | ✅ | 8 | 7 | 6.0k | 37.0k/1.5k | 0 | 0.0090 |
| needle-sweep | pyrepl | ❌ | 10 | 9 | 7.6k | 56.1k/1.2k | 0 | 0.0133 |
| needle-sweep | jsrepl | ❌ | 14 | 13 | 8.9k | 88.0k/2.4k | 0 | 0.0210 |
| needle-sweep | lispfns | ❌ | 6 | 5 | 5.4k | 25.2k/711 | 0 | 0.0060 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ✅ | 4 | 7 | 5.8k | 17.4k/1.2k | 0 | 0.0128 |
| incident-commander | jsrepl | ✅ | 4 | 7 | 5.8k | 17.2k/1.2k | 0 | 0.0126 |
| incident-commander | lispfns | ✅ | 4 | 7 | 4.9k | 14.7k/1.2k | 0 | 0.0112 |
| heavy-pr-audit | pyrepl | ✅ | 5 | 4 | 5.2k | 20.4k/1.2k | 0 | 0.0145 |
| heavy-pr-audit | jsrepl | ✅ | 4 | 4 | 5.2k | 15.9k/842 | 0 | 0.0112 |
| heavy-pr-audit | lispfns | ✅ | 5 | 6 | 4.7k | 18.3k/983 | 0 | 0.0129 |
| needle-sweep | pyrepl | ✅ | 4 | 5 | 5.8k | 17.0k/992 | 0 | 0.0121 |
| needle-sweep | jsrepl | ✅ | 3 | 5 | 5.5k | 12.6k/747 | 0 | 0.0090 |
| needle-sweep | lispfns | ✅ | 4 | 8 | 5.3k | 15.9k/1.1k | 0 | 0.0116 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ✅ | 7 | 6 | 7.8k | 40.4k/2.0k | 0 | 0.0048 |
| incident-commander | jsrepl | ✅ | 5 | 9 | 6.5k | 23.9k/1.4k | 0 | 0.0029 |
| incident-commander | lispfns | ERR | 2 | 7 | 3.7k | 5.8k/324 | 0 | 0.0007 |
| heavy-pr-audit | pyrepl | ✅ | 10 | 9 | 4.5k | 33.7k/1.5k | 0 | 0.0040 |
| heavy-pr-audit | jsrepl | ✅ | 6 | 6 | 5.5k | 24.0k/750 | 0 | 0.0027 |
| heavy-pr-audit | lispfns | ✅ | 5 | 4 | 4.4k | 17.9k/478 | 0 | 0.0020 |
| needle-sweep | pyrepl | ✅ | 5 | 4 | 5.8k | 22.3k/1.7k | 0 | 0.0028 |
| needle-sweep | jsrepl | ✅ | 5 | 6 | 5.5k | 21.2k/1.6k | 0 | 0.0027 |
| needle-sweep | lispfns | ✅ | 7 | 10 | 6.2k | 31.5k/1.7k | 0 | 0.0038 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ❌ | 13 | 12 | 8.3k | 73.2k/2.7k | 0 | 0.0042 |
| incident-commander | jsrepl | ✅ | 25 | 23 | 8.8k | 129.3k/4.6k | 1 | 0.0073 |
| incident-commander | lispfns | ❌ | 15 | 14 | 5.3k | 65.0k/448 | 0 | 0.0033 |
| heavy-pr-audit | pyrepl | ❌ | 5 | 4 | 5.0k | 20.3k/354 | 0 | 0.0011 |
| heavy-pr-audit | jsrepl | ❌ | 25 | 24 | 7.8k | 124.1k/5.9k | 1 | 0.0073 |
| heavy-pr-audit | lispfns | ✅ | 7 | 6 | 5.0k | 26.8k/444 | 0 | 0.0014 |
| needle-sweep | pyrepl | ❌ | 6 | 5 | 5.6k | 25.7k/382 | 0 | 0.0014 |
| needle-sweep | jsrepl | ❌ | 15 | 14 | 6.9k | 81.2k/1.8k | 0 | 0.0044 |
| needle-sweep | lispfns | ❌ | 15 | 14 | 6.0k | 70.0k/1.4k | 0 | 0.0038 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| pyrepl | 67% | 7.8 | 7.3 | 6.6k | 39.5k | 1.5k | 0.08 | 0.0089 |
| jsrepl | 75% | 10.8 | 11.0 | 6.9k | 56.4k | 2.1k | 0.17 | 0.0095 |
| lispfns | 67% | 7.4 | 8.2 | 5.3k | 31.7k | 964 | 0.00 | 0.0065 |
