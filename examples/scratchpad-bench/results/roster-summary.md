# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=2, maxTurns=30, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (32 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## moonshotai/kimi-k2.7-code

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 4.7k | 6.0k/82 | 0 | 0.0047 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.5k | 2.9k/96 | 0 | 0.0025 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 2.0k | 3.2k/171 | 0 | 0.0030 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.8k | 4.8k/214 | 0 | 0.0043 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 5.8k | 11.3k/802 | 0 | 0.0112 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.2k | 5.3k/463 | 0 | 0.0056 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 2.5k | 3.8k/296 | 0 | 0.0038 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 1.7k | 4.7k/150 | 0 | 0.0040 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 1.5k | 2.8k/175 | 0 | 0.0027 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.5k | 3.0k/142 | 0 | 0.0027 |
| email-top-error | baseline | ❌ | 3 | 2 | 4.5k | 10.1k/779 | 0 | 0.0102 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 1.9k | 6.7k/286 | 0 | 0.0059 |
| compose-verify-issues | baseline | ✅ | 3 | 16 | 6.0k | 11.6k/1.8k | 0 | 0.0147 |
| compose-verify-issues | scratchpad | ✅ | 4 | 4 | 2.0k | 7.2k/372 | 0 | 0.0066 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 6.6k | 9.7k/396 | 0 | 0.0066 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/117 | 0 | 0.0022 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.8k | 6.9k/257 | 0 | 0.0046 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.0k | 5.4k/411 | 0 | 0.0041 |
| merged-prs-open-linear | baseline | ❌ | 3 | 15 | 7.6k | 16.8k/1.3k | 0 | 0.0126 |
| merged-prs-open-linear | scratchpad | ✅ | 6 | 6 | 2.5k | 12.3k/631 | 0 | 0.0086 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.3k | 7.5k/257 | 0 | 0.0050 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/298 | 0 | 0.0026 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.5k/215 | 0 | 0.0043 |
| high-urgency-triggered | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/278 | 0 | 0.0037 |
| email-top-error | baseline | ❌ | 3 | 2 | 6.3k | 15.7k/283 | 0 | 0.0100 |
| email-top-error | scratchpad | ✅ | 3 | 3 | 2.1k | 5.7k/565 | 0 | 0.0045 |
| compose-verify-issues | baseline | ✅ | 3 | 16 | 7.4k | 16.7k/1.6k | 0 | 0.0131 |
| compose-verify-issues | scratchpad | ✅ | 4 | 4 | 2.7k | 9.0k/735 | 0 | 0.0068 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 6.6k | 9.7k/467 | 0 | 0.0035 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/77 | 0 | 0.0012 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.8k | 6.9k/247 | 0 | 0.0024 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/207 | 0 | 0.0021 |
| merged-prs-open-linear | baseline | ✅ | 2 | 2 | 15.8k | 18.9k/1.3k | 0 | 0.0072 |
| merged-prs-open-linear | scratchpad | ✅ | 2 | 1 | 2.2k | 4.0k/368 | 0 | 0.0017 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.3k | 7.4k/292 | 0 | 0.0026 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/263 | 0 | 0.0021 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.4k/269 | 0 | 0.0023 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/143 | 0 | 0.0013 |
| email-top-error | baseline | ✅ | 3 | 2 | 6.4k | 15.8k/710 | 0 | 0.0056 |
| email-top-error | scratchpad | ✅ | 4 | 3 | 2.3k | 8.3k/618 | 0 | 0.0032 |
| compose-verify-issues | baseline | ✅ | 3 | 18 | 9.4k | 20.3k/2.2k | 0 | 0.0087 |
| compose-verify-issues | scratchpad | ✅ | 7 | 6 | 2.9k | 17.0k/958 | 0 | 0.0063 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ✅ | 2 | 1 | 6.6k | 9.5k/339 | 0 | 0.0009 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.9k | 3.7k/130 | 0 | 0.0004 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.7k | 6.7k/317 | 0 | 0.0007 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 2.2k | 6.0k/342 | 0 | 0.0006 |
| merged-prs-open-linear | baseline | ✅ | 3 | 15 | 8.1k | 17.1k/2.0k | 0 | 0.0019 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 3 | 3.2k | 7.2k/1.1k | 0 | 0.0009 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.3k | 7.2k/375 | 0 | 0.0007 |
| busiest-assignee | scratchpad | ✅ | 3 | 2 | 2.2k | 6.1k/236 | 0 | 0.0006 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.3k | 6.2k/227 | 0 | 0.0006 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 2.0k | 3.8k/181 | 0 | 0.0004 |
| email-top-error | baseline | ✅ | 3 | 2 | 6.5k | 15.8k/621 | 0 | 0.0015 |
| email-top-error | scratchpad | ✅ | 5 | 4 | 2.6k | 11.0k/932 | 0 | 0.0012 |
| compose-verify-issues | baseline | ✅ | 3 | 20 | 9.0k | 18.3k/3.2k | 0 | 0.0022 |
| compose-verify-issues | scratchpad | ✅ | 5 | 5 | 3.3k | 13.5k/1.4k | 0 | 0.0015 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ❌ | 2 | 1 | 7.3k | 10.4k/24 | 0 | 0.0005 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/33 | 0 | 0.0002 |
| sentry-billing-unresolved | baseline | ❌ | 2 | 1 | 4.0k | 7.1k/117 | 0 | 0.0004 |
| sentry-billing-unresolved | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/150 | 0 | 0.0003 |
| merged-prs-open-linear | baseline | ❌ | 8 | 7 | 4.6k | 29.4k/320 | 0 | 0.0015 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.2k | 5.6k/342 | 0 | 0.0003 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.7k | 7.8k/50 | 0 | 0.0004 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/72 | 0 | 0.0002 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.4k | 6.6k/84 | 0 | 0.0003 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/88 | 0 | 0.0002 |
| email-top-error | baseline | ✅ | 3 | 2 | 7.1k | 17.3k/155 | 0 | 0.0009 |
| email-top-error | scratchpad | ✅ | 3 | 2 | 1.9k | 5.3k/124 | 0 | 0.0003 |
| compose-verify-issues | baseline | ❌ | 1 | 0 | 3.2k | 3.2k/30 | 0 | 0.0002 |
| compose-verify-issues | scratchpad | ❌ | 3 | 2 | 1.9k | 5.3k/128 | 0 | 0.0003 |

## qwen/qwen3-8b

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | baseline | ERR | 1 | 1 | 3.0k | 3.0k/1.2k | 0 | 0.0009 |
| count-open-prs | scratchpad | ✅ | 2 | 1 | 1.7k | 3.3k/515 | 0 | 0.0006 |
| sentry-billing-unresolved | baseline | ✅ | 2 | 1 | 3.9k | 6.8k/689 | 0 | 0.0011 |
| sentry-billing-unresolved | scratchpad | ❌ | 3 | 2 | 1.8k | 5.2k/3.8k | 0 | 0.0023 |
| merged-prs-open-linear | baseline | ❌ | 3 | 2 | 6.8k | 16.5k/4.3k | 0 | 0.0039 |
| merged-prs-open-linear | scratchpad | ✅ | 3 | 2 | 2.3k | 5.7k/5.7k | 0 | 0.0032 |
| busiest-assignee | baseline | ✅ | 2 | 1 | 4.6k | 7.6k/2.0k | 0 | 0.0018 |
| busiest-assignee | scratchpad | ✅ | 2 | 1 | 1.7k | 3.4k/1.5k | 0 | 0.0011 |
| high-urgency-triggered | baseline | ✅ | 2 | 1 | 3.3k | 6.3k/543 | 0 | 0.0010 |
| high-urgency-triggered | scratchpad | ✅ | 2 | 1 | 1.8k | 3.4k/863 | 0 | 0.0008 |
| email-top-error | baseline | ✅ | 3 | 2 | 7.0k | 16.9k/1.7k | 0 | 0.0028 |
| email-top-error | scratchpad | ❌ | 4 | 3 | 2.0k | 7.3k/6.1k | 0 | 0.0036 |
| compose-verify-issues | baseline | ERR | 2 | 15 | 6.8k | 9.8k/4.1k | 0 | 0.0030 |
| compose-verify-issues | scratchpad | ✅ | 3 | 2 | 2.0k | 5.4k/7.5k | 0 | 0.0040 |

## Aggregate: scratchpad vs baseline

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| baseline | 71% | 2.4 | 4.2 | 5.4k | 10.6k | 862 | 0.00 | 0.0040 |
| scratchpad | 93% | 3.0 | 2.2 | 2.1k | 5.8k | 923 | 0.00 | 0.0025 |

**Reduction factors (baseline ÷ scratchpad):** tool calls 1.9×, peak context 2.6×, input tokens 1.8×, cost 1.6×.
