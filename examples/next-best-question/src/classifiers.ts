import {
  answerFromDistribution,
  assertValidRequest,
  jev,
  llmClassifier,
  type Answer,
  type ClassifierAdapter,
  type ClassifyRequest,
  type ClassifyResult,
  type Description,
  type Questions,
} from "glove-classifier";
import { createAdapter } from "glove-core/models/providers";

/**
 * The classifier the demo and bench run with. `CLASSIFIER` picks it:
 *
 * - `local` (default): a zero-shot NLI model run in-process with
 *   transformers.js. No key and no server; the weights (~70 MB quantized)
 *   download once into `.cache/`. `NLI_MODEL` picks another checkpoint.
 * - `jev`: TypeSafe's hosted Jev. Needs `TYPESAFE_API_KEY`.
 * - `llm`: a chat model as a classifier, via OpenRouter. Needs
 *   `OPENROUTER_API_KEY`; `LLM_MODEL` picks the model.
 */
export async function pickClassifier(name = process.env.CLASSIFIER ?? "local"): Promise<ClassifierAdapter> {
  switch (name) {
    case "local":
      return localNli(process.env.NLI_MODEL);
    case "jev":
      return jev();
    case "llm":
      return llmClassifier({
        model: createAdapter({ provider: "openrouter", model: process.env.LLM_MODEL ?? "openai/gpt-4.1-mini", stream: false }),
      });
    default:
      throw new Error(`unknown CLASSIFIER "${name}" (expected local, jev or llm)`);
  }
}

/**
 * A zero-shot NLI model as a `ClassifierAdapter`, with every hypothesis of a
 * request scored in one forward pass.
 *
 * Each question becomes NLI hypotheses against the state:
 *
 * - **noul**: P(entailment) of the instructions, out of all three NLI
 *   classes. The transformers.js zero-shot pipeline's multi-label mode
 *   compares entailment against contradiction only and drops *neutral*,
 *   which is exactly the "not mentioned" case, so "Hi, I think I've been
 *   burgled" came out as entailing "The speaker says their name".
 * - **choice** / **score**: the standard zero-shot reading: entailment logits
 *   of each label's description, softmaxed across the labels.
 *
 * NLI judges whether a statement follows from the text, so hypotheses work
 * best phrased as the answer ("The car cannot be driven.") rather than as a
 * question about the text ("The speaker says whether the car can be driven.").
 */
export async function localNli(model = "Xenova/nli-deberta-v3-xsmall"): Promise<ClassifierAdapter> {
  const { AutoModelForSequenceClassification, AutoTokenizer, env } = await import("@huggingface/transformers");
  env.cacheDir = new URL("../.cache/", import.meta.url).pathname;
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const nli = await AutoModelForSequenceClassification.from_pretrained(model, { dtype: "q8" });
  const index = Object.fromEntries(
    Object.entries((nli.config as unknown as { id2label: Record<string, string> }).id2label).map(([i, label]) => [label.toLowerCase(), Number(i)]),
  );
  const entailment = index.entailment;
  if (entailment === undefined) throw new Error(`${model} has no "entailment" label; is it an NLI model?`);

  /** Raw logits for each (premise, hypothesis) pair, in batches. */
  const logits = async (premise: string, hypotheses: string[]): Promise<number[][]> => {
    const rows: number[][] = [];
    for (let i = 0; i < hypotheses.length; i += 32) {
      const batch = hypotheses.slice(i, i + 32);
      const inputs = await tokenizer(batch.map(() => premise), { text_pair: batch, padding: true, truncation: true });
      rows.push(...((await nli(inputs)).logits.tolist() as number[][]));
    }
    return rows;
  };
  // One ONNX session, CPU-bound: run requests one after another.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    name: `local:${model}`,
    classify<Q extends Questions>(request: ClassifyRequest<Q>): Promise<ClassifyResult<Q>> {
      assertValidRequest(request);
      const run = queue.then(async () => {
        const premise = typeof request.state === "string" ? request.state : JSON.stringify(request.state);
        const plan = Object.entries(request.questions).map(([id, q]) => ({
          id,
          q,
          options: q.type === "noul" ? ["true"] : q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i)),
          hypotheses: q.type === "noul"
            ? [text(q.instructions)]
            : q.type === "choice"
              ? Object.entries(q.criteria).map(([label, d]) => text(d) || label)
              : q.criteria.map((d, i) => text(d) || `level ${i}`),
        }));
        const rows = await logits(premise, plan.flatMap((p) => p.hypotheses));
        const answers: Record<string, Answer> = {};
        let at = 0;
        for (const p of plan) {
          const mine = rows.slice(at, (at += p.hypotheses.length));
          const scores = p.q.type === "noul" ? [softmax(mine[0]!)[entailment]!] : softmax(mine.map((r) => r[entailment]!));
          answers[p.id] = answerFromDistribution(p.q, Object.fromEntries(p.options.map((o, i) => [o, scores[i]!])));
        }
        return { model: `local:${model}`, answers: answers as ClassifyResult<Q>["answers"], usage: { input_tokens: 0, output_tokens: 0 } };
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

function text(d: Description | undefined): string {
  return d == null ? "" : typeof d === "string" ? d : JSON.stringify(d);
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}
