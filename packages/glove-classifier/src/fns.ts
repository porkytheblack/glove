/**
 * Classifier functions for code-writing agents.
 *
 * The REPL surfaces (glove-js / glove-python / glove-lisp, via
 * glove-scratchpad's catalog) and the working environment let an agent
 * compute over data it never reads: a program pulls 400 emails, and only its
 * return value enters the agent's context. A classifier is the missing piece
 * — the judgement "is this one about a refund?" happens inside the program,
 * on a model built for it, and the agent sees `["msg_12", "msg_311"]`.
 *
 * {@link classifierFns} returns plain `ToolFn` objects — structurally the
 * same interface `glove-scratchpad/fns` and `glove-working-environment`'s
 * `defineTools` accept — so this package depends on neither:
 *
 * ```ts
 * session.registerAll(classifierFns(jev()));          // JS: classifier.many({...})
 * defineTools({ name: "classifier", fns: classifierFns(jev(), { namespace: null }) });
 * ```
 *
 * REPL programs call host functions one at a time, so `many` fans a whole
 * batch out in parallel inside a single call — prefer it over a loop.
 */
import { z } from "zod";
import { answerConfidence, answerValue } from "./answers";
import { answersMatch, classifyMany, type ClassifyItem, type Where } from "./batch";
import { choice, noul, score } from "./questions";
import { normalizeQuestions } from "./normalize";
import { classifierEntrySchema, classifierQuestionSchema } from "./tools";
import type { Answer, ChoiceAnswer, ClassifierAdapter, ClassifierUsage, Questions, ScoreAnswer } from "./types";

/** Structurally identical to glove-scratchpad's and glove-working-environment's `ToolFn`. */
export interface ClassifierToolFn {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  readOnlyHint?: boolean;
  resultShape?: string;
  server?: string;
  serverDescription?: string;
  call(args: Record<string, unknown>, ctx?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface ClassifierFnsOptions {
  /**
   * Name prefix. Default `"classifier"` → `classifier__classify`, which the
   * REPLs expose as `classifier.classify(...)`. Pass `null` for bare names
   * (`classify`, `many`, …) — what `defineTools` wants, since the module name
   * already namespaces them (`import { many } from 'env:classifier'`).
   */
  namespace?: string | null;
  /** Parallel requests inside `many`. Default 8. */
  concurrency?: number;
  /** Most items one `many` call accepts. Default 2000. */
  maxItems?: number;
  /** Accumulates usage across every call, for cost accounting. */
  usage?: ClassifierUsageTally;
}

/** A mutable running total of classifier usage. */
export interface ClassifierUsageTally {
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

/** A fresh usage accumulator for {@link ClassifierFnsOptions.usage}. */
export function newClassifierUsage(): ClassifierUsageTally {
  return { calls: 0, input_tokens: 0, output_tokens: 0 };
}

const whereSchema = z.object({
  question: z.string(),
  choice: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const questions = z.record(z.string(), classifierQuestionSchema);

/**
 * What a program gets back: plain values it can compare directly
 * (`answers.refund > 0.5`, `answers.team === "billing"`), each answer's
 * confidence, and the full typed answers under `details`.
 */
export interface FlatAnswers {
  answers: Record<string, number | string>;
  confidence: Record<string, number>;
  details: Record<string, Answer>;
}

function flatten(answers: Record<string, Answer>): FlatAnswers {
  const values: Record<string, number | string> = {};
  const confidence: Record<string, number> = {};
  for (const [id, a] of Object.entries(answers)) {
    values[id] = answerValue(a);
    confidence[id] = Math.round(answerConfidence(a) * 1000) / 1000;
  }
  return { answers: values, confidence, details: answers };
}

/** Classifier functions for REPL catalogs and working environments. */
export function classifierFns(
  classifier: ClassifierAdapter,
  options: ClassifierFnsOptions = {},
): ClassifierToolFn[] {
  const ns = options.namespace === undefined ? "classifier" : options.namespace;
  const name = (n: string) => (ns ? `${ns}__${n}` : n);
  const concurrency = options.concurrency ?? 8;
  const maxItems = options.maxItems ?? 2000;
  const server = ns ?? undefined;
  const serverDescription = `Classifier model (${classifier.name}): fast typed judgements — yes/no, pick a label, rate on a rubric. Use it for any question about meaning ("asks for a refund?", "urgent?", "which team?") instead of keyword matching, which misses paraphrases and matches mentions.`;

  const track = (usage: ClassifierUsage, calls: number) => {
    if (!options.usage) return;
    options.usage.calls += calls;
    options.usage.input_tokens += usage.input_tokens;
    options.usage.output_tokens += usage.output_tokens;
  };

  const one = async (state: unknown, qs: Questions, signal?: AbortSignal) => {
    const res = await classifier.classify({ state: state as ClassifyItem["state"], questions: qs }, { signal });
    track(res.usage, 1);
    return res.answers as Record<string, Answer>;
  };

  const fn = <S extends z.ZodObject<any, any>>(spec: {
    name: string;
    description: string;
    input: S;
    resultShape: string;
    handler: (args: z.infer<S>, signal?: AbortSignal) => Promise<unknown>;
  }): ClassifierToolFn => ({
    name: name(spec.name),
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input, { unrepresentable: "any" }) as Record<string, unknown>,
    readOnlyHint: true,
    resultShape: spec.resultShape,
    ...(server && { server, serverDescription }),
    async call(args, ctx) {
      const parsed = spec.input.safeParse(args ?? {});
      if (!parsed.success) {
        const why = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; ");
        throw new Error(`${name(spec.name)}: ${why}`);
      }
      return spec.handler(parsed.data, ctx?.signal);
    },
  });

  return [
    fn({
      name: "classify",
      description:
        "Judge one state against typed questions ({ id: \"yes/no question\" } or { id: { type: 'noul'|'choice'|'score', instructions, criteria } }). Returns { answers, confidence, details }: answers[id] is P(yes) for a yes/no question, the label for a choice, the level for a score.",
      input: z.object({ state: classifierEntrySchema, questions }),
      resultShape:
        "{ answers: { [id]: number /* yes/no: P(yes) */ | string /* choice: label */ | number /* score: level */ }, confidence: { [id]: number }, details: {...} }",
      handler: async (a, signal) => flatten(await one(a.state, normalizeQuestions(a.questions), signal)),
    }),
    fn({
      name: "many",
      description:
        "Judge many items ({ id, state, label? }[]) against the same questions, in parallel, in one call — use it whenever a filter depends on meaning (intent, tone, urgency, topic), not on exact text. Questions: { id: \"yes/no question\" } or { id: { type: 'noul'|'choice'|'score', instructions, criteria } }. Pass `where` ({ question, choice?, min?, max? } or a list) to get back only matching items. Prefer this over looping `classify`.",
      input: z.object({
        items: z.array(z.object({ id: z.string(), state: classifierEntrySchema, label: z.string().optional() })),
        questions,
        where: z.union([whereSchema, z.array(whereSchema)]).optional(),
      }),
      resultShape:
        "{ id: string, label?: string, answers: { [id]: number | string }, confidence: { [id]: number }, details: {...}, error?: string }[] — e.g. hits.filter(h => h.answers.refund > 0.5)",
      async handler(a, signal) {
        if (a.items.length > maxItems) {
          throw new Error(`${name("many")}: too many items (${a.items.length}); the limit is ${maxItems}`);
        }
        const res = await classifyMany(classifier, a.items as ClassifyItem[], normalizeQuestions(a.questions), {
          concurrency,
          signal,
        });
        track(res.usage, a.items.length);
        const where = a.where as Where | Where[] | undefined;
        const kept =
          where === undefined
            ? res.items
            : res.items.filter((i) => answersMatch(i.answers as Record<string, Answer> | undefined, where));
        return kept.map((i) => ({
          id: i.id,
          ...(i.label !== undefined && { label: i.label }),
          ...(i.answers ? flatten(i.answers as Record<string, Answer>) : { answers: {}, confidence: {}, details: {} }),
          ...(i.error !== undefined && { error: i.error }),
        }));
      },
    }),
    fn({
      name: "is",
      description: "Yes/no: the probability (0–1) that `question` is true of `state`.",
      input: z.object({ state: classifierEntrySchema, question: z.string() }),
      resultShape: "number",
      async handler(a, signal) {
        const answers = await one(a.state, { q: noul(a.question) }, signal);
        return (answers.q as { noul: number }).noul;
      },
    }),
    fn({
      name: "pick",
      description:
        "Pick one label for `state`. `labels` is a list of names or { label: description }. Returns { choice, confidence, probabilities }.",
      input: z.object({
        state: classifierEntrySchema,
        question: z.string(),
        labels: z.union([z.array(z.string()).min(2), z.record(z.string(), classifierEntrySchema.nullable())]),
      }),
      resultShape: "{ choice: string, confidence: number, probabilities: { [label]: number } }",
      async handler(a, signal) {
        const q = Array.isArray(a.labels)
          ? choice(a.question, a.labels)
          : choice(a.question, a.labels as Record<string, string | null>);
        const ans = (await one(a.state, { q }, signal)).q as ChoiceAnswer;
        return { choice: ans.choice, confidence: ans.confidence, probabilities: ans.probabilities };
      },
    }),
    fn({
      name: "rate",
      description:
        "Rate `state` on an ordered rubric (`levels`, lowest first, 2–10). Returns { score, confidence } — score is a probability-weighted level index.",
      input: z.object({
        state: classifierEntrySchema,
        question: z.string(),
        levels: z.array(z.string()).min(2).max(10),
      }),
      resultShape: "{ score: number, confidence: number }",
      async handler(a, signal) {
        const levels = a.levels as [string, string, ...string[]];
        const ans = (await one(a.state, { q: score(a.question, levels) }, signal)).q as ScoreAnswer;
        return { score: ans.score, confidence: ans.confidence };
      },
    }),
  ];
}
