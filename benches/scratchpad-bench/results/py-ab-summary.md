# Agentic A/B benchmark — glove-scratchpad as a verifiable scratchpad

Config: scale=1, maxTurns=24, contextLimit=100000, maxTokens=4096.
Each cell = one (model × scenario × arm) run against 10 in-process MCP servers (1 baseline tools).
Tool calls / turns / peak context are what the model spent; **round-trips** are the underlying MCP `tools/call`s.


## deepseek/deepseek-v3.2

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 2 | 1 | 3.7k | 7.2k/111 | 0 | 0.0017 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.5k | 7.0k/90 | 0 | 0.0016 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.3k | 6.4k/91 | 0 | 0.0015 |
| sentry-billing-unresolved | pyrepl | ✅ | 5 | 4 | 6.7k | 28.0k/798 | 0 | 0.0067 |
| sentry-billing-unresolved | jsrepl | ✅ | 7 | 6 | 6.7k | 40.5k/925 | 0 | 0.0096 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.4k | 6.6k/170 | 0 | 0.0016 |
| merged-prs-open-linear | pyrepl | ✅ | 21 | 19 | 8.2k | 123.5k/2.5k | 1 | 0.0291 |
| merged-prs-open-linear | jsrepl | ❌ | 3 | 2 | 4.8k | 12.3k/1.1k | 0 | 0.0032 |
| merged-prs-open-linear | lispfns | ✅ | 13 | 12 | 5.6k | 57.5k/1.4k | 0 | 0.0136 |
| busiest-assignee | pyrepl | ✅ | 11 | 10 | 7.4k | 68.6k/1.0k | 0 | 0.0161 |
| busiest-assignee | jsrepl | ✅ | 7 | 6 | 4.9k | 28.7k/1.1k | 0 | 0.0069 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.5k | 6.6k/190 | 0 | 0.0016 |
| high-urgency-triggered | pyrepl | ✅ | 5 | 4 | 6.8k | 28.1k/511 | 0 | 0.0066 |
| high-urgency-triggered | jsrepl | ✅ | 6 | 5 | 5.4k | 28.0k/948 | 0 | 0.0067 |
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 3.4k | 9.9k/202 | 0 | 0.0023 |
| email-top-error | pyrepl | ✅ | 8 | 7 | 7.0k | 47.7k/1.0k | 0 | 0.0113 |
| email-top-error | jsrepl | ✅ | 9 | 8 | 5.7k | 42.0k/1.6k | 0 | 0.0102 |
| email-top-error | lispfns | ✅ | 4 | 3 | 4.1k | 14.7k/701 | 0 | 0.0036 |
| compose-verify-issues | pyrepl | ✅ | 9 | 8 | 7.4k | 55.2k/1.1k | 0 | 0.0130 |
| compose-verify-issues | jsrepl | ✅ | 6 | 5 | 6.0k | 29.0k/1.3k | 0 | 0.0071 |
| compose-verify-issues | lispfns | ✅ | 7 | 6 | 4.5k | 26.7k/679 | 0 | 0.0064 |
| incident-branch | pyrepl | ✅ | 5 | 4 | 4.2k | 19.7k/517 | 0 | 0.0047 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 4.0k | 11.3k/442 | 0 | 0.0027 |
| incident-branch | lispfns | ✅ | 4 | 3 | 3.8k | 14.1k/470 | 0 | 0.0034 |
| open-prs-breakdown | pyrepl | ❌ | 3 | 2 | 4.1k | 11.4k/540 | 0 | 0.0028 |
| open-prs-breakdown | jsrepl | ✅ | 6 | 5 | 5.0k | 25.4k/1.4k | 0 | 0.0063 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.5k | 6.7k/267 | 0 | 0.0016 |
| reconcile-ghost-issues | pyrepl | ✅ | 19 | 17 | 8.6k | 115.3k/2.8k | 1 | 0.0274 |
| reconcile-ghost-issues | jsrepl | ✅ | 12 | 11 | 8.7k | 68.3k/4.1k | 0 | 0.0170 |
| reconcile-ghost-issues | lispfns | ✅ | 18 | 17 | 6.1k | 83.9k/1.9k | 0 | 0.0199 |

## minimax/minimax-m3

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 2 | 1 | 3.5k | 6.9k/105 | 0 | 0.0022 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.5k | 6.8k/107 | 0 | 0.0022 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.2k | 6.3k/76 | 0 | 0.0020 |
| sentry-billing-unresolved | pyrepl | ✅ | 2 | 1 | 3.6k | 7.0k/162 | 0 | 0.0023 |
| sentry-billing-unresolved | jsrepl | ❌ | 2 | 1 | 3.5k | 6.9k/129 | 0 | 0.0022 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.4k | 6.5k/149 | 0 | 0.0021 |
| merged-prs-open-linear | pyrepl | ✅ | 4 | 3 | 4.5k | 15.8k/678 | 0 | 0.0055 |
| merged-prs-open-linear | jsrepl | ✅ | 3 | 2 | 5.1k | 12.2k/652 | 0 | 0.0044 |
| merged-prs-open-linear | lispfns | ✅ | 9 | 8 | 6.5k | 40.2k/1.5k | 0 | 0.0139 |
| busiest-assignee | pyrepl | ✅ | 3 | 2 | 3.7k | 10.7k/241 | 0 | 0.0035 |
| busiest-assignee | jsrepl | ✅ | 5 | 4 | 4.0k | 18.4k/531 | 0 | 0.0062 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.3k | 6.4k/197 | 0 | 0.0022 |
| high-urgency-triggered | pyrepl | ❌ | 2 | 1 | 3.6k | 7.0k/156 | 0 | 0.0023 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.8k | 7.1k/227 | 0 | 0.0024 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.2k | 6.3k/156 | 0 | 0.0021 |
| email-top-error | pyrepl | ✅ | 3 | 2 | 3.8k | 10.8k/314 | 0 | 0.0036 |
| email-top-error | jsrepl | ✅ | 3 | 2 | 3.9k | 11.0k/435 | 0 | 0.0038 |
| email-top-error | lispfns | ✅ | 17 | 16 | 5.4k | 71.1k/1.5k | 0 | 0.0231 |
| compose-verify-issues | pyrepl | ✅ | 4 | 3 | 4.3k | 15.8k/614 | 0 | 0.0055 |
| compose-verify-issues | jsrepl | ✅ | 4 | 3 | 4.5k | 15.5k/927 | 0 | 0.0058 |
| compose-verify-issues | lispfns | ✅ | 4 | 3 | 4.1k | 14.2k/475 | 0 | 0.0048 |
| incident-branch | pyrepl | ✅ | 2 | 1 | 3.8k | 7.3k/308 | 0 | 0.0025 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 3.8k | 10.8k/226 | 0 | 0.0035 |
| incident-branch | lispfns | ✅ | 3 | 2 | 3.7k | 10.4k/608 | 0 | 0.0038 |
| open-prs-breakdown | pyrepl | ✅ | 4 | 3 | 4.1k | 15.0k/1.1k | 0 | 0.0058 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 3.6k | 7.0k/232 | 0 | 0.0024 |
| open-prs-breakdown | lispfns | ✅ | 3 | 2 | 3.3k | 9.7k/209 | 0 | 0.0032 |
| reconcile-ghost-issues | pyrepl | ✅ | 23 | 21 | 6.9k | 116.6k/3.1k | 1 | 0.0387 |
| reconcile-ghost-issues | jsrepl | ✅ | 3 | 3 | 4.3k | 11.4k/1.2k | 0 | 0.0048 |
| reconcile-ghost-issues | lispfns | ✅ | 4 | 3 | 3.8k | 13.7k/741 | 0 | 0.0050 |

## z-ai/glm-5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 2 | 1 | 3.2k | 6.4k/109 | 0 | 0.0040 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.2k | 6.3k/109 | 0 | 0.0040 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 2.9k | 5.8k/168 | 0 | 0.0038 |
| sentry-billing-unresolved | pyrepl | ✅ | 2 | 1 | 3.3k | 6.5k/179 | 0 | 0.0042 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.3k | 6.4k/274 | 0 | 0.0044 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.0k | 5.9k/192 | 0 | 0.0039 |
| merged-prs-open-linear | pyrepl | ✅ | 5 | 4 | 4.1k | 18.6k/708 | 0 | 0.0125 |
| merged-prs-open-linear | jsrepl | ✅ | 7 | 6 | 4.1k | 24.6k/830 | 0 | 0.0164 |
| merged-prs-open-linear | lispfns | ✅ | 4 | 3 | 3.8k | 13.2k/998 | 0 | 0.0098 |
| busiest-assignee | pyrepl | ✅ | 3 | 2 | 3.5k | 10.0k/391 | 0 | 0.0067 |
| busiest-assignee | jsrepl | ✅ | 2 | 1 | 3.3k | 6.5k/275 | 0 | 0.0044 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.0k | 5.9k/199 | 0 | 0.0039 |
| high-urgency-triggered | pyrepl | ❌ | 2 | 1 | 3.3k | 6.5k/224 | 0 | 0.0043 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.3k | 6.4k/186 | 0 | 0.0042 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.0k | 5.9k/259 | 0 | 0.0040 |
| email-top-error | pyrepl | ✅ | 3 | 2 | 3.5k | 10.2k/416 | 0 | 0.0069 |
| email-top-error | jsrepl | ✅ | 3 | 2 | 3.5k | 10.0k/472 | 0 | 0.0069 |
| email-top-error | lispfns | ✅ | 3 | 2 | 3.2k | 9.2k/352 | 0 | 0.0062 |
| compose-verify-issues | pyrepl | ✅ | 6 | 5 | 4.1k | 21.6k/1.1k | 0 | 0.0151 |
| compose-verify-issues | jsrepl | ✅ | 7 | 6 | 4.1k | 25.3k/735 | 0 | 0.0166 |
| compose-verify-issues | lispfns | ✅ | 3 | 2 | 3.6k | 9.6k/743 | 0 | 0.0072 |
| incident-branch | pyrepl | ✅ | 4 | 3 | 3.6k | 13.7k/514 | 0 | 0.0092 |
| incident-branch | jsrepl | ✅ | 2 | 1 | 3.5k | 6.7k/390 | 0 | 0.0048 |
| incident-branch | lispfns | ✅ | 3 | 2 | 3.3k | 9.4k/874 | 0 | 0.0073 |
| open-prs-breakdown | pyrepl | ✅ | 3 | 2 | 3.5k | 10.0k/364 | 0 | 0.0067 |
| open-prs-breakdown | jsrepl | ✅ | 2 | 1 | 3.4k | 6.5k/313 | 0 | 0.0045 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.1k | 6.0k/237 | 0 | 0.0040 |
| reconcile-ghost-issues | pyrepl | ✅ | 4 | 3 | 4.8k | 16.3k/1.2k | 0 | 0.0120 |
| reconcile-ghost-issues | jsrepl | ✅ | 4 | 3 | 4.4k | 15.3k/1.1k | 0 | 0.0112 |
| reconcile-ghost-issues | lispfns | ❌ | 25 | 24 | 5.8k | 104.5k/2.5k | 1 | 0.0676 |

## xiaomi/mimo-v2.5

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 2 | 1 | 3.5k | 6.8k/259 | 0 | 0.0008 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.3k | 6.5k/90 | 0 | 0.0007 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.1k | 6.1k/110 | 0 | 0.0007 |
| sentry-billing-unresolved | pyrepl | ✅ | 4 | 3 | 5.6k | 19.6k/295 | 0 | 0.0021 |
| sentry-billing-unresolved | jsrepl | ✅ | 3 | 2 | 5.4k | 13.8k/223 | 0 | 0.0015 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.3k | 6.3k/172 | 0 | 0.0007 |
| merged-prs-open-linear | pyrepl | ✅ | 4 | 3 | 4.8k | 16.3k/929 | 0 | 0.0020 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 5.3k | 22.0k/1.3k | 0 | 0.0027 |
| merged-prs-open-linear | lispfns | ✅ | 6 | 5 | 4.1k | 21.4k/978 | 0 | 0.0025 |
| busiest-assignee | pyrepl | ✅ | 5 | 4 | 4.4k | 19.2k/715 | 0 | 0.0022 |
| busiest-assignee | jsrepl | ✅ | 3 | 2 | 3.6k | 10.2k/220 | 0 | 0.0011 |
| busiest-assignee | lispfns | ✅ | 2 | 1 | 3.2k | 6.2k/140 | 0 | 0.0007 |
| high-urgency-triggered | pyrepl | ✅ | 4 | 3 | 5.8k | 19.8k/595 | 0 | 0.0022 |
| high-urgency-triggered | jsrepl | ✅ | 3 | 2 | 3.9k | 10.6k/350 | 0 | 0.0012 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.5k | 6.4k/411 | 0 | 0.0008 |
| email-top-error | pyrepl | ✅ | 7 | 6 | 6.7k | 38.7k/741 | 0 | 0.0043 |
| email-top-error | jsrepl | ✅ | 3 | 2 | 3.6k | 10.4k/364 | 0 | 0.0012 |
| email-top-error | lispfns | ✅ | 4 | 3 | 5.7k | 19.7k/447 | 0 | 0.0022 |
| compose-verify-issues | pyrepl | ✅ | 5 | 4 | 6.8k | 27.3k/1.1k | 0 | 0.0032 |
| compose-verify-issues | jsrepl | ✅ | 4 | 3 | 4.6k | 15.9k/882 | 0 | 0.0019 |
| compose-verify-issues | lispfns | ✅ | 5 | 4 | 6.7k | 26.8k/1.4k | 0 | 0.0032 |
| incident-branch | pyrepl | ✅ | 5 | 4 | 6.2k | 24.4k/669 | 0 | 0.0027 |
| incident-branch | jsrepl | ✅ | 3 | 2 | 3.9k | 10.9k/370 | 0 | 0.0013 |
| incident-branch | lispfns | ✅ | 2 | 1 | 3.5k | 6.5k/648 | 0 | 0.0009 |
| open-prs-breakdown | pyrepl | ❌ | 2 | 1 | 3.8k | 7.1k/613 | 0 | 0.0009 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 4.0k | 10.9k/710 | 0 | 0.0013 |
| open-prs-breakdown | lispfns | ✅ | 2 | 1 | 3.2k | 6.2k/224 | 0 | 0.0007 |
| reconcile-ghost-issues | pyrepl | ✅ | 12 | 11 | 9.3k | 88.1k/3.0k | 0 | 0.0101 |
| reconcile-ghost-issues | jsrepl | ✅ | 4 | 3 | 5.0k | 16.5k/1.4k | 0 | 0.0021 |
| reconcile-ghost-issues | lispfns | ✅ | 7 | 6 | 4.8k | 27.0k/1.5k | 0 | 0.0033 |

## qwen/qwen3-30b-a3b-instruct-2507

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 2 | 1 | 3.2k | 6.4k/33 | 0 | 0.0003 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.2k | 6.3k/35 | 0 | 0.0003 |
| count-open-prs | lispfns | ✅ | 3 | 2 | 3.0k | 8.7k/59 | 0 | 0.0004 |
| sentry-billing-unresolved | pyrepl | ✅ | 6 | 5 | 3.8k | 20.4k/280 | 0 | 0.0011 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.3k | 6.5k/100 | 0 | 0.0003 |
| sentry-billing-unresolved | lispfns | ❌ | 4 | 3 | 3.0k | 11.8k/143 | 0 | 0.0006 |
| merged-prs-open-linear | pyrepl | ✅ | 2 | 1 | 3.7k | 6.9k/356 | 0 | 0.0004 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 5.2k | 20.4k/1.8k | 0 | 0.0014 |
| merged-prs-open-linear | lispfns | ✅ | 4 | 3 | 5.7k | 16.6k/470 | 0 | 0.0009 |
| busiest-assignee | pyrepl | ❌ | 25 | 24 | 6.0k | 109.5k/2.7k | 1 | 0.0060 |
| busiest-assignee | jsrepl | ✅ | 2 | 1 | 3.4k | 6.5k/175 | 0 | 0.0004 |
| busiest-assignee | lispfns | ❌ | 10 | 9 | 3.6k | 31.8k/598 | 0 | 0.0017 |
| high-urgency-triggered | pyrepl | ✅ | 6 | 5 | 3.8k | 20.4k/277 | 0 | 0.0011 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.3k | 6.4k/120 | 0 | 0.0003 |
| high-urgency-triggered | lispfns | ✅ | 3 | 2 | 3.3k | 9.1k/130 | 0 | 0.0005 |
| email-top-error | pyrepl | ✅ | 2 | 1 | 3.4k | 6.6k/154 | 0 | 0.0004 |
| email-top-error | jsrepl | ✅ | 2 | 1 | 3.3k | 6.5k/154 | 0 | 0.0004 |
| email-top-error | lispfns | ✅ | 8 | 7 | 6.5k | 38.9k/323 | 0 | 0.0020 |
| compose-verify-issues | pyrepl | ✅ | 3 | 2 | 4.0k | 10.7k/532 | 0 | 0.0006 |
| compose-verify-issues | jsrepl | ✅ | 2 | 1 | 3.5k | 6.7k/225 | 0 | 0.0004 |
| compose-verify-issues | lispfns | ✅ | 6 | 5 | 3.4k | 18.6k/275 | 0 | 0.0010 |
| incident-branch | pyrepl | ✅ | 4 | 3 | 4.1k | 14.6k/774 | 0 | 0.0009 |
| incident-branch | jsrepl | ✅ | 2 | 1 | 3.4k | 6.6k/203 | 0 | 0.0004 |
| incident-branch | lispfns | ✅ | 6 | 5 | 3.7k | 19.6k/327 | 0 | 0.0010 |
| open-prs-breakdown | pyrepl | ❌ | 22 | 21 | 7.6k | 96.8k/2.1k | 0 | 0.0052 |
| open-prs-breakdown | jsrepl | ❌ | 14 | 13 | 5.3k | 58.2k/1.8k | 0 | 0.0032 |
| open-prs-breakdown | lispfns | ✅ | 5 | 4 | 5.3k | 17.2k/203 | 0 | 0.0009 |
| reconcile-ghost-issues | pyrepl | ❌ | 7 | 6 | 6.1k | 32.0k/280 | 0 | 0.0017 |
| reconcile-ghost-issues | jsrepl | ❌ | 2 | 1 | 3.5k | 6.7k/222 | 0 | 0.0004 |
| reconcile-ghost-issues | lispfns | ❌ | 8 | 7 | 3.3k | 24.8k/352 | 0 | 0.0013 |

## deepseek/deepseek-v4-flash

| scenario | arm | pass | turns | tool calls | peak ctx (tok) | tokens in/out | compactions | cost $ |
|---|---|:--:|--:|--:|--:|--:|--:|--:|
| count-open-prs | pyrepl | ✅ | 2 | 1 | 3.5k | 7.0k/120 | 0 | 0.0007 |
| count-open-prs | jsrepl | ✅ | 2 | 1 | 3.6k | 7.0k/108 | 0 | 0.0007 |
| count-open-prs | lispfns | ✅ | 2 | 1 | 3.2k | 6.3k/127 | 0 | 0.0006 |
| sentry-billing-unresolved | pyrepl | ✅ | 2 | 1 | 3.8k | 7.2k/290 | 0 | 0.0007 |
| sentry-billing-unresolved | jsrepl | ✅ | 2 | 1 | 3.7k | 7.1k/199 | 0 | 0.0007 |
| sentry-billing-unresolved | lispfns | ✅ | 2 | 1 | 3.4k | 6.6k/166 | 0 | 0.0006 |
| merged-prs-open-linear | pyrepl | ✅ | 6 | 5 | 4.4k | 23.4k/1.1k | 0 | 0.0023 |
| merged-prs-open-linear | jsrepl | ✅ | 5 | 4 | 5.0k | 20.7k/1.1k | 0 | 0.0021 |
| merged-prs-open-linear | lispfns | ✅ | 15 | 14 | 6.9k | 78.5k/2.5k | 0 | 0.0075 |
| busiest-assignee | pyrepl | ✅ | 4 | 3 | 4.6k | 16.6k/466 | 0 | 0.0016 |
| busiest-assignee | jsrepl | ✅ | 2 | 1 | 3.7k | 7.1k/296 | 0 | 0.0007 |
| busiest-assignee | lispfns | ✅ | 4 | 3 | 5.0k | 17.2k/539 | 0 | 0.0016 |
| high-urgency-triggered | pyrepl | ✅ | 4 | 3 | 5.8k | 20.6k/456 | 0 | 0.0019 |
| high-urgency-triggered | jsrepl | ✅ | 2 | 1 | 3.8k | 7.2k/226 | 0 | 0.0007 |
| high-urgency-triggered | lispfns | ✅ | 2 | 1 | 3.5k | 6.7k/301 | 0 | 0.0007 |
| email-top-error | pyrepl | ✅ | 3 | 2 | 5.8k | 14.8k/825 | 0 | 0.0015 |
| email-top-error | jsrepl | ✅ | 3 | 2 | 5.8k | 14.8k/789 | 0 | 0.0015 |
| email-top-error | lispfns | ✅ | 5 | 4 | 3.9k | 17.9k/518 | 0 | 0.0017 |
| compose-verify-issues | pyrepl | ✅ | 8 | 7 | 7.2k | 47.9k/1.7k | 0 | 0.0046 |
| compose-verify-issues | jsrepl | ✅ | 6 | 5 | 6.6k | 33.3k/909 | 0 | 0.0032 |
| compose-verify-issues | lispfns | ✅ | 4 | 3 | 4.1k | 14.3k/838 | 0 | 0.0014 |
| incident-branch | pyrepl | ✅ | 3 | 2 | 4.2k | 11.7k/420 | 0 | 0.0011 |
| incident-branch | jsrepl | ✅ | 4 | 3 | 4.0k | 14.9k/656 | 0 | 0.0015 |
| incident-branch | lispfns | ✅ | 4 | 3 | 3.6k | 13.6k/527 | 0 | 0.0013 |
| open-prs-breakdown | pyrepl | ✅ | 4 | 3 | 4.0k | 15.0k/578 | 0 | 0.0015 |
| open-prs-breakdown | jsrepl | ✅ | 3 | 2 | 3.9k | 11.0k/408 | 0 | 0.0011 |
| open-prs-breakdown | lispfns | ✅ | 3 | 2 | 5.1k | 13.2k/283 | 0 | 0.0012 |
| reconcile-ghost-issues | pyrepl | ✅ | 17 | 15 | 8.8k | 105.1k/5.7k | 1 | 0.0105 |
| reconcile-ghost-issues | jsrepl | ✅ | 10 | 9 | 7.7k | 62.5k/3.0k | 0 | 0.0062 |
| reconcile-ghost-issues | lispfns | ✅ | 10 | 9 | 9.1k | 64.8k/4.6k | 0 | 0.0067 |

## Aggregate: arms compared

Averaged over all runs (lower is better for every column except pass-rate).

| arm | pass rate | avg turns | avg tool calls | avg peak ctx | avg tokens in | avg tokens out | avg compactions | avg cost $ |
|---|:--:|--:|--:|--:|--:|--:|--:|--:|
| pyrepl | 88% | 5.9 | 4.8 | 5.0k | 28.3k | 850 | 0.08 | 0.0058 |
| jsrepl | 93% | 3.8 | 2.9 | 4.3k | 16.0k | 676 | 0.00 | 0.0038 |
| lispfns | 93% | 4.9 | 3.9 | 4.1k | 19.4k | 625 | 0.02 | 0.0047 |
