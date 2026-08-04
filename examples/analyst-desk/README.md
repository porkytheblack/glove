# analyst-desk

An agent given the documents an analyst actually gets: an 80-page annual report, a sales export that is messy in the way real exports are, and instructions to produce a briefing, a deck and a PDF from them.

The point is not that the agent has document tools. It is that **the report cannot be read**. Eighty pages is ~200 KB of text, and the environment caps a tool response at 8 KB, so there is no path where the model pulls the document into its context and paraphrases. It has to get the text into the tree and search it. That constraint is the subject of the test.

```bash
pnpm selfcheck    # free — proves the scenarios are solvable and the graders work
pnpm judgecheck   # ~$0.01 — proves the judge can tell right from wrong
pnpm eval         # real models, hard budget ceiling
```

## Grading, twice

Two tiers, split by what kind of question is being asked.

**Deterministic checks own facts.** Is EMEA's revenue exactly $2,435,210, does the deck have three slides, does the PDF still say the right total when an independent reader extracts it. A model judging these would be strictly worse than an equality test — it can only add noise to something already known exactly.

**A judge owns readings.** Is the briefing faithful to the source, does it surface every material matter, does it assert anything the corpus never said. No regex decides that.

The judge is a stronger model than the ones doing the work — `z-ai/glm-5.2`, which scored 16/16 in the earlier benchmark where the agents here score 9–15, so the gap is measured rather than assumed. It never sees the transcript, the reasoning or the turn count, only the artifact and the ground truth, so it cannot be talked into passing a wrong document by a confident-sounding process. Verdicts default to fail on uncertainty.

## Why the ground truth is exact

Every fixture is generated, and that is load-bearing rather than convenient. A committed PDF can only be graded against what someone believed it said. A generated one is graded against what the generator knows it says: the regional totals are summed by the same code that wrote the 420 rows, so "the summary got EMEA right" is a fact, not an opinion.

Four things are planted deliberately, each catching a different way of doing the work badly:

| Plant | Catches |
|---|---|
| **Buried facts** on pages 44, 61, 68 and 73 — litigation, customer concentration, a debt covenant, a post-period acquisition | Reading the first page and paraphrasing. They are reachable only by searching. |
| **A computed figure** — regional totals exist in no file and must be derived from 420 rows | Transcribing the first few rows, which produces a plausible wrong number. This is what real models actually did in the earlier benchmark. |
| **A distractor** — a settled prior-year provision of $1.1M, worded like the outstanding $2.4M one and sitting seven pages earlier | Grepping for "provision" and taking the first hit. |
| **Fabrication traps** — headcount, competitors and growth rates are never stated anywhere, and the tasks invite a sentence about the company's position | Inventing. No deterministic check can catch this; a reader can. |

The CSV carries the mess separately: three date formats, amounts with and without `$` and separators, stray whitespace in region values, a blank line, a trailing comment, and one duplicated row. The grouped amounts are quoted, so the file is *valid* CSV rather than merely ugly — which means `env:std.csv.parse` handles it and `split(",")` silently reads the wrong column on a quarter of the rows.

## Scenarios

| id | what it asks | what it is really testing |
|---|---|---|
| `pdf-review` | Brief a director on every risk in the 80-page report, with page numbers | Whether a document too large to read is workable at all |
| `csv-analysis` | Regional totals to `/out/revenue.json` | Parsing a real export, and arithmetic over 420 rows |
| `deck-build` | A board deck at `/out/board.pptx` | Producing a real artifact, verified by reading the file back |
| `pdf-report` | A one-page revenue PDF | Whether figures survive being written and re-extracted |

Tasks state an outcome, never a method. Telling the agent to use `grep` would test instruction-following; the interesting question is whether it works the problem out.

## Verification reads the file, not the intent

Nothing is graded on what the agent said it did. Every artifact is re-opened with a **different library than produced it**: a PDF written by pdf-lib is extracted with pdfjs, a deck written by pptxgenjs is parsed by the slides package's own OOXML reader. A verifier sharing a library with the writer only proves the pair agree with each other.

## Selfcheck first, always

`pnpm selfcheck` solves every scenario with a hand-written reference script and runs the real graders over the result. It costs nothing and it answers two questions before any money is spent: is this possible in the environment, and does a correct answer actually pass?

It earns its place. On its first run it found three bugs in this harness — a CSV whose quoted fields broke the reference parser, a `pdf.create` call with the arguments in the wrong order, and a check comparing against totals the generator no longer produced. Each would have shown up as "the models failed" and been believed.

`pnpm judgecheck` does the same for the judge: one briefing known to be right, one wrong in four specific ways, and the judge has to separate them. Without it, every verdict in a real run is unfalsifiable.

## Cost

The budget ceiling is checked before every call, not tallied afterwards, so an overrun stops the run rather than being discovered in the summary. `--budget 2` to lower it, `--models` and `--scenarios` to narrow, `--judge` to swap the verifier (`xiaomi/mimo-v2.5-pro` is the other sensible pick).

The response caps are what make this affordable: the agent physically cannot pull 200 KB of report into a prompt, so a scenario over an 80-page document costs cents.
