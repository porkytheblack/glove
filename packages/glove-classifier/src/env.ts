/**
 * `env:classifier` — classifier functions inside a Glove working environment.
 *
 * A script can walk `/inbox`, pull every email through `env:email`, and ask
 * `many()` which ones mention a refund — the agent reads the three ids that
 * come back, not the four hundred messages.
 *
 * ```ts
 * createWorkingEnvironment({ stdlib: [email(), classifierEnv(jev())] });
 * ```
 */
import { defineTools, type StdlibAdapter } from "glove-working-environment";
import { classifierFns, type ClassifierFnsOptions } from "./fns";
import type { ClassifierAdapter } from "./types";

export interface ClassifierEnvOptions extends Omit<ClassifierFnsOptions, "namespace"> {
  /** Module name. Default `"classifier"` → `import { many } from 'env:classifier'`. */
  name?: string;
  /** Extra README prose (what the classifier is for in this deployment). */
  docs?: string;
}

export const CLASSIFIER_ENV_DOCS = `Classifier functions answer typed questions about content without generating text. They are fast and cheap, and only their answers come back to you — use them to decide which files deserve reading instead of reading everything.

Question types (the \`questions\` map in \`classify\` and \`many\`):
- \`{ type: "noul", instructions: "Does this ask for a refund?" }\` → \`{ noul: 0.93 }\` (probability of yes)
- \`{ type: "choice", instructions: "Which team?", criteria: { billing: "…", technical: null } }\` → \`{ choice, confidence, probabilities }\`
- \`{ type: "score", instructions: "How urgent?", criteria: ["not", "somewhat", "very"] }\` → \`{ score, confidence, probabilities }\`

\`many({ items, questions, where })\` judges every item in parallel in one call; \`where\` keeps only matches (noul: yes-probability ≥ \`min\`, default 0.5; choice: \`choice\` label chosen; score: within \`min\`/\`max\`). Prefer it to looping \`classify\`. Keep each question atomic, and treat low confidence as "look closer", not as an answer.`;

const TRIAGE_SKILL = `# Triage many files with a classifier

1. List the files (\`glob("/inbox/*.eml")\` from \`env:fs\`) and turn each into a small state: a subject from \`describe(path)\` (\`env:email\`) plus the raw text, trimmed.
2. Call \`many({ items, questions, where })\` once — every item is judged in parallel.
3. Return only what matters: the matching ids and labels. Open those, and only those, with \`extract\`.

\`\`\`js
import { glob, readFile } from 'env:fs';
import { describe } from 'env:email';
import { many } from 'env:classifier';

export default async function () {
  const items = [];
  for (const path of await glob('/inbox/*.eml')) {
    const meta = await describe(path);
    const raw = await readFile(path);
    items.push({ id: path, label: meta.subject, state: { subject: meta.subject, from: meta.from?.address, message: raw.slice(0, 20000) } });
  }
  const hits = await many({
    items,
    questions: { refund: { type: 'noul', instructions: 'Does the sender ask for a refund?' } },
    where: { question: 'refund', min: 0.7 },
  });
  return hits.map(h => ({ path: h.id, subject: h.label, p: h.answers.refund.noul }));
}
\`\`\`
`;

/** A working-environment stdlib module exposing classifier functions as `env:classifier`. */
export function classifierEnv(classifier: ClassifierAdapter, options: ClassifierEnvOptions = {}): StdlibAdapter {
  const { name = "classifier", docs, ...fnsOptions } = options;
  return defineTools({
    name,
    description: `Classifier model (${classifier.name}): typed yes/no, choice and score judgements over content — decide what to read without reading it.`,
    fns: classifierFns(classifier, { ...fnsOptions, namespace: null }),
    docs: docs ? `${CLASSIFIER_ENV_DOCS}\n\n${docs}` : CLASSIFIER_ENV_DOCS,
    skills: [
      {
        name: "classifier-triage",
        summary: "Find the few files worth reading in a large set, using env:classifier's many().",
        body: TRIAGE_SKILL,
      },
    ],
  });
}
