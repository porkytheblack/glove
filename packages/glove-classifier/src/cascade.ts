/**
 * Confidence-gated cascade: ask a fast classifier first, and re-ask only the
 * questions it is unsure about of a slower, stronger one.
 *
 * The usual pairing is Jev as `primary` and an {@link LLMClassifier} over a
 * reasoning model as `fallback`: most questions settle in one cheap parallel
 * pass, and the reasoning model only sees the ambiguous remainder. Any two
 * `ClassifierAdapter`s compose, including another cascade.
 */
import { answerConfidence } from "./answers";
import type {
  Answer,
  ClassifierAdapter,
  ClassifierUsage,
  ClassifyOptions,
  ClassifyRequest,
  ClassifyResult,
  Question,
  Questions,
} from "./types";

export interface CascadeOptions {
  primary: ClassifierAdapter;
  fallback: ClassifierAdapter;
  /**
   * Escalate an answer whose {@link answerConfidence} is below this.
   * Default 0.6. Ignored when `shouldEscalate` is given.
   */
  threshold?: number;
  /** Custom escalation rule, per answer. */
  shouldEscalate?: (answer: Answer, id: string, question: Question) => boolean;
  name?: string;
}

export interface CascadeStage {
  readonly model: string;
  readonly usage: ClassifierUsage;
}

export interface CascadeResult<Q extends Questions = Questions> extends ClassifyResult<Q> {
  /** Ids whose answer came from the fallback. */
  readonly escalated: ReadonlyArray<keyof Q & string>;
  readonly primary: CascadeStage;
  /** Present only when something escalated. */
  readonly fallback?: CascadeStage;
}

export class CascadeClassifier implements ClassifierAdapter {
  readonly name: string;
  private readonly primary: ClassifierAdapter;
  private readonly fallback: ClassifierAdapter;
  private readonly shouldEscalate: (answer: Answer, id: string, question: Question) => boolean;

  constructor(options: CascadeOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.name = options.name ?? `cascade(${options.primary.name} → ${options.fallback.name})`;
    const threshold = options.threshold ?? 0.6;
    this.shouldEscalate = options.shouldEscalate ?? ((answer) => answerConfidence(answer) < threshold);
  }

  async classify<Q extends Questions>(
    request: ClassifyRequest<Q>,
    options: ClassifyOptions = {},
  ): Promise<CascadeResult<Q>> {
    const first = await this.primary.classify(request, options);
    const escalated = Object.keys(request.questions).filter((id) =>
      this.shouldEscalate(first.answers[id] as Answer, id, request.questions[id]!),
    ) as Array<keyof Q & string>;

    const primary: CascadeStage = { model: first.model, usage: first.usage };
    if (escalated.length === 0) {
      return { ...first, escalated, primary };
    }

    const subset = Object.fromEntries(escalated.map((id) => [id, request.questions[id]!])) as Questions;
    // The request's model override names a primary model; don't forward it.
    const second = await this.fallback.classify({ state: request.state, questions: subset }, options);
    const answers = { ...first.answers, ...second.answers } as ClassifyResult<Q>["answers"];
    return {
      model: first.model,
      answers,
      usage: {
        input_tokens: first.usage.input_tokens + second.usage.input_tokens,
        output_tokens: first.usage.output_tokens + second.usage.output_tokens,
      },
      escalated,
      primary,
      fallback: { model: second.model, usage: second.usage },
    };
  }
}

export function cascade(options: CascadeOptions): CascadeClassifier {
  return new CascadeClassifier(options);
}
