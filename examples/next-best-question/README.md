# next-best-question

Classifiers that reorder a form or a goal program around the conversation. Each turn they decide what to confirm from what the speaker already said, what to ask next, and which step or goal to steer to.

A form or a goal program fixes its order when it is written. Conversations don't follow it. A caller opens with the middle of the story, answers questions nobody has asked yet, and changes the subject. The form engine in [`glove-memory`](../../packages/glove-memory) opens the first incomplete step whose gate holds. The goal runner activates the first unsettled goal. Both follow definition order, so an agent that reads them literally asks for things it has already been told.

This example adds a planner that re-ranks what is still open on every turn. It uses three cheap judgements from any [`glove-classifier`](../../packages/glove-classifier) adapter:

| Judgement | Question | Effect |
| --- | --- | --- |
| **covered** | Has the speaker already said this? | Confirm it instead of asking again. |
| **branch** | Which variant is this (car, home, injury, theft)? | Branch questions are weighted by how likely their branch is, and the question that settles the branch is worth more the less certain it is. |
| **focus** | What is the latest message about? | Questions on that topic move up while the speaker is on it. |

The planner only decides order. It never fills a field or completes a goal. A `confirm` move means "check this with the speaker", and the agent still records the answer through `glove_form_fill` or `glove_goal_update`. Facts work the same way: a classifier's "probably said" is evidence, not an answer.

```bash
# from the repo root; no API key needed (a ~70 MB NLI model downloads once into .cache/)
pnpm --filter glove-next-best-question-example demo       # the planner inside real Glove agents
pnpm --filter glove-next-best-question-example bench      # 20 simulated claim calls, four policies
pnpm --filter glove-next-best-question-example phrasing   # how to word coverage statements for NLI
pnpm --filter glove-next-best-question-example test
CLASSIFIER=jev pnpm --filter glove-next-best-question-example bench   # TYPESAFE_API_KEY
CLASSIFIER=llm pnpm --filter glove-next-best-question-example bench   # OPENROUTER_API_KEY, LLM_MODEL
```

`CONFIRM_AT` sets the confirm threshold (default 0.8) and `NLI_MODEL` picks another local checkpoint.

## Files

| File | What it is |
| --- | --- |
| [`src/planner.ts`](src/planner.ts) | `NextBestPlanner`: candidates + speaker turns → ranked `confirm` and `ask` moves. Classifier-agnostic. `renderPlan` turns a plan into one line of runtime context. |
| [`src/forms.ts`](src/forms.ts) | Forms: `formCandidates` (every open field across all steps, branch fields found by probing gates), `useNextBestForm` (advisory line), `withNextBestRouting` (steers the open step with `{ jump }`). |
| [`src/goals.ts`](src/goals.ts) | Goals: `goalCandidates`, `useNextBestGoals` (advisory line), `refocusGoals` (moves a goal ahead of the active one with `revise`). |
| [`src/classifiers.ts`](src/classifiers.ts) | `localNli()`: a zero-shot NLI model in-process via transformers.js, as a `ClassifierAdapter`. Also `jev()` and `llmClassifier()` by environment. |
| [`src/claim-form.ts`](src/claim-form.ts), [`src/scenarios.ts`](src/scenarios.ts) | An insurance first-notice-of-loss form (7 steps, 4 branches) and 20 labelled callers. |
| [`src/discovery-goals.ts`](src/discovery-goals.ts) | A sales discovery call as a goal program. |
| [`src/demo.ts`](src/demo.ts), [`src/bench.ts`](src/bench.ts), [`src/phrasing.ts`](src/phrasing.ts) | The three runnable scripts above. |

## Wiring it in

### Forms, advisory

```ts
const planner = new NextBestPlanner(jev());   // any ClassifierAdapter
const { runner } = useFormRunner(glove, formAdapter, { registry, subject });
useNextBestForm(glove, { runner, planner, config: claimPlan });
```

`useNextBestForm` registers a runtime context provider. Before each model iteration it appends the plan after the form's own tier-0 line. It is cached per (answers, latest speaker message), so the iterations after tool results within one turn don't classify again. The output below is from `pnpm demo`, after the caller's opening:

```
caller: "Hi, my name's Dana Reyes. Someone reversed into my car in the Tesco car park on King
         Street yesterday afternoon and drove off. The rear bumper's hanging off but it still drives."

[form: claim] step 1/7 "Claimant" · pending: Full name, Policy number, Contact phone
later: Incident (type, date, location) · Evidence (photos)
[next-best: claim] confirm from what was said: Full name (99%), Vehicle still driveable (98%),
  Another party involved (98%), When it happened (93%), Where it happened (90%),
  Type of incident = vehicle (86%) · ask next: Vehicle registration — likely vehicle 100%,
  on the topic just raised · then: Policy number, Contact phone
These are classifier suggestions for ordering. Confirm with the speaker before recording anything.
```

The engine on its own would have asked for the caller's name.

`FormPlanConfig` names the branch field and gives the classifier a statement per field, branch and step. A field with no statement gets one derived from its label. Branch fields that aren't applicable yet are still candidates: `formCandidates` tries each branch label as a hypothetical answer and re-evaluates the form. That is safe because gates are pure by contract.

### Forms, steered

```ts
const routed = withNextBestRouting(claimForm, { planner, config: claimPlan, turns: () => speakerTurns(messages) });
```

The engine derives the open step itself, and only an executor's `{ jump }` effect overrides it. So steering has to live in executors: `withNextBestRouting` wraps every field's `onFill` and `onSkip` and adds a checkpoint that fires at start. Each one asks the planner and jumps when the best question is on another step. With this, tier 0, `glove_form_status` and the `ask` flags all agree with the plan, so even an agent that ignores the advisory line follows the new order:

```
caller: "Hi, I'm Tom Becker, policy LB-77120. My elderly mother tripped over a loose paving slab
         outside our house this morning and hurt her hip."
unrouted: [form: claim] step 1/7 "Claimant" · pending: Full name, Policy number, Contact phone
router:   on "claimant" → jump to "incident" (best question is "Type of incident")
routed:   [form: claim] step 2/7 "Incident" · pending: Type of incident, When it happened, Where it happened
caller: "It's my mum who got hurt, so it's an injury claim."
router:   on "incident" → jump to "injury" (best question is "Medical treatment received")
routed:   [form: claim] step 5/7 "Injury" · pending: Medical treatment received
```

### Goals

```ts
useNextBestGoals(glove, { runner: goals, planner, config: discoveryPlan });       // advisory line
const refocus = await refocusGoals(goals, planner, speakerTurns(messages), { config: discoveryPlan });
```

`refocusGoals` moves a goal ahead of the active one when the prospect is clearly on it. Program order decides the active goal, so refocusing is a `revise` with the goals reordered. That keeps progress and respects locks, because locks pin a goal's content, not its position. It also records the reason in history and fires the goal's `onEnter` hook, which is where a host swaps in that goal's tools or prompt. A revision is durable, so the bar is higher than for the advisory line: the latest message has to be about that goal (`minFocus`, default 0.6), and its best question has to beat the active goal's by `margin` (default 0.1). Call it once per speaker turn, before the agent runs, never from a context provider.

```
caller:  "Honestly, before anything else I need to know what this costs. Is it priced per seat?"
onEnter(budget): a host would swap in this goal's tools here
refocus: moved "budget" ahead of "pain" (Speaker raised budget (93%): "Who approves the spend" moves ahead of pain)
history: v1 start · v2 update: Confirmed with the prospect on the call · v3 revise: Speaker raised budget (93%) …
```

## How a plan is ranked

For each open candidate *c*:

- `applies` = the summed probability of the branches *c* belongs to (1 for common questions, exact once the branch is answered).
- `covered` = the highest probability, across the speaker's messages, that a message states *c*. Each (message, statement) pair is classified once and cached.
- **confirm** when `applies × covered ≥ confirmAt`. The branch question itself is confirmed when the likeliest branch reaches `confirmAt`. Then the rest of the plan assumes that branch, so its questions are confirmed in the same turn ("so it's a car claim, and you said it still drives?").
- **ask** otherwise, ranked by `applies × (1 − covered) × (0.5·prior + 0.35·focus + 0.6·uncertainty)`. Here `prior` is definition order, `focus` is the latest message's probability of being about *c*'s step or goal, and `uncertainty` is the branch distribution's normalized entropy, counted only for the question that settles the branch.

One plan makes at most three classifier calls: coverage for messages not yet judged, the branch, and the focus. Jev answers all the questions in a call in parallel, and the local NLI model scores a call's hypotheses in batched forward passes.

## Results

Every scenario in `bench` is a caller with a hidden profile. The caller opens with a message, then answers whatever the agent asks. The agent is a policy, not an LLM, so runs are deterministic and free. All answers go through a real `FormRunner`, so applicability, steps and completion are the engine's.

| Policy | What it does |
| --- | --- |
| static | The engine's own order: the first `ask: true` field. |
| oracle | Knows exactly what the caller said, confirms all of it in one turn, then asks in engine order. The ceiling for coverage detection. |
| advisory | Follows the planner's line: confirm what it thinks was said, otherwise ask its top question. |
| steered | Confirms like advisory, but asks in engine order over a form whose open step the planner moves. |

A confirmation of something the caller never said fails (a *phantom*), and the agent asks that field on the next turn. A wrong guess at the claim type is corrected by the caller. Turns are counted two ways: with every confirmation as its own turn, and folded into the next question ("Got it, the King Street car park. What's the registration?").

**Local NLI model** (`Xenova/nli-deberta-v3-xsmall`, quantized, CPU), 20 callers, `confirmAt` 0.8. Full runs are in [`results/`](results).

| Policy | Turns | Turns, confirms folded | Re-asked | Phantom confirms | Wrong type guesses | Type settled at turn | Classifier ms/turn |
| --- | --: | --: | --: | --: | --: | --: | --: |
| static | 9.8 | 9.8 | 80 | 0 | 0 | 4.0 | 0 |
| oracle | 6.8 | 5.8 | 0 | 0 | 0 | 1.9 | 0 |
| advisory | 8.0 | 6.5 | 13 | 21 | 1 | 1.8 | 49 |
| steered | 7.9 | 6.5 | 13 | 19 | 1 | 1.8 | 96 |

From the opening message alone, the classifier picks the right claim type 85% of the time, and 10 of the 11 calls it makes with ≥ 80% confidence are right. The three misses are the ambiguous openings: "I've had an accident", a car through a garden wall, and a car window smashed to steal a sat nav. Coverage detection at 0.8 has precision 0.76 and recall 0.86 (F1 0.81).

**The threshold trades re-asks against bad confirmations.** Advisory policy:

| `confirmAt` | Turns | Turns, confirms folded | Re-asked | Phantom confirms | Wrong type guesses |
| --: | --: | --: | --: | --: | --: |
| 0.6 | 8.3 | 6.1 | 7 | 49 | 3 |
| 0.7 | 7.7 | 6.1 | 7 | 28 | 2 |
| 0.8 | 8.0 | 6.5 | 13 | 21 | 1 |
| 0.9 | 8.8 | 7.0 | 23 | 19 | 1 |

**Phrasing matters more than model size** (`pnpm phrasing`, the same openings, "covered" at p ≥ 0.8):

| Field | Meta phrasing ("The speaker says whether …") | Answer phrasing ("The car can still be driven." / "… cannot …") |
| --- | --: | --: |
| driveable | 3/5 | 5/5 |
| treatment | 1/5 | 5/5 |
| forcedEntry | 2/5 | 4/5 |
| damageCause | 1/5 | 3/5 |
| policyNumber | 16/20 | 20/20 |
| all 16 fields | 74% | 83% |

## What the exploration showed

- **Most of the gain is not re-asking.** Static order re-asked 80 things callers had already said; the planner re-asked 13. Advisory and steered recover about 60% of the turns between static order and the oracle, and over 80% once confirmations fold into the next question (6.5 against the oracle's 5.8).
- **Settling the branch early is the other gain.** The claim type was settled by turn 1.8 instead of 4.0. Weighting the deciding question by the branch's entropy does this: when the classifier is unsure it asks "what happened?" first, and when it is sure it confirms.
- **A confirmation needs P(applies) × P(said), not P(said) alone.** The first version confirmed "who was hurt" on a burglary call because the NLI model thought "I think I've been burgled" mentions an injured person.
- **Steering steps works, but it can't do everything the advisory line does.** The engine can't open a branch step before the branch is answered: with no applicable fields the step counts as complete, so a jump would be an empty revisit. The router steers to the deciding question instead. Jumps are also step-granular, and every fill now writes a dispatch record. In this bench, steering produced the same outcomes as the advisory line at twice the classifier time. What it buys is consistency: tier 0, status and `ask` flags agree with the plan, which matters when the agent reads the form rather than the extra line.
- **Refocusing goals through `revise` fits better than expected.** Reordering keeps progress, respects locks, leaves an auditable reason, and fires `onEnter` for the new goal. It is durable, though, so it needs a higher bar (focus and margin) than an advisory line that is recomputed every turn.
- **NLI models answer "is this true?", not "was this mentioned?"** The transformers.js zero-shot pipeline's multi-label mode compares entailment against contradiction and drops *neutral*, which is exactly the "not mentioned" case. With that, "Hi, I think I've been burgled" entailed "The speaker says their name". `localNli()` uses P(entailment) over all three classes. Even then, larger checkpoints (`nli-deberta-v3-base`) were not better at meta statements like "The speaker says X"; phrasing statements as the answer helped more.
- **Classifiers are cheap enough to run every turn.** About 50 ms per turn on CPU for this model, and 1.6 calls per turn on average because judgements of earlier messages are cached.
- **The planner is slightly less orderly.** Following the speaker means moving between steps a little more often than static order (3.3 step changes per call against 3.0; the oracle, which confirms first and then follows the form, has 2.3).

## Limits

- The callers are simulated: one opening per scenario plus templated answers. The policies are scripted, not LLM agents. Whether a model actually follows the advisory line, and how it phrases confirmations, isn't measured here and needs an agent eval.
- The phrasings in `claimPlan` and the branch labels were compared on these same 20 openings, with no held-out set, so the coverage and branch numbers are optimistic for callers the bench hasn't seen. The `meta` column in the phrasing table is the untuned baseline.
- Only the local model was run for these results. Jev and LLM classifiers are wired up (`CLASSIFIER=jev|llm`) but weren't measured, because no keys were available. They follow instructions, so they should depend less on phrasing.
- Batch composition slightly changes the quantized model's scores, so reruns after code changes can move single counts by one or two.

## Where this could go in the library

- **An ordering seam in `FormRunner`**, such as `prioritize(ctx) => { step?, fields? }`, consulted when tier 0 and status are projected. Field order and step order would come from a policy without wrapping every executor, with no dispatch-log noise, and the advisory line would merge into tier 0.
- **A non-durable goal focus**, a projection-level ordering hint distinct from `revise`, for focus that should follow the conversation without leaving a revision each time.
- **A local NLI adapter in `glove-classifier`** that scores entailment over all three classes, since the drop-neutral behaviour of zero-shot pipelines is a trap for any "was this said?" question.
- **Preparation gating.** Coverage judgements could decide when to run `glove-facts` preparation, so the expensive extraction agent only runs on turns that actually said something a field or goal needs.
