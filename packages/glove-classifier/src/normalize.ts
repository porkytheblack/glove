/**
 * Accept the question shapes models actually write.
 *
 * Measured on a live agent: a strict schema made a small model spend its
 * whole turn budget on validation errors. It sent a question as a bare
 * string, left out `instructions`, wrote `type: "yes_no"`, and put labels
 * under `options`. Each of those has one obvious meaning, so the tool
 * surfaces normalize them here and validate the result with
 * {@link assertValidRequest}. A malformed question still fails, with a
 * message naming the question and the fix.
 */
import { ClassifierError } from "./errors";
import { assertValidRequest } from "./questions";
import type { Description, Question, Questions } from "./types";

const TYPE_ALIASES: Record<string, Question["type"]> = {
  noul: "noul",
  yes_no: "noul",
  yesno: "noul",
  "yes/no": "noul",
  boolean: "noul",
  bool: "noul",
  binary: "noul",
  true_false: "noul",
  choice: "choice",
  choose: "choice",
  classification: "choice",
  classify: "choice",
  category: "choice",
  categorical: "choice",
  enum: "choice",
  label: "choice",
  select: "choice",
  multiple_choice: "choice",
  score: "score",
  rating: "score",
  rate: "score",
  scale: "score",
  rubric: "score",
  level: "score",
};

type Loose = Record<string, unknown>;

/** Normalize one question. Throws `ClassifierError("invalid_request")` when it cannot be read. */
export function normalizeQuestion(id: string, raw: unknown): Question {
  if (typeof raw === "string") return { type: "noul", instructions: raw };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClassifierError(
      "invalid_request",
      `question "${id}": expected an object like { type: "noul", instructions: "…" } or a yes/no question as a string`,
    );
  }
  const q = raw as Loose;
  const instructions = (q.instructions ?? q.question ?? q.prompt ?? q.text ?? q.description ?? null) as Description;
  const criteria = q.criteria ?? q.options ?? q.labels ?? q.choices ?? q.levels ?? q.scale ?? q.rubric;
  const declared = typeof q.type === "string" ? TYPE_ALIASES[q.type.trim().toLowerCase().replace(/[\s-]+/g, "_")] : undefined;
  if (typeof q.type === "string" && !declared) {
    throw new ClassifierError(
      "invalid_request",
      `question "${id}": unknown type "${q.type}" — use "noul" (yes/no), "choice" (pick a label) or "score" (rate on a rubric)`,
    );
  }
  const hasLevels = q.levels !== undefined || q.scale !== undefined || q.rubric !== undefined;
  const type: Question["type"] =
    declared ?? (criteria === undefined ? "noul" : hasLevels ? "score" : "choice");

  switch (type) {
    case "noul": {
      const c = criteria as Loose | undefined;
      if (c && typeof c === "object" && !Array.isArray(c)) {
        const yes = (c.true ?? c.yes) as Description | undefined;
        const no = (c.false ?? c.no) as Description | undefined;
        if (yes !== undefined || no !== undefined) {
          return { type, instructions, criteria: { ...(yes !== undefined && { true: yes }), ...(no !== undefined && { false: no }) } };
        }
      }
      return { type, instructions };
    }
    case "choice":
      return { type, instructions, criteria: toChoiceCriteria(id, criteria) };
    case "score":
      return { type, instructions, criteria: toLevels(id, criteria) };
  }
}

/** Normalize and validate a whole question map. */
export function normalizeQuestions(raw: unknown): Questions {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClassifierError("invalid_request", "`questions` must be an object keyed by question id");
  }
  const out: Questions = {};
  for (const [id, q] of Object.entries(raw)) out[id] = normalizeQuestion(id, q);
  assertValidRequest({ state: "", questions: out });
  return out;
}

function toChoiceCriteria(id: string, raw: unknown): Record<string, Description> {
  if (Array.isArray(raw)) {
    const out: Record<string, Description> = {};
    for (const item of raw) {
      if (typeof item === "string") out[item] = null;
      else if (item && typeof item === "object") {
        const o = item as Loose;
        const label = o.label ?? o.name ?? o.value ?? o.id;
        if (typeof label !== "string") {
          throw new ClassifierError("invalid_request", `question "${id}": each choice option needs a label`);
        }
        out[label] = (o.description ?? o.criteria ?? null) as Description;
      }
    }
    return out;
  }
  if (raw && typeof raw === "object") return raw as Record<string, Description>;
  throw new ClassifierError(
    "invalid_request",
    `question "${id}": a choice needs \`criteria\` — a list of labels or { label: description }`,
  );
}

function toLevels(id: string, raw: unknown): [Description, Description, ...Description[]] {
  let levels: unknown[] | undefined;
  if (Array.isArray(raw)) levels = raw;
  else if (raw && typeof raw === "object") {
    // { "0": "low", "1": "high" } → ordered by key
    levels = Object.entries(raw as Loose)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v);
  }
  if (!levels) {
    throw new ClassifierError(
      "invalid_request",
      `question "${id}": a score needs \`criteria\` — an ordered list of levels, lowest first`,
    );
  }
  return levels as [Description, Description, ...Description[]];
}
