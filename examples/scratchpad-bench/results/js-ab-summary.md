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
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 2.9k | 7.8k/351 | 0 | 0.0019 |
| email-top-error | baseline | ✅ | 3 | 2 | 5.4k | 13.4k/524 | 0 | 0.0033 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.9k | 11.8k/658 | 0 | 0.0029 |
| email-top-error | lisp | ✅ | 5 | 4 | 3.1k | 13.1k/652 | 0 | 0.0032 |
| email-top-error | jsrepl | ✅ | 8 | 7 | 4.6k | 27.5k/2.1k | 0 | 0.0070 |
| email-top-error | lispfns | ✅ | 12 | 11 | 4.5k | 41.9k/1.0k | 0 | 0.0099 |
| compose-verify-issues | baseline | ✅ | 4 | 11 | 7.7k | 21.1k/1.7k | 0 | 0.0054 |
| compose-verify-issues | scratchpad | ✅ | 9 | 8 | 4.0k | 26.9k/1.0k | 0 | 0.0065 |
| compose-verify-issues | lisp | ❌ | 22 | 21 | 6.6k | 101.0k/2.1k | 0 | 0.0239 |
| compose-verify-issues | jsrepl | ✅ | 6 | 5 | 4.7k | 19.8k/1.1k | 0 | 0.0049 |
| compose-verify-issues | lispfns | ✅ | 7 | 6 | 3.8k | 21.7k/960 | 0 | 0.0053 |
| incident-branch | baseline | ✅ | 3 | 2 | 3.6k | 10.1k/381 | 0 | 0.0024 |
| incident-branch | scratchpad | ✅ | 4 | 3 | 2.8k | 9.3k/463 | 0 | 0.0023 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.8k | 7.8k/383 | 0 | 0.0019 |
| incident-branch | jsrepl | ✅ | 5 | 4 | 3.5k | 14.8k/778 | 0 | 0.0036 |
| incident-branch | lispfns | ✅ | 2 | 1 | 2.8k | 5.5k/388 | 0 | 0.0014 |
| open-prs-breakdown | baseline | ❌ | 2 | 1 | 4.8k | 7.8k/304 | 0 | 0.0019 |
| open-prs-breakdown | scratchpad | ✅ | 5 | 4 | 2.7k | 11.5k/425 | 0 | 0.0028 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.9k | 10.2k/485 | 0 | 0.0025 |
| open-prs-breakdown | jsrepl | ✅ | 4 | 3 | 3.2k | 10.8k/909 | 0 | 0.0028 |
| open-prs-breakdown | lispfns | ✅ | 3 | 2 | 2.7k | 7.7k/282 | 0 | 0.0019 |
| reconcile-ghost-issues | baseline | ✅ | 9 | 8 | 14.2k | 81.6k/2.1k | 0 | 0.0194 |
| reconcile-ghost-issues | scratchpad | ✅ | 17 | 16 | 10.9k | 99.3k/2.6k | 0 | 0.0236 |
| reconcile-ghost-issues | lisp | ✅ | 14 | 13 | 5.4k | 51.6k/2.0k | 0 | 0.0125 |
| reconcile-ghost-issues | jsrepl | ✅ | 11 | 10 | 7.4k | 49.0k/4.2k | 0 | 0.0126 |
| reconcile-ghost-issues | lispfns | ✅ | 5 | 4 | 5.6k | 18.4k/1.4k | 0 | 0.0047 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 4.8k | 7.8k/85 | 0 | 0.0024 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/60 | 0 | 0.0012 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/73 | 0 | 0.0015 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.3k | 4.6k/76 | 0 | 0.0015 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.5k | 4.9k/84 | 0 | 0.0016 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.3k | 6.4k/179 | 0 | 0.0021 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 2.0k | 3.9k/162 | 0 | 0.0014 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.4k | 4.6k/185 | 0 | 0.0016 |
| sentry-billing-unresolved | jsrepl | ❌ | 2 | 1 | 2.5k | 4.7k/154 | 0 | 0.0016 |
| sentry-billing-unresolved | lispfns | ✅ | 3 | 2 | 2.6k | 7.5k/202 | 0 | 0.0025 |
| merged-prs-open-linear | baseline | ✅ | 2 | 2 | 9.7k | 12.7k/871 | 0 | 0.0049 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.5k | 6.6k/388 | 0 | 0.0024 |
| merged-prs-open-linear | lisp | ✅ | 6 | 5 | 3.0k | 15.5k/730 | 0 | 0.0055 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 3.5k | 14.3k/853 | 0 | 0.0053 |
| merged-prs-open-linear | lispfns | ✅ | 7 | 6 | 3.4k | 20.0k/691 | 0 | 0.0068 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 3.8k | 6.9k/257 | 0 | 0.0024 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.2k | 6.2k/205 | 0 | 0.0021 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.4k | 7.1k/213 | 0 | 0.0024 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 2.6k | 7.3k/235 | 0 | 0.0025 |
| busiest-assignee | lispfns | ✅ | 3 | 2 | 2.6k | 7.6k/300 | 0 | 0.0026 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.5k/252 | 0 | 0.0022 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.0k | 3.9k/148 | 0 | 0.0013 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.4k | 4.6k/160 | 0 | 0.0016 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.6k | 4.8k/244 | 0 | 0.0017 |
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 2.6k | 7.6k/238 | 0 | 0.0026 |
| email-top-error | baseline | ✅ | 3 | 2 | 5.1k | 13.2k/336 | 0 | 0.0044 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.8k | 11.6k/873 | 0 | 0.0045 |
| email-top-error | lisp | ✅ | 3 | 2 | 2.8k | 7.5k/440 | 0 | 0.0028 |
| email-top-error | jsrepl | ❌ | 4 | 3 | 3.0k | 10.5k/614 | 0 | 0.0039 |
| email-top-error | lispfns | ✅ | 3 | 2 | 2.8k | 7.8k/421 | 0 | 0.0029 |
| compose-verify-issues | baseline | ✅ | 3 | 11 | 8.1k | 18.2k/2.0k | 0 | 0.0079 |
| compose-verify-issues | scratchpad | ✅ | 4 | 3 | 3.0k | 9.5k/545 | 0 | 0.0035 |
| compose-verify-issues | lisp | ✅ | 4 | 3 | 3.6k | 11.6k/590 | 0 | 0.0042 |
| compose-verify-issues | jsrepl | ✅ | 6 | 5 | 4.7k | 19.7k/1.3k | 0 | 0.0075 |
| compose-verify-issues | lispfns | ✅ | 14 | 13 | 5.3k | 49.8k/1.6k | 0 | 0.0169 |
| incident-branch | baseline | ✅ | 3 | 2 | 3.6k | 10.2k/351 | 0 | 0.0035 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.2k | 6.3k/249 | 0 | 0.0022 |
| incident-branch | lisp | ✅ | 2 | 1 | 2.6k | 4.9k/349 | 0 | 0.0019 |
| incident-branch | jsrepl | ✅ | 2 | 1 | 2.6k | 5.0k/406 | 0 | 0.0020 |
| incident-branch | lispfns | ✅ | 3 | 2 | 2.9k | 8.1k/552 | 0 | 0.0031 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 4.8k | 7.9k/397 | 0 | 0.0028 |
| open-prs-breakdown | scratchpad | ✅ | 2 | 1 | 2.1k | 3.9k/212 | 0 | 0.0014 |
| open-prs-breakdown | lisp | ✅ | 3 | 2 | 2.7k | 7.4k/304 | 0 | 0.0026 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 2.6k | 4.8k/326 | 0 | 0.0018 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 2.7k | 5.1k/232 | 0 | 0.0018 |
| reconcile-ghost-issues | baseline | ✅ | 2 | 2 | 7.7k | 10.8k/1.5k | 0 | 0.0050 |
| reconcile-ghost-issues | scratchpad | ❌ | 4 | 3 | 2.8k | 9.3k/867 | 0 | 0.0038 |
| reconcile-ghost-issues | lisp | ✅ | 2 | 1 | 2.8k | 5.1k/828 | 0 | 0.0025 |
| reconcile-ghost-issues | jsrepl | ✅ | 6 | 8 | 4.8k | 19.6k/1.4k | 0 | 0.0075 |
| reconcile-ghost-issues | lispfns | ✅ | 10 | 9 | 4.1k | 33.4k/1.4k | 0 | 0.0117 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 4.8k | 7.9k/273 | 0 | 0.0053 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.4k/123 | 0 | 0.0023 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/110 | 0 | 0.0026 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.0k | 4.0k/112 | 0 | 0.0026 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.2k | 4.4k/104 | 0 | 0.0028 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.3k | 6.4k/145 | 0 | 0.0041 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 1.7k | 3.4k/302 | 0 | 0.0026 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/186 | 0 | 0.0028 |
| sentry-billing-unresolved | jsrepl | ✅ | 3 | 2 | 2.2k | 6.3k/205 | 0 | 0.0042 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 2.3k | 4.5k/265 | 0 | 0.0032 |
| merged-prs-open-linear | baseline | ✅ | 3 | 10 | 5.7k | 13.7k/966 | 0 | 0.0101 |
| merged-prs-open-linear | scratchpad | ✅ | 4 | 4 | 2.4k | 8.3k/632 | 0 | 0.0062 |
| merged-prs-open-linear | lisp | ✅ | 2 | 1 | 2.4k | 4.5k/431 | 0 | 0.0035 |
| merged-prs-open-linear | jsrepl | ✅ | 6 | 5 | 3.4k | 16.0k/1.3k | 0 | 0.0120 |
| merged-prs-open-linear | lispfns | ✅ | 12 | 11 | 5.5k | 44.1k/2.9k | 0 | 0.0320 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 3.8k | 6.9k/218 | 0 | 0.0046 |
| busiest-assignee | scratchpad | ✅ | 4 | 3 | 2.0k | 7.4k/348 | 0 | 0.0051 |
| busiest-assignee | lisp | ✅ | 2 | 1 | 2.3k | 4.3k/191 | 0 | 0.0029 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 2.4k | 6.6k/551 | 0 | 0.0050 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 2.5k | 4.6k/196 | 0 | 0.0032 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.5k/162 | 0 | 0.0042 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/308 | 0 | 0.0026 |
| high-urgency-triggered | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/313 | 0 | 0.0031 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.2k | 4.2k/202 | 0 | 0.0029 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 2.3k | 4.5k/255 | 0 | 0.0032 |
| email-top-error | baseline | ✅ | 3 | 2 | 5.0k | 13.1k/396 | 0 | 0.0086 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.1k | 7.6k/451 | 0 | 0.0054 |
| email-top-error | lisp | ✅ | 2 | 1 | 2.3k | 4.3k/468 | 0 | 0.0035 |
| email-top-error | jsrepl | ❌ | 5 | 4 | 3.4k | 12.6k/732 | 0 | 0.0090 |
| email-top-error | lispfns | ❌ | 2 | 1 | 2.4k | 4.6k/479 | 0 | 0.0037 |
| compose-verify-issues | baseline | ✅ | 3 | 10 | 5.7k | 13.7k/1.2k | 0 | 0.0105 |
| compose-verify-issues | scratchpad | ✅ | 8 | 7 | 3.0k | 17.1k/740 | 0 | 0.0117 |
| compose-verify-issues | lisp | ✅ | 4 | 3 | 2.4k | 9.0k/577 | 0 | 0.0065 |
| compose-verify-issues | jsrepl | ✅ | 4 | 3 | 2.5k | 9.0k/430 | 0 | 0.0062 |
| compose-verify-issues | lispfns | ✅ | 6 | 5 | 3.8k | 18.3k/1.2k | 0 | 0.0133 |
| incident-branch | baseline | ✅ | 3 | 2 | 3.6k | 10.2k/396 | 0 | 0.0069 |
| incident-branch | scratchpad | ✅ | 3 | 2 | 2.0k | 5.5k/474 | 0 | 0.0042 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.3k | 6.7k/414 | 0 | 0.0048 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 2.3k | 6.6k/387 | 0 | 0.0047 |
| incident-branch | lispfns | ✅ | 2 | 1 | 2.5k | 4.7k/496 | 0 | 0.0038 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 4.8k | 7.9k/303 | 0 | 0.0053 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 4 | 2.1k | 5.6k/333 | 0 | 0.0040 |
| open-prs-breakdown | lisp | ✅ | 3 | 2 | 2.5k | 6.7k/447 | 0 | 0.0049 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 2.3k | 4.3k/318 | 0 | 0.0032 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 2.4k | 4.6k/324 | 0 | 0.0034 |
| reconcile-ghost-issues | baseline | ✅ | 2 | 2 | 7.7k | 10.8k/1.3k | 0 | 0.0091 |
| reconcile-ghost-issues | scratchpad | ✅ | 7 | 9 | 3.2k | 17.5k/1.2k | 0 | 0.0127 |
| reconcile-ghost-issues | lisp | ✅ | 2 | 1 | 2.5k | 4.5k/413 | 0 | 0.0035 |
| reconcile-ghost-issues | jsrepl | ✅ | 6 | 5 | 4.5k | 20.1k/2.1k | 0 | 0.0160 |
| reconcile-ghost-issues | lispfns | ✅ | 4 | 3 | 3.2k | 10.7k/1.1k | 0 | 0.0086 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 5.8k | 9.7k/273 | 0 | 0.0011 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.9k | 3.7k/92 | 0 | 0.0004 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.2k | 4.3k/90 | 0 | 0.0005 |
| count-open-prs | jsrepl | ✅ | 3 | 2 | 2.4k | 6.7k/188 | 0 | 0.0008 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.4k | 4.7k/142 | 0 | 0.0005 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 4.2k | 8.0k/282 | 0 | 0.0009 |
| sentry-billing-unresolved | scratchpad | ✅ | 2 | 1 | 1.9k | 3.7k/109 | 0 | 0.0004 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.7k | 9.9k/337 | 0 | 0.0011 |
| sentry-billing-unresolved | jsrepl | ✅ | 3 | 2 | 2.6k | 6.9k/221 | 0 | 0.0008 |
| sentry-billing-unresolved | lispfns | ✅ | 4 | 3 | 2.9k | 10.4k/321 | 0 | 0.0012 |
| merged-prs-open-linear | baseline | ✅ | 3 | 10 | 7.4k | 17.3k/1.3k | 0 | 0.0022 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.5k | 6.5k/420 | 0 | 0.0008 |
| merged-prs-open-linear | lisp | ✅ | 5 | 5 | 4.2k | 15.7k/770 | 0 | 0.0019 |
| merged-prs-open-linear | jsrepl | ✅ | 7 | 6 | 4.1k | 21.1k/1.2k | 0 | 0.0026 |
| merged-prs-open-linear | lispfns | ✅ | 4 | 4 | 3.8k | 11.9k/872 | 0 | 0.0015 |
| busiest-assignee | baseline | ✅ | 3 | 2 | 5.0k | 13.6k/529 | 0 | 0.0016 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.1k | 5.9k/168 | 0 | 0.0007 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.6k | 7.2k/325 | 0 | 0.0008 |
| busiest-assignee | jsrepl | ✅ | 5 | 4 | 2.7k | 11.8k/400 | 0 | 0.0013 |
| busiest-assignee | lispfns | ✅ | 4 | 3 | 2.8k | 10.2k/374 | 0 | 0.0012 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 4.2k | 8.1k/253 | 0 | 0.0009 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/180 | 0 | 0.0004 |
| high-urgency-triggered | lisp | ✅ | 3 | 3 | 2.6k | 7.2k/339 | 0 | 0.0008 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.4k | 4.5k/358 | 0 | 0.0006 |
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 2.6k | 7.4k/354 | 0 | 0.0009 |
| email-top-error | baseline | ✅ | 3 | 2 | 6.7k | 16.7k/658 | 0 | 0.0019 |
| email-top-error | scratchpad | ✅ | 3 | 2 | 2.1k | 5.9k/278 | 0 | 0.0007 |
| email-top-error | lisp | ✅ | 5 | 4 | 3.0k | 12.9k/438 | 0 | 0.0015 |
| email-top-error | jsrepl | ✅ | 5 | 4 | 6.8k | 25.0k/1.1k | 0 | 0.0029 |
| email-top-error | lispfns | ✅ | 4 | 3 | 5.0k | 16.8k/451 | 0 | 0.0019 |
| compose-verify-issues | baseline | ✅ | 3 | 10 | 7.7k | 17.7k/2.3k | 0 | 0.0025 |
| compose-verify-issues | scratchpad | ✅ | 6 | 7 | 3.4k | 15.5k/979 | 0 | 0.0019 |
| compose-verify-issues | lisp | ✅ | 7 | 6 | 4.5k | 22.3k/1.2k | 0 | 0.0027 |
| compose-verify-issues | jsrepl | ✅ | 12 | 11 | 6.8k | 57.5k/1.9k | 0 | 0.0066 |
| compose-verify-issues | lispfns | ✅ | 6 | 6 | 6.1k | 24.8k/1.3k | 0 | 0.0030 |
| incident-branch | baseline | ✅ | 3 | 2 | 4.5k | 12.7k/394 | 0 | 0.0014 |
| incident-branch | scratchpad | ✅ | 4 | 3 | 2.4k | 8.4k/381 | 0 | 0.0010 |
| incident-branch | lisp | ✅ | 3 | 2 | 2.9k | 7.7k/767 | 0 | 0.0010 |
| incident-branch | jsrepl | ✅ | 4 | 3 | 2.7k | 9.8k/519 | 0 | 0.0012 |
| incident-branch | lispfns | ✅ | 2 | 1 | 3.0k | 5.4k/775 | 0 | 0.0008 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 5.9k | 9.8k/790 | 0 | 0.0012 |
| open-prs-breakdown | scratchpad | ✅ | 4 | 4 | 2.4k | 8.4k/358 | 0 | 0.0010 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.8k | 9.9k/494 | 0 | 0.0012 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 2.5k | 4.6k/448 | 0 | 0.0006 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 2.5k | 4.8k/272 | 0 | 0.0006 |
| reconcile-ghost-issues | baseline | ✅ | 4 | 9 | 9.8k | 22.8k/1.4k | 0 | 0.0028 |
| reconcile-ghost-issues | scratchpad | ✅ | 4 | 3 | 2.6k | 8.8k/689 | 0 | 0.0011 |
| reconcile-ghost-issues | lisp | ✅ | 2 | 1 | 2.7k | 4.8k/537 | 0 | 0.0007 |
| reconcile-ghost-issues | jsrepl | ✅ | 5 | 4 | 4.7k | 16.2k/1.3k | 0 | 0.0021 |
| reconcile-ghost-issues | lispfns | ✅ | 15 | 14 | 10.4k | 87.4k/4.8k | 0 | 0.0105 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 5.0k | 8.0k/26 | 0 | 0.0004 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.4k/35 | 0 | 0.0002 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.0k | 4.0k/34 | 0 | 0.0002 |
| count-open-prs | jsrepl | ❌ | 5 | 4 | 2.2k | 10.4k/121 | 0 | 0.0005 |
| count-open-prs | lispfns | ✅ | 3 | 2 | 2.3k | 6.6k/59 | 0 | 0.0003 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.3k | 6.3k/73 | 0 | 0.0003 |
| sentry-billing-unresolved | scratchpad | ❌ | 2 | 1 | 1.8k | 3.4k/77 | 0 | 0.0002 |
| sentry-billing-unresolved | lisp | ✅ | 2 | 1 | 2.1k | 4.1k/102 | 0 | 0.0002 |
| sentry-billing-unresolved | jsrepl | ❌ | 3 | 2 | 2.1k | 6.1k/92 | 0 | 0.0003 |
| sentry-billing-unresolved | lispfns | ✅ | 3 | 2 | 2.5k | 6.9k/106 | 0 | 0.0004 |
| merged-prs-open-linear | baseline | ❌ | 7 | 6 | 3.9k | 23.5k/250 | 0 | 0.0012 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.1k | 5.6k/280 | 0 | 0.0003 |
| merged-prs-open-linear | lisp | ✅ | 2 | 1 | 2.7k | 4.8k/407 | 0 | 0.0003 |
| merged-prs-open-linear | jsrepl | ❌ | 2 | 1 | 2.4k | 4.4k/288 | 0 | 0.0003 |
| merged-prs-open-linear | lispfns | ❌ | 14 | 13 | 8.7k | 73.4k/6.0k | 0 | 0.0048 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 3.9k | 6.9k/54 | 0 | 0.0004 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/74 | 0 | 0.0002 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 2.3k | 6.5k/292 | 0 | 0.0004 |
| busiest-assignee | jsrepl | ❌ | 4 | 3 | 2.2k | 8.3k/172 | 0 | 0.0004 |
| busiest-assignee | lispfns | ❌ | 7 | 6 | 2.6k | 16.3k/319 | 0 | 0.0009 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.4k/93 | 0 | 0.0003 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/97 | 0 | 0.0002 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.3k | 6.4k/215 | 0 | 0.0004 |
| high-urgency-triggered | jsrepl | ❌ | 3 | 2 | 2.1k | 6.2k/92 | 0 | 0.0003 |
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 2.6k | 7.0k/147 | 0 | 0.0004 |
| email-top-error | baseline | ❌ | 3 | 2 | 5.4k | 13.7k/127 | 0 | 0.0007 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.0k | 7.3k/173 | 0 | 0.0004 |
| email-top-error | lisp | ✅ | 5 | 4 | 2.7k | 11.5k/425 | 0 | 0.0007 |
| email-top-error | jsrepl | ❌ | 5 | 4 | 2.2k | 10.5k/167 | 0 | 0.0006 |
| email-top-error | lispfns | ❌ | 3 | 2 | 2.3k | 6.7k/96 | 0 | 0.0004 |
| compose-verify-issues | baseline | ❌ | 3 | 9 | 6.1k | 14.3k/557 | 0 | 0.0008 |
| compose-verify-issues | scratchpad | ❌ | 4 | 3 | 2.1k | 7.5k/229 | 0 | 0.0004 |
| compose-verify-issues | lisp | ✅ | 3 | 2 | 2.4k | 6.7k/322 | 0 | 0.0004 |
| compose-verify-issues | jsrepl | ❌ | 11 | 10 | 2.6k | 25.2k/415 | 0 | 0.0013 |
| compose-verify-issues | lispfns | ✅ | 7 | 6 | 4.0k | 22.3k/1.2k | 0 | 0.0013 |
| incident-branch | baseline | ✅ | 3 | 2 | 3.6k | 10.1k/145 | 0 | 0.0005 |
| incident-branch | scratchpad | ❌ | 2 | 1 | 1.8k | 3.5k/103 | 0 | 0.0002 |
| incident-branch | lisp | ✅ | 2 | 1 | 2.3k | 4.4k/230 | 0 | 0.0003 |
| incident-branch | jsrepl | ❌ | 5 | 4 | 2.3k | 10.8k/163 | 0 | 0.0006 |
| incident-branch | lispfns | ✅ | 4 | 3 | 2.5k | 9.4k/257 | 0 | 0.0005 |
| open-prs-breakdown | baseline | ❌ | 2 | 1 | 5.0k | 8.0k/63 | 0 | 0.0004 |
| open-prs-breakdown | scratchpad | ✅ | 4 | 5 | 2.3k | 7.8k/254 | 0 | 0.0004 |
| open-prs-breakdown | lisp | ❌ | 25 | 24 | 10.6k | 112.4k/2.0k | 1 | 0.0060 |
| open-prs-breakdown | jsrepl | ❌ | 7 | 6 | 2.6k | 15.7k/348 | 0 | 0.0009 |
| open-prs-breakdown | lispfns | ✅ | 5 | 4 | 2.5k | 11.7k/223 | 0 | 0.0006 |
| reconcile-ghost-issues | baseline | ❌ | 11 | 10 | 6.5k | 58.1k/356 | 0 | 0.0030 |
| reconcile-ghost-issues | scratchpad | ❌ | 3 | 2 | 2.0k | 5.5k/161 | 0 | 0.0003 |
| reconcile-ghost-issues | lisp | ❌ | 2 | 1 | 2.3k | 4.4k/173 | 0 | 0.0003 |
| reconcile-ghost-issues | jsrepl | ❌ | 9 | 8 | 2.7k | 20.4k/585 | 0 | 0.0011 |
| reconcile-ghost-issues | lispfns | ERR | 1 | 1 | 2.2k | 2.2k/21 | 0 | 0.0001 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 4.7k | 7.6k/425 | 0 | 0.0008 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/110 | 0 | 0.0004 |
| count-open-prs | lisp | ✅ | 2 | 1 | 2.3k | 4.5k/108 | 0 | 0.0004 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.3k | 4.5k/107 | 0 | 0.0004 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.4k | 4.8k/128 | 0 | 0.0005 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.3k | 6.4k/189 | 0 | 0.0006 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/242 | 0 | 0.0006 |
| sentry-billing-unresolved | lisp | ✅ | 4 | 3 | 2.7k | 10.1k/289 | 0 | 0.0010 |
| sentry-billing-unresolved | jsrepl | ✅ | 3 | 2 | 2.6k | 7.1k/286 | 0 | 0.0007 |
| sentry-billing-unresolved | lispfns | ✅ | 4 | 3 | 2.9k | 10.6k/333 | 0 | 0.0010 |
| merged-prs-open-linear | baseline | ✅ | 3 | 10 | 6.0k | 13.7k/1.0k | 0 | 0.0014 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 2.6k | 6.8k/737 | 0 | 0.0007 |
| merged-prs-open-linear | lisp | ✅ | 7 | 6 | 5.2k | 27.6k/1.3k | 0 | 0.0027 |
| merged-prs-open-linear | jsrepl | ✅ | 6 | 9 | 10.1k | 45.9k/2.7k | 0 | 0.0046 |
| merged-prs-open-linear | lispfns | ✅ | 13 | 14 | 6.8k | 62.2k/2.2k | 0 | 0.0060 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 3.7k | 6.6k/232 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/260 | 0 | 0.0006 |
| busiest-assignee | lisp | ✅ | 3 | 2 | 3.0k | 8.2k/311 | 0 | 0.0008 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 3.2k | 8.3k/492 | 0 | 0.0008 |
| busiest-assignee | lispfns | ✅ | 3 | 2 | 3.3k | 8.7k/494 | 0 | 0.0009 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.5k/325 | 0 | 0.0006 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 2.3k | 6.1k/377 | 0 | 0.0006 |
| high-urgency-triggered | lisp | ✅ | 3 | 2 | 2.8k | 7.5k/332 | 0 | 0.0007 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.6k | 4.8k/320 | 0 | 0.0005 |
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 2.9k | 7.8k/298 | 0 | 0.0008 |
| email-top-error | baseline | ✅ | 3 | 2 | 5.1k | 13.2k/756 | 0 | 0.0013 |
| email-top-error | scratchpad | ✅ | 5 | 5 | 2.8k | 11.8k/653 | 0 | 0.0012 |
| email-top-error | lisp | ✅ | 5 | 4 | 3.0k | 13.2k/546 | 0 | 0.0013 |
| email-top-error | jsrepl | ✅ | 5 | 4 | 4.8k | 18.3k/737 | 0 | 0.0018 |
| email-top-error | lispfns | ✅ | 6 | 5 | 5.0k | 22.2k/970 | 0 | 0.0022 |
| compose-verify-issues | baseline | ✅ | 3 | 10 | 6.4k | 14.2k/3.3k | 0 | 0.0019 |
| compose-verify-issues | scratchpad | ✅ | 5 | 5 | 3.2k | 13.1k/1.2k | 0 | 0.0014 |
| compose-verify-issues | lisp | ✅ | 7 | 7 | 4.5k | 23.3k/1.3k | 0 | 0.0023 |
| compose-verify-issues | jsrepl | ✅ | 8 | 7 | 6.7k | 38.4k/2.0k | 0 | 0.0038 |
| compose-verify-issues | lispfns | ✅ | 6 | 5 | 6.3k | 26.7k/1.8k | 0 | 0.0027 |
| incident-branch | baseline | ✅ | 3 | 2 | 3.5k | 9.9k/376 | 0 | 0.0010 |
| incident-branch | scratchpad | ✅ | 5 | 5 | 2.9k | 12.2k/744 | 0 | 0.0012 |
| incident-branch | lisp | ✅ | 4 | 6 | 3.6k | 12.0k/593 | 0 | 0.0012 |
| incident-branch | jsrepl | ✅ | 5 | 4 | 2.8k | 12.6k/473 | 0 | 0.0012 |
| incident-branch | lispfns | ✅ | 3 | 2 | 3.1k | 8.3k/418 | 0 | 0.0008 |
| open-prs-breakdown | baseline | ✅ | 2 | 1 | 4.8k | 7.9k/551 | 0 | 0.0008 |
| open-prs-breakdown | scratchpad | ✅ | 3 | 2 | 2.3k | 6.2k/247 | 0 | 0.0006 |
| open-prs-breakdown | lisp | ✅ | 4 | 3 | 2.7k | 10.1k/408 | 0 | 0.0010 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 2.6k | 7.1k/389 | 0 | 0.0007 |
| open-prs-breakdown | lispfns | ✅ | 9 | 8 | 4.1k | 32.5k/792 | 0 | 0.0031 |
| reconcile-ghost-issues | baseline | ERR | 3 | 10 | 8.0k | 14.8k/2.3k | 0 | 0.0017 |
| reconcile-ghost-issues | scratchpad | ERR | 8 | 10 | 6.5k | 28.4k/1.9k | 0 | 0.0029 |
| reconcile-ghost-issues | lisp | ✅ | 7 | 8 | 4.3k | 23.3k/2.1k | 0 | 0.0025 |
| reconcile-ghost-issues | jsrepl | ✅ | 12 | 15 | 7.2k | 61.2k/5.6k | 0 | 0.0065 |
| reconcile-ghost-issues | lispfns | ❌ | 10 | 14 | 7.5k | 55.4k/3.1k | 0 | 0.0056 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 88% | 2.8 | 3.4 | 5.3k | 12.7k | 624 | 0.00 | 0.0031 |
| scratchpad | 90% | 3.8 | 3.1 | 2.6k | 9.5k | 456 | 0.00 | 0.0025 |
| lisp | 95% | 4.2 | 3.3 | 3.0k | 12.7k | 525 | 0.02 | 0.0026 |
| jsrepl | 78% | 4.6 | 3.8 | 3.4k | 14.5k | 820 | 0.00 | 0.0033 |
| lispfns | 90% | 4.9 | 4.0 | 3.6k | 17.1k | 810 | 0.00 | 0.0038 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 1.1×, peak context 2.1×, input tokens 1.3×, cost 1.2×.

**Reduction factors (baseline ÷ lisp):** tool calls 1.0×, peak context 1.7×, input tokens 1.0×, cost 1.2×.

**Reduction factors (baseline ÷ jsrepl):** tool calls 0.9×, peak context 1.5×, input tokens 0.9×, cost 0.9×.

**Reduction factors (baseline ÷ lispfns):** tool calls 0.8×, peak context 1.5×, input tokens 0.7×, cost 0.8×.
