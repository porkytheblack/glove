# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.4k/35 | 0 | 0.0002 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/118 | 0 | 0.0002 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.3k | 5.7k/331 | 0 | 0.0003 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/73 | 0 | 0.0002 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/90 | 0 | 0.0002 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.0k | 7.3k/166 | 0 | 0.0004 |
| compose-verify-issues | scratchpad | ✅ | 3 | 2 | 1.9k | 5.4k/130 | 0 | 0.0003 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.4k/513 | 0 | 0.0006 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 3 | 2.0k | 5.4k/5.7k | 0 | 0.0032 |
| merged-prs-open-linear | scratchpad | ✅ | 2 | 1 | 2.1k | 3.8k/6.0k | 0 | 0.0032 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/1.2k | 0 | 0.0009 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.5k/1.2k | 0 | 0.0010 |
| email-top-error | scratchpad | ❌ | 2 | 1 | 1.9k | 3.5k/3.7k | 0 | 0.0021 |
| compose-verify-issues | scratchpad | ✅ | 3 | 4 | 2.2k | 5.8k/5.1k | 0 | 0.0030 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/138 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.3k | 6.1k/278 | 0 | 0.0006 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.7k | 6.8k/835 | 0 | 0.0008 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/270 | 0 | 0.0006 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.0k | 3.9k/171 | 0 | 0.0004 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.6k | 11.2k/629 | 0 | 0.0011 |
| compose-verify-issues | scratchpad | ✅ | 7 | 7 | 4.1k | 20.6k/1.1k | 0 | 0.0020 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| scratchpad | 95% | 2.8 | 2.0 | 2.1k | 5.7k | 1.3k | 0.00 | 0.0010 |
