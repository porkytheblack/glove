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

## What it found

The first full run (4 models × 6 scenarios × 2 reps, $0.095) turned up a real
defect in the surface, not in the models.

**279 field ids were rejected as unknown, and 62% of them differed from a real
field only in case or punctuation** — `full_name`, `Full name`, `Staff ID` for
`fullName`, `staffId`. **45 of 262 write calls had *every* field rejected**: a
wholly wasted round trip. It concentrated in `front-loaded` (110 of 279) and was
nearly absent in `straight-through` (3), which is the tell — models guess ids
confidently for fields they have *not* seen, which is exactly the case §7 says
is free:

> Fields outside the open step can be filled by id without inspecting them
> first … A miss here costs nothing; the user gets asked again two steps later.

It did not cost nothing. It was the single largest source of friction on the
surface and the main cause of the `front-loaded` failures.

The fix (in `glove-memory/forms`): field ids resolve through a compile-time
alias index over normalised ids *and* labels, so case and punctuation stop
mattering; ids that still don't resolve come back with `did_you_mean`
suggestions ranked by bigram overlap. `compileForm` rejects any definition whose
fields would collide once normalised, so resolution is never a guess.

Re-running the identical matrix:

| | before | after |
|---|---|---|
| collection rate | 69% | **85%** |
| unknown field ids | 279 | **69** (141 now resolved) |
| write calls fully rejected | 45/262 (17%) | **2/217 (1%)** |
| completion calls | 487 | 435 |
| prompt tokens | 1,357,388 | **1,146,738** |
| spend | $0.095 | $0.085 |

Per scenario: `bad-staff-id` 3/8 → 7/8, `over-cap` 5/8 → 7/8, `front-loaded`
6/8 → 7/8, `held-value` 6/8 → 7/8.

A second, smaller finding, recorded because it nearly became a false result:
the first run capped `max_tokens` at 1024, and reasoning models spent the whole
budget thinking and returned `finish_reason: length` with no content and no tool
call — indistinguishable from a model that ignored its tools. The harness now
counts truncated completions and puts a warning banner above the tables.

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
