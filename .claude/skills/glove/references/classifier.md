# Classifier models (glove-classifier)

> Read when an agent makes many cheap typed decisions (triage, routing, filtering, gating) that should not cost a chat-model call each, or when a Foundry transmission should classify inbound events before any agent starts.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

`glove-classifier` puts structured-decision (classifier) models behind a `ClassifierAdapter` contract: state + typed questions (`noul` yes/no probability, `choice` label + probabilities + confidence, `score` rubric level + probabilities + confidence) in, typed answers out.

- **Models.** `jev()` / `typesafe()` call TypeSafe System One (`TYPESAFE_API_KEY`, `jev-latest`, retries 408/429/5xx). Open models on the same `/v1/systemone` API have presets: `kev()` / `laya()` / `von()` / `rizzo()` / `decider()`, each reading `<NAME>_BASE_URL` / `<NAME>_API_KEY`; `systemOne({ baseURL, model, apiKey? })` covers any compatible server. `huggingfaceZeroShot()` / `gliclass()` / `labelScorer({ name, score })` wrap zero-shot "text + labels → scores" models. `llmClassifier({ model })` makes any `ModelAdapter` answer the same questions.
- **Jev is not a chat model.** Never put it behind `createAdapter` or use it as an agent's model.
- **Cascades and gates.** `cascade({ primary, fallback, threshold })` re-asks only low-confidence answers; `gate(answer, { act, review })` → `"act" | "review" | "escalate"`.
- **As tools.** `classifierTool({ classifier })` folds an open `glove_classify` tool; `defineClassifierTool({ name, description, classifier, questions, input?, state?, format? })` a fixed-question one. `mountClassifier(glove, { classifier, classifiers?, presets?, sources?, prefix? })` folds `glove_classify` / `_batch` / `_source` (host data the agent classifies without reading — only ids/labels/answers return) / `_catalog`, and returns `{ addPreset, addSource, removePreset, removeSource, usage }`. `where: { question, choice?, min?, max? }` filters batch/source results.
- **In code.** `session.registerAll(classifierFns(clf))` → `classifier.classify/many/is/pick/rate` in glove-js/python/lisp (`many` runs a batch in parallel in one call); `classifierEnv(clf)` from `glove-classifier/env` → `env:classifier` in a working environment; `withClassifier(browserAdapter, { classifier })` adds `browser.judge({ sessionId, questions })`.
- **In Foundry.** `classifyInbound({ classifier, question: choice(...), events, fallback, minConfidence, state })` from `glove-classifier/foundry` is a transmission's `inbound.classify`. `defineTransmissionPredicate(classifierPredicate({ classifier, questions, where, state }))` lets a playbook match only when the answers satisfy `where`; playbook predicate parameters `{ min, max, choice, where }` override the thresholds. Both return Effects that fail with `ClassifierError`.

Guide: https://glove.dterminal.net/docs/classifier
