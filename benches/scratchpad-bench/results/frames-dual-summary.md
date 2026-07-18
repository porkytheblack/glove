# Frame DUAL — repl + workflow mounted together, with DISTINCT roles

Both `execute_js` (repl · EXPLORE) and `execute_js_workflow` (workflow · DO) mounted over one session, each with its own role description, presentation order counterbalanced (A = repl-first, B = workflow-first). Config: maxTurns=18, discovery=full-shapes. Question: does the model route — workflow to compose the task, repl to explore — and does giving both beat either alone?

Runs with a pick: 43/48 · pass 32/48 (67%).

## Tool usage (did the model reach for each surface?)

- used `execute_js_workflow` ≥1: **41/48** (85%); the whole task in exactly one workflow call: 17/48 (35%)
- used `execute_js` (repl) ≥1: 26/48 (54%)
- used BOTH: 24/48 · workflow-only: 17/48 · repl-only: 2/48

## Preference share (by which tool the model used most)

| cohort | n | picks execute_js | picks _program | picks _workflow |
|---|--:|:--:|:--:|:--:|
| all | 43 | 21 (49%) | 0 (0%) | 22 (51%) |
| order A (repl-first) | 22 | 12 (55%) | 0 (0%) | 10 (45%) |
| order B (workflow-first) | 21 | 9 (43%) | 0 (0%) | 12 (57%) |

_A preference stable across A and B is a genuine pull toward the name, not a first-listed effect._

## Per model (picks: execute_js / _program / _workflow)

| model | n | execute_js | _program | _workflow |
|---|--:|:--:|:--:|:--:|
| glm | 12 | 2 | 0 | 10 |
| deepseek | 12 | 7 | 0 | 5 |
| xiaomi | 12 | 7 | 0 | 5 |
| qwen30b | 7 | 5 | 0 | 2 |
