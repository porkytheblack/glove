# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| busiest-assignee | pyrepl | ✅ | 9 | 8 | 4.8k | 34.4k/1.1k | 0 | 0.0083 |
| busiest-assignee | jsrepl | ✅ | 8 | 7 | 5.4k | 33.1k/1.5k | 0 | 0.0081 |
| busiest-assignee | lispfns | ✅ | 5 | 4 | 3.8k | 15.1k/710 | 0 | 0.0037 |
| compose-verify-issues | pyrepl | ✅ | 13 | 12 | 6.5k | 63.4k/1.4k | 0 | 0.0150 |
| compose-verify-issues | jsrepl | ERR | 18 | 17 | 11.4k | 110.3k/5.2k | 1 | 0.0270 |
| compose-verify-issues | lispfns | ✅ | 9 | 8 | 4.7k | 31.3k/1.2k | 0 | 0.0076 |
| count-open-prs | pyrepl | ✅ | 4 | 3 | 3.6k | 12.9k/284 | 0 | 0.0031 |
| count-open-prs | jsrepl | ✅ | 3 | 2 | 3.0k | 8.3k/208 | 0 | 0.0020 |
| count-open-prs | lispfns | ✅ | 4 | 3 | 2.8k | 10.1k/285 | 0 | 0.0024 |
| email-top-error | pyrepl | ✅ | 7 | 6 | 4.6k | 26.3k/846 | 0 | 0.0063 |
| email-top-error | jsrepl | ✅ | 9 | 8 | 5.9k | 36.9k/1.9k | 0 | 0.0091 |
| email-top-error | lispfns | ✅ | 8 | 7 | 4.1k | 26.2k/1.0k | 0 | 0.0064 |
| high-urgency-triggered | pyrepl | ✅ | 6 | 5 | 3.8k | 19.4k/640 | 0 | 0.0047 |
| high-urgency-triggered | jsrepl | ✅ | 7 | 6 | 3.8k | 21.9k/729 | 0 | 0.0053 |
| high-urgency-triggered | lispfns | ✅ | 4 | 3 | 2.8k | 10.0k/340 | 0 | 0.0024 |
| incident-branch | pyrepl | ✅ | 8 | 7 | 4.3k | 28.2k/786 | 0 | 0.0067 |
| incident-branch | jsrepl | ✅ | 7 | 6 | 4.3k | 23.7k/652 | 0 | 0.0057 |
| incident-branch | lispfns | ✅ | 7 | 6 | 3.5k | 19.7k/643 | 0 | 0.0047 |
| merged-prs-open-linear | pyrepl | ✅ | 13 | 12 | 7.2k | 66.5k/1.7k | 0 | 0.0158 |
| merged-prs-open-linear | jsrepl | ✅ | 13 | 12 | 8.3k | 70.2k/3.7k | 0 | 0.0173 |
| merged-prs-open-linear | lispfns | ✅ | 10 | 9 | 6.0k | 38.3k/1.8k | 0 | 0.0094 |
| open-prs-breakdown | pyrepl | ✅ | 4 | 3 | 3.3k | 12.2k/599 | 0 | 0.0030 |
| open-prs-breakdown | jsrepl | ✅ | 7 | 6 | 4.4k | 23.8k/1.3k | 0 | 0.0059 |
| open-prs-breakdown | lispfns | ✅ | 4 | 3 | 3.0k | 10.2k/480 | 0 | 0.0025 |
| reconcile-ghost-issues | pyrepl | ERR | 16 | 15 | 10.7k | 96.8k/5.7k | 1 | 0.0241 |
| reconcile-ghost-issues | jsrepl | ✅ | 11 | 10 | 8.7k | 58.1k/3.4k | 0 | 0.0144 |
| reconcile-ghost-issues | lispfns | ✅ | 15 | 14 | 7.0k | 70.6k/2.9k | 0 | 0.0172 |
| sentry-billing-unresolved | pyrepl | ✅ | 6 | 5 | 4.0k | 20.4k/711 | 0 | 0.0049 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 3.6k | 12.3k/432 | 0 | 0.0030 |
| sentry-billing-unresolved | lispfns | ✅ | 4 | 3 | 3.0k | 10.3k/363 | 0 | 0.0025 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| busiest-assignee | pyrepl | ✅ | 5 | 4 | 3.7k | 16.2k/473 | 0 | 0.0018 |
| busiest-assignee | jsrepl | ✅ | 6 | 5 | 3.6k | 18.5k/501 | 0 | 0.0021 |
| busiest-assignee | lispfns | ✅ | 4 | 3 | 2.9k | 10.1k/320 | 0 | 0.0011 |
| compose-verify-issues | pyrepl | ERR | 6 | 6 | 4.2k | 20.2k/906 | 0 | 0.0024 |
| compose-verify-issues | jsrepl | ERR | 5 | 5 | 4.3k | 16.1k/689 | 0 | 0.0019 |
| compose-verify-issues | lispfns | ERR | 8 | 9 | 4.0k | 25.8k/1.1k | 0 | 0.0030 |
| count-open-prs | pyrepl | ✅ | 4 | 3 | 3.1k | 11.3k/209 | 0 | 0.0012 |
| count-open-prs | jsrepl | ✅ | 3 | 2 | 2.7k | 7.7k/217 | 0 | 0.0009 |
| count-open-prs | lispfns | ✅ | 3 | 2 | 2.3k | 6.6k/136 | 0 | 0.0007 |
| email-top-error | pyrepl | ✅ | 7 | 7 | 3.7k | 22.5k/760 | 0 | 0.0026 |
| email-top-error | jsrepl | ✅ | 5 | 4 | 3.5k | 14.7k/504 | 0 | 0.0017 |
| email-top-error | lispfns | ✅ | 4 | 5 | 2.9k | 10.0k/425 | 0 | 0.0012 |
| high-urgency-triggered | pyrepl | ✅ | 4 | 3 | 3.1k | 11.1k/418 | 0 | 0.0013 |
| high-urgency-triggered | jsrepl | ✅ | 3 | 2 | 2.8k | 7.8k/311 | 0 | 0.0009 |
| high-urgency-triggered | lispfns | ✅ | 5 | 4 | 2.6k | 11.7k/334 | 0 | 0.0013 |
| incident-branch | pyrepl | ✅ | 5 | 4 | 3.8k | 15.9k/573 | 0 | 0.0018 |
| incident-branch | jsrepl | ✅ | 4 | 5 | 3.6k | 12.5k/685 | 0 | 0.0015 |
| incident-branch | lispfns | ✅ | 4 | 5 | 3.4k | 11.4k/804 | 0 | 0.0014 |
| merged-prs-open-linear | pyrepl | ✅ | 7 | 6 | 5.2k | 26.4k/1.1k | 0 | 0.0031 |
| merged-prs-open-linear | jsrepl | ✅ | 10 | 9 | 5.6k | 40.3k/1.4k | 0 | 0.0046 |
| merged-prs-open-linear | lispfns | ✅ | 6 | 7 | 4.5k | 21.5k/866 | 0 | 0.0025 |
| open-prs-breakdown | pyrepl | ✅ | 6 | 5 | 3.9k | 20.0k/596 | 0 | 0.0023 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 3.1k | 8.3k/387 | 0 | 0.0010 |
| open-prs-breakdown | lispfns | ✅ | 4 | 3 | 2.6k | 9.5k/327 | 0 | 0.0011 |
| reconcile-ghost-issues | pyrepl | ERR | 17 | 17 | 11.1k | 100.3k/3.5k | 1 | 0.0115 |
| reconcile-ghost-issues | jsrepl | ✅ | 7 | 7 | 5.8k | 28.8k/1.8k | 0 | 0.0035 |
| reconcile-ghost-issues | lispfns | ✅ | 6 | 7 | 4.6k | 20.7k/1.5k | 0 | 0.0026 |
| sentry-billing-unresolved | pyrepl | ✅ | 4 | 3 | 3.4k | 12.0k/350 | 0 | 0.0014 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 3.3k | 11.7k/280 | 0 | 0.0013 |
| sentry-billing-unresolved | lispfns | ✅ | 3 | 2 | 2.7k | 7.2k/228 | 0 | 0.0008 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| busiest-assignee | pyrepl | ✅ | 7 | 6 | 4.2k | 24.0k/621 | 0 | 0.0013 |
| busiest-assignee | jsrepl | ✅ | 9 | 8 | 4.6k | 32.5k/1.1k | 0 | 0.0018 |
| busiest-assignee | lispfns | ✅ | 8 | 7 | 3.5k | 22.7k/250 | 0 | 0.0012 |
| compose-verify-issues | pyrepl | ✅ | 7 | 6 | 4.4k | 24.7k/330 | 0 | 0.0013 |
| compose-verify-issues | jsrepl | ✅ | 7 | 6 | 4.3k | 24.2k/350 | 0 | 0.0013 |
| compose-verify-issues | lispfns | ❌ | 9 | 8 | 3.8k | 27.1k/302 | 0 | 0.0014 |
| count-open-prs | pyrepl | ✅ | 3 | 2 | 2.7k | 7.6k/55 | 0 | 0.0004 |
| count-open-prs | jsrepl | ✅ | 3 | 2 | 2.6k | 7.4k/56 | 0 | 0.0004 |
| count-open-prs | lispfns | ❌ | 7 | 6 | 3.0k | 17.3k/170 | 0 | 0.0009 |
| email-top-error | pyrepl | ❌ | 14 | 13 | 4.2k | 49.6k/752 | 0 | 0.0026 |
| email-top-error | jsrepl | ✅ | 6 | 5 | 3.6k | 18.7k/345 | 0 | 0.0010 |
| email-top-error | lispfns | ✅ | 6 | 5 | 3.1k | 15.7k/378 | 0 | 0.0009 |
| high-urgency-triggered | pyrepl | ❌ | 4 | 3 | 2.9k | 10.7k/157 | 0 | 0.0006 |
| high-urgency-triggered | jsrepl | ✅ | 6 | 5 | 3.2k | 16.4k/305 | 0 | 0.0009 |
| high-urgency-triggered | lispfns | ✅ | 7 | 6 | 2.7k | 16.6k/253 | 0 | 0.0009 |
| incident-branch | pyrepl | ❌ | 7 | 6 | 3.9k | 23.5k/431 | 0 | 0.0013 |
| incident-branch | jsrepl | ✅ | 8 | 7 | 4.0k | 25.5k/545 | 0 | 0.0014 |
| incident-branch | lispfns | ❌ | 7 | 6 | 3.0k | 17.6k/222 | 0 | 0.0009 |
| merged-prs-open-linear | pyrepl | ✅ | 8 | 7 | 4.6k | 29.0k/520 | 0 | 0.0015 |
| merged-prs-open-linear | jsrepl | ❌ | 9 | 8 | 4.7k | 32.8k/735 | 0 | 0.0018 |
| merged-prs-open-linear | lispfns | ✅ | 14 | 13 | 6.0k | 52.3k/887 | 0 | 0.0028 |
| open-prs-breakdown | pyrepl | ✅ | 4 | 3 | 3.0k | 10.8k/179 | 0 | 0.0006 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 2.8k | 7.7k/198 | 0 | 0.0004 |
| open-prs-breakdown | lispfns | ❌ | 7 | 6 | 3.0k | 17.4k/238 | 0 | 0.0009 |
| reconcile-ghost-issues | pyrepl | ❌ | 7 | 6 | 4.4k | 24.5k/601 | 0 | 0.0013 |
| reconcile-ghost-issues | jsrepl | ❌ | 6 | 5 | 4.0k | 19.8k/311 | 0 | 0.0011 |
| reconcile-ghost-issues | lispfns | ❌ | 25 | 24 | 5.6k | 95.8k/2.3k | 1 | 0.0052 |
| sentry-billing-unresolved | pyrepl | ✅ | 5 | 4 | 3.2k | 14.2k/168 | 0 | 0.0007 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 3.0k | 10.8k/148 | 0 | 0.0006 |
| sentry-billing-unresolved | lispfns | ❌ | 7 | 6 | 3.2k | 18.9k/205 | 0 | 0.0010 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| pyrepl | 77% | 7.2 | 6.3 | 4.5k | 28.5k | 878 | 0.07 | 0.0044 |
| jsrepl | 87% | 6.6 | 5.7 | 4.5k | 25.4k | 995 | 0.03 | 0.0043 |
| lispfns | 77% | 7.1 | 6.5 | 3.7k | 22.6k | 699 | 0.03 | 0.0030 |
