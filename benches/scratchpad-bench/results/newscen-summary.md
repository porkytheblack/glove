# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (32 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 3.6k | 9.4k/296 | 0 | 0.0022 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.4k | 6.4k/292 | 0 | 0.0016 |
| incident-branch | lisp | ✅ | 4 | 3 | 3.1k | 10.9k/557 | 0 | 0.0027 |
| open-prs-breakdown | baseline | ❌ | 2 | 1 | 6.7k | 9.6k/396 | 0 | 0.0023 |
| open-prs-breakdown | scratchpad | ✅ | 5 | 4 | 2.8k | 11.8k/662 | 0 | 0.0029 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.8k | 9.9k/406 | 0 | 0.0024 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 3.5k | 9.8k/470 | 0 | 0.0008 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.1k | 5.7k/781 | 0 | 0.0007 |
| incident-branch | lisp | ✅ | 7 | 6 | 2.7k | 16.8k/919 | 0 | 0.0014 |
| open-prs-breakdown | baseline | ❌ | 2 | 1 | 6.6k | 9.5k/412 | 0 | 0.0007 |
| open-prs-breakdown | scratchpad | ✅ | 4 | 3 | 2.0k | 7.4k/290 | 0 | 0.0006 |
| open-prs-breakdown | lisp | ✅ | 7 | 6 | 2.6k | 16.5k/925 | 0 | 0.0014 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 4.3k | 12.4k/382 | 0 | 0.0014 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/365 | 0 | 0.0007 |
| incident-branch | lisp | ❌ | 3 | 2 | 2.7k | 7.4k/624 | 0 | 0.0009 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 8.0k | 11.8k/532 | 0 | 0.0014 |
| open-prs-breakdown | scratchpad | ✅ | 4 | 3 | 2.3k | 8.0k/301 | 0 | 0.0009 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.7k | 9.7k/570 | 0 | 0.0012 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 3.5k | 10.0k/480 | 0 | 0.0014 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.0k | 5.6k/474 | 0 | 0.0009 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.4k | 6.8k/536 | 0 | 0.0011 |
| open-prs-breakdown | baseline | ✅ | 3 | 2 | 10.8k | 21.2k/1.0k | 0 | 0.0030 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 2 | 2.0k | 5.6k/305 | 0 | 0.0008 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.6k | 9.3k/445 | 0 | 0.0013 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 1.7k | 4.7k/400 | 0 | 0.0026 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 1.8k | 5.0k/392 | 0 | 0.0027 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.2k | 6.1k/434 | 0 | 0.0032 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 4.7k | 6.0k/583 | 0 | 0.0034 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 2 | 1.8k | 4.9k/429 | 0 | 0.0027 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.4k | 8.7k/555 | 0 | 0.0044 |

## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 1.7k | 4.7k/368 | 0 | 0.0047 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 1.8k | 4.9k/327 | 0 | 0.0048 |
| incident-branch | lisp | ✅ | 3 | 2 | 3.3k | 8.2k/639 | 0 | 0.0083 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 4.7k | 6.0k/420 | 0 | 0.0059 |
| open-prs-breakdown | scratchpad | ✅ | 4 | 3 | 1.9k | 6.9k/520 | 0 | 0.0069 |
| open-prs-breakdown | lisp | ✅ | 3 | 2 | 2.3k | 6.2k/299 | 0 | 0.0056 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 3.4k | 9.7k/396 | 0 | 0.0066 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.0k | 5.5k/462 | 0 | 0.0042 |
| incident-branch | lisp | ✅ | 2 | 1 | 2.3k | 4.4k/411 | 0 | 0.0034 |
| open-prs-breakdown | baseline | ❌ | 2 | 1 | 6.7k | 9.7k/752 | 0 | 0.0072 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 2 | 2.0k | 5.6k/427 | 0 | 0.0042 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.2k | 8.5k/387 | 0 | 0.0059 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 3.5k | 10.1k/314 | 0 | 0.0034 |
| incident-branch | scratchpad | ✅ | 5 | 4 | 2.4k | 10.9k/477 | 0 | 0.0039 |
| incident-branch | lisp | ✅ | 2 | 1 | 2.7k | 5.0k/336 | 0 | 0.0019 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 6.6k | 9.7k/580 | 0 | 0.0036 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 3 | 2.3k | 6.3k/389 | 0 | 0.0024 |
| open-prs-breakdown | lisp | ✅ | 6 | 5 | 4.3k | 21.1k/619 | 0 | 0.0071 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ✅ | 3 | 2 | 3.5k | 9.8k/445 | 0 | 0.0010 |
| incident-branch | scratchpad | ✅ | 4 | 6 | 2.9k | 10.1k/688 | 0 | 0.0010 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.9k | 7.7k/397 | 0 | 0.0008 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 6.6k | 9.6k/818 | 0 | 0.0010 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 2 | 2.3k | 6.2k/352 | 0 | 0.0006 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.8k | 10.1k/472 | 0 | 0.0010 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ❌ | 2 | 1 | 3.4k | 6.4k/83 | 0 | 0.0003 |
| incident-branch | scratchpad | ❌ | 4 | 3 | 2.1k | 7.5k/185 | 0 | 0.0004 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.6k | 7.0k/457 | 0 | 0.0004 |
| open-prs-breakdown | baseline | ❌ | 2 | 1 | 7.2k | 10.2k/62 | 0 | 0.0005 |
| open-prs-breakdown | scratchpad | ✅ | 5 | 4 | 2.2k | 9.4k/212 | 0 | 0.0005 |
| open-prs-breakdown | lisp | ❌ | 19 | 18 | 4.2k | 58.5k/1.7k | 0 | 0.0032 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| incident-branch | baseline | ERR | 0 | 0 | 0 | 0/0 | 0 | 0.0000 |
| incident-branch | scratchpad | ERR | 3 | 3 | 2.0k | 5.5k/2.3k | 0 | 0.0017 |
| incident-branch | lisp | ERR | 3 | 3 | 2.4k | 6.7k/6.0k | 0 | 0.0035 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 7.2k | 10.2k/4.9k | 0 | 0.0034 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 3 | 2.0k | 5.4k/3.7k | 0 | 0.0023 |
| open-prs-breakdown | lisp | ERR | 2 | 2 | 2.2k | 4.2k/3.7k | 0 | 0.0022 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 73% | 2.4 | 1.4 | 4.9k | 9.1k | 643 | 0.00 | 0.0026 |
| scratchpad | 91% | 3.5 | 2.8 | 2.1k | 6.9k | 648 | 0.00 | 0.0022 |
| lisp | 82% | 4.4 | 3.5 | 2.8k | 11.4k | 973 | 0.00 | 0.0029 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 0.5×, peak context 2.3×, input tokens 1.3×, cost 1.2×.

**Reduction factors (baseline ÷ lisp):** tool calls 0.4×, peak context 1.8×, input tokens 0.8×, cost 0.9×.
