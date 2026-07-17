# Frame A/B — does the eval tool's FRAMING change how a model uses it?

Same mock org, same catalog, same scenarios, same models, same runtime — only the eval tool's NAME + priming vary (`repl` = execute_*, `program` = execute_*_program, `workflow` = execute_*_workflow). Config: discovery=progressive, scale=1, maxTurns=14, maxTokens=4096.

**Headline: eval calls per task + single-call rate** — the fraction of runs that did the whole task in exactly ONE eval call. Pass rate is carried alongside so a framing can't win by degrading correctness.

## Aggregate — per (language × frame)

| lang | frame | n | pass | single-call | eval calls (avg / median) | disc calls | tool calls | turns | tok in/out | peak | cost $ |
|---|---|--:|:--:|:--:|--:|--:|--:|--:|--:|--:|--:|
| js | repl | 16 | 69% | 25% | 4.06 / 3.5 | 2.5 | 6.6 | 7.3 | 27.0k/1.0k | 4.5k | 0.0041 |
| js | program | 16 | 75% | 44% | 3.38 / 2 | 2.9 | 6.3 | 6.4 | 22.6k/1.1k | 4.3k | 0.0029 |
| js | workflow | 16 | 81% | 31% | 4.63 / 3.5 | 3.0 | 7.6 | 8.1 | 31.6k/1.5k | 4.9k | 0.0038 |

## repl → workflow (per language)

| lang | Δ single-call | Δ pass | eval calls repl→workflow | eval-call reduction |
|---|:--:|:--:|--:|--:|
| js | 6 pts | 13 pts | 4.06 → 4.63 | 0.88× |

## Per model × frame (single-call rate / pass rate / avg eval calls)

| model | repl | program | workflow |
|---|:--:|:--:|:--:|
| glm | 50% / 50% / 1.5 | 50% / 50% / 4.8 | 0% / 100% / 5.3 |
| deepseek | 0% / 75% / 7.0 | 25% / 100% / 2.8 | 25% / 100% / 3.3 |
| xiaomi | 25% / 100% / 3.5 | 50% / 100% / 1.8 | 75% / 100% / 2.0 |
| qwen30b | 25% / 50% / 4.3 | 50% / 50% / 4.3 | 25% / 25% / 8.0 |

_Cells are single-call% / pass% / avg eval calls. Higher single-call% at equal-or-higher pass% is the win._

