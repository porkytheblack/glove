# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (3 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.5k | 6.4k/64 | 0 | 0.0015 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.6k | 6.9k/175 | 0 | 0.0016 |
| merged-prs-open-linear | polyglot | ✅ | 3 | 2 | 5.0k | 12.8k/978 | 0 | 0.0033 |
| busiest-assignee | polyglot | ✅ | 4 | 3 | 4.3k | 15.2k/887 | 0 | 0.0038 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 4.0k | 7.3k/364 | 0 | 0.0018 |
| email-top-error | polyglot | ✅ | 4 | 3 | 4.6k | 15.9k/984 | 0 | 0.0040 |
| compose-verify-issues | polyglot | ✅ | 10 | 9 | 7.9k | 58.2k/2.8k | 0 | 0.0143 |
| incident-branch | polyglot | ✅ | 3 | 2 | 3.9k | 10.9k/424 | 0 | 0.0026 |
| open-prs-breakdown | polyglot | ✅ | 2 | 1 | 3.8k | 7.1k/350 | 0 | 0.0017 |
| reconcile-ghost-issues | polyglot | ✅ | 5 | 4 | 8.3k | 29.9k/2.0k | 0 | 0.0075 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.4k | 6.7k/76 | 0 | 0.0021 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.4k | 6.7k/161 | 0 | 0.0022 |
| merged-prs-open-linear | polyglot | ✅ | 4 | 3 | 4.4k | 15.4k/613 | 0 | 0.0054 |
| busiest-assignee | polyglot | ✅ | 4 | 3 | 3.9k | 14.1k/382 | 0 | 0.0047 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.5k | 6.7k/156 | 0 | 0.0022 |
| email-top-error | polyglot | ✅ | 3 | 2 | 3.7k | 10.5k/333 | 0 | 0.0036 |
| compose-verify-issues | polyglot | ✅ | 4 | 3 | 5.2k | 16.1k/855 | 0 | 0.0058 |
| incident-branch | polyglot | ✅ | 2 | 1 | 3.7k | 7.0k/484 | 0 | 0.0027 |
| open-prs-breakdown | polyglot | ✅ | 6 | 5 | 4.2k | 22.7k/1.3k | 0 | 0.0084 |
| reconcile-ghost-issues | polyglot | ❌ | 25 | 26 | 8.5k | 139.7k/6.0k | 1 | 0.0491 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.1k | 6.2k/115 | 0 | 0.0039 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.2k | 6.2k/168 | 0 | 0.0041 |
| merged-prs-open-linear | polyglot | ✅ | 6 | 5 | 6.3k | 30.2k/1.2k | 0 | 0.0203 |
| busiest-assignee | polyglot | ✅ | 2 | 1 | 3.2k | 6.3k/234 | 0 | 0.0042 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.2k | 6.2k/209 | 0 | 0.0041 |
| email-top-error | polyglot | ✅ | 3 | 2 | 3.4k | 9.7k/479 | 0 | 0.0068 |
| compose-verify-issues | polyglot | ✅ | 5 | 4 | 3.9k | 17.5k/1.1k | 0 | 0.0125 |
| incident-branch | polyglot | ✅ | 3 | 2 | 3.7k | 10.3k/471 | 0 | 0.0071 |
| open-prs-breakdown | polyglot | ✅ | 3 | 2 | 3.4k | 9.7k/494 | 0 | 0.0068 |
| reconcile-ghost-issues | polyglot | ✅ | 6 | 5 | 4.9k | 23.7k/1.8k | 0 | 0.0177 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 3 | 2 | 3.4k | 9.9k/173 | 0 | 0.0011 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.4k | 6.6k/146 | 0 | 0.0007 |
| merged-prs-open-linear | polyglot | ✅ | 7 | 6 | 8.2k | 41.8k/1.4k | 0 | 0.0048 |
| busiest-assignee | polyglot | ✅ | 4 | 3 | 3.6k | 13.7k/393 | 0 | 0.0015 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.4k | 6.6k/215 | 0 | 0.0007 |
| email-top-error | polyglot | ✅ | 3 | 2 | 3.7k | 10.4k/379 | 0 | 0.0012 |
| compose-verify-issues | polyglot | ✅ | 3 | 2 | 4.1k | 10.9k/769 | 0 | 0.0014 |
| incident-branch | polyglot | ✅ | 2 | 1 | 3.6k | 6.8k/276 | 0 | 0.0008 |
| open-prs-breakdown | polyglot | ✅ | 3 | 2 | 3.8k | 10.4k/512 | 0 | 0.0012 |
| reconcile-ghost-issues | polyglot | ✅ | 2 | 1 | 4.1k | 7.3k/784 | 0 | 0.0010 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 3 | 2 | 3.2k | 9.3k/73 | 0 | 0.0005 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.2k | 6.2k/97 | 0 | 0.0003 |
| merged-prs-open-linear | polyglot | ✅ | 2 | 1 | 3.5k | 6.5k/303 | 0 | 0.0004 |
| busiest-assignee | polyglot | ✅ | 4 | 3 | 3.7k | 13.4k/560 | 0 | 0.0008 |
| high-urgency-triggered | polyglot | ❌ | 2 | 1 | 3.2k | 6.2k/101 | 0 | 0.0003 |
| email-top-error | polyglot | ✅ | 2 | 1 | 3.4k | 6.4k/206 | 0 | 0.0004 |
| compose-verify-issues | polyglot | ✅ | 4 | 3 | 3.9k | 13.8k/598 | 0 | 0.0008 |
| incident-branch | polyglot | ✅ | 4 | 3 | 3.9k | 14.0k/715 | 0 | 0.0008 |
| open-prs-breakdown | polyglot | ❌ | 2 | 1 | 3.3k | 6.3k/149 | 0 | 0.0003 |
| reconcile-ghost-issues | polyglot | ❌ | 4 | 3 | 4.0k | 13.9k/753 | 0 | 0.0008 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.4k | 6.7k/86 | 0 | 0.0006 |
| sentry-billing-unresolved | polyglot | ✅ | 3 | 2 | 3.8k | 10.5k/308 | 0 | 0.0010 |
| merged-prs-open-linear | polyglot | ✅ | 11 | 10 | 6.1k | 48.4k/1.8k | 0 | 0.0047 |
| busiest-assignee | polyglot | ✅ | 2 | 1 | 3.5k | 6.8k/172 | 0 | 0.0006 |
| high-urgency-triggered | polyglot | ✅ | 3 | 2 | 3.6k | 10.4k/386 | 0 | 0.0010 |
| email-top-error | polyglot | ✅ | 4 | 3 | 4.3k | 15.8k/379 | 0 | 0.0015 |
| compose-verify-issues | polyglot | ✅ | 4 | 3 | 5.8k | 19.8k/1.5k | 0 | 0.0021 |
| incident-branch | polyglot | ✅ | 4 | 3 | 4.1k | 15.3k/351 | 0 | 0.0014 |
| open-prs-breakdown | polyglot | ✅ | 4 | 3 | 3.8k | 14.1k/388 | 0 | 0.0013 |
| reconcile-ghost-issues | polyglot | ❌ | 17 | 16 | 14.1k | 119.4k/2.8k | 1 | 0.0113 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| polyglot | 92% | 4.0 | 3.0 | 4.3k | 17.2k | 707 | 0.03 | 0.0044 |
