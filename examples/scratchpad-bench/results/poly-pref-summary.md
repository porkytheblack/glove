# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (3 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.5k | 6.8k/102 | 0 | 0.0016 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.6k | 6.9k/189 | 0 | 0.0017 |
| merged-prs-open-linear | polyglot | ✅ | 6 | 5 | 7.6k | 34.8k/1.7k | 0 | 0.0085 |
| busiest-assignee | polyglot | ✅ | 2 | 1 | 3.8k | 7.1k/386 | 0 | 0.0018 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.6k | 6.9k/211 | 0 | 0.0017 |
| email-top-error | polyglot | ✅ | 3 | 2 | 6.8k | 16.4k/627 | 0 | 0.0040 |
| compose-verify-issues | polyglot | ✅ | 3 | 2 | 6.3k | 14.6k/675 | 0 | 0.0036 |
| incident-branch | polyglot | ✅ | 2 | 1 | 3.9k | 7.3k/417 | 0 | 0.0018 |
| open-prs-breakdown | polyglot | ✅ | 3 | 2 | 4.0k | 11.0k/601 | 0 | 0.0027 |
| reconcile-ghost-issues | polyglot | ✅ | 11 | 10 | 13.3k | 99.6k/4.8k | 0 | 0.0245 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.4k | 6.7k/71 | 0 | 0.0021 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.4k | 6.7k/174 | 0 | 0.0022 |
| merged-prs-open-linear | polyglot | ✅ | 7 | 6 | 7.6k | 43.8k/908 | 0 | 0.0142 |
| busiest-assignee | polyglot | ✅ | 3 | 2 | 3.6k | 10.3k/304 | 0 | 0.0034 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.5k | 6.7k/189 | 0 | 0.0022 |
| email-top-error | polyglot | ✅ | 3 | 2 | 4.3k | 11.8k/442 | 0 | 0.0041 |
| compose-verify-issues | polyglot | ✅ | 3 | 2 | 4.4k | 11.4k/539 | 0 | 0.0041 |
| incident-branch | polyglot | ✅ | 3 | 2 | 3.8k | 10.8k/498 | 0 | 0.0038 |
| open-prs-breakdown | polyglot | ✅ | 2 | 1 | 3.5k | 6.8k/263 | 0 | 0.0024 |
| reconcile-ghost-issues | polyglot | ❌ | 25 | 25 | 9.0k | 138.8k/4.3k | 1 | 0.0468 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 4.7k | 7.8k/122 | 0 | 0.0049 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.3k | 6.3k/168 | 0 | 0.0041 |
| merged-prs-open-linear | polyglot | ✅ | 3 | 2 | 4.0k | 10.6k/755 | 0 | 0.0078 |
| busiest-assignee | polyglot | ✅ | 4 | 3 | 3.4k | 12.9k/450 | 0 | 0.0086 |
| high-urgency-triggered | polyglot | ❌ | 2 | 1 | 3.2k | 6.2k/213 | 0 | 0.0041 |
| email-top-error | polyglot | ✅ | 3 | 2 | 3.4k | 9.7k/401 | 0 | 0.0066 |
| compose-verify-issues | polyglot | ✅ | 3 | 2 | 4.1k | 10.8k/801 | 0 | 0.0080 |
| incident-branch | polyglot | ✅ | 3 | 2 | 3.4k | 9.8k/468 | 0 | 0.0068 |
| open-prs-breakdown | polyglot | ✅ | 2 | 1 | 3.3k | 6.3k/337 | 0 | 0.0045 |
| reconcile-ghost-issues | polyglot | ✅ | 5 | 4 | 5.2k | 20.7k/2.1k | 0 | 0.0164 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.4k | 6.5k/138 | 0 | 0.0007 |
| sentry-billing-unresolved | polyglot | ✅ | 4 | 3 | 3.8k | 14.0k/486 | 0 | 0.0016 |
| merged-prs-open-linear | polyglot | ✅ | 5 | 4 | 6.5k | 27.0k/1.1k | 0 | 0.0031 |
| busiest-assignee | polyglot | ✅ | 4 | 3 | 3.8k | 14.1k/505 | 0 | 0.0016 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.4k | 6.6k/231 | 0 | 0.0008 |
| email-top-error | polyglot | ✅ | 2 | 1 | 3.6k | 6.8k/361 | 0 | 0.0008 |
| compose-verify-issues | polyglot | ✅ | 7 | 6 | 5.9k | 32.5k/1.6k | 0 | 0.0039 |
| incident-branch | polyglot | ✅ | 3 | 2 | 3.8k | 10.5k/454 | 0 | 0.0012 |
| open-prs-breakdown | polyglot | ✅ | 5 | 4 | 4.2k | 18.5k/953 | 0 | 0.0022 |
| reconcile-ghost-issues | polyglot | ✅ | 4 | 3 | 5.6k | 17.9k/1.2k | 0 | 0.0022 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ❌ | 3 | 2 | 5.1k | 11.2k/64 | 0 | 0.0006 |
| sentry-billing-unresolved | polyglot | ✅ | 2 | 1 | 3.2k | 6.3k/113 | 0 | 0.0003 |
| merged-prs-open-linear | polyglot | ✅ | 2 | 1 | 3.5k | 6.6k/333 | 0 | 0.0004 |
| busiest-assignee | polyglot | ❌ | 3 | 2 | 3.4k | 9.7k/370 | 0 | 0.0006 |
| high-urgency-triggered | polyglot | ✅ | 3 | 2 | 3.3k | 9.5k/167 | 0 | 0.0005 |
| email-top-error | polyglot | ✅ | 2 | 1 | 3.4k | 6.5k/233 | 0 | 0.0004 |
| compose-verify-issues | polyglot | ✅ | 3 | 2 | 3.5k | 9.7k/298 | 0 | 0.0005 |
| incident-branch | polyglot | ✅ | 4 | 3 | 4.1k | 14.3k/802 | 0 | 0.0009 |
| open-prs-breakdown | polyglot | ❌ | 3 | 2 | 3.4k | 9.6k/247 | 0 | 0.0005 |
| reconcile-ghost-issues | polyglot | ❌ | 4 | 3 | 4.1k | 14.2k/881 | 0 | 0.0009 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | polyglot | ✅ | 2 | 1 | 3.4k | 6.7k/107 | 0 | 0.0006 |
| sentry-billing-unresolved | polyglot | ✅ | 3 | 2 | 5.7k | 14.4k/296 | 0 | 0.0013 |
| merged-prs-open-linear | polyglot | ✅ | 9 | 8 | 6.7k | 51.1k/1.2k | 0 | 0.0048 |
| busiest-assignee | polyglot | ✅ | 7 | 6 | 6.0k | 37.4k/653 | 0 | 0.0035 |
| high-urgency-triggered | polyglot | ✅ | 2 | 1 | 3.7k | 7.0k/262 | 0 | 0.0007 |
| email-top-error | polyglot | ✅ | 5 | 4 | 6.4k | 27.3k/525 | 0 | 0.0026 |
| compose-verify-issues | polyglot | ✅ | 3 | 2 | 5.0k | 12.3k/1.3k | 0 | 0.0013 |
| incident-branch | polyglot | ✅ | 3 | 2 | 4.1k | 11.3k/490 | 0 | 0.0011 |
| open-prs-breakdown | polyglot | ✅ | 5 | 4 | 5.8k | 25.6k/481 | 0 | 0.0024 |
| reconcile-ghost-issues | polyglot | ERR | 13 | 12 | 11.4k | 99.8k/4.4k | 1 | 0.0098 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| polyglot | 88% | 3.9 | 3.0 | 4.7k | 18.5k | 725 | 0.03 | 0.0043 |
