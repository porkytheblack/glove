# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (32 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 4.7k | 7.7k/87 | 0 | 0.0018 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/98 | 0 | 0.0009 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.3k/52 | 0 | 0.0010 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.3k | 4.5k/85 | 0 | 0.0011 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.5k | 4.8k/88 | 0 | 0.0011 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.3k | 6.2k/165 | 0 | 0.0015 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 2.5k | 8.8k/363 | 0 | 0.0021 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.5k | 4.8k/227 | 0 | 0.0012 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 2.5k | 4.7k/156 | 0 | 0.0011 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 2.7k | 5.0k/176 | 0 | 0.0012 |
| merged-prs-open-linear | baseline | ✅ | 3 | 10 | 6.1k | 13.9k/985 | 0 | 0.0035 |
| merged-prs-open-linear | scratchpad | ✅ | 7 | 6 | 3.9k | 20.1k/991 | 0 | 0.0049 |
| merged-prs-open-linear | lisp | ✅ | 6 | 5 | 3.4k | 16.1k/805 | 0 | 0.0040 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 6.2k | 20.4k/1.8k | 0 | 0.0053 |
| merged-prs-open-linear | lispfns | ✅ | 13 | 12 | 7.2k | 63.0k/1.8k | 0 | 0.0151 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 3.7k | 6.7k/209 | 0 | 0.0016 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 2.5k | 8.8k/394 | 0 | 0.0021 |
| busiest-assignee | lisp | ✅ | 6 | 5 | 3.2k | 16.2k/408 | 0 | 0.0038 |
| busiest-assignee | jsrepl | ✅ | 10 | 9 | 5.4k | 38.6k/2.7k | 0 | 0.0098 |
| busiest-assignee | lispfns | ✅ | 3 | 2 | 2.9k | 8.0k/458 | 0 | 0.0020 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.3k/149 | 0 | 0.0015 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.1k | 4.0k/156 | 0 | 0.0010 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.5k | 4.7k/201 | 0 | 0.0012 |
| high-urgency-triggered | jsrepl | ✅ | 3 | 2 | 2.7k | 7.2k/393 | 0 | 0.0018 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 100% | 2.2 | 2.8 | 4.2k | 8.2k | 319 | 0.00 | 0.0020 |
| scratchpad | 100% | 3.8 | 2.8 | 2.6k | 9.1k | 400 | 0.00 | 0.0022 |
| lisp | 100% | 3.6 | 2.6 | 2.8k | 9.2k | 339 | 0.00 | 0.0022 |
| jsrepl | 100% | 4.4 | 3.4 | 3.8k | 15.1k | 1.0k | 0.00 | 0.0038 |
| lispfns | 100% | 5.0 | 4.0 | 3.8k | 20.2k | 635 | 0.00 | 0.0048 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 1.0×, peak context 1.6×, input tokens 0.9×, cost 0.9×.

**Reduction factors (baseline ÷ lisp):** tool calls 1.1×, peak context 1.5×, input tokens 0.9×, cost 0.9×.

**Reduction factors (baseline ÷ jsrepl):** tool calls 0.8×, peak context 1.1×, input tokens 0.5×, cost 0.5×.

**Reduction factors (baseline ÷ lispfns):** tool calls 0.7×, peak context 1.1×, input tokens 0.4×, cost 0.4×.
