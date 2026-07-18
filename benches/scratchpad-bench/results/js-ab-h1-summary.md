# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.7k | 5.3k/93 | 0 | 0.0012 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 3.6k | 12.2k/607 | 0 | 0.0030 |
| merged-prs-open-linear | jsrepl | ✅ | 10 | 9 | 7.2k | 52.3k/2.3k | 0 | 0.0127 |
| busiest-assignee | jsrepl | ✅ | 6 | 5 | 5.7k | 27.5k/1.2k | 0 | 0.0067 |
| high-urgency-triggered | jsrepl | ✅ | 8 | 7 | 6.0k | 37.6k/1.3k | 0 | 0.0091 |
| email-top-error | jsrepl | ✅ | 11 | 10 | 5.1k | 41.8k/2.0k | 0 | 0.0102 |
| compose-verify-issues | jsrepl | ✅ | 13 | 12 | 8.2k | 77.2k/2.3k | 0 | 0.0185 |
| incident-branch | jsrepl | ✅ | 6 | 5 | 4.2k | 20.6k/1.2k | 0 | 0.0051 |
| open-prs-breakdown | jsrepl | ✅ | 6 | 5 | 4.2k | 20.7k/1.2k | 0 | 0.0052 |
| reconcile-ghost-issues | jsrepl | ✅ | 10 | 9 | 8.8k | 59.4k/2.9k | 0 | 0.0146 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.8k | 5.5k/66 | 0 | 0.0017 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 2.9k | 5.6k/250 | 0 | 0.0020 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 3.6k | 15.8k/623 | 0 | 0.0055 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 3.0k | 8.5k/236 | 0 | 0.0028 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.9k | 5.6k/260 | 0 | 0.0020 |
| email-top-error | jsrepl | ✅ | 4 | 3 | 3.2k | 11.7k/551 | 0 | 0.0042 |
| compose-verify-issues | jsrepl | ✅ | 4 | 3 | 4.5k | 14.1k/840 | 0 | 0.0052 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 3.1k | 8.7k/434 | 0 | 0.0031 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 3.3k | 9.0k/388 | 0 | 0.0032 |
| reconcile-ghost-issues | jsrepl | ✅ | 7 | 6 | 4.9k | 26.2k/1.7k | 0 | 0.0099 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.5k | 4.9k/171 | 0 | 0.0033 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 2.6k | 5.0k/261 | 0 | 0.0035 |
| merged-prs-open-linear | jsrepl | ✅ | 6 | 5 | 3.5k | 17.5k/797 | 0 | 0.0120 |
| busiest-assignee | jsrepl | ✅ | 4 | 3 | 2.9k | 10.5k/476 | 0 | 0.0072 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.7k | 5.1k/223 | 0 | 0.0035 |
| email-top-error | jsrepl | ✅ | 4 | 3 | 2.9k | 10.7k/525 | 0 | 0.0074 |
| compose-verify-issues | jsrepl | ❌ | 5 | 4 | 3.0k | 13.9k/706 | 0 | 0.0097 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 2.9k | 8.1k/611 | 0 | 0.0060 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 2.7k | 5.2k/351 | 0 | 0.0038 |
| reconcile-ghost-issues | jsrepl | ✅ | 5 | 4 | 4.7k | 17.5k/1.4k | 0 | 0.0131 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.6k | 5.1k/89 | 0 | 0.0006 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 2.9k | 10.8k/272 | 0 | 0.0012 |
| merged-prs-open-linear | jsrepl | ✅ | 7 | 6 | 4.7k | 26.8k/1.1k | 0 | 0.0031 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 3.0k | 8.3k/320 | 0 | 0.0010 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.8k | 5.3k/257 | 0 | 0.0006 |
| email-top-error | jsrepl | ✅ | 3 | 2 | 5.3k | 12.8k/510 | 0 | 0.0015 |
| compose-verify-issues | jsrepl | ✅ | 8 | 7 | 5.6k | 36.1k/1.1k | 0 | 0.0041 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 3.3k | 9.0k/409 | 0 | 0.0011 |
| open-prs-breakdown | jsrepl | ✅ | 4 | 3 | 3.4k | 12.0k/712 | 0 | 0.0015 |
| reconcile-ghost-issues | jsrepl | ✅ | 5 | 4 | 6.1k | 22.7k/1.4k | 0 | 0.0028 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.5k | 4.9k/34 | 0 | 0.0003 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 2.6k | 5.0k/93 | 0 | 0.0003 |
| merged-prs-open-linear | jsrepl | ❌ | 2 | 1 | 2.8k | 5.3k/467 | 0 | 0.0004 |
| busiest-assignee | jsrepl | ✅ | 11 | 10 | 5.8k | 40.8k/2.5k | 0 | 0.0025 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 2.6k | 5.0k/121 | 0 | 0.0003 |
| email-top-error | jsrepl | ❌ | 2 | 1 | 2.7k | 5.1k/134 | 0 | 0.0003 |
| compose-verify-issues | jsrepl | ❌ | 3 | 2 | 3.1k | 8.4k/626 | 0 | 0.0005 |
| incident-branch | jsrepl | ❌ | 6 | 5 | 4.1k | 21.1k/261 | 0 | 0.0011 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 2.7k | 5.2k/185 | 0 | 0.0003 |
| reconcile-ghost-issues | jsrepl | ❌ | 17 | 16 | 6.9k | 76.7k/4.1k | 0 | 0.0046 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.7k | 5.4k/141 | 0 | 0.0005 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.0k | 5.6k/230 | 0 | 0.0005 |
| merged-prs-open-linear | jsrepl | ✅ | 6 | 5 | 5.5k | 26.9k/1.2k | 0 | 0.0026 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 3.6k | 9.7k/462 | 0 | 0.0010 |
| high-urgency-triggered | jsrepl | ✅ | 3 | 2 | 2.9k | 8.3k/355 | 0 | 0.0008 |
| email-top-error | jsrepl | ✅ | 7 | 6 | 4.9k | 29.8k/762 | 0 | 0.0028 |
| compose-verify-issues | jsrepl | ✅ | 5 | 4 | 7.3k | 26.8k/1.7k | 0 | 0.0027 |
| incident-branch | jsrepl | ✅ | 4 | 3 | 3.2k | 11.9k/548 | 0 | 0.0012 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 4.8k | 11.9k/539 | 0 | 0.0012 |
| reconcile-ghost-issues | jsrepl | ✅ | 11 | 10 | 8.5k | 64.6k/4.9k | 0 | 0.0067 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| jsrepl | 90% | 4.7 | 3.7 | 4.0k | 18.2k | 856 | 0.00 | 0.0041 |
