# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | lisp | ✅ | 3 | 2 | 2.5k | 7.0k/317 | 0 | 0.0008 |
| open-prs-breakdown | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/219 | 0 | 0.0005 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | lisp | ✅ | 2 | 1 | 2.4k | 4.5k/256 | 0 | 0.0003 |
| open-prs-breakdown | lisp | ❌ | 19 | 18 | 4.7k | 61.9k/2.2k | 0 | 0.0035 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | lisp | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| open-prs-breakdown | lisp | ERR | 1 | 1 | 2.0k | 2.0k/3.8k | 0 | 0.0020 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| lisp | 50% | 4.5 | 3.8 | 2.3k | 13.3k | 1.1k | 0.00 | 0.0012 |
