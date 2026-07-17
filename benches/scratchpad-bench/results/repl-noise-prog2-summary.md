# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ✅ | 14 | 13 | 8.3k | 82.2k/1.9k | 0 | 0.0195 |
| incident-commander | jsrepl | ERR | 24 | 23 | 9.0k | 148.1k/2.9k | 1 | 0.0349 |
| incident-commander | lispfns | ✅ | 13 | 12 | 6.0k | 55.1k/1.4k | 0 | 0.0131 |
| heavy-pr-audit | pyrepl | ✅ | 19 | 17 | 9.2k | 112.9k/2.8k | 1 | 0.0268 |
| heavy-pr-audit | jsrepl | ✅ | 8 | 7 | 6.4k | 36.0k/1.9k | 0 | 0.0089 |
| heavy-pr-audit | lispfns | ✅ | 12 | 11 | 5.1k | 47.6k/1.1k | 0 | 0.0113 |
| needle-sweep | pyrepl | ❌ | 13 | 12 | 7.0k | 66.3k/1.6k | 0 | 0.0157 |
| needle-sweep | jsrepl | ❌ | 8 | 7 | 5.7k | 33.0k/1.4k | 0 | 0.0081 |
| needle-sweep | lispfns | ❌ | 10 | 9 | 5.4k | 37.3k/1.5k | 0 | 0.0091 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ✅ | 4 | 12 | 6.4k | 20.0k/1.3k | 0 | 0.0145 |
| incident-commander | jsrepl | ✅ | 4 | 11 | 6.3k | 19.7k/1.3k | 0 | 0.0144 |
| incident-commander | lispfns | ✅ | 4 | 9 | 4.7k | 14.8k/1.3k | 0 | 0.0113 |
| heavy-pr-audit | pyrepl | ✅ | 6 | 8 | 4.7k | 23.1k/1.0k | 0 | 0.0158 |
| heavy-pr-audit | jsrepl | ✅ | 4 | 5 | 4.1k | 13.5k/730 | 0 | 0.0095 |
| heavy-pr-audit | lispfns | ✅ | 4 | 4 | 3.2k | 10.7k/694 | 0 | 0.0077 |
| needle-sweep | pyrepl | ✅ | 6 | 9 | 6.1k | 29.1k/1.3k | 0 | 0.0199 |
| needle-sweep | jsrepl | ✅ | 4 | 7 | 5.5k | 16.9k/1.3k | 0 | 0.0126 |
| needle-sweep | lispfns | ✅ | 6 | 9 | 4.8k | 22.3k/1.5k | 0 | 0.0162 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ❌ | 24 | 22 | 7.3k | 99.2k/1.5k | 1 | 0.0052 |
| incident-commander | jsrepl | ✅ | 13 | 12 | 4.4k | 46.0k/862 | 0 | 0.0025 |
| incident-commander | lispfns | ❌ | 17 | 20 | 7.0k | 86.0k/2.1k | 0 | 0.0047 |
| heavy-pr-audit | pyrepl | ❌ | 10 | 9 | 5.6k | 41.2k/1.6k | 0 | 0.0024 |
| heavy-pr-audit | jsrepl | ✅ | 22 | 20 | 7.4k | 102.0k/3.8k | 1 | 0.0058 |
| heavy-pr-audit | lispfns | ✅ | 7 | 6 | 3.8k | 20.4k/375 | 0 | 0.0011 |
| needle-sweep | pyrepl | ❌ | 7 | 6 | 5.4k | 28.5k/370 | 0 | 0.0015 |
| needle-sweep | jsrepl | ❌ | 25 | 24 | 7.7k | 119.2k/3.7k | 1 | 0.0067 |
| needle-sweep | lispfns | ❌ | 10 | 9 | 3.4k | 26.1k/286 | 0 | 0.0014 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-commander | pyrepl | ✅ | 5 | 9 | 7.4k | 28.3k/1.6k | 0 | 0.0034 |
| incident-commander | jsrepl | ✅ | 13 | 12 | 9.4k | 84.1k/1.7k | 0 | 0.0093 |
| incident-commander | lispfns | ✅ | 6 | 9 | 5.6k | 26.2k/1.6k | 0 | 0.0032 |
| heavy-pr-audit | pyrepl | ✅ | 7 | 6 | 7.1k | 37.4k/1.6k | 0 | 0.0044 |
| heavy-pr-audit | jsrepl | ✅ | 6 | 5 | 4.8k | 22.9k/1.3k | 0 | 0.0028 |
| heavy-pr-audit | lispfns | ✅ | 5 | 5 | 4.0k | 16.3k/581 | 0 | 0.0019 |
| needle-sweep | pyrepl | ✅ | 4 | 5 | 5.9k | 17.8k/887 | 0 | 0.0021 |
| needle-sweep | jsrepl | ✅ | 5 | 4 | 6.0k | 23.4k/1.1k | 0 | 0.0028 |
| needle-sweep | lispfns | ✅ | 6 | 9 | 4.7k | 21.7k/1.4k | 0 | 0.0027 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| pyrepl | 67% | 9.9 | 10.7 | 6.7k | 48.8k | 1.4k | 0.17 | 0.0109 |
| jsrepl | 75% | 11.3 | 11.4 | 6.4k | 55.4k | 1.8k | 0.25 | 0.0098 |
| lispfns | 75% | 8.3 | 9.3 | 4.8k | 32.0k | 1.2k | 0.00 | 0.0070 |
