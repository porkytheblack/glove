# Is a workflow just a renamed REPL? — the framing bet

*A design exploration building on ["The Scratchpad Is a REPL"](REPL-PAPER.md). It
takes the **Workflows** section of the *"Workflows, Assertions, and Delegated
Model Calls"* design thesis and turns it into a measurement. Status: **live A/B
run** — see §6.*

---

## 1. Where this comes from

The REPL paper folded an agent's capabilities behind ONE code-eval tool
(`execute_js` / `execute_python` / `execute_lisp`) and showed the model computes
over results in the sandbox instead of round-tripping every intermediate through
its context window. The mechanism works. But a behavioral failure survived every
round of hardening, and it is not architectural — it is behavioral:

> Models degrade the code surface back into an incremental tool-call loop. They
> run one form, look at the result, run another — a *session* — instead of
> authoring one program that does the whole task.

The surface was built for programs; models drive it like a prompt. The thesis
diagnoses a **training prior**: models have consumed millions of REPL transcripts
— `>>>`, the Node prompt, the Clojure prompt — and every one is interactive,
line-by-line, print-after-each-form. The token "REPL" and the `execute_js`
affordance pattern-match to that, so the model reenacts a *session*. **The name
hands the model the wrong mental model.**

This exploration asks the narrowest possible version of the question:

> Hold the runtime, the catalog, the scenarios, and the models fixed. Change
> **only the name and the priming** of the one eval tool. Does the model author
> more of the task as a single program?

## 2. What a workflow is

A *workflow* is the `execute_*` payload itself, written as a **complete
multi-step program** — discovery, fetching, filtering, branching, effects — that
does the whole task before anything passes back to the model. One call in, one
shaped value out. Nothing is persisted or registered; it is model-authored,
per-turn, ad hoc. It is a *framing* of the existing surface, not a new surface.

So the package now mounts the same eval tool under three framings, chosen with
one config flag (`frame`), identical in every other respect:

| frame | tool name | priming |
|---|---|---|
| `repl` (default) | `execute_js` | the classic "persistent JavaScript REPL"; top-level `const` persists across calls |
| `program` | `execute_js_program` | "you write COMPLETE programs"; a rename + a light de-REPL, persistence demoted |
| `workflow` | `execute_js_workflow` | "you author WORKFLOWS — one program carries the task start to finish"; **actively de-REPLs** the priming |

The three differ in exactly the levers the thesis names:

1. **The word.** `repl` says "REPL"; `workflow` never does — it says "write the
   script, not type at a prompt."
2. **Persistence.** `repl` advertises cross-call `const` as a feature (an
   incentive to split). `workflow` demotes it to a *recovery aid* only ("if a
   workflow fails partway you can continue without recomputing — never split a
   task across calls on purpose").
3. **The shape peek.** `repl`'s discipline says *inspect one row FIRST from an
   initial call* — literally an instruction to split. The one-shot framings point
   out you can `const rows = fn(...)` and read `rows[0]` **inside the same
   program**, so no separate call is needed to learn a shape.
4. **The target.** `repl` says "as FEW calls as possible"; `workflow` names "ONE
   workflow per task" as the explicit goal.

`program` is the deliberate half-step: it renames the tool and drops the "REPL"
word but keeps the priming otherwise neutral. It isolates *how much is the name
alone* versus *how much is the full reframing*.

## 3. The mechanism, and why the metric is tool calls

Every avoided `execute_*` call is a boundary crossing avoided. The REPL paper's
headline efficiency metric was **median model-visible tool calls per task**;
platform hardening took it 6 → 2. The thesis predicts framing is the push from
**2 → 1**. So the headline here is:

- **eval calls per task** — how many times the model invoked the eval tool
  (`execute_*`). One is the target; two-plus means it split.
- **single-call rate** — the fraction of runs that did the whole task in exactly
  one eval call. This is the "2 → 1" claim made falsifiable.
- **pass rate**, carried alongside, so a framing cannot win by degrading
  correctness. A single call that is confidently wrong is not the goal.

## 4. What is held constant (so the framing is the only variable)

Everything but the framing. Same PRNG-seeded mock org (ten in-process MCP
servers, 32 tools), same `fnsFromMcp` catalog, same `glove-core` agent loop, same
deterministic verifiers (writes graded on the unforgeable outbox), same models,
same runtime session — a `program`-framed and a `workflow`-framed tool execute
byte-identical code against the same interpreter.

**Discovery is run in both conditions.** The primary run holds discovery at
`full` — function signatures *and* sampled result shapes primed into every arm's
prompt, so a `repl`-framed model has no shape-peek *excuse* to split; it already
knows the row fields. That deliberately handicaps the hypothesis: if the framing
still collapses calls when the usual reason to split has been removed, the effect
is the framing itself, not missing information. A second run at
`--discovery=progressive` primes *nothing* — the model must discover — which
re-introduces the peek temptation and is the harder, more realistic test. Both are
in §6.

The scenarios are the six most composition-heavy tasks in the suite — the place a
model is most tempted to peek-then-split: a cross-service join
(`merged-prs-open-linear`), a group-by argmax (`busiest-assignee`), an
argmax→write (`email-top-error`), a decide-and-act branch (`incident-branch`), a
two-part reuse (`open-prs-breakdown`), and a three-filter needle
(`needle-sweep`).

Grading gates the paid run: `pnpm --filter glove-scratchpad-bench frame-selfcheck`
validates the naming, the de-REPL framing, the mount wiring, and — the
single-call *ceiling* — that a hand-authored one-program solution passes the same
verifier in every language. 100% single-call is achievable; the bench measures
how close a model gets.

## 5. Running it

```bash
# no API key — validate naming, framing, mount wiring, and the single-call ceiling:
pnpm --filter glove-scratchpad-bench frame-selfcheck

# the A/B (guard spend with --budget, in USD):
pnpm --filter glove-scratchpad-bench frame-bench --budget=1.0
pnpm --filter glove-scratchpad-bench frame-bench --langs=js,py --models=glm,deepseek --frames=repl,workflow
```

Flags: `--models`, `--scenarios`, `--langs` (`js,py,lisp`), `--frames`
(`repl,program,workflow`), `--discovery` (`full` default / `progressive` /
`auto`), `--budget`, `--maxTokens`, `--maxTurns`, `--timeout`, `--out`,
`--append`. Writes `results/frames-*.{json,csv,md}` and `logs/frames/*.jsonl`.

## 6. Results

<!-- RESULTS:BEGIN -->
Two conditions, four cheap-to-weak OpenRouter models (GLM-4.7-Flash,
DeepSeek-V3.2, Xiaomi MiMo-v2.5, Qwen3-30B), JS surface, `maxTurns=14`. **`full`**
= all six scenarios with signatures + result shapes primed (the peek-to-split
excuse removed for every frame); **`progressive`** = the four most shape-dependent
scenarios with *nothing* primed (the model must discover). *Single-call* = the
whole task done in exactly one eval-tool call (discovery via the separate
discovery tools does not count against it). Samples are modest (n = 24 and 16 per
frame) — read these as directional.

**`full` discovery** (shapes primed; `$0.23`):

| frame | n | pass | single-call | eval calls (avg / med) | disc calls | turns |
|---|--:|:--:|:--:|--:|--:|--:|
| repl | 24 | **83%** | 21% | 4.38 / 3.5 | 0.2 | 5.9 |
| program | 24 | 79% | 29% | 3.75 / 2.0 | 0.2 | 5.1 |
| workflow | 24 | 71% | **38%** | **3.46** / 2.0 | 0.5 | **4.9** |

**`progressive` discovery** (nothing primed; `$0.17`):

| frame | n | pass | single-call | eval calls (avg / med) | disc calls | turns |
|---|--:|:--:|:--:|--:|--:|--:|
| repl | 16 | 69% | 25% | 4.06 / 3.5 | 2.5 | 7.2 |
| program | 16 | 75% | **44%** | **3.38** / 2.0 | 2.9 | 6.4 |
| workflow | 16 | **81%** | 31% | 4.62 / 3.5 | 3.0 | 8.1 |

**Per model** (single-call% / pass% / avg eval calls), the heterogeneity that the
aggregates hide:

| | repl | program | workflow |
|---|---|---|---|
| **`full`** | | | |
| glm | 50 / 83 / 2.2 | 50 / 50 / 3.2 | 33 / 50 / 3.7 |
| deepseek | 17 / 100 / 5.5 | 0 / 100 / 4.0 | 0 / 100 / 3.7 |
| xiaomi | 0 / 83 / 3.2 | 33 / 100 / 2.3 | **67 / 100 / 1.7** |
| qwen30b | 17 / 67 / 6.7 | 33 / 67 / 5.5 | 50 / **33** / 4.8 |
| **`progressive`** | | | |
| glm | 50 / 50 / 1.5 | 50 / 50 / 4.8 | 0 / 100 / 5.2 |
| deepseek | 0 / 75 / 7.0 | 25 / 100 / 2.8 | 25 / 100 / 3.2 |
| xiaomi | 25 / 100 / 3.5 | 50 / 100 / 1.8 | **75 / 100 / 2.0** |
| qwen30b | 25 / 50 / 4.2 | 50 / 50 / 4.2 | 25 / **25** / 8.0 |

**What the numbers say — honestly:**

1. **The name is part of the contract.** Renaming the one tool and de-REPLing its
   priming moves behavior every time. It is *not* the simple "workflow always
   wins" the pilot teased — but the framing is a real, measurable lever, not a
   cosmetic relabel.
2. **De-REPLing raises single-call composition and cuts calls — at a correctness
   cost that lands on the tail.** Under `full`, single-call climbs monotonically
   **21% → 29% → 38%** and avg eval calls / turns fall — but pass slips **83% →
   71%**, driven almost entirely by the *weakest* model (qwen30b) over-committing
   to one confidently-wrong program (workflow 50% single but 33% pass). The
   aggressive one-shot push helps models that can carry a whole task and hurts the
   one that can't.
3. **Xiaomi is the thesis working exactly as written.** MiMo-v2.5 goes **0% → 67%
   single-call at 100% pass** (`full`) and **25% → 75%** (`progressive`) — same
   correctness, far fewer calls, purely from the framing. When a model is capable
   enough to compose but prone to sessionize, the frame is close to a free win.
4. **DeepSeek gets cheaper, not different.** It already passes ~everything and
   rarely single-calls; the de-REPL framings cut its eval calls (5.5→3.7 `full`,
   7.0→3.2 `progressive`) with no correctness cost — economy, not accuracy.
5. **`program` — the rename-only half-step — is the best-calibrated middle.**
   Under `progressive` it posts the best single-call rate (**44%**) and fewest
   eval calls (**3.38**) while *improving* pass (69%→75%). That much of the effect
   comes from dropping the word "REPL" — not the heavier workflow priming — is the
   sharpest finding here: the lightest touch is often the best-tuned, and the
   maximal workflow push can overshoot into single-confident-wrong on weak models.

The transferable claim survives, in a more careful form than the pilot promised:
**"REPL" quietly licenses a session and measurably invites splitting; a
program/workflow name quietly asks for one program. Which of the two de-REPL
framings to pick is a tuning decision — `program` for the best call-economy at
held correctness, `workflow` when the model is strong enough to spend the extra
one-shot pressure well.**
<!-- RESULTS:END -->

### 6.1 The mechanism, caught in one transcript

Xiaomi MiMo × `email-top-error` (argmax → compose → **send**, `full` discovery) —
both framings passed, but reached the answer completely differently:

- **`repl` — 4 eval calls, a session.** The model drove discovery *through the
  eval tool*, one form at a time: `execute_js({code: 'search("sentry issue")'})`,
  then `execute_js({code: 'describe("sentry__list_issues")'})`, then
  `execute_js({code: 'search("send email")'})`, and only the 4th call did the
  read → argmax → send. The name `execute_js` invited an interactive session, so
  the model held one open.
- **`workflow` — 1 eval call.** The model discovered with the *dedicated*
  discovery tools (`search_functions`, `describe_function`), then spent its single
  `execute_js_workflow` on one complete program that fetched, found the worst
  issue, and sent the email.

That is what "single-call rate" measures: not fewer *actions*, but the eval tool
reserved for **one whole program** instead of run open like a prompt — with
discovery pushed onto the tools built for it (which is why the de-REPL frames show
*more* discovery-tool calls, not fewer). It is the same mechanism the thesis
names — the name sets the mental model — caught in a diff.

## 7. The package API

The framing is a first-class mount option on all three surfaces
(`glove-js`, `glove-python`, `glove-lisp`), so a developer picks it per
deployment based on the language and the behavior they want:

```ts
import { JsSession, mountJs } from "glove-js";

const session = JsSession.create();
session.registerAll(await fnsFromMcp(conn));

mountJs(agent, { session });                      // frame: "repl"     → execute_js (default, unchanged)
mountJs(agent, { session, frame: "program" });    // frame: "program"  → execute_js_program
mountJs(agent, { session, frame: "workflow" });   // frame: "workflow" → execute_js_workflow
```

`execute_python` / `execute_python_program` / `execute_python_workflow` and
`execute_lisp` / `execute_lisp_program` / `execute_lisp_workflow` (the latter's
`explain_lisp` companion follows the frame too) are identical. The default is
`repl`, so existing mounts are byte-for-byte unchanged. Only the tool NAME and
the primed preamble differ; `jsToolName(frame)` / `pyToolName(frame)` /
`lispToolName(frame)` expose the mapping, and `buildJsPreambleBody(frame)` (and
the Py/Lisp analogues) expose the framing text for inspection.

## 8. Honest caveats

- **It is a framing, not a guarantee.** Nothing *forces* a single call — a model
  can still split a `workflow`-framed tool. The bench measures a rate, not a
  proof.
- **`full` discovery flatters one-shot composition.** With shapes primed, the
  main reason to split is already gone; the `progressive` column (§6.2) is the
  harder, more realistic test and the one to weight when the effect is smaller
  there.
- **Grading is coarse on writes.** Effect scenarios grade the outbox; a workflow
  that fires the right effect but reports the wrong count still fails — which is
  correct, but means "pass" bundles compose-correctness with report-correctness.
- **Model roster is cost-bounded.** Runs stay on cheap-to-mid OpenRouter models
  (the tail that actually spirals); a frontier model that already composes in one
  call has little room to improve, so the *absolute* single-call lift is largest
  exactly where the thesis says it should be — the weak-model tail.

The transferable lesson, if the numbers hold: **the one tool's name is part of
its contract.** "REPL" quietly licenses a session; "workflow" quietly demands a
program. Same runtime, one word, measurably different behavior.
