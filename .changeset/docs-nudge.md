---
"glove-working-environment": minor
---

`nudgeToDocsOnFirstWrite` — an opt-in that refuses the first script write of a session, once, when no docs have been opened, naming `/skills/README.md`. Resending the identical write succeeds; nothing afterwards is ever refused.

It ships **off**, and the measurement is the reason rather than caution. A/B over 45 runs per arm (5 scenarios × 3 models × 3 reps, same build, same day):

| | off | on |
|---|---|---|
| complete | **25/45** | **24/45** |
| genuine errored calls | 87 | 72 |

Two of the three models scored identically. It does what it was built to do — errors fall about 17% — and that does not convert into delivered work, which is the finding worth recording: the failures it removes were not the ones costing runs.

Kept as an opt-in rather than deleted, because it costs nothing when off and a different model mix may answer differently. Turn it on to re-measure, not because it is expected to help.
