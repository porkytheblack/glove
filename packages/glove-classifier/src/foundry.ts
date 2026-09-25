/**
 * Classifier triage for Glove Foundry inbound transmissions.
 *
 * Every inbound event — a support email, a webhook, a chat message — passes
 * through the transmission's `classify` step and each playbook's predicates
 * before any agent runs. Those are the cheapest places to make a judgement:
 * a classifier there decides which event an inbound message *is* and which
 * playbooks should wake for it, in milliseconds, so agents only start for
 * events that deserve one and never read the rest.
 *
 * Both helpers return plain option objects, so this module needs nothing from
 * glove-foundry at runtime — pass them to Foundry's own definers:
 *
 * ```ts
 * // predicates/urgent.predicate.ts
 * export default defineTransmissionPredicate(classifierPredicate({
 *   classifier: jev(),
 *   questions: { urgent: noul("Does the sender need help today?") },
 *   where: { question: "urgent", min: 0.7 },
 *   state: (event: SupportEvent) => ({ subject: event.subject, body: event.body }),
 * }));
 *
 * // transmissions/support.transmission.ts
 * inbound: {
 *   ...,
 *   classify: classifyInbound({
 *     classifier: jev(),
 *     question: choice("What is this message?", { refund: "...", bug: "...", other: null }),
 *     events: { refund: refundRequested, bug: bugReported },
 *     fallback: generalInquiry,
 *     minConfidence: 0.6,
 *     state: (event: SupportEvent) => event.body,
 *   }),
 * }
 * ```
 */
import { Effect } from "effect";
import { answersMatch, type Where } from "./batch";
import { ClassifierError } from "./errors";
import type { Answer, ChoiceAnswer, ChoiceCriteria, ChoiceQuestion, ClassifierAdapter, Entry, Questions } from "./types";

export interface ClassifierPredicateOptions<TEvent> {
  classifier: ClassifierAdapter;
  questions: Questions;
  /**
   * Conditions the answers must satisfy for the playbook to match. A playbook
   * can override them through its predicate parameters: `{ where }` replaces
   * them, and `{ min }` / `{ max }` / `{ choice }` adjust a single condition.
   */
  where: Where | Where[];
  /** Build the state to judge from the normalized event. Default: the event itself. */
  state?: (event: TEvent) => Entry;
  description?: string;
  /** Called with every classification, e.g. for tracing. */
  onAnswers?: (answers: Readonly<Record<string, Answer>>, event: TEvent) => void;
}

/**
 * Options for Foundry's `defineTransmissionPredicate`: the playbook matches
 * when the classifier's answers satisfy `where`.
 */
export function classifierPredicate<TEvent = unknown>(options: ClassifierPredicateOptions<TEvent>): {
  readonly description: string;
  readonly match: (
    event: TEvent,
    parameters: Readonly<Record<string, unknown>>,
    context: unknown,
  ) => Effect.Effect<boolean, ClassifierError>;
} {
  const base = Array.isArray(options.where) ? options.where : [options.where];
  return {
    description:
      options.description ??
      `Classifier (${options.classifier.name}) judges the event: ${base.map(describeWhere).join(" and ")}.`,
    match: (event, parameters) =>
      Effect.tryPromise({
        try: async (signal) => {
          const state = options.state ? options.state(event) : (event as unknown as Entry);
          const res = await options.classifier.classify({ state, questions: options.questions }, { signal });
          const answers = res.answers as Record<string, Answer>;
          options.onAnswers?.(answers, event);
          return answersMatch(answers, resolveWhere(base, parameters));
        },
        catch: toClassifierError,
      }),
  };
}

export interface ClassifyInboundOptions<TEvent, TDefinition, C extends ChoiceCriteria> {
  classifier: ClassifierAdapter;
  /** A choice question; each label maps to an event definition in `events`. */
  question: ChoiceQuestion<C>;
  events: { readonly [K in keyof C]?: TDefinition };
  /** Used when the chosen label has no event, or confidence is below `minConfidence`. */
  fallback?: TDefinition;
  /** Below this, route to `fallback` instead of the chosen label. Default 0. */
  minConfidence?: number;
  state?: (event: TEvent) => Entry;
  onAnswer?: (answer: ChoiceAnswer<C>, event: TEvent) => void;
}

/**
 * A transmission's `inbound.classify`: ask the classifier which kind of
 * event an inbound message is and resolve it to one of your event
 * definitions. Low-confidence answers go to `fallback`.
 */
export function classifyInbound<TEvent, TDefinition, C extends ChoiceCriteria>(
  options: ClassifyInboundOptions<TEvent, TDefinition, C>,
): (event: TEvent, context: unknown) => Effect.Effect<TDefinition, ClassifierError> {
  const minConfidence = options.minConfidence ?? 0;
  return (event) =>
    Effect.tryPromise({
      try: async (signal) => {
        const state = options.state ? options.state(event) : (event as unknown as Entry);
        const res = await options.classifier.classify({ state, questions: { kind: options.question } }, { signal });
        const answer = res.answers.kind as ChoiceAnswer<C>;
        options.onAnswer?.(answer, event);
        const chosen = answer.confidence >= minConfidence ? options.events[answer.choice] : undefined;
        const definition = chosen ?? options.fallback;
        if (definition === undefined) {
          throw new ClassifierError(
            "bad_response",
            `classified as "${answer.choice}" (confidence ${answer.confidence.toFixed(2)}) with no matching event and no fallback`,
          );
        }
        return definition;
      },
      catch: toClassifierError,
    });
}

function resolveWhere(base: Where[], parameters: Readonly<Record<string, unknown>> | undefined): Where[] {
  if (!parameters) return base;
  const override = parameters.where as Where | Where[] | undefined;
  if (override) return Array.isArray(override) ? override : [override];
  const { min, max, choice } = parameters as { min?: unknown; max?: unknown; choice?: unknown };
  if (base.length !== 1 || (min === undefined && max === undefined && choice === undefined)) return base;
  return [
    {
      ...base[0]!,
      ...(typeof min === "number" && { min }),
      ...(typeof max === "number" && { max }),
      ...(typeof choice === "string" && { choice }),
    },
  ];
}

function describeWhere(w: Where): string {
  if (w.choice !== undefined) return `${w.question} = ${w.choice}`;
  if (w.min !== undefined && w.max !== undefined) return `${w.min} ≤ ${w.question} ≤ ${w.max}`;
  if (w.max !== undefined) return `${w.question} ≤ ${w.max}`;
  return `${w.question} ≥ ${w.min ?? 0.5}`;
}

function toClassifierError(err: unknown): ClassifierError {
  return err instanceof ClassifierError
    ? err
    : new ClassifierError("provider", err instanceof Error ? err.message : String(err), { cause: err });
}
