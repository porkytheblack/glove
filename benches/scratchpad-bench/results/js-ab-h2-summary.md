# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.5k | 7.0k/89 | 0 | 0.0016 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.2k | 6.4k/90 | 0 | 0.0015 |
| sentry-billing-unresolved | jsrepl | ✅ | 5 | 4 | 4.4k | 19.5k/783 | 0 | 0.0047 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.4k | 6.5k/145 | 0 | 0.0015 |
| merged-prs-open-linear | jsrepl | ✅ | 7 | 6 | 6.7k | 34.8k/2.3k | 0 | 0.0087 |
| merged-prs-open-linear | lispfns | ✅ | 11 | 10 | 5.1k | 44.7k/1.3k | 0 | 0.0107 |
| busiest-assignee | jsrepl | ✅ | 7 | 6 | 6.5k | 34.1k/2.1k | 0 | 0.0085 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.5k | 6.7k/290 | 0 | 0.0016 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 4.0k | 7.4k/328 | 0 | 0.0018 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.5k | 6.6k/228 | 0 | 0.0016 |
| email-top-error | jsrepl | ✅ | 7 | 6 | 5.9k | 32.3k/1.6k | 0 | 0.0079 |
| email-top-error | lispfns | ✅ | 8 | 7 | 4.6k | 31.5k/886 | 0 | 0.0075 |
| compose-verify-issues | jsrepl | ✅ | 6 | 5 | 7.5k | 32.9k/1.2k | 0 | 0.0080 |
| compose-verify-issues | lispfns | ✅ | 7 | 6 | 4.6k | 27.4k/804 | 0 | 0.0066 |
| incident-branch | jsrepl | ✅ | 5 | 4 | 4.7k | 20.8k/811 | 0 | 0.0050 |
| incident-branch | lispfns | ✅ | 5 | 4 | 3.9k | 17.9k/587 | 0 | 0.0043 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 4.2k | 11.5k/675 | 0 | 0.0029 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.5k | 6.7k/207 | 0 | 0.0016 |
| reconcile-ghost-issues | jsrepl | ERR | 10 | 10 | 7.9k | 54.7k/3.4k | 0 | 0.0137 |
| reconcile-ghost-issues | lispfns | ✅ | 4 | 3 | 4.8k | 16.0k/1.1k | 0 | 0.0041 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.5k | 6.8k/77 | 0 | 0.0021 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.2k | 6.3k/81 | 0 | 0.0020 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.6k | 7.0k/320 | 0 | 0.0025 |
| sentry-billing-unresolved | lispfns | ❌ | 2 | 1 | 3.2k | 6.4k/101 | 0 | 0.0020 |
| merged-prs-open-linear | jsrepl | ✅ | 4 | 3 | 4.2k | 15.1k/618 | 0 | 0.0053 |
| merged-prs-open-linear | lispfns | ✅ | 9 | 8 | 6.8k | 43.7k/1.1k | 0 | 0.0144 |
| busiest-assignee | jsrepl | ✅ | 2 | 1 | 3.6k | 7.0k/262 | 0 | 0.0024 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.3k | 6.4k/171 | 0 | 0.0021 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.5k | 6.9k/186 | 0 | 0.0023 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.3k | 6.4k/136 | 0 | 0.0021 |
| email-top-error | jsrepl | ❌ | 2 | 1 | 3.7k | 7.1k/358 | 0 | 0.0026 |
| email-top-error | lispfns | ✅ | 3 | 2 | 3.4k | 9.9k/363 | 0 | 0.0034 |
| compose-verify-issues | jsrepl | ✅ | 4 | 3 | 4.4k | 15.9k/647 | 0 | 0.0055 |
| compose-verify-issues | lispfns | ✅ | 5 | 4 | 3.9k | 17.6k/1.0k | 0 | 0.0065 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 3.7k | 10.8k/370 | 0 | 0.0037 |
| incident-branch | lispfns | ✅ | 3 | 2 | 3.4k | 9.9k/328 | 0 | 0.0034 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 3.7k | 7.1k/256 | 0 | 0.0025 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.4k | 6.5k/227 | 0 | 0.0022 |
| reconcile-ghost-issues | jsrepl | ✅ | 2 | 1 | 3.9k | 7.3k/653 | 0 | 0.0030 |
| reconcile-ghost-issues | lispfns | ✅ | 24 | 22 | 6.3k | 113.2k/3.5k | 1 | 0.0382 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.2k | 6.3k/121 | 0 | 0.0040 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.9k | 5.8k/159 | 0 | 0.0038 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.3k | 6.4k/213 | 0 | 0.0043 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.0k | 5.9k/167 | 0 | 0.0038 |
| merged-prs-open-linear | jsrepl | ✅ | 4 | 3 | 4.1k | 14.3k/840 | 0 | 0.0102 |
| merged-prs-open-linear | lispfns | ✅ | 3 | 2 | 3.4k | 9.4k/690 | 0 | 0.0070 |
| busiest-assignee | jsrepl | ✅ | 2 | 1 | 3.4k | 6.5k/269 | 0 | 0.0044 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.2k | 6.0k/198 | 0 | 0.0040 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.3k | 6.4k/259 | 0 | 0.0043 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.0k | 5.9k/223 | 0 | 0.0040 |
| email-top-error | jsrepl | ✅ | 2 | 1 | 3.5k | 6.6k/485 | 0 | 0.0049 |
| email-top-error | lispfns | ✅ | 2 | 1 | 3.1k | 6.0k/412 | 0 | 0.0044 |
| compose-verify-issues | jsrepl | ✅ | 3 | 2 | 3.5k | 9.9k/330 | 0 | 0.0066 |
| compose-verify-issues | lispfns | ✅ | 4 | 3 | 3.2k | 12.2k/397 | 0 | 0.0081 |
| incident-branch | jsrepl | ✅ | 2 | 1 | 3.5k | 6.7k/406 | 0 | 0.0048 |
| incident-branch | lispfns | ✅ | 2 | 1 | 3.1k | 6.1k/473 | 0 | 0.0046 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 3.4k | 6.5k/392 | 0 | 0.0047 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.1k | 6.0k/338 | 0 | 0.0042 |
| reconcile-ghost-issues | jsrepl | ✅ | 4 | 3 | 4.2k | 15.1k/956 | 0 | 0.0109 |
| reconcile-ghost-issues | lispfns | ✅ | 3 | 2 | 3.7k | 10.0k/1.1k | 0 | 0.0081 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.3k | 6.6k/125 | 0 | 0.0007 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.1k | 6.1k/124 | 0 | 0.0007 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.5k | 6.7k/201 | 0 | 0.0008 |
| sentry-billing-unresolved | lispfns | ✅ | 3 | 2 | 3.5k | 9.8k/305 | 0 | 0.0011 |
| merged-prs-open-linear | jsrepl | ✅ | 8 | 7 | 5.2k | 34.8k/1.3k | 0 | 0.0040 |
| merged-prs-open-linear | lispfns | ✅ | 6 | 5 | 4.5k | 22.5k/1.1k | 0 | 0.0027 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 3.6k | 10.3k/413 | 0 | 0.0012 |
| busiest-assignee | lispfns | ✅ | 3 | 2 | 4.0k | 10.9k/226 | 0 | 0.0012 |
| high-urgency-triggered | jsrepl | ✅ | 3 | 2 | 4.0k | 11.0k/434 | 0 | 0.0013 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.4k | 6.4k/251 | 0 | 0.0007 |
| email-top-error | jsrepl | ✅ | 5 | 4 | 3.8k | 17.6k/344 | 0 | 0.0019 |
| email-top-error | lispfns | ✅ | 4 | 3 | 5.6k | 19.5k/402 | 0 | 0.0022 |
| compose-verify-issues | jsrepl | ✅ | 3 | 2 | 4.0k | 10.9k/696 | 0 | 0.0013 |
| compose-verify-issues | lispfns | ✅ | 4 | 3 | 6.0k | 20.2k/1.2k | 0 | 0.0025 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 4.0k | 11.1k/443 | 0 | 0.0013 |
| incident-branch | lispfns | ✅ | 3 | 2 | 3.7k | 10.2k/318 | 0 | 0.0012 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 5.6k | 14.2k/374 | 0 | 0.0016 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.2k | 6.2k/205 | 0 | 0.0007 |
| reconcile-ghost-issues | jsrepl | ✅ | 3 | 2 | 4.5k | 12.0k/994 | 0 | 0.0015 |
| reconcile-ghost-issues | lispfns | ✅ | 4 | 3 | 4.7k | 15.0k/1.3k | 0 | 0.0019 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.2k | 6.3k/34 | 0 | 0.0003 |
| count-open-prs | lispfns | ✅ | 16 | 15 | 5.0k | 58.0k/705 | 0 | 0.0030 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.3k | 6.5k/99 | 0 | 0.0003 |
| sentry-billing-unresolved | lispfns | ✅ | 3 | 2 | 3.2k | 9.0k/106 | 0 | 0.0005 |
| merged-prs-open-linear | jsrepl | ✅ | 2 | 1 | 3.6k | 6.7k/327 | 0 | 0.0004 |
| merged-prs-open-linear | lispfns | ✅ | 4 | 3 | 5.3k | 16.2k/343 | 0 | 0.0009 |
| busiest-assignee | jsrepl | ✅ | 2 | 1 | 3.4k | 6.5k/155 | 0 | 0.0004 |
| busiest-assignee | lispfns | ❌ | 11 | 10 | 4.0k | 36.0k/939 | 0 | 0.0020 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.3k | 6.4k/121 | 0 | 0.0003 |
| high-urgency-triggered | lispfns | ❌ | 4 | 3 | 3.1k | 11.8k/133 | 0 | 0.0006 |
| email-top-error | jsrepl | ✅ | 2 | 1 | 3.3k | 6.5k/150 | 0 | 0.0004 |
| email-top-error | lispfns | ❌ | 7 | 6 | 3.4k | 21.6k/492 | 0 | 0.0012 |
| compose-verify-issues | jsrepl | ✅ | 2 | 1 | 3.5k | 6.7k/215 | 0 | 0.0004 |
| compose-verify-issues | lispfns | ❌ | 10 | 9 | 4.1k | 33.9k/665 | 0 | 0.0018 |
| incident-branch | jsrepl | ✅ | 2 | 1 | 3.4k | 6.6k/184 | 0 | 0.0004 |
| incident-branch | lispfns | ❌ | 4 | 3 | 3.1k | 12.1k/144 | 0 | 0.0006 |
| open-prs-breakdown | jsrepl | ✅ | 10 | 9 | 6.5k | 40.8k/1.3k | 0 | 0.0023 |
| open-prs-breakdown | lispfns | ✅ | 3 | 2 | 3.1k | 9.0k/125 | 0 | 0.0005 |
| reconcile-ghost-issues | jsrepl | ❌ | 25 | 24 | 7.7k | 123.2k/6.4k | 1 | 0.0074 |
| reconcile-ghost-issues | lispfns | ❌ | 18 | 17 | 5.4k | 78.2k/815 | 0 | 0.0041 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.5k | 6.9k/124 | 0 | 0.0006 |
| count-open-prs | lispfns | ✅ | 3 | 2 | 3.4k | 9.8k/173 | 0 | 0.0009 |
| sentry-billing-unresolved | jsrepl | ✅ | 3 | 2 | 3.8k | 10.7k/295 | 0 | 0.0010 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.4k | 6.6k/183 | 0 | 0.0006 |
| merged-prs-open-linear | jsrepl | ✅ | 4 | 3 | 5.4k | 17.5k/1.2k | 0 | 0.0018 |
| merged-prs-open-linear | lispfns | ✅ | 10 | 11 | 9.1k | 63.5k/2.4k | 0 | 0.0062 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 4.4k | 12.0k/362 | 0 | 0.0011 |
| busiest-assignee | lispfns | ✅ | 3 | 2 | 4.1k | 11.1k/367 | 0 | 0.0011 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.8k | 7.2k/293 | 0 | 0.0007 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.5k | 6.7k/216 | 0 | 0.0006 |
| email-top-error | jsrepl | ✅ | 4 | 3 | 4.0k | 15.0k/634 | 0 | 0.0015 |
| email-top-error | lispfns | ✅ | 5 | 4 | 5.8k | 23.4k/866 | 0 | 0.0023 |
| compose-verify-issues | jsrepl | ✅ | 4 | 3 | 4.9k | 16.3k/1.1k | 0 | 0.0017 |
| compose-verify-issues | lispfns | ✅ | 6 | 5 | 6.3k | 31.3k/2.1k | 0 | 0.0032 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 4.1k | 11.5k/452 | 0 | 0.0011 |
| incident-branch | lispfns | ✅ | 6 | 5 | 4.0k | 21.9k/644 | 0 | 0.0021 |
| open-prs-breakdown | jsrepl | ✅ | 4 | 3 | 5.8k | 20.4k/411 | 0 | 0.0019 |
| open-prs-breakdown | lispfns | ✅ | 4 | 3 | 3.5k | 13.5k/349 | 0 | 0.0013 |
| reconcile-ghost-issues | jsrepl | ✅ | 6 | 5 | 5.8k | 27.4k/2.2k | 0 | 0.0029 |
| reconcile-ghost-issues | lispfns | ✅ | 10 | 9 | 6.5k | 44.9k/3.8k | 0 | 0.0047 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| jsrepl | 95% | 3.8 | 2.8 | 4.3k | 15.5k | 712 | 0.02 | 0.0033 |
| lispfns | 88% | 4.8 | 3.8 | 4.1k | 18.6k | 630 | 0.02 | 0.0037 |
