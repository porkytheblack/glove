/**
 * Verification by a stronger model than the one that did the work.
 *
 * The judge is deliberately given a narrow job. It never sees the agent's
 * transcript, its reasoning, or how many turns it took — only the artifact
 * that came out and the ground truth the corpus was built from. It cannot be
 * charmed by a confident-sounding process into passing a wrong document,
 * because it is not shown the process.
 *
 * Two properties that make its answers worth something:
 *
 * - **The ground truth is exact.** The corpus generator computed the regional
 *   totals and planted the buried facts, so "is this figure right" is checked
 *   against a known value rather than the judge's own arithmetic — which is
 *   the thing models are worst at and would silently get wrong.
 * - **Fabrication is asked about directly.** "Does it avoid asserting X" is
 *   the one question a deterministic check genuinely cannot answer, and it is
 *   the failure that matters most in a briefing someone will act on. Verdicts
 *   default to fail on uncertainty, so a judge that cannot tell does not pass
 *   the artifact.
 */
import { complete, type Usage } from "./openrouter";
import type { JudgeQuestion } from "./scenarios";

export interface Verdict {
  id: string;
  pass: boolean;
  /** The judge's one-line reason, quoted in the report. */
  reason: string;
}

export interface JudgeResult {
  verdicts: Verdict[];
  usage: Usage;
  /** Set when the judge could not be reached or returned unusable output. */
  error?: string;
}

export interface Evidence {
  /** What the agent produced, already extracted to text by the harness. */
  artifacts: Array<{ path: string; kind: string; text: string }>;
}

const SYSTEM = `You are verifying a document produced by another AI agent. You are the last check before it reaches a person who will act on it.

Rules:
- Judge ONLY the artifact text you are shown against the ground truth you are given. You are not shown how the agent worked, and you should not speculate about it.
- The ground truth is authoritative and was computed, not estimated. Where the artifact disagrees with it, the artifact is wrong.
- Default to FAIL when you are not sure. A briefing that might be wrong is not usable, and a false pass is far more costly here than a false fail.
- A figure that is present but wrong is a FAIL, not a partial pass.
- Answer each question independently.

Reply with ONLY a JSON object, no prose and no code fences:
{"verdicts":[{"id":"<question id>","pass":true|false,"reason":"<one sentence, concrete, quoting the artifact where it helps>"}]}`;

/** Keep any single artifact from crowding out the others or the questions. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, Math.floor(limit * 0.7));
  const tail = text.slice(-Math.floor(limit * 0.25));
  return `${head}\n\n[... ${text.length - head.length - tail.length} characters omitted ...]\n\n${tail}`;
}

export async function judge(opts: {
  model: string;
  scenario: string;
  groundTruth: string;
  evidence: Evidence;
  questions: JudgeQuestion[];
  signal?: AbortSignal;
}): Promise<JudgeResult> {
  const empty: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  if (opts.questions.length === 0) return { verdicts: [], usage: empty };

  const artifacts = opts.evidence.artifacts.length
    ? opts.evidence.artifacts
        .map((a) => `--- ARTIFACT ${a.path} (${a.kind}) ---\n${clip(a.text, 14_000)}`)
        .join("\n\n")
    : "(the agent produced no artifact at the expected path)";

  const user = [
    `## Scenario\n${opts.scenario}`,
    `## Ground truth (authoritative)\n${opts.groundTruth}`,
    `## What the agent produced\n${artifacts}`,
    `## Questions\n${opts.questions.map((q) => `- [${q.id}] ${q.question}`).join("\n")}`,
  ].join("\n\n");

  let res;
  try {
    res = await complete({
      model: opts.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      tools: [],
      maxTokens: 1500,
      signal: opts.signal,
    });
  } catch (e) {
    return { verdicts: failAll(opts.questions, "judge unreachable"), usage: empty, error: String(e) };
  }

  const parsed = parseVerdicts(res.content ?? "");
  if (!parsed) {
    return {
      verdicts: failAll(opts.questions, "judge returned unparseable output"),
      usage: res.usage,
      error: `unparseable judge reply: ${(res.content ?? "").slice(0, 200)}`,
    };
  }

  // A question the judge silently skipped is not a pass. Anything missing
  // from its reply fails, so an incomplete answer cannot quietly count as
  // approval.
  const byId = new Map(parsed.map((v) => [v.id, v]));
  return {
    verdicts: opts.questions.map(
      (q) => byId.get(q.id) ?? { id: q.id, pass: false, reason: "the judge did not answer this question" },
    ),
    usage: res.usage,
  };
}

function failAll(questions: JudgeQuestion[], reason: string): Verdict[] {
  return questions.map((q) => ({ id: q.id, pass: false, reason }));
}

/**
 * Pull the verdict array out of a reply. Models wrap JSON in code fences and
 * add a sentence of preamble often enough that requiring a bare object would
 * fail correct answers, so the outermost brace-delimited object is extracted.
 */
function parseVerdicts(content: string): Verdict[] | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(content.slice(start, end + 1));
    if (!Array.isArray(obj?.verdicts)) return null;
    return obj.verdicts
      .filter((v: unknown): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v: Record<string, unknown>) => ({
        id: String(v.id ?? ""),
        pass: v.pass === true,
        reason: String(v.reason ?? "").slice(0, 400),
      }));
  } catch {
    return null;
  }
}
