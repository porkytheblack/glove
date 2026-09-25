---
"glove-classifier": minor
---

New package: `glove-classifier` adds structured-decision (classifier) models to Glove. A `ClassifierAdapter` takes a state and typed questions (`noul`, `choice`, `score`) and returns typed answers with probabilities and confidence. It ships these pieces:

- `jev()` / `typesafe()`: TypeSafe's System One API (Jev) over `fetch`, with the official SDK's env vars, per-attempt timeouts and retries on 408, 429 and 5xx that honour `Retry-After`.
- `llmClassifier()`: any Glove `ModelAdapter` answering the same typed questions.
- `cascade()`: re-asks only the low-confidence answers of a stronger fallback.
- `mountClassifier()`: folds `glove_classify`, `_batch`, `_source` and `_catalog`. Sources are host data the agent classifies without reading. Presets and sources can change at runtime.
- `classifierTool()` and `defineClassifierTool()`: single-tool variants.
- `classifierFns()`: `classifier.classify/many/is/pick/rate` for the glove-js, glove-python and glove-lisp REPLs. `many` runs a batch in parallel in one call.
- `classifierEnv()` (`glove-classifier/env`): `env:classifier` for working environments.
- `withClassifier()`: adds a `judge` operation to glove-execution browser adapters.
- `classifierPredicate()` / `classifyInbound()` (`glove-classifier/foundry`): triage for Foundry inbound transmissions.
- `classifyMany()`, `answersMatch()`, `gate()`, `answerConfidence()`: batch and routing helpers.
- `normalizeQuestions()`: tool surfaces accept the question shapes models actually write, such as bare strings (a yes/no question), `type: "yes_no"` and `options`/`labels`/`levels`. The result is validated with a readable error. REPL and env functions return plain values (`answers.refund > 0.5`, `answers.team === "billing"`) alongside the full `details`.

- Other models in Jev's category:
  - `systemOne({ baseURL, model, apiKey? })` works with any `/v1/systemone`-compatible server. It fills in missing confidence, legend, usage and model, ignores extra fields, and checks per-server limits.
  - Presets for the open models that serve that API: `kev()`, `laya()`, `von()`, `rizzo()` and `decider()`.
  - `labelScorer()`, `huggingfaceZeroShot()` and `gliclass()` handle zero-shot "text + labels → scores" classifiers.

A live benchmark and demo are in `examples/classifier-inbox`.
