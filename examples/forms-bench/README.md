# glove-forms-bench

Agentic evaluation of `glove-memory/forms`: real models via OpenRouter driving a
four-step intake through scripted multi-turn conversations, measuring **how much
context the form costs** and **whether the model uses the surface the way it's
meant to be used**.

```bash
pnpm selfcheck                       # offline — verifies the harness, spends nothing
pnpm bench                           # the matrix
pnpm bench -- --models a,b
pnpm bench -- --scenarios held-value,over-cap
pnpm bench -- --reps 3
pnpm bench -- --budget 0.25
```

Needs `OPENROUTER_API_KEY` in the environment or in `.env` at the repo root.
Reports land in `results/`, stamped per run, with `report.md` / `raw.json` as
aliases for the latest.

## What it measures

**Context.** The design's central bet is §4: a form should cost a standing
one-line notification, not a field list. So the ledger separates

- `tier-0` — the injected line, counted on every completion call because that's
  how often it's re-sent;
- `tiered reads` — whatever the model chose to pull from `status` / `inspect`,
  cumulative for the same reason;
- `discovery` = the two together — what the model spent *learning what to ask*;
- `eager` — the like-for-like alternative: the whole form (every step, every
  field, its type, whether it's required, and its ask) rendered into the system
  prompt and re-sent every call.

`eager` is generated from the same compiled form and the same `projectView` the
tiers use, so it can't be accused of being a strawman. Write verbs and their
results are common to both designs and excluded from both sides.

Totals come from the provider's own `prompt_tokens`; the *breakdown* is measured
with one fixed tokenizer (`o200k_base`) over the exact strings injected, so the
split is comparable across models whose own tokenizers differ.

**Instruction following.** Signals come off tool results rather than being
guessed from prose:

| Metric | What it catches |
|---|---|
| `batch` | Fields per write call. §7 asks for everything learned in one call; trickling one field at a time still finishes but wastes turns. |
| `rejected` | Values zod refused — recoverable friction, and the setup for "did it re-ask only that field?" |
| `redundant` | A write that re-sent a value already stored and valid. |
| `unknown` | Field ids the form doesn't declare — pure hallucination. |
| `tool errors` | Including calls to verbs that don't exist. |

## Scenarios

Six scripted conversations, each aimed at one contestable claim in the design.

| Scenario | Probes |
|---|---|
| `straight-through` | Baseline — cooperative user, in order. Does the plain path work at all? |
| `front-loaded` | §2, writes are never gated. A first turn carrying four steps' worth of answers should land in one call. |
| `held-value` | §5.1. A correction orphans an answer into `held` rather than deleting it, and the form still completes without it. |
| `bad-staff-id` | §7. One bad value must not reject the rest of the patch. |
| `what-else` | Tier 2. Asked what's still coming, does it answer from the form or invent requirements? |
| `over-cap` | §3. A blocking checkpoint rejects — is the reason relayed, or swallowed? |

The user is **scripted, not simulated by a second model**. A model-driven user
would drift between cells, and the point is to hold the conversation fixed so
the difference between models is attributable to the models. It also keeps a
full matrix inside a dollar.

Each cell gets a fresh in-memory adapter and its own `subject`, and the
conversation opens with the form already in progress — the common host case,
and it keeps `start` off the critical path so a model isn't penalised for
skipping something the host would normally do. All seven verbs are still
exposed, so their schema cost is real, and a model that calls `start` again is
graded on the instance it actually ended up on.

## Reading a failure

A failed cell is a claim about the model, but only if the harness is sound —
so `pnpm selfcheck` drives every grader with a scripted model that does
everything right (must pass), one that records nothing (must fail), and one
that walks the held-value correction. It also asserts the bridged JSON Schemas
are shapes a provider will accept. Run it after touching anything here.

## Cost

OpenRouter reports real spend per call, so `--budget` is a hard stop checked
before each cell rather than an estimate. Results flush after every cell, so an
abort keeps whatever was already paid for. The default model set is cheap and
spread across vendors; a full 4×6 matrix at two repetitions runs well under
$0.50 at the prices these were chosen at.

> Filed under `examples/` as asked. The three sibling harnesses
> (`benches/scratchpad-bench`, `benches/support-desk`,
> `benches/working-environment-bench`) live under `benches/` — move it there if
> you'd rather it sat with them; nothing but the workspace glob depends on the
> location.
