/**
 * `mountClassifier` — give an agent classifier models it can reach for
 * whenever a judgement is cheaper than reading.
 *
 * Folds four tools (names shown with the default `glove_classify` prefix):
 *
 * - `glove_classify` — judge one state against typed questions (or a preset).
 * - `glove_classify_batch` — judge many states the agent already holds, and
 *   optionally keep only the ones matching a condition.
 * - `glove_classify_source` — judge a host-registered **source** (an inbox, a
 *   ticket queue, a crawl) the agent never reads. Only ids, labels and answers
 *   come back, so a thousand emails cost the agent's context a few lines.
 * - `glove_classify_catalog` — what presets, sources and classifiers exist.
 *
 * Presets and sources can be added and removed after mounting, so a host can
 * hand the agent a new question set or data stream mid-conversation.
 */
import type { GloveFoldArgs } from "glove-core/glove";
import { z } from "zod";
import { answersMatch, classifyMany, type ClassifyItem, type Where } from "./batch";
import { ClassifierError } from "./errors";
import { classifierEntrySchema, classifierQuestionSchema, compactAnswers } from "./tools";
import { AbortError } from "glove-core/core";
import type { Answer, ClassifierAdapter, ClassifierUsage, Questions } from "./types";

/** A named, reusable question set the agent can apply by name. */
export interface ClassifierPreset {
  description?: string;
  questions: Questions;
}

/** A host-owned stream of items the agent can classify without reading. */
export interface ClassifierSource {
  description: string;
  load(signal?: AbortSignal): Promise<ReadonlyArray<ClassifyItem>> | ReadonlyArray<ClassifyItem>;
}

/** Anything exposing `fold` — `IGloveRunnable`, `IGloveBuilder`, or a test stub. */
export type ClassifierMountTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
};

export interface MountClassifierOptions {
  /** The default classifier. */
  classifier: ClassifierAdapter;
  /** Extra classifiers the agent may pick by name (e.g. `{ reasoning: llmClassifier(...) }`). */
  classifiers?: Record<string, ClassifierAdapter>;
  presets?: Record<string, ClassifierPreset>;
  sources?: Record<string, ClassifierSource>;
  /** Tool name prefix. Default `glove_classify`. */
  prefix?: string;
  /** Parallel requests for batch and source calls. Default 8. */
  concurrency?: number;
  /** Most items one batch/source call may classify. Default 1000. */
  maxItems?: number;
  /** Most matched items a batch/source call returns. Default 50 (the agent can raise it per call). */
  resultLimit?: number;
  requiresPermission?: boolean;
  /** Called after every classifier call with its usage. */
  onUsage?: (usage: ClassifierUsage, classifier: string) => void;
}

export interface ClassifierMount {
  readonly toolNames: string[];
  addPreset(name: string, preset: ClassifierPreset): void;
  removePreset(name: string): void;
  addSource(name: string, source: ClassifierSource): void;
  removeSource(name: string): void;
  /** Cumulative usage across every tool call. */
  usage(): ClassifierUsage & { calls: number };
}

const whereSchema = z.object({
  question: z.string().describe("Question id to test."),
  choice: z.string().optional().describe("choice: the label that must be chosen (or, with min/max, whose probability is tested)."),
  min: z.number().optional().describe("noul: min probability of yes (default 0.5). score: min score. choice: min probability of `choice`."),
  max: z.number().optional().describe("Upper bound, same meaning as min."),
});

const questionsField = z
  .record(z.string(), classifierQuestionSchema)
  .optional()
  .describe("Questions keyed by an id you choose. Combine with `preset` to add questions to it.");
const presetField = z.string().optional().describe("Name of a preset question set (see the catalog tool).");
const classifierField = z.string().optional().describe("Named classifier to use instead of the default.");
const whereField = z
  .union([whereSchema, z.array(whereSchema)])
  .optional()
  .describe("Keep only items whose answers satisfy every condition. Omit to return all items.");
const limitField = z.number().int().min(1).optional().describe("Most matched items to return.");

export function mountClassifier(glove: ClassifierMountTarget, options: MountClassifierOptions): ClassifierMount {
  const prefix = options.prefix ?? "glove_classify";
  const presets = new Map(Object.entries(options.presets ?? {}));
  const sources = new Map(Object.entries(options.sources ?? {}));
  const classifiers = new Map(Object.entries(options.classifiers ?? {}));
  const concurrency = options.concurrency ?? 8;
  const maxItems = options.maxItems ?? 1000;
  const resultLimit = options.resultLimit ?? 50;
  const total = { calls: 0, input_tokens: 0, output_tokens: 0 };

  const record = (usage: ClassifierUsage, calls: number, name: string) => {
    total.calls += calls;
    total.input_tokens += usage.input_tokens;
    total.output_tokens += usage.output_tokens;
    options.onUsage?.(usage, name);
  };

  const pick = (name: string | undefined): ClassifierAdapter => {
    if (name === undefined) return options.classifier;
    const found = classifiers.get(name);
    if (!found) {
      throw new ClassifierError(
        "invalid_request",
        `unknown classifier "${name}"; available: ${["(default)", ...classifiers.keys()].join(", ")}`,
      );
    }
    return found;
  };

  const resolveQuestions = (preset: string | undefined, questions: Questions | undefined): Questions => {
    let merged: Questions = {};
    if (preset !== undefined) {
      const p = presets.get(preset);
      if (!p) {
        throw new ClassifierError(
          "invalid_request",
          `unknown preset "${preset}"; available: ${[...presets.keys()].join(", ") || "(none)"}`,
        );
      }
      merged = { ...p.questions };
    }
    if (questions) merged = { ...merged, ...questions };
    if (Object.keys(merged).length === 0) {
      throw new ClassifierError("invalid_request", "pass `questions`, a `preset`, or both");
    }
    return merged;
  };

  const perms = options.requiresPermission !== undefined ? { requiresPermission: options.requiresPermission } : {};

  // ─── glove_classify ────────────────────────────────────────────────────────
  const single = z.object({
    state: classifierEntrySchema.describe("The content to judge: text, or a JSON object/array with named fields."),
    questions: questionsField,
    preset: presetField,
    classifier: classifierField,
  });
  const classifyTool: GloveFoldArgs<z.infer<typeof single>> = {
    name: prefix,
    description: `Judge one piece of content with a fast classifier model. Ask typed questions — noul (yes/no → probability), choice (pick a label → probabilities + confidence), score (ordered rubric → score + confidence) — all answered in parallel in one call. Keep each question atomic; ask several and combine them. Low confidence means the content is ambiguous: don't act on it blindly. Use ${prefix}_batch for many items and ${prefix}_source for data you haven't read.`,
    inputSchema: single,
    ...perms,
    async do(input, _d, _g, signal) {
      return guard(signal, async () => {
        const clf = pick(input.classifier);
        const questions = resolveQuestions(input.preset, input.questions as Questions | undefined);
        const res = await clf.classify({ state: input.state as ClassifyItem["state"], questions }, { signal });
        record(res.usage, 1, clf.name);
        return { status: "success" as const, data: { model: res.model, answers: compactAnswers(res.answers) }, renderData: res };
      });
    },
  };

  // ─── glove_classify_batch ──────────────────────────────────────────────────
  const batch = z.object({
    items: z
      .array(z.object({ id: z.string(), state: classifierEntrySchema, label: z.string().optional() }))
      .min(1)
      .describe("Items to judge, each with an id its result comes back under."),
    questions: questionsField,
    preset: presetField,
    classifier: classifierField,
    where: whereField,
    limit: limitField,
  });
  const batchTool: GloveFoldArgs<z.infer<typeof batch>> = {
    name: `${prefix}_batch`,
    description: `Judge many items against the same questions in one call (each item independently, in parallel). Use \`where\` to get back only the items that matter — e.g. { question: "mentions_refund" } keeps items where the yes-probability ≥ 0.5.`,
    inputSchema: batch,
    ...perms,
    async do(input, _d, _g, signal) {
      return guard(signal, async () => {
        const clf = pick(input.classifier);
        const questions = resolveQuestions(input.preset, input.questions as Questions | undefined);
        const items = input.items as ClassifyItem[];
        return runMany(clf, items, questions, input.where as Where | Where[] | undefined, input.limit, signal);
      });
    },
  };

  // ─── glove_classify_source ─────────────────────────────────────────────────
  const source = z.object({
    source: z.string().describe("Name of a source (see the catalog tool)."),
    questions: questionsField,
    preset: presetField,
    classifier: classifierField,
    where: whereField,
    limit: limitField,
  });
  const sourceTool: GloveFoldArgs<z.infer<typeof source>> = {
    name: `${prefix}_source`,
    description: `Judge every item in a host-provided source (an inbox, a queue, a result set) without reading it. You get back ids, labels and answers — never the content — so use this to find the few items worth opening. Filter with \`where\`; results are capped by \`limit\`.`,
    inputSchema: source,
    ...perms,
    async do(input, _d, _g, signal) {
      return guard(signal, async () => {
        const src = sources.get(input.source);
        if (!src) {
          throw new ClassifierError(
            "invalid_request",
            `unknown source "${input.source}"; available: ${[...sources.keys()].join(", ") || "(none)"}`,
          );
        }
        const clf = pick(input.classifier);
        const questions = resolveQuestions(input.preset, input.questions as Questions | undefined);
        const items = await src.load(signal);
        const result = await runMany(clf, items, questions, input.where as Where | Where[] | undefined, input.limit, signal);
        return { ...result, data: { source: input.source, ...(result.data as object) } };
      });
    },
  };

  // ─── glove_classify_catalog ────────────────────────────────────────────────
  const catalogTool: GloveFoldArgs<Record<string, never>> = {
    name: `${prefix}_catalog`,
    description: "List the classifier presets (named question sets), sources (data you can classify without reading) and named classifiers available to you.",
    inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
    async do() {
      return {
        status: "success" as const,
        data: {
          classifiers: ["(default) " + options.classifier.name, ...[...classifiers].map(([n, c]) => `${n}: ${c.name}`)],
          presets: [...presets].map(([name, p]) => ({
            name,
            description: p.description ?? "",
            questions: Object.fromEntries(Object.entries(p.questions).map(([id, q]) => [id, q.type])),
          })),
          sources: [...sources].map(([name, s]) => ({ name, description: s.description })),
        },
      };
    },
  };

  async function runMany(
    clf: ClassifierAdapter,
    items: ReadonlyArray<ClassifyItem>,
    questions: Questions,
    where: Where | Where[] | undefined,
    limit: number | undefined,
    signal: AbortSignal | undefined,
  ) {
    if (items.length > maxItems) {
      throw new ClassifierError("invalid_request", `too many items (${items.length}); the limit is ${maxItems}`);
    }
    const res = await classifyMany(clf, items, questions, { concurrency, signal });
    record(res.usage, items.length, clf.name);
    const failed = res.items.filter((i) => i.error !== undefined);
    const matched = res.items.filter(
      (i) => i.answers && answersMatch(i.answers as Record<string, Answer>, where),
    );
    const cap = limit ?? resultLimit;
    return {
      status: "success" as const,
      data: {
        total: items.length,
        matched: matched.length,
        ...(matched.length > cap && { truncated: true }),
        results: matched.slice(0, cap).map((i) => ({
          id: i.id,
          ...(i.label !== undefined && { label: i.label }),
          answers: compactAnswers(i.answers as Record<string, Answer>),
        })),
        ...(failed.length > 0 && { failed: failed.slice(0, 20).map((i) => ({ id: i.id, error: i.error })) }),
      } as Record<string, unknown>,
      renderData: res,
    };
  }

  const tools = [classifyTool, batchTool, sourceTool, catalogTool] as Array<GloveFoldArgs<any>>;
  for (const tool of tools) glove.fold(tool);

  return {
    toolNames: tools.map((t) => t.name),
    addPreset: (name, preset) => void presets.set(name, preset),
    removePreset: (name) => void presets.delete(name),
    addSource: (name, src) => void sources.set(name, src),
    removeSource: (name) => void sources.delete(name),
    usage: () => ({ ...total }),
  };
}

async function guard<T>(signal: AbortSignal | undefined, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AbortError || signal?.aborted) throw err;
    const message = err instanceof ClassifierError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    return { status: "error" as const, data: null, message };
  }
}
