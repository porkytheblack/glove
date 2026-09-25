---
"glove-classifier": minor
---

New package: `glove-classifier` adds structured-decision (classifier) models to Glove. A `ClassifierAdapter` takes a state and typed questions (`noul`, `choice`, `score`) and returns typed answers with probabilities and confidence. It ships these pieces:

- `jev()` / `typesafe()`: TypeSafe's System One API (Jev) over `fetch`, with the official SDK's env vars, per-attempt timeouts and retries on 408, 429 and 5xx that honour `Retry-After`.
- `llmClassifier()`: any Glove `ModelAdapter` answering the same typed questions.
- `cascade()`: re-asks only the low-confidence answers of a stronger fallback.
- `classifierTool()` and `defineClassifierTool()`: tools that let an agent use a classifier.
- `gate()` / `answerConfidence()`: confidence-gated routing.
