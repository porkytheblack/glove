# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (2 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/34 | 0 | 0.0002 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/147 | 0 | 0.0002 |
| merged-prs-open-linear | lisp | ❌ | 3 | 2 | 2.4k | 6.6k/633 | 0 | 0.0005 |
| busiest-assignee | lisp | ✅ | 29 | 27 | 6.3k | 109.2k/3.5k | 1 | 0.0061 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.1k | 6.2k/132 | 0 | 0.0003 |
| email-top-error | lisp | ✅ | 6 | 5 | 2.7k | 14.1k/561 | 0 | 0.0008 |
| compose-verify-issues | lisp | ✅ | 3 | 2 | 2.7k | 6.9k/361 | 0 | 0.0004 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/596 | 0 | 0.0008 |
| sentry-billing-unresolved | lisp | ✅ | 3 | 2 | 2.2k | 6.2k/5.0k | 0 | 0.0030 |
| merged-prs-open-linear | lisp | ERR | 1 | 1 | 2.0k | 2.0k/4.0k | 0 | 0.0020 |
| busiest-assignee | lisp | ERR | 4 | 4 | 2.4k | 8.8k/8.2k | 0 | 0.0047 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/2.1k | 0 | 0.0014 |
| email-top-error | lisp | ❌ | 2 | 1 | 2.2k | 4.2k/1.4k | 0 | 0.0011 |
| compose-verify-issues | lisp | ✅ | 3 | 2 | 2.3k | 6.6k/2.2k | 0 | 0.0018 |

## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/87 | 0 | 0.0011 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.4k | 4.4k/166 | 0 | 0.0011 |
| merged-prs-open-linear | lisp | ✅ | 7 | 6 | 3.9k | 21.5k/1.1k | 0 | 0.0053 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 3.1k | 16.4k/483 | 0 | 0.0039 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.5k | 4.7k/218 | 0 | 0.0011 |
| email-top-error | lisp | ✅ | 5 | 4 | 3.4k | 14.3k/1.1k | 0 | 0.0037 |
| compose-verify-issues | lisp | ✅ | 8 | 7 | 4.5k | 24.4k/786 | 0 | 0.0059 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| lisp | 81% | 4.6 | 3.7 | 2.8k | 13.2k | 1.6k | 0.05 | 0.0022 |
