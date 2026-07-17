# Frame A/B — does the eval tool's FRAMING change how a model uses it?

Same mock org, same catalog, same scenarios, same models, same runtime — only the eval tool's NAME + priming vary (`repl` = execute_*, `program` = execute_*_program, `workflow` = execute_*_workflow). Config: discovery=full, scale=1, maxTurns=18, maxTokens=4096.

**Headline: eval calls per task + single-call rate** — the fraction of runs that did the whole task in exactly ONE eval call. Pass rate is carried alongside so a framing can't win by degrading correctness.

## Aggregate — per (language × frame)

| lang | frame | n | pass | single-call | eval calls (avg / median) | disc calls | tool calls | turns | tok in/out | peak | cost $ |
|---|---|--:|:--:|:--:|--:|--:|--:|--:|--:|--:|--:|
| js | repl | 24 | 75% | 4% | 5.67 / 4 | 0.1 | 6.3 | 7.1 | 36.4k/1.6k | 5.9k | 0.0046 |
| js | program | 24 | 71% | 13% | 4.21 / 3 | 0.2 | 4.9 | 5.6 | 29.3k/1.6k | 6.0k | 0.0039 |
| js | workflow | 24 | 75% | 33% | 3.79 / 2 | 0.5 | 4.9 | 5.6 | 30.0k/1.9k | 6.0k | 0.0033 |

## repl → workflow (per language)

| lang | Δ single-call | Δ pass | eval calls repl→workflow | eval-call reduction |
|---|:--:|:--:|--:|--:|
| js | 29 pts | 0 pts | 5.67 → 3.79 | 1.49× |

## Per model × frame (single-call rate / pass rate / avg eval calls)

| model | repl | program | workflow |
|---|:--:|:--:|:--:|
| glm | 17% / 50% / 3.5 | 50% / 33% / 2.5 | 33% / 50% / 4.8 |
| deepseek | 0% / 100% / 6.5 | 0% / 100% / 5.0 | 33% / 100% / 2.2 |
| xiaomi | 0% / 100% / 3.7 | 0% / 100% / 3.2 | 33% / 100% / 1.7 |
| qwen30b | 0% / 50% / 9.0 | 0% / 50% / 6.2 | 33% / 50% / 6.5 |

_Cells are single-call% / pass% / avg eval calls. Higher single-call% at equal-or-higher pass% is the win._

