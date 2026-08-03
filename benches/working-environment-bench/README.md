# glove-working-environment-bench

Real models, driven through the working environment's verb surface, doing end-to-end deliverable work.

```bash
pnpm selfcheck                       # solve every scenario host-side — no API cost
pnpm bench                           # all models, all scenarios
pnpm bench -- --models xiaomi/mimo-v2.5
pnpm bench -- --scenarios pdf-report --budget 0.50
```

Needs `OPENROUTER_API_KEY` (read from the repo-root `.env` if present). A full matrix run costs cents, and `--budget` is a hard stop, not a suggestion.

## What it measures

Not "can a model use a tool" — the unit tests already prove the verbs work. This measures whether an agent with **no prior knowledge of this package** can get a real deliverable out of it, and it reports the answer in two halves:

- **Outcomes.** Did the artifact appear, and is it correct? Every check runs host-side against the tree the model left behind, never against what the model claimed. A run that reports success and produced nothing scores zero, which is the only convention worth having.
- **Friction.** Every errored tool call, grouped by normalised message. This is the more useful half. Failed calls are the environment telling you where its affordances don't match what models reach for — a hallucinated verb name says what the surface was expected to contain, and a repeated error message says which guardrail is teaching the wrong lesson.

## Scenarios

| Name | What it proves |
|---|---|
| `pdf-report` | Read a CSV, aggregate it correctly, author a PDF. Graded on the *summed* totals, so a model that transcribes rows instead of grouping them fails. |
| `script-library` | Write a reusable, documented script and run it — then the grader snapshots the tree, restores it into a **fresh environment**, and runs the stored script on input it has never seen. This is the persistence claim, tested rather than asserted. |
| `custom-stdlib` | Discover and use `env:motion`, an adapter that exists only in this bench and that no model has seen. Proves the extension path works from cold: nothing but `/std` tells the model it exists. |
| `compose` | One deliverable spanning three adapters — a contact sheet from images, a table from a CSV, both embedded in a PDF. |

`pnpm selfcheck` solves all four host-side and grades them. Run it after touching a scenario: a benchmark whose tasks are impossible measures nothing, and that failure is invisible — every model simply scores zero.

## `env:motion` is deliberately local

`src/motion.ts` is a bespoke adapter that assembles stills into animated clips. It is not exported by any package and is not meant to be. Its job is to answer a question the shipped adapters cannot: can a host bolt on a capability the environment has never heard of, and will a model find it and use it correctly with nothing but the materialised `/std` docs to go on?

It is also written the way a downstream user would write one — `defineAdapter`, paths in and out, `describe()` first — so it doubles as a worked reference for the authoring contract.

## Output

`results/report.md` (outcomes, failed checks, friction, verb usage) and `results/raw.json` (full transcripts, every tool call with arguments, results, and timings).
