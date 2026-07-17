# Frame A/B — does the eval tool's FRAMING change how a model uses it?

Same mock org, same catalog, same scenarios, same models, same runtime — only the eval tool's NAME + priming vary (`repl` = execute_*, `program` = execute_*_program, `workflow` = execute_*_workflow). Config: discovery=full, scale=1, maxTurns=14, maxTokens=4096.

**Headline: eval calls per task + single-call rate** — the fraction of runs that did the whole task in exactly ONE eval call. Pass rate is carried alongside so a framing can't win by degrading correctness.

## Aggregate — per (language × frame)

| lang | frame | n | pass | single-call | eval calls (avg / median) | disc calls | tool calls | turns | tok in/out | peak | cost $ |
|---|---|--:|:--:|:--:|--:|--:|--:|--:|--:|--:|--:|
| js | repl | 24 | 83% | 21% | 4.38 / 3.5 | 0.3 | 5.0 | 5.9 | 30.3k/1.1k | 5.6k | 0.0039 |
| js | program | 24 | 79% | 29% | 3.75 / 2 | 0.3 | 4.3 | 5.1 | 25.0k/977 | 5.2k | 0.0029 |
| js | workflow | 24 | 71% | 38% | 3.46 / 2 | 0.5 | 4.3 | 4.9 | 23.9k/1.1k | 5.3k | 0.0029 |

## repl → workflow (per language)

| lang | Δ single-call | Δ pass | eval calls repl→workflow | eval-call reduction |
|---|:--:|:--:|--:|--:|
| js | 17 pts | -13 pts | 4.38 → 3.46 | 1.27× |

## Per model × frame (single-call rate / pass rate / avg eval calls)

| model | repl | program | workflow |
|---|:--:|:--:|:--:|
| glm | 50% / 83% / 2.2 | 50% / 50% / 3.2 | 33% / 50% / 3.7 |
| deepseek | 17% / 100% / 5.5 | 0% / 100% / 4.0 | 0% / 100% / 3.7 |
| xiaomi | 0% / 83% / 3.2 | 33% / 100% / 2.3 | 67% / 100% / 1.7 |
| qwen30b | 17% / 67% / 6.7 | 33% / 67% / 5.5 | 50% / 33% / 4.8 |

_Cells are single-call% / pass% / avg eval calls. Higher single-call% at equal-or-higher pass% is the win._

