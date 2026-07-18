---
"glove-scratchpad": minor
---

Add `defineModelFn` (`glove-scratchpad/fns`) — wrap any `ModelAdapter` as a
delegated-judgement `ToolFn` the planner calls inside its program. The sub-model
sees the input and returns a parsed value; the input never has to enter the
planner's own context, making per-item delegation both an economy (a cheap model
does the work) and a context boundary (the documents stay with the delegate).

A classifier is a model fn with a YES/NO `parse`, a drafter returns text, an
extractor parses JSON. Pair it with the optional `ModelFnUsage` accumulator
(`newModelFnUsage`) to measure the delegated token/cost curve. New exports:
`defineModelFn`, `newModelFnUsage`, `DefineModelFnSpec`, `ModelFnUsage`.
