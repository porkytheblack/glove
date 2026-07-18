# support-desk-bench

An **application** bench for the delegation-economics question: a SOTA
open-source planner authors a support-triage **workflow**, and either does the
per-ticket judgement itself or hands it to a **cheap model**. We measure all
three things a team cares about on the same runs — **quality**, **cost**, and
**privacy**.

> 📄 **Read the write-up: [Delegation Economics](PAPER.md)** — the full study with
> figures: quality-at-par, the cost curve, the delegate-choice result, and the
> PII-leak contrast.

Built on two shipped primitives:
[`defineModelFn`](../../packages/glove-scratchpad) (delegate a scoped judgement
to another model as a catalog function) and
[`glove-egress`](../../packages/glove-egress) (measure whether data crossed the
boundary).

## The two arms

Both mount the [glove-js](../../packages/glove-js) **workflow** surface; the
planner authors one program that triages a 15-ticket inbox (categorize + decide
escalations) and calls `submit_triage`.

| arm | who does the per-ticket judgement | ticket bodies |
| --- | --- | --- |
| **solo** | the planner reads every body and classifies it itself | cross into the planner's context |
| **delegated** | `classify_ticket(id)` hands the body to a cheap model, returns `{ category, escalate }` | stay with the delegate |

## What's measured

- **Quality** — escalation **F1** (the real judgement) + category accuracy, graded
  deterministically from the structured `submit_triage` against seeded ground truth.
- **Cost** — planner $ + delegate $ at live OpenRouter prices.
- **Privacy** — three customers pasted an SSN / card / API key into their tickets;
  an exact canary scan (`glove-egress`) reports whether that PII crossed into the
  planner's context.

## Headline

Delegating each ticket to **Qwen3-30B** matched or beat every planner's own solo
triage (86–92% F1), at **17–78%** of the solo cost, leaking **0** PII canaries —
where solo leaked all three, every time. The delegate is a choice, though:
DeepSeek-V4-Flash, cheaper still, landed 25–80% on the same tickets.

## Running

Needs `OPENROUTER_API_KEY` (loaded from the repo-root `.env` if present).

```bash
# no API — world, graders, delegate parse, and the solo-leaks / delegated-safe contrast:
pnpm --filter support-desk-bench selfcheck

# the bench (guard spend with --budget, USD):
pnpm --filter support-desk-bench bench --budget=1.0
pnpm --filter support-desk-bench bench --planners=glm5,kimi27 --delegates=qwen30b

# figures:
pnpm --filter support-desk-bench figures
```

Flags: `--planners`, `--delegates`, `--arms`, `--budget`, `--maxTurns`,
`--maxTokens`, `--timeout`, `--echo`.

## Layout

```
src/
  world.ts       # the seeded inbox: tickets + ground-truth labels + PII canaries
  models.ts      # roster: SOTA planners (<$5/M out) + cheap direct delegates
  task.ts        # the triage task + deterministic graders (escalation F1, category)
  arms.ts        # solo vs delegated (defineModelFn classifier) over the workflow surface
  run.ts         # CLI + runner + writers
  figures.ts     # SVG figures for PAPER.md
  selfcheck.ts   # no-API validation of the whole layer
results/         # desk-summary.md + desk-results.json
logs/            # per-cell JSONL transcripts (git-ignored — contain canary bodies)
```
