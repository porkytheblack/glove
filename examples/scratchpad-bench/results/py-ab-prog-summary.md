# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 4 | 3 | 3.6k | 12.3k/256 | 0 | 0.0029 |
| count-open-prs | jsrepl | ✅ | 4 | 3 | 3.6k | 11.8k/269 | 0 | 0.0028 |
| count-open-prs | lispfns | ✅ | 5 | 4 | 3.1k | 12.9k/282 | 0 | 0.0031 |
| sentry-billing-unresolved | pyrepl | ✅ | 5 | 4 | 3.7k | 15.6k/462 | 0 | 0.0037 |
| sentry-billing-unresolved | jsrepl | ✅ | 8 | 7 | 4.4k | 26.7k/1.2k | 0 | 0.0065 |
| sentry-billing-unresolved | lispfns | ✅ | 5 | 4 | 3.2k | 13.1k/432 | 0 | 0.0031 |
| merged-prs-open-linear | pyrepl | ✅ | 8 | 7 | 6.0k | 32.8k/1.2k | 0 | 0.0079 |
| merged-prs-open-linear | jsrepl | ✅ | 13 | 12 | 7.5k | 63.5k/2.8k | 0 | 0.0155 |
| merged-prs-open-linear | lispfns | ✅ | 7 | 6 | 4.4k | 21.3k/1.0k | 0 | 0.0052 |
| busiest-assignee | pyrepl | ✅ | 6 | 5 | 4.5k | 20.4k/943 | 0 | 0.0050 |
| busiest-assignee | jsrepl | ✅ | 6 | 5 | 5.2k | 21.3k/1.8k | 0 | 0.0055 |
| busiest-assignee | lispfns | ✅ | 6 | 5 | 3.7k | 17.3k/829 | 0 | 0.0042 |
| high-urgency-triggered | pyrepl | ✅ | 5 | 4 | 3.8k | 15.8k/551 | 0 | 0.0038 |
| high-urgency-triggered | jsrepl | ✅ | 8 | 7 | 4.2k | 26.8k/846 | 0 | 0.0064 |
| high-urgency-triggered | lispfns | ✅ | 5 | 4 | 3.3k | 13.5k/531 | 0 | 0.0033 |
| email-top-error | pyrepl | ✅ | 5 | 4 | 3.9k | 15.9k/695 | 0 | 0.0039 |
| email-top-error | jsrepl | ✅ | 6 | 5 | 4.8k | 20.8k/1.4k | 0 | 0.0052 |
| email-top-error | lispfns | ✅ | 10 | 9 | 4.0k | 31.3k/995 | 0 | 0.0075 |
| compose-verify-issues | pyrepl | ✅ | 10 | 9 | 5.8k | 42.3k/1.5k | 0 | 0.0102 |
| compose-verify-issues | jsrepl | ✅ | 10 | 9 | 6.8k | 44.6k/2.2k | 0 | 0.0110 |
| compose-verify-issues | lispfns | ✅ | 10 | 9 | 4.7k | 33.9k/1.1k | 0 | 0.0081 |
| incident-branch | pyrepl | ✅ | 7 | 6 | 4.4k | 24.5k/741 | 0 | 0.0059 |
| incident-branch | jsrepl | ✅ | 8 | 7 | 5.0k | 29.4k/1.5k | 0 | 0.0072 |
| incident-branch | lispfns | ✅ | 8 | 7 | 3.9k | 24.3k/1.0k | 0 | 0.0059 |
| open-prs-breakdown | pyrepl | ✅ | 4 | 3 | 3.9k | 12.6k/569 | 0 | 0.0031 |
| open-prs-breakdown | jsrepl | ✅ | 7 | 6 | 4.5k | 23.7k/1.4k | 0 | 0.0059 |
| open-prs-breakdown | lispfns | ✅ | 6 | 5 | 3.5k | 16.9k/688 | 0 | 0.0041 |
| reconcile-ghost-issues | pyrepl | ✅ | 7 | 6 | 7.3k | 29.5k/2.4k | 0 | 0.0076 |
| reconcile-ghost-issues | jsrepl | ✅ | 15 | 14 | 11.6k | 92.8k/6.2k | 0 | 0.0234 |
| reconcile-ghost-issues | lispfns | ✅ | 10 | 9 | 6.2k | 37.6k/2.4k | 0 | 0.0094 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 3 | 2 | 2.9k | 8.1k/130 | 0 | 0.0026 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.5k | 4.8k/122 | 0 | 0.0016 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.1k | 4.2k/90 | 0 | 0.0014 |
| sentry-billing-unresolved | pyrepl | ✅ | 5 | 4 | 3.2k | 14.7k/268 | 0 | 0.0047 |
| sentry-billing-unresolved | jsrepl | ✅ | 5 | 4 | 3.2k | 14.4k/322 | 0 | 0.0047 |
| sentry-billing-unresolved | lispfns | ✅ | 5 | 4 | 2.8k | 12.7k/259 | 0 | 0.0041 |
| merged-prs-open-linear | pyrepl | ✅ | 6 | 6 | 4.5k | 21.7k/616 | 0 | 0.0072 |
| merged-prs-open-linear | jsrepl | ✅ | 11 | 11 | 5.6k | 45.4k/1.6k | 0 | 0.0155 |
| merged-prs-open-linear | lispfns | ✅ | 11 | 13 | 6.2k | 50.8k/1.2k | 0 | 0.0167 |
| busiest-assignee | pyrepl | ✅ | 9 | 8 | 3.8k | 29.3k/598 | 0 | 0.0095 |
| busiest-assignee | jsrepl | ✅ | 4 | 3 | 3.4k | 11.7k/319 | 0 | 0.0039 |
| busiest-assignee | lispfns | ✅ | 5 | 4 | 3.1k | 13.2k/345 | 0 | 0.0044 |
| high-urgency-triggered | pyrepl | ✅ | 4 | 4 | 3.5k | 12.1k/382 | 0 | 0.0041 |
| high-urgency-triggered | jsrepl | ✅ | 4 | 3 | 3.2k | 11.4k/269 | 0 | 0.0037 |
| high-urgency-triggered | lispfns | ✅ | 4 | 3 | 2.8k | 9.9k/256 | 0 | 0.0033 |
| email-top-error | pyrepl | ✅ | 5 | 4 | 3.7k | 15.9k/363 | 0 | 0.0052 |
| email-top-error | jsrepl | ❌ | 4 | 4 | 3.5k | 11.7k/406 | 0 | 0.0040 |
| email-top-error | lispfns | ✅ | 6 | 7 | 3.3k | 16.7k/483 | 0 | 0.0056 |
| compose-verify-issues | pyrepl | ✅ | 6 | 6 | 5.4k | 22.7k/993 | 0 | 0.0080 |
| compose-verify-issues | jsrepl | ✅ | 6 | 9 | 5.5k | 22.4k/929 | 0 | 0.0078 |
| compose-verify-issues | lispfns | ✅ | 7 | 8 | 4.1k | 22.1k/755 | 0 | 0.0075 |
| incident-branch | pyrepl | ✅ | 5 | 6 | 4.0k | 16.8k/465 | 0 | 0.0056 |
| incident-branch | jsrepl | ✅ | 6 | 5 | 3.4k | 18.3k/448 | 0 | 0.0060 |
| incident-branch | lispfns | ✅ | 5 | 6 | 3.1k | 13.7k/501 | 0 | 0.0047 |
| open-prs-breakdown | pyrepl | ✅ | 7 | 6 | 4.3k | 23.5k/2.2k | 0 | 0.0097 |
| open-prs-breakdown | jsrepl | ✅ | 4 | 3 | 3.6k | 12.1k/377 | 0 | 0.0041 |
| open-prs-breakdown | lispfns | ✅ | 4 | 3 | 3.4k | 10.1k/345 | 0 | 0.0035 |
| reconcile-ghost-issues | pyrepl | ✅ | 7 | 7 | 4.6k | 26.0k/754 | 0 | 0.0087 |
| reconcile-ghost-issues | jsrepl | ✅ | 5 | 5 | 3.9k | 15.7k/858 | 0 | 0.0058 |
| reconcile-ghost-issues | lispfns | ✅ | 9 | 14 | 4.8k | 31.7k/2.6k | 0 | 0.0126 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 3 | 2 | 2.6k | 7.3k/211 | 0 | 0.0048 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 2.2k | 4.3k/127 | 0 | 0.0028 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 1.9k | 3.7k/123 | 0 | 0.0025 |
| sentry-billing-unresolved | pyrepl | ✅ | 3 | 3 | 2.9k | 7.8k/331 | 0 | 0.0053 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 2.8k | 10.1k/339 | 0 | 0.0067 |
| sentry-billing-unresolved | lispfns | ✅ | 4 | 3 | 2.5k | 8.8k/361 | 0 | 0.0060 |
| merged-prs-open-linear | pyrepl | ✅ | 4 | 4 | 4.2k | 12.4k/895 | 0 | 0.0091 |
| merged-prs-open-linear | jsrepl | ✅ | 4 | 4 | 3.9k | 11.9k/706 | 0 | 0.0085 |
| merged-prs-open-linear | lispfns | ✅ | 8 | 10 | 3.6k | 23.4k/976 | 0 | 0.0159 |
| busiest-assignee | pyrepl | ✅ | 5 | 4 | 3.2k | 14.0k/461 | 0 | 0.0093 |
| busiest-assignee | jsrepl | ✅ | 4 | 3 | 3.1k | 10.5k/403 | 0 | 0.0071 |
| busiest-assignee | lispfns | ✅ | 6 | 5 | 2.9k | 14.8k/357 | 0 | 0.0096 |
| high-urgency-triggered | pyrepl | ✅ | 5 | 4 | 3.0k | 13.5k/392 | 0 | 0.0088 |
| high-urgency-triggered | jsrepl | ✅ | 4 | 3 | 2.9k | 10.2k/396 | 0 | 0.0069 |
| high-urgency-triggered | lispfns | ✅ | 4 | 3 | 2.5k | 8.9k/348 | 0 | 0.0060 |
| email-top-error | pyrepl | ✅ | 4 | 4 | 3.3k | 11.1k/591 | 0 | 0.0078 |
| email-top-error | jsrepl | ✅ | 4 | 4 | 3.3k | 10.9k/748 | 0 | 0.0079 |
| email-top-error | lispfns | ✅ | 4 | 6 | 2.9k | 9.9k/712 | 0 | 0.0073 |
| compose-verify-issues | pyrepl | ✅ | 8 | 7 | 4.0k | 25.6k/1.0k | 0 | 0.0173 |
| compose-verify-issues | jsrepl | ✅ | 5 | 5 | 4.6k | 16.6k/1.1k | 0 | 0.0120 |
| compose-verify-issues | lispfns | ✅ | 8 | 10 | 3.6k | 22.8k/1.0k | 0 | 0.0156 |
| incident-branch | pyrepl | ✅ | 4 | 5 | 3.6k | 11.8k/701 | 0 | 0.0084 |
| incident-branch | jsrepl | ✅ | 5 | 5 | 3.3k | 13.8k/743 | 0 | 0.0097 |
| incident-branch | lispfns | ✅ | 3 | 5 | 2.8k | 7.3k/633 | 0 | 0.0056 |
| open-prs-breakdown | pyrepl | ✅ | 8 | 7 | 3.5k | 22.9k/935 | 0 | 0.0155 |
| open-prs-breakdown | jsrepl | ✅ | 4 | 3 | 3.2k | 10.8k/468 | 0 | 0.0074 |
| open-prs-breakdown | lispfns | ✅ | 4 | 3 | 2.5k | 8.9k/408 | 0 | 0.0061 |
| reconcile-ghost-issues | pyrepl | ✅ | 4 | 4 | 4.1k | 12.3k/786 | 0 | 0.0089 |
| reconcile-ghost-issues | jsrepl | ✅ | 5 | 5 | 4.2k | 16.1k/983 | 0 | 0.0115 |
| reconcile-ghost-issues | lispfns | ✅ | 5 | 6 | 3.4k | 13.0k/944 | 0 | 0.0096 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 5 | 4 | 3.0k | 13.5k/464 | 0 | 0.0015 |
| count-open-prs | jsrepl | ✅ | 3 | 2 | 2.6k | 7.3k/109 | 0 | 0.0008 |
| count-open-prs | lispfns | ✅ | 4 | 3 | 2.5k | 9.0k/218 | 0 | 0.0010 |
| sentry-billing-unresolved | pyrepl | ✅ | 4 | 3 | 3.0k | 10.6k/461 | 0 | 0.0012 |
| sentry-billing-unresolved | jsrepl | ✅ | 5 | 4 | 3.0k | 13.2k/359 | 0 | 0.0015 |
| sentry-billing-unresolved | lispfns | ✅ | 5 | 4 | 2.6k | 11.7k/446 | 0 | 0.0014 |
| merged-prs-open-linear | pyrepl | ✅ | 6 | 6 | 5.0k | 22.3k/1.2k | 0 | 0.0027 |
| merged-prs-open-linear | jsrepl | ✅ | 8 | 8 | 5.0k | 30.8k/1.2k | 0 | 0.0036 |
| merged-prs-open-linear | lispfns | ✅ | 6 | 7 | 3.9k | 16.3k/1.2k | 0 | 0.0020 |
| busiest-assignee | pyrepl | ✅ | 6 | 5 | 3.5k | 17.8k/646 | 0 | 0.0020 |
| busiest-assignee | jsrepl | ✅ | 5 | 4 | 3.3k | 14.1k/630 | 0 | 0.0017 |
| busiest-assignee | lispfns | ✅ | 7 | 6 | 3.1k | 17.9k/736 | 0 | 0.0021 |
| high-urgency-triggered | pyrepl | ✅ | 5 | 4 | 3.5k | 14.3k/662 | 0 | 0.0017 |
| high-urgency-triggered | jsrepl | ✅ | 4 | 3 | 2.9k | 10.3k/374 | 0 | 0.0012 |
| high-urgency-triggered | lispfns | ✅ | 6 | 5 | 2.8k | 14.7k/391 | 0 | 0.0016 |
| email-top-error | pyrepl | ✅ | 7 | 6 | 7.6k | 33.1k/981 | 0 | 0.0038 |
| email-top-error | jsrepl | ✅ | 6 | 6 | 3.3k | 17.1k/732 | 0 | 0.0020 |
| email-top-error | lispfns | ✅ | 4 | 4 | 2.8k | 9.5k/418 | 0 | 0.0011 |
| compose-verify-issues | pyrepl | ✅ | 6 | 6 | 4.9k | 21.7k/1.5k | 0 | 0.0027 |
| compose-verify-issues | jsrepl | ✅ | 7 | 8 | 4.1k | 22.3k/1.4k | 0 | 0.0027 |
| compose-verify-issues | lispfns | ERR | 14 | 16 | 6.1k | 63.6k/2.5k | 0 | 0.0074 |
| incident-branch | pyrepl | ✅ | 5 | 6 | 3.8k | 15.8k/930 | 0 | 0.0019 |
| incident-branch | jsrepl | ✅ | 6 | 6 | 3.3k | 16.9k/590 | 0 | 0.0019 |
| incident-branch | lispfns | ✅ | 4 | 5 | 3.1k | 10.1k/469 | 0 | 0.0012 |
| open-prs-breakdown | pyrepl | ✅ | 4 | 3 | 3.2k | 10.9k/479 | 0 | 0.0013 |
| open-prs-breakdown | jsrepl | ✅ | 4 | 3 | 3.1k | 10.6k/549 | 0 | 0.0013 |
| open-prs-breakdown | lispfns | ✅ | 4 | 3 | 2.8k | 9.4k/380 | 0 | 0.0011 |
| reconcile-ghost-issues | pyrepl | ERR | 5 | 6 | 5.6k | 18.9k/2.0k | 0 | 0.0026 |
| reconcile-ghost-issues | jsrepl | ✅ | 4 | 4 | 4.1k | 12.3k/2.0k | 0 | 0.0018 |
| reconcile-ghost-issues | lispfns | ✅ | 7 | 8 | 4.4k | 22.6k/2.2k | 0 | 0.0030 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 6 | 5 | 3.3k | 17.4k/127 | 0 | 0.0009 |
| count-open-prs | jsrepl | ✅ | 4 | 3 | 3.0k | 10.5k/70 | 0 | 0.0005 |
| count-open-prs | lispfns | ✅ | 5 | 4 | 2.6k | 11.4k/96 | 0 | 0.0006 |
| sentry-billing-unresolved | pyrepl | ✅ | 5 | 4 | 3.1k | 13.4k/156 | 0 | 0.0007 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 2.9k | 10.1k/139 | 0 | 0.0005 |
| sentry-billing-unresolved | lispfns | ❌ | 5 | 4 | 2.5k | 11.1k/131 | 0 | 0.0006 |
| merged-prs-open-linear | pyrepl | ❌ | 7 | 6 | 4.1k | 22.6k/369 | 0 | 0.0012 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 3.9k | 14.8k/386 | 0 | 0.0008 |
| merged-prs-open-linear | lispfns | ✅ | 15 | 14 | 5.1k | 50.0k/1.7k | 0 | 0.0028 |
| busiest-assignee | pyrepl | ❌ | 7 | 6 | 3.5k | 20.7k/356 | 0 | 0.0011 |
| busiest-assignee | jsrepl | ✅ | 13 | 12 | 4.5k | 44.7k/1.2k | 0 | 0.0025 |
| busiest-assignee | lispfns | ✅ | 5 | 4 | 2.8k | 11.6k/189 | 0 | 0.0006 |
| high-urgency-triggered | pyrepl | ❌ | 5 | 4 | 3.1k | 13.6k/167 | 0 | 0.0007 |
| high-urgency-triggered | jsrepl | ✅ | 4 | 3 | 3.0k | 10.3k/177 | 0 | 0.0005 |
| high-urgency-triggered | lispfns | ✅ | 5 | 4 | 2.6k | 11.3k/174 | 0 | 0.0006 |
| email-top-error | pyrepl | ✅ | 5 | 4 | 3.2k | 13.6k/226 | 0 | 0.0007 |
| email-top-error | jsrepl | ❌ | 18 | 17 | 7.5k | 82.5k/2.3k | 0 | 0.0046 |
| email-top-error | lispfns | ✅ | 5 | 4 | 2.8k | 11.5k/289 | 0 | 0.0006 |
| compose-verify-issues | pyrepl | ✅ | 7 | 6 | 4.1k | 22.9k/242 | 0 | 0.0012 |
| compose-verify-issues | jsrepl | ✅ | 6 | 5 | 3.5k | 17.6k/210 | 0 | 0.0009 |
| compose-verify-issues | lispfns | ✅ | 9 | 8 | 5.5k | 28.7k/342 | 0 | 0.0015 |
| incident-branch | pyrepl | ✅ | 7 | 6 | 3.7k | 21.0k/572 | 0 | 0.0012 |
| incident-branch | jsrepl | ❌ | 5 | 4 | 3.3k | 13.7k/206 | 0 | 0.0007 |
| incident-branch | lispfns | ✅ | 9 | 8 | 3.4k | 24.2k/835 | 0 | 0.0014 |
| open-prs-breakdown | pyrepl | ❌ | 6 | 5 | 3.5k | 17.9k/274 | 0 | 0.0009 |
| open-prs-breakdown | jsrepl | ❌ | 10 | 9 | 4.2k | 33.2k/1.1k | 0 | 0.0019 |
| open-prs-breakdown | lispfns | ✅ | 6 | 5 | 2.9k | 14.6k/216 | 0 | 0.0008 |
| reconcile-ghost-issues | pyrepl | ❌ | 7 | 6 | 4.3k | 23.1k/784 | 0 | 0.0013 |
| reconcile-ghost-issues | jsrepl | ❌ | 5 | 4 | 3.7k | 14.6k/237 | 0 | 0.0008 |
| reconcile-ghost-issues | lispfns | ❌ | 8 | 7 | 3.5k | 21.8k/337 | 0 | 0.0012 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 4 | 3 | 4.9k | 13.1k/407 | 0 | 0.0013 |
| count-open-prs | jsrepl | ✅ | 4 | 3 | 3.3k | 11.6k/264 | 0 | 0.0011 |
| count-open-prs | lispfns | ✅ | 5 | 4 | 2.9k | 12.7k/395 | 0 | 0.0012 |
| sentry-billing-unresolved | pyrepl | ✅ | 4 | 3 | 3.2k | 11.4k/384 | 0 | 0.0011 |
| sentry-billing-unresolved | jsrepl | ✅ | 4 | 3 | 3.3k | 11.3k/318 | 0 | 0.0011 |
| sentry-billing-unresolved | lispfns | ✅ | 6 | 5 | 3.2k | 15.9k/477 | 0 | 0.0015 |
| merged-prs-open-linear | pyrepl | ✅ | 10 | 11 | 5.3k | 42.2k/1.6k | 0 | 0.0041 |
| merged-prs-open-linear | jsrepl | ✅ | 11 | 12 | 5.9k | 49.0k/1.6k | 0 | 0.0047 |
| merged-prs-open-linear | lispfns | ✅ | 13 | 14 | 5.9k | 53.9k/2.4k | 0 | 0.0053 |
| busiest-assignee | pyrepl | ✅ | 5 | 4 | 3.6k | 15.3k/459 | 0 | 0.0015 |
| busiest-assignee | jsrepl | ✅ | 8 | 7 | 4.2k | 27.2k/1.1k | 0 | 0.0026 |
| busiest-assignee | lispfns | ✅ | 6 | 5 | 3.5k | 16.8k/717 | 0 | 0.0016 |
| high-urgency-triggered | pyrepl | ✅ | 5 | 4 | 3.4k | 14.7k/463 | 0 | 0.0014 |
| high-urgency-triggered | jsrepl | ✅ | 4 | 3 | 3.2k | 11.3k/373 | 0 | 0.0011 |
| high-urgency-triggered | lispfns | ✅ | 5 | 4 | 3.2k | 12.9k/414 | 0 | 0.0012 |
| email-top-error | pyrepl | ✅ | 5 | 5 | 3.9k | 16.0k/802 | 0 | 0.0016 |
| email-top-error | jsrepl | ✅ | 6 | 6 | 5.7k | 24.9k/1.8k | 0 | 0.0026 |
| email-top-error | lispfns | ✅ | 7 | 7 | 5.3k | 25.2k/1.1k | 0 | 0.0025 |
| compose-verify-issues | pyrepl | ✅ | 5 | 5 | 5.5k | 19.1k/1.7k | 0 | 0.0020 |
| compose-verify-issues | jsrepl | ✅ | 8 | 8 | 5.7k | 32.9k/1.6k | 0 | 0.0032 |
| compose-verify-issues | lispfns | ✅ | 8 | 11 | 6.7k | 34.9k/2.8k | 0 | 0.0036 |
| incident-branch | pyrepl | ✅ | 5 | 6 | 3.9k | 16.1k/680 | 0 | 0.0016 |
| incident-branch | jsrepl | ✅ | 6 | 7 | 4.0k | 20.5k/866 | 0 | 0.0020 |
| incident-branch | lispfns | ✅ | 6 | 10 | 4.2k | 19.0k/799 | 0 | 0.0019 |
| open-prs-breakdown | pyrepl | ✅ | 6 | 5 | 3.8k | 19.4k/572 | 0 | 0.0019 |
| open-prs-breakdown | jsrepl | ✅ | 5 | 4 | 4.0k | 16.0k/819 | 0 | 0.0016 |
| open-prs-breakdown | lispfns | ✅ | 6 | 5 | 3.2k | 16.1k/568 | 0 | 0.0016 |
| reconcile-ghost-issues | pyrepl | ✅ | 15 | 15 | 6.3k | 70.6k/4.5k | 0 | 0.0072 |
| reconcile-ghost-issues | jsrepl | ✅ | 8 | 11 | 6.6k | 35.5k/2.8k | 0 | 0.0037 |
| reconcile-ghost-issues | lispfns | ✅ | 11 | 12 | 7.2k | 52.8k/2.9k | 0 | 0.0053 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| pyrepl | 90% | 5.8 | 5.2 | 4.1k | 19.2k | 776 | 0.00 | 0.0045 |
| jsrepl | 92% | 6.1 | 5.6 | 4.1k | 21.5k | 944 | 0.00 | 0.0047 |
| lispfns | 95% | 6.4 | 6.3 | 3.6k | 19.5k | 797 | 0.00 | 0.0043 |
