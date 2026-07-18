# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=8, maxTurns=24, contextLimit=16000, maxTokens=3000.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (32 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 16.4k | 19.3k/78 | 0 | 0.0045 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.9k | 6.2k/335 | 0 | 0.0015 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 4.7k | 7.7k/297 | 0 | 0.0019 |
| high-urgency-triggered | scratchpad | ✅ | 7 | 6 | 2.6k | 13.1k/710 | 0 | 0.0032 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 16.0k | 18.9k/188 | 0 | 0.0012 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.4k | 4.9k/225 | 0 | 0.0004 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 4.7k | 7.6k/474 | 0 | 0.0006 |
| high-urgency-triggered | scratchpad | ❌ | 6 | 8 | 1.8k | 8.3k/794 | 0 | 0.0008 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 13.8k | 15.0k/1.5k | 0 | 0.0087 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.2k | 4.2k/224 | 0 | 0.0020 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 2.9k | 4.2k/348 | 0 | 0.0023 |
| high-urgency-triggered | scratchpad | ✅ | 4 | 3 | 1.4k | 4.3k/436 | 0 | 0.0025 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 67% | 2.0 | 1.0 | 9.7k | 12.1k | 481 | 0.00 | 0.0032 |
| scratchpad | 83% | 4.8 | 4.3 | 1.7k | 6.8k | 454 | 0.00 | 0.0017 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 0.2×, peak context 5.7×, input tokens 1.8×, cost 1.8×.
