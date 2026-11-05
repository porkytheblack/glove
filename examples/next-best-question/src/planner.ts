import { choice, noul, type ChoiceAnswer, type ClassifierAdapter, type Questions } from "glove-classifier";

/**
 * Next best question, from classifier answers.
 *
 * A form or a goal program fixes an order when it is written. A conversation
 * does not follow it: people open with the middle of the story, answer
 * questions nobody asked yet, and change the subject. The planner re-ranks
 * what is still open each turn from three cheap judgements:
 *
 * - **covered**: has the speaker already said this? Then confirm it from what
 *   they said instead of asking again.
 * - **branch**: which variant of the workflow is this (a car claim, a burst
 *   pipe)? Branch-specific questions are weighted by how likely their branch
 *   is, and the question that decides the branch is worth more the less sure
 *   the classifier is.
 * - **focus**: what is the latest message about? Questions on that topic are
 *   asked while the speaker is on it.
 *
 * The planner only orders. It never fills a field or completes a goal: a
 * `confirm` move means "check this with the speaker", and the agent still
 * writes the answer.
 */

/** Something still open: a form field, a goal item. */
export interface Candidate {
  /** Stable id, such as a field id or `goalKey/itemKey`. */
  id: string;
  label: string;
  /** What the candidate belongs to (a step, a goal). Focus and steering work per group. */
  group?: string;
  /** Static priority in [0, 1], usually from definition order. */
  prior: number;
  /**
   * Statements that are true once the speaker has given this; any one is
   * enough. For a yes/no or pick-one answer, list the possible answers: the
   * candidate is covered when the speaker settled it either way. Omit to
   * always ask.
   */
  covered?: string | readonly string[];
  /** Branch labels this candidate applies under. Omit when it applies regardless. */
  appliesTo?: readonly string[];
  /** Answering this candidate settles the branch. */
  decidesBranch?: boolean;
}

export interface BranchSpec {
  /** Branch label → a statement that is true of a conversation in that branch. */
  labels: Record<string, string>;
  instructions?: string;
  /** The branch once it is answered. The classifier is not asked then. */
  known?: string;
}

/** One message from the speaker. */
export interface Turn {
  id: string;
  text: string;
}

export interface PlanRequest {
  candidates: Candidate[];
  /** The speaker's messages, oldest first. Only these are judged, never the agent's. */
  turns: Turn[];
  branch?: BranchSpec;
  /** Group id → a statement that is true of a message about that group. */
  groups?: Record<string, string>;
}

export interface AskMove {
  kind: "ask";
  candidate: Candidate;
  score: number;
  /** Probability the candidate applies, from the branch distribution. */
  applies: number;
  covered: number;
  focus: number;
}

export interface ConfirmMove {
  kind: "confirm";
  candidate: Candidate;
  /** Probability it applies and the speaker already gave it (for the branch question: the branch's probability). */
  p: number;
  /** The proposed answer, when the classifier supplies one (the branch label). */
  value?: string;
}

export interface Plan {
  /** Things to confirm from what was said, most certain first. */
  confirm: ConfirmMove[];
  /** Questions to ask, best first. */
  ask: AskMove[];
  /** The likeliest branch and its probability. */
  branch?: { choice: string; p: number; probabilities: Record<string, number>; known: boolean };
  focus?: { group: string; p: number };
  /** Classifier calls this plan made. Coverage of messages already judged is cached. */
  calls: number;
  ms: number;
}

export interface PlannerOptions {
  /** Coverage, or the likeliest branch's probability, at or above this becomes a confirm move. Default 0.8. */
  confirmAt?: number;
  /** Cached (message, statement) judgements. Default 10 000. */
  cacheSize?: number;
  weights?: {
    /** Weight of the static order. Default 0.5. */
    prior?: number;
    /** Weight of being on the latest message's topic. Default 0.35. */
    focus?: number;
    /** Weight of settling an uncertain branch. Default 0.6. */
    split?: number;
  };
}

const OTHER = "other";

export class NextBestPlanner {
  /**
   * `message text + statement` → probability the message says it. Keyed on
   * the text, not the turn id, so one planner can serve many conversations:
   * the same words get the same judgement. Oldest entries go first past
   * `cacheSize`.
   */
  private readonly coverage = new Map<string, number>();
  private readonly cacheSize: number;
  /** Coverage, or the likeliest branch's probability, at or above this becomes a confirm move. */
  readonly confirmAt: number;
  private readonly w: Required<NonNullable<PlannerOptions["weights"]>>;

  constructor(
    readonly classifier: ClassifierAdapter,
    options: PlannerOptions = {},
  ) {
    this.confirmAt = options.confirmAt ?? 0.8;
    this.cacheSize = options.cacheSize ?? 10_000;
    this.w = { prior: 0.5, focus: 0.35, split: 0.6, ...options.weights };
  }

  async plan(request: PlanRequest, signal?: AbortSignal): Promise<Plan> {
    const started = performance.now();
    let calls = 0;
    const count = <T>(p: Promise<T>) => {
      calls++;
      return p;
    };

    const statements = [...new Set(request.candidates.flatMap((c) => asList(c.covered)))];
    const latest = request.turns.at(-1);
    const transcript = request.turns.map((t) => t.text).join("\n");
    const branchKnown = request.branch?.known;
    const groupIds = Object.keys(request.groups ?? {}).filter((g) => request.candidates.some((c) => c.group === g));

    const [, branch, focus] = await Promise.all([
      this.cover(request.turns, statements, count, signal),
      request.branch && !branchKnown && transcript
        ? count(this.classifier.classify(
            { state: transcript, questions: { branch: choice(request.branch.instructions ?? "Which kind of case is this?", request.branch.labels) } },
            { signal },
          )).then((r) => r.answers.branch as ChoiceAnswer)
        : undefined,
      latest && groupIds.length > 0
        ? count(this.classifier.classify(
            {
              state: latest.text,
              questions: {
                focus: choice("What is this message about?", {
                  ...Object.fromEntries(groupIds.map((g) => [g, request.groups![g]!])),
                  [OTHER]: "The speaker is talking about something else.",
                }),
              },
            },
            { signal },
          )).then((r) => r.answers.focus as ChoiceAnswer)
        : undefined,
    ]);

    const branchP = branch ? branch.probabilities[branch.choice]! : 0;
    // Confirming the branch puts the rest of the plan under that branch: its
    // questions are confirmed in the same breath ("so it's a car claim, and
    // you said it still drives?"), and if the speaker corrects the branch the
    // next plan starts over from their answer.
    const assumed = !branchKnown && branch && branchP >= this.confirmAt && request.candidates.some((c) => c.decidesBranch)
      ? branch.choice
      : undefined;
    const given = branchKnown ?? assumed;
    const branchProbs: Record<string, number> | undefined = given
      ? Object.fromEntries(Object.keys(request.branch!.labels).map((l) => [l, l === given ? 1 : 0]))
      : branch?.probabilities;
    const uncertainty = branch && !given ? normalizedEntropy(Object.values(branch.probabilities)) : 0;
    const focusGroup = focus && focus.choice !== OTHER ? focus.choice : undefined;
    const focusP = focusGroup ? focus!.probabilities[focusGroup]! : 0;

    const confirm: ConfirmMove[] = [];
    const ask: AskMove[] = [];
    for (const c of request.candidates) {
      const covered = this.coveredBy(request.turns, asList(c.covered));
      if (c.decidesBranch && assumed) {
        confirm.push({ kind: "confirm", candidate: c, p: branchP, value: assumed });
        continue;
      }
      const applies = c.appliesTo && branchProbs ? sum(c.appliesTo.map((b) => branchProbs[b] ?? 0)) : c.appliesTo ? 0.5 : 1;
      // Both have to hold: "probably said" about a question from an unlikely
      // branch ("who was hurt" on a burglary) is not worth confirming.
      if (applies * covered >= this.confirmAt) {
        confirm.push({ kind: "confirm", candidate: c, p: applies * covered });
        continue;
      }
      const onTopic = focusGroup !== undefined && c.group === focusGroup ? focusP : 0;
      const split = c.decidesBranch ? uncertainty : 0;
      const score = applies * (1 - covered) * (this.w.prior * c.prior + this.w.focus * onTopic + this.w.split * split);
      ask.push({ kind: "ask", candidate: c, score, applies, covered, focus: onTopic });
    }
    confirm.sort((a, b) => b.p - a.p);
    ask.sort((a, b) => b.score - a.score || b.candidate.prior - a.candidate.prior);

    return {
      confirm,
      ask,
      ...(branchProbs && request.branch
        ? {
            branch: branchKnown
              ? { choice: branchKnown, p: 1, probabilities: branchProbs, known: true }
              : { choice: branch!.choice, p: branchP, probabilities: branch!.probabilities, known: false },
          }
        : {}),
      ...(focusGroup ? { focus: { group: focusGroup, p: focusP } } : {}),
      calls,
      ms: Math.round(performance.now() - started),
    };
  }

  /** Classify each (turn, statement) pair once. One call per turn, all its statements at once. */
  private async cover(
    turns: Turn[],
    statements: string[],
    count: <T>(p: Promise<T>) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<void> {
    await Promise.all(turns.map(async (turn) => {
      const missing = statements.filter((s) => !this.coverage.has(key(turn, s)));
      if (missing.length === 0) return;
      const questions: Questions = Object.fromEntries(missing.map((s, i) => [`s${i}`, noul(s)]));
      const { answers } = await count(this.classifier.classify({ state: turn.text, questions }, { signal }));
      missing.forEach((s, i) => {
        const a = answers[`s${i}`];
        this.coverage.set(key(turn, s), a?.type === "noul" ? a.noul : 0);
      });
      for (const old of this.coverage.keys()) {
        if (this.coverage.size <= this.cacheSize) break;
        this.coverage.delete(old);
      }
    }));
  }

  /** Any statement, said in any turn: the strongest evidence wins. */
  private coveredBy(turns: Turn[], statements: readonly string[]): number {
    return Math.max(0, ...turns.flatMap((t) => statements.map((s) => this.coverage.get(key(t, s)) ?? 0)));
  }
}

/**
 * The plan as one line of runtime context for the agent. Suggestions, not
 * answers: the line says so, because an agent that treats "confirm" as
 * "fill" turns a classifier's guess into a recorded answer.
 */
export function renderPlan(plan: Plan, options: { tag?: string; limit?: number } = {}): string {
  const limit = options.limit ?? 3;
  const parts: string[] = [];
  if (plan.confirm.length > 0) {
    const items = plan.confirm.map((m) => `${m.candidate.label}${m.value ? ` = ${m.value}` : ""} (${pct(m.p)})`);
    parts.push(`confirm from what was said: ${items.join(", ")}`);
  }
  const [first, ...rest] = plan.ask;
  if (first) {
    const why: string[] = [];
    if (first.candidate.decidesBranch && plan.branch && !plan.branch.known) why.push(`settles the case type (now ${plan.branch.choice} ${pct(plan.branch.p)})`);
    else if (first.candidate.appliesTo && plan.branch) why.push(`likely ${plan.branch.choice} ${pct(first.applies)}`);
    if (first.focus > 0) why.push("on the topic just raised");
    parts.push(`ask next: ${first.candidate.label}${why.length ? ` — ${why.join(", ")}` : ""}`);
  }
  if (rest.length > 0) parts.push(`then: ${rest.slice(0, limit - 1).map((m) => m.candidate.label).join(", ")}`);
  if (parts.length === 0) return "";
  return `[${options.tag ?? "next-best"}] ${parts.join(" · ")}\nThese are classifier suggestions for ordering. Confirm with the speaker before recording anything.`;
}

function asList(covered: Candidate["covered"]): readonly string[] {
  return covered === undefined ? [] : typeof covered === "string" ? [covered] : covered;
}

function key(turn: Turn, statement: string): string {
  return `${turn.text}\u0000${statement}`;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Entropy of a distribution divided by its maximum: 0 when certain, 1 when uniform. */
export function normalizedEntropy(probabilities: number[]): number {
  if (probabilities.length < 2) return 0;
  const h = -sum(probabilities.filter((p) => p > 0).map((p) => p * Math.log(p)));
  return h / Math.log(probabilities.length);
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
