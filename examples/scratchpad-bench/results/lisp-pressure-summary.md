# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=8, maxTurns=20, contextLimit=16000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/88 | 0 | 0.0011 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/123 | 0 | 0.0003 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 1.9k | 3.7k/105 | 0 | 0.0016 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| lisp | 100% | 2.0 | 1.0 | 2.1k | 4.1k | 105 | 0.00 | 0.0010 |
