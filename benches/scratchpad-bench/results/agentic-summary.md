# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (32 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.8k | 6.7k/190 | 0 | 0.0016 |
| sentry-billing-unresolved | scratchpad | ✅ | 10 | 9 | 3.0k | 21.4k/953 | 0 | 0.0052 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 8.1k | 17.0k/1.7k | 0 | 0.0045 |
| merged-prs-open-linear | scratchpad | ✅ | 8 | 7 | 3.3k | 17.5k/1.1k | 0 | 0.0044 |
| busiest-assignee | baseline | ✅ | 3 | 2 | 5.7k | 12.9k/479 | 0 | 0.0031 |
| busiest-assignee | scratchpad | ✅ | 8 | 7 | 2.7k | 16.0k/778 | 0 | 0.0039 |
| email-top-error | baseline | ✅ | 3 | 2 | 7.0k | 16.4k/688 | 0 | 0.0040 |
| email-top-error | scratchpad | ✅ | 26 | 25 | 6.5k | 98.3k/3.3k | 0 | 0.0237 |
| compose-verify-issues | baseline | ✅ | 18 | 16 | 8.9k | 115.7k/2.7k | 1 | 0.0274 |
| compose-verify-issues | scratchpad | ❌ | 31 | 30 | 6.5k | 118.7k/3.2k | 1 | 0.0283 |
| count-open-prs | baseline | ❌ | 2 | 1 | 6.6k | 9.6k/79 | 0 | 0.0022 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.9k | 6.2k/307 | 0 | 0.0015 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.3k | 6.3k/145 | 0 | 0.0015 |
| high-urgency-triggered | scratchpad | ✅ | 9 | 8 | 2.9k | 18.1k/940 | 0 | 0.0045 |

## z-ai/glm-4.7-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 6.5k | 9.5k/200 | 0 | 0.0006 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.4k | 4.9k/226 | 0 | 0.0004 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.7k | 6.6k/309 | 0 | 0.0005 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.4k | 4.8k/312 | 0 | 0.0004 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 7.5k | 16.5k/1.5k | 0 | 0.0016 |
| merged-prs-open-linear | scratchpad | ✅ | 5 | 6 | 2.2k | 7.9k/939 | 0 | 0.0008 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.2k | 7.2k/332 | 0 | 0.0006 |
| busiest-assignee | scratchpad | ✅ | 7 | 6 | 1.7k | 9.8k/652 | 0 | 0.0008 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.2k | 6.2k/171 | 0 | 0.0004 |
| high-urgency-triggered | scratchpad | ❌ | 6 | 5 | 1.5k | 7.6k/564 | 0 | 0.0007 |
| email-top-error | baseline | ❌ | 2 | 1 | 3.0k | 6.0k/151 | 0 | 0.0004 |
| email-top-error | scratchpad | ❌ | 4 | 3 | 1.4k | 4.9k/272 | 0 | 0.0004 |
| compose-verify-issues | baseline | ✅ | 3 | 16 | 7.3k | 16.4k/1.4k | 0 | 0.0016 |
| compose-verify-issues | scratchpad | ✅ | 9 | 8 | 5.9k | 27.3k/1.6k | 0 | 0.0023 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 8.0k | 11.8k/123 | 0 | 0.0013 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.6k | 5.6k/207 | 0 | 0.0006 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 4.7k | 8.5k/378 | 0 | 0.0010 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.7k | 5.6k/287 | 0 | 0.0007 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 9.5k | 20.8k/1.7k | 0 | 0.0027 |
| merged-prs-open-linear | scratchpad | ✅ | 6 | 9 | 3.0k | 12.0k/956 | 0 | 0.0015 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 5.4k | 9.2k/344 | 0 | 0.0011 |
| busiest-assignee | scratchpad | ❌ | 30 | 31 | 4.1k | 84.4k/2.8k | 0 | 0.0096 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 4.1k | 8.0k/272 | 0 | 0.0009 |
| high-urgency-triggered | scratchpad | ❌ | 30 | 31 | 4.0k | 80.6k/3.3k | 0 | 0.0094 |
| email-top-error | baseline | ✅ | 3 | 2 | 7.9k | 19.4k/443 | 0 | 0.0022 |
| email-top-error | scratchpad | ✅ | 10 | 10 | 2.9k | 20.6k/1.0k | 0 | 0.0025 |
| compose-verify-issues | baseline | ✅ | 3 | 16 | 9.1k | 20.5k/2.7k | 0 | 0.0029 |
| compose-verify-issues | scratchpad | ❌ | 31 | 34 | 6.9k | 123.1k/9.5k | 1 | 0.0156 |

## minimax/minimax-m2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 6.4k | 9.3k/681 | 0 | 0.0014 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.5k | 5.0k/271 | 0 | 0.0007 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.6k | 6.5k/311 | 0 | 0.0009 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.5k | 5.0k/400 | 0 | 0.0008 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 7.6k | 16.5k/1.9k | 0 | 0.0029 |
| merged-prs-open-linear | scratchpad | ❌ | 30 | 30 | 4.5k | 90.4k/3.2k | 0 | 0.0124 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.2k | 7.1k/279 | 0 | 0.0010 |
| busiest-assignee | scratchpad | ✅ | 6 | 5 | 1.8k | 8.4k/480 | 0 | 0.0012 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.2k | 6.1k/269 | 0 | 0.0009 |
| high-urgency-triggered | scratchpad | ✅ | 6 | 5 | 1.7k | 8.2k/454 | 0 | 0.0012 |
| email-top-error | baseline | ✅ | 3 | 2 | 6.2k | 15.2k/790 | 0 | 0.0022 |
| email-top-error | scratchpad | ✅ | 19 | 18 | 8.3k | 74.6k/2.8k | 0 | 0.0103 |
| compose-verify-issues | baseline | ❌ | 4 | 14 | 6.8k | 21.9k/3.0k | 0 | 0.0040 |
| compose-verify-issues | scratchpad | ❌ | 31 | 30 | 5.8k | 102.4k/4.0k | 1 | 0.0142 |

## moonshotai/kimi-k2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 4.7k | 6.0k/507 | 0 | 0.0033 |
| count-open-prs | scratchpad | ✅ | 4 | 3 | 1.3k | 4.2k/222 | 0 | 0.0020 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 2.0k | 3.2k/208 | 0 | 0.0016 |
| sentry-billing-unresolved | scratchpad | ✅ | 4 | 3 | 1.3k | 4.2k/391 | 0 | 0.0024 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 6.0k | 11.5k/1.5k | 0 | 0.0074 |
| merged-prs-open-linear | scratchpad | ✅ | 4 | 4 | 1.8k | 4.9k/812 | 0 | 0.0035 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 2.5k | 3.8k/336 | 0 | 0.0021 |
| busiest-assignee | scratchpad | ✅ | 4 | 4 | 1.4k | 4.5k/437 | 0 | 0.0026 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 1.5k | 2.8k/213 | 0 | 0.0015 |
| high-urgency-triggered | scratchpad | ❌ | 4 | 3 | 1.2k | 4.1k/249 | 0 | 0.0020 |
| email-top-error | baseline | ❌ | 3 | 2 | 4.5k | 10.1k/394 | 0 | 0.0046 |
| email-top-error | scratchpad | ✅ | 7 | 7 | 1.8k | 9.7k/871 | 0 | 0.0054 |
| compose-verify-issues | baseline | ✅ | 3 | 16 | 5.7k | 11.3k/1.8k | 0 | 0.0079 |
| compose-verify-issues | scratchpad | ✅ | 9 | 11 | 3.2k | 18.1k/1.4k | 0 | 0.0096 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 83% | 2.9 | 5.2 | 5.5k | 13.8k | 803 | 0.03 | 0.0030 |
| scratchpad | 74% | 11.0 | 10.7 | 3.0k | 29.7k | 1.4k | 0.09 | 0.0053 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 0.5×, peak context 1.9×, input tokens 0.5×, cost 0.6×.
