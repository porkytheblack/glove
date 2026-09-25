# glove-classifier

Structured-decision models for [Glove](https://github.com/porkytheblack/glove).

A classifier model doesn't write text. It takes a **state** (the thing being
judged) and a map of typed **questions**, and returns one typed answer per
question, with the probability distribution behind it. [TypeSafe's Jev](https://docs.typesafe.ai/introduction)
is the flagship example: a "System One" model that answers in 70–500 ms,
charges only for input tokens, and can't return a malformed answer.

Jev can't sit behind a Glove `ModelAdapter`, because it doesn't chat, stream
or call tools. This package gives classifier models their own adapter
contract, `ClassifierAdapter`, and ships:

| Export | What it is |
| --- | --- |
| `jev()` / `typesafe()` | TypeSafe System One over `fetch`. No SDK dependency. |
| `llmClassifier()` | Any Glove `ModelAdapter` answering the same typed questions. |
| `cascade()` | Asks a fast classifier first and re-asks only its low-confidence questions of a stronger one. |
| `classifierTool()` | A `glove_classify` tool: the agent writes its own questions. |
| `defineClassifierTool()` | A fixed-question tool: you write the questions, the agent supplies the input. |
| `noul` / `choice` / `score` | Question builders with typed answers. |
| `gate()` / `answerConfidence()` | Confidence-gated routing: act, review or escalate. |

```bash
pnpm add glove-classifier
```

## Question types

| Type | Asks | Answer |
| --- | --- | --- |
| `noul` | Is this statement true? | `noul`: the probability of yes (0–1) |
| `choice` | Which of these labels? | `choice`, `probabilities` per label, `confidence` |
| `score` | Where on this rubric? | `score` (can land between levels), `probabilities` per level, `confidence` |

The names and wire shapes match TypeSafe's API, so a request you build here can
be sent to `POST /v1/systemone` as it is.

## Jev

```ts
import { jev, noul, choice, score } from "glove-classifier";

const model = jev(); // reads TYPESAFE_API_KEY; model "jev-latest"

const { answers, model: served, usage } = await model.classify({
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: noul("Does this convey urgency?"),
    department: choice("Which team should handle this?", {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades, new accounts",
    }),
    frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
  },
});

answers.department.choice;         // "billing" | "technical" | "sales" (typed from the labels)
answers.department.confidence;     // 0.81
answers.frustration.score;         // 1.05
answers.is_urgent.noul;            // 0.95
served;                            // "jev-1.13.0", the versioned model that answered
```

Options: `apiKey` (defaults to `TYPESAFE_API_KEY`), `baseURL` (`TYPESAFE_BASE_URL`),
`model` (`TYPESAFE_DEFAULT_MODEL`, then `jev-latest`), `timeout` (per attempt,
default 10 s), `maxRetries` (default 2), `backoffMs`, `headers` and `fetch`.
Responses with status 408, 429 and 5xx (including 529 Overloaded) are retried
with exponential backoff, and `Retry-After` is honoured. An aborted
`signal` raises glove-core's `AbortError`. Every other failure raises a
`ClassifierError` whose `code` is one of `invalid_request`, `auth`,
`rate_limited`, `provider`, `bad_response` or `connection`.

`model.listModels()` returns the ids and aliases your account can use. If you
tuned confidence thresholds against a specific version, pin that versioned id
(for example `jev-1.13.0`), because aliases move when a new version ships.

State can be a string, or an object or array that names its parts. Keep each
question atomic: split a broad judgement into several questions and combine
the answers in code. All the questions are evaluated in parallel in one call,
so adding more costs almost nothing.

## Acting on confidence

```ts
import { gate } from "glove-classifier";

switch (gate(answers.department, { act: 0.8, review: 0.5 })) {
  case "act":      return route(answers.department.choice);
  case "review":   return confirmWithUser(answers.department.choice);
  case "escalate": return handToHuman();
}
```

`answerConfidence(answer)` works for all three answer types. A `noul` has no
`confidence` field, so its certainty is its distance from a coin flip,
`|2p − 1|`.

## Any LLM as a classifier

```ts
import { createAdapter } from "glove-core/models/providers";
import { llmClassifier } from "glove-classifier";

const model = llmClassifier({
  model: createAdapter({ provider: "openai", model: "gpt-4.1-mini", stream: false }),
});
```

The LLM is asked for a probability distribution per question, returned as
JSON, and the reply is turned into the same typed answers. Replies that can't
be parsed are retried (`maxAttempts`, default 2). Calls are serialized, because
a `ModelAdapter`'s system prompt is shared state. The probabilities are
self-reported, not calibrated.

## Cascade

```ts
import { cascade, jev, llmClassifier } from "glove-classifier";

const model = cascade({
  primary: jev(),
  fallback: llmClassifier({ model: reasoningModel }),
  threshold: 0.6, // re-ask answers with confidence below this; or pass shouldEscalate()
});

const result = await model.classify({ state, questions });
result.escalated; // ids the fallback answered
```

## In an agent

```ts
import { classifierTool, defineClassifierTool, jev, choice, noul } from "glove-classifier";

const model = jev();

// Open: the agent writes the state and questions. Use it to fan a fast
// judgement out over many items instead of reasoning through each one in context.
glove.fold(classifierTool({ classifier: model }));

// Fixed: the questions are yours, and the agent passes { text }.
glove.fold(defineClassifierTool({
  name: "triage_ticket",
  description: "Route a support ticket to a team.",
  classifier: model,
  questions: {
    team: choice("Which team should handle this?", ["billing", "technical", "sales"]),
    urgent: noul("Does this convey urgency?"),
  },
  format: (a) => ({ team: a.team.choice, urgent: a.urgent.noul > 0.5 }),
}));
```

Tool results carry compact answers, rounded and without the score legend, so
they stay small in the model's context. The full result is kept in
`renderData`. Classifier failures come back as tool errors.

## Bring your own classifier

Implement `ClassifierAdapter`, which has a `name` and a
`classify({ state, questions }, { signal })` method. It must return one answer
per question id, with the same `type` as the question.
`answerFromDistribution(question, { label: p, … })` builds a well-formed answer
from any probability distribution, so wrapping a fine-tuned model or a hosted
classification endpoint takes a few lines. Everything above, including
cascades, tools and gating, then works with it.

## License

MIT
