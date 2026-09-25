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
| `mountClassifier()` | The full agent toolset: classify, batch, **sources** (data the agent classifies without reading), presets and a catalog. |
| `classifierFns()` | Functions for the REPLs (`glove-js` / `-python` / `-lisp` via the scratchpad catalog). |
| `classifierEnv()` | `env:classifier` for a working environment (`glove-classifier/env`). |
| `withClassifier()` | Adds a `judge` operation to a glove-execution browser adapter. |
| `classifierPredicate()` / `classifyInbound()` | Foundry inbound-transmission triage (`glove-classifier/foundry`). |
| `classifyMany()` / `answersMatch()` | Classify many items in parallel; filter results with `where`. |

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

## In an agent: `mountClassifier`

```ts
import { mountClassifier, jev, llmClassifier, noul, choice } from "glove-classifier";

const classifiers = mountClassifier(glove, {
  classifier: jev(),
  classifiers: { careful: llmClassifier({ model: reasoningModel }) }, // the agent can pick by name
  presets: {
    triage: {
      description: "Support triage",
      questions: {
        team: choice("Which team should handle this?", ["billing", "technical", "sales"]),
        urgent: noul("Does the sender need help today?"),
      },
    },
  },
  sources: {
    inbox: {
      description: "Unread support email",
      load: async () => (await mail.unread()).map((m) => ({ id: m.id, label: m.subject, state: m.body })),
    },
  },
});

// Presets and sources can change at any time. The agent finds them through the catalog tool.
classifiers.addSource("crm", { description: "Open CRM notes", load: loadNotes });
```

| Tool | What it does |
| --- | --- |
| `glove_classify` | Judges one state, with its own questions and/or a `preset`. |
| `glove_classify_batch` | Judges many items the agent already holds. `where` keeps only the matches. |
| `glove_classify_source` | Judges every item in a host **source** and returns only ids, labels and answers. The content never enters the agent's context. |
| `glove_classify_catalog` | Lists presets, sources and named classifiers. |

A `where` condition is `{ question, choice?, min?, max? }`, and a list of conditions must all hold:

- **noul:** matches when the yes-probability is at least `min` (default 0.5).
- **choice:** matches when `choice` is the chosen label. With `min`/`max`, it tests that label's probability instead.
- **score:** matches when the score is within `min` and `max`.

Results are capped by `limit` (`resultLimit`, default 50). `usage()` returns the running totals.

For a single fixed judgement, fold one tool yourself. `classifierTool()` is the open tool alone, and `defineClassifierTool()` asks your questions over the agent's input:

```ts
glove.fold(defineClassifierTool({
  name: "triage_ticket",
  description: "Route a support ticket to a team.",
  classifier: jev(),
  questions: { team: choice("Which team?", ["billing", "technical", "sales"]) },
  format: (a) => ({ team: a.team.choice }),
}));
```

## In code: REPLs, working environments and browsers

An agent that writes code can move data around without reading it. Only the program's return value enters its context. A classifier supplies the judgement that step needs, such as "which of these 400 emails ask for a refund?", and the program returns three ids.

**REPLs** (`glove-js`, `glove-python`, `glove-lisp`, over the scratchpad catalog):

```ts
import { JsSession, mountJs } from "glove-js";
import { classifierFns, jev } from "glove-classifier";

const session = JsSession.create();
session.registerAll(classifierFns(jev()));   // classifier.classify / many / is / pick / rate
mountJs(glove, { session });
```

```js
// what the agent writes
const hits = classifier.many({
  items: emails.map(e => ({ id: e.id, label: e.subject, state: e.body })),
  questions: { refund: { type: "noul", instructions: "Does the sender ask for a refund?" } },
  where: { question: "refund", min: 0.7 },
});
hits.map(h => h.id)
```

REPL programs call host functions one at a time, so `many` runs a whole batch in parallel inside a single call. The five functions are:

| Function | Returns |
| --- | --- |
| `classify({ state, questions })` | The answers. |
| `many({ items, questions, where? })` | Per-item answers. Items that fail carry an `error`. |
| `is({ state, question })` | The yes-probability. |
| `pick({ state, question, labels })` | `{ choice, confidence, probabilities }` |
| `rate({ state, question, levels })` | `{ score, confidence }` |

**Working environment:**

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { email } from "glove-env-email";
import { classifierEnv } from "glove-classifier/env";

createWorkingEnvironment({ stdlib: [email(), classifierEnv(jev())] });
// scripts:  import { many, is, pick } from 'env:classifier'
```

The module ships a README and a `classifier-triage` skill under `/skills`.

**Browser** (glove-execution):

```ts
import { mountBrowser } from "glove-execution";
import { stationBrowser } from "glove-execution/station";
import { withClassifier } from "glove-classifier";

mountBrowser(glove, { adapter: withClassifier(stationBrowser({ client }), { classifier: jev() }) });
// in a workflow:  const { answers } = await browser.judge({ sessionId, questions: { done: { type: "noul", instructions: "Did the order go through?" } } })
```

`judge` observes the page, classifies what it sees, and returns only the answers. The DOM never comes back. Use `state` to trim the observation first, and `maxStateChars` (default 100 000) to cap it.

## Foundry: triaging inbound transmissions

Each inbound event passes through its transmission's `classify` step and then each playbook's predicates, all before any agent starts. Putting a classifier there means agents start only for events that need them.

```ts
import { defineTransmissionPredicate } from "glove-foundry";
import { classifierPredicate, classifyInbound } from "glove-classifier/foundry";

// predicates/urgent.predicate.ts: the playbook wakes only for urgent tickets
export default defineTransmissionPredicate(classifierPredicate({
  classifier: jev(),
  questions: { urgent: noul("Does the sender need help today?") },
  where: { question: "urgent", min: 0.7 },   // a playbook may override: predicate parameters { min: 0.9 }
  state: (event: Ticket) => ({ subject: event.subject, body: event.body }),
}));

// in the transmission: resolve which event an inbound message is
inbound: {
  // ...config, event, adapter
  classify: classifyInbound({
    classifier: jev(),
    question: choice("What is this message?", ["refund", "bug", "other"]),
    events: { refund: refundRequested, bug: bugReported },
    fallback: generalInquiry,
    minConfidence: 0.6,
    state: (event: Ticket) => event.body,
  }),
},
```

Both helpers return Effects that fail with `ClassifierError`. Neither needs anything from `glove-foundry` at runtime.

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
