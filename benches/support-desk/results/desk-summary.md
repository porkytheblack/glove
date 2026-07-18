# Support-desk — can a cheap delegate triage at par, cheaper, without leaking?

A SOTA open-source planner triages a 15-ticket inbox. `solo` reads every body itself; `delegated` hands each ticket to a cheap model. Quality = escalation F1 + category accuracy (deterministic); cost = planner $ + delegate $; security = customer PII crossing into the planner's context.

## Solo (planner does it all)

| planner | esc F1 | category acc | planner $ | PII leaked | peak ctx | turns |
|---|--:|--:|--:|:--:|--:|--:|
| deepseek | 91% | 60% | 0.0097 | **yes** | 3.6k | 6 |
| glm5 | 100% | 60% | 0.0395 | **yes** | 5.8k | 6 |
| minimax | 91% | 60% | 0.0039 | **yes** | 2.8k | 3 |
| kimi27 | 91% | 60% | 0.0213 | **yes** | 3.6k | 4 |

## Delegated (planner orchestrates, cheap model classifies)

| planner | delegate | esc F1 | category acc | total $ | (planner / delegate) | PII leaked | Δcost vs solo |
|---|---|--:|--:|--:|--:|:--:|--:|
| deepseek | dsflash | 67% | 0% | 0.0034 | 0.0030 / 0.0004 | **no** | 35% of solo |
| deepseek | qwen30b | 86% | 60% | 0.0077 | 0.0075 / 0.0002 | **no** | 80% of solo |
| glm5 | dsflash | 73% | 40% | 0.0067 | 0.0064 / 0.0003 | **no** | 17% of solo |
| glm5 | qwen30b | 86% | 60% | 0.0077 | 0.0074 / 0.0002 | **no** | 19% of solo |
| minimax | dsflash | 67% | 20% | 0.0028 | 0.0025 / 0.0003 | **no** | 72% of solo |
| minimax | qwen30b | 92% | 60% | 0.0018 | 0.0015 / 0.0002 | **no** | 45% of solo |
| kimi27 | dsflash | 67% | 20% | 0.0066 | 0.0063 / 0.0003 | **no** | 31% of solo |
| kimi27 | qwen30b | 92% | 100% | 0.0033 | 0.0030 / 0.0002 | **no** | 15% of solo |

## Headline (averaged)

| arm | esc F1 | category acc | total $ | PII leak rate |
|---|--:|--:|--:|--:|
| solo | 93% | 60% | 0.0186 | 100% |
| delegated | 79% | 45% | 0.0050 | 0% |

