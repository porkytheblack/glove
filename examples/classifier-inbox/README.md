# classifier-inbox

Classifier models on a labelled support inbox. This example accompanies [`glove-classifier`](../../packages/glove-classifier) and the blog post [Classifier models in Glove](https://glove.dterminal.net/blog/classifier-models).

The inbox (`src/inbox.ts`) is deterministic. It has 80 messages, about 24k tokens including real-world signatures, quoted threads and legal footers, and five kinds of message: refund, bug, sales, spam and other. Every message has ground-truth labels. A few are deliberately awkward: a typo report that says "no refund needed", a "refund received, thanks", phishing that says "claim your refund", and a request for "money back" that never uses the word refund. One refund request carries a canary account number, so each run can check whether customer data reached the agent's context.

```bash
# from the repo root, with TYPESAFE_API_KEY and OPENROUTER_API_KEY in .env
pnpm --filter glove-classifier-inbox-example repl    # the program an agent would write (Jev only, no LLM)
pnpm --filter glove-classifier-inbox-example agent   # an agent with mountClassifier + an inbox source
pnpm --filter glove-classifier-inbox-example bench   # the benchmark below (spend-capped, ~$0.08 per run)
pnpm --filter glove-classifier-inbox-example compare # classifiers alone: Jev, self-hosted open models, zero-shot scorers
```

`BENCH_MODEL` picks the agent and LLM-classifier model (default `openai/gpt-4.1-mini`, via OpenRouter). `BENCH_RUNS` sets the runs per agent arm, and `BENCH_CAP_USD` sets the hard spend cap.

## Results

The runs are from 2026-09-25 and cost about $0.30 in total. The full per-run answers and tool calls are in [`results/`](results).

### Classifiers: 80 messages × 3 questions

| Classifier | Refund | Urgent | Kind | Wall time | Cost |
| --- | --: | --: | --: | --: | --: |
| Jev (`jev-latest` → `jev-1.13.0`) | **100%** | 97.5% | **100%** | **1.35 s** | **$0.0024** |
| LLM (`gpt-4.1-mini`, 8 parallel) | 95% | 96.3% | 95% | 16.3 s | $0.0277 |
| Cascade (Jev → LLM below 0.6 confidence) | 95% | **100%** | **100%** | 3.3 s | $0.0054 |

The cascade escalated 12 of 240 answers.

### Hosted and self-hosted classifiers

`compare` runs every classifier whose environment is configured: `TYPESAFE_API_KEY` for Jev; `LAYA_BASE_URL`, `KEV_BASE_URL`, `VON_BASE_URL`, `RIZZO_BASE_URL` or `DECIDER_BASE_URL` for the open System One models; `HF_TOKEN` for a Hugging Face zero-shot model; and `GLICLASS_BASE_URL` for GLiClass. Results go to [`results/classifiers.json`](results/classifiers.json).

| Classifier | Refund | Urgent | Kind | Time per message |
| --- | --: | --: | --: | --: |
| Jev (hosted, `jev-1.13.0`) | 100% | 97.5% | 100% | 18 ms |
| Laya (self-hosted with `laya-serve`, English checkpoint, 4 vCPU, no GPU) | 75% | 88.8% | 81.3% | 2.85 s |

Laya's English checkpoint reads 512 tokens, so these ~300-token emails plus their questions get truncated. On a GPU its authors report about 40 ms per question.

### Agents: "Which messages ask for a refund? How many are urgent?"

Three runs per arm. The canary check asks whether customer data from the inbox entered the agent's context.

| Model | Arm | Refund F1 | Urgent-count error | Agent context (tokens) | Canary seen | Agent cost |
| --- | --- | --: | --: | --: | --: | --: |
| gpt-4.1-mini | read the inbox | 0.93 | 3.67 | 24,455 | 3/3 | $0.0102 |
| gpt-4.1-mini | **classifier source** | **1.00** | **0** | **3,705** | **0/3** | **$0.0018** |
| gpt-4.1-mini | REPL + `classifier.many` | 0.97 | 1.33 | 5,064 | 0/3 | $0.0026 |
| gpt-4.1 | read the inbox | 1.00 | 1.00 | 24,455 | 3/3 | $0.0505 |
| gpt-4.1 | **classifier source** | **1.00** | **0** | **3,703** | **0/3** | **$0.0091** |
| gpt-4.1 | REPL + `classifier.many` | 0.93 | 1.33 | 5,088 | 0/3 | $0.0126 |

The Jev cost for the classifier arms is about $0.002 per run and is not included in the agent-cost column.

What the runs showed, including what we changed because of them:

- **Reading costs context and accuracy.** Reading the inbox put 24k tokens into the agent's context on every run. The smaller model still missed or added refund requests and miscounted urgent ones (it answered 4 or 5 when the truth was 8).
- **Sources remove the reading step.** The agent asks both questions in one call and sees only ids, subjects and answers. The canary never reached it.
- **Tool ergonomics mattered.** The first version of the tools used a strict question schema, and a small model spent its whole turn budget on validation errors. It sent questions as bare strings, left out `instructions`, and wrote `type: "yes_no"`. The tools now accept those shapes (`normalizeQuestions`).
- **REPL agents need scalar results.** Early REPL runs used keyword matching instead of the classifier, or compared `answers.refund === "yes"` against nested objects. `classifier.many` now returns plain values (`answers.refund > 0.5`, `answers.team === "billing"`), and its description says when to prefer it over matching text. REPL F1 went from 0.65 to 0.97.
- **Truncation needs a note.** An unfiltered source call used to be capped at 50 results with only a `truncated` flag. Results now come with a note explaining how to narrow or widen them, and the default cap is 100.

The inbox is templated, so these are measurements of mechanism, not a leaderboard. The labels are unambiguous by construction, and "urgent" is a judgement call even for a person.
