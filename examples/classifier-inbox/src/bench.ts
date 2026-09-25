/**
 * Live benchmark: classifier models on a labelled 80-message support inbox.
 *
 *   Part 1 — classifiers. Jev vs an LLM answering the same typed questions
 *            (does the sender ask for a refund? is it urgent? which kind?),
 *            plus a Jev → LLM cascade. Accuracy, wall time, cost.
 *   Part 2 — agents. The same request ("which messages ask for a refund, and
 *            how many of those are urgent?") answered three ways:
 *              read     the agent reads the whole inbox through a tool
 *              source   mountClassifier: the agent classifies a source it never reads
 *              repl     glove-js: the agent writes a program over inbox + classifier fns
 *            Tokens that reached the agent, answer quality, cost, and whether
 *            the canary account number ever entered the agent's context.
 *
 * Needs TYPESAFE_API_KEY and OPENROUTER_API_KEY. Spend is capped (BENCH_CAP_USD,
 * default $1.50) and a typical run costs a few cents.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { Glove, Displaymanager, MemoryStore, type SubscriberAdapter, type SubscriberEvent, type SubscriberEventDataMap } from "glove-core";
import { JsSession, mountJs } from "glove-js";
import { z } from "zod";
import {
  cascade,
  choice,
  classifierFns,
  classifyMany,
  jev,
  llmClassifier,
  mountClassifier,
  noul,
  type ClassifierAdapter,
  type ClassifyManyResult,
} from "glove-classifier";
import { buildInbox, CANARY_ACCOUNT, type Email } from "./inbox";
import { AGENT_MODEL, JEV_USD_PER_INPUT_TOKEN, openrouter, openrouterPricing, SpendGuard } from "./shared";

const RUNS = Number(process.env.BENCH_RUNS ?? 3);
const guard = new SpendGuard(Number(process.env.BENCH_CAP_USD ?? 1.5));
const inbox = buildInbox();
const pricing = await openrouterPricing();
const llmUsd = (tin: number, tout: number) => tin * pricing.prompt + tout * pricing.completion;

const questions = {
  refund: noul("Does the sender ask for a refund, a chargeback reversal, or their money back?"),
  urgent: noul("Does the sender need this handled today or say it is urgent?"),
  kind: choice("What kind of message is this?", {
    refund: "Asks for money back",
    bug: "Reports something broken",
    sales: "Pricing, quotes, upgrades",
    spam: "Unsolicited marketing or phishing",
    other: "Thanks, feedback, confirmations",
  }),
};
const toItem = (e: Email) => ({ id: e.id, label: e.subject, state: { from: e.from, subject: e.subject, body: e.body } });

// ─── Part 1: classifiers ─────────────────────────────────────────────────────

function score(res: ClassifyManyResult<typeof questions>) {
  let refund = 0, urgent = 0, kind = 0, n = 0;
  for (const item of res.items) {
    const truth = inbox.find((e) => e.id === item.id)!.truth;
    if (!item.answers) continue;
    n++;
    if (item.answers.refund.noul >= 0.5 === truth.asksRefund) refund++;
    if (item.answers.urgent.noul >= 0.5 === truth.urgent) urgent++;
    if (item.answers.kind.choice === truth.kind) kind++;
  }
  const pct = (x: number) => Math.round((1000 * x) / inbox.length) / 10;
  return { answered: n, refundAcc: pct(refund), urgentAcc: pct(urgent), kindAcc: pct(kind) };
}

async function runClassifier(name: string, clf: ClassifierAdapter, usd: (r: ClassifyManyResult<typeof questions>) => number) {
  const t0 = performance.now();
  const res = await classifyMany(clf, inbox.map(toItem), questions, { concurrency: 8 });
  const ms = performance.now() - t0;
  const cost = usd(res);
  guard.add(cost, name);
  const row = { classifier: name, ...score(res), wallMs: Math.round(ms), msPerMessage: Math.round(ms / inbox.length), inputTokens: res.usage.input_tokens, costUsd: +cost.toFixed(5) };
  console.log(row);
  return row;
}

console.log(`\n── Part 1: ${inbox.length} messages × 3 questions ──`);
const jevClf = jev();
// LLMClassifier serializes calls on one adapter, so give it a pool for a fair wall-time comparison.
const llmPool: ClassifierAdapter = (() => {
  const pool = Array.from({ length: 8 }, () => llmClassifier({ model: openrouter(512) }));
  let i = 0;
  return { name: `llm:${AGENT_MODEL}`, classify: (r, o) => pool[i++ % pool.length]!.classify(r, o) };
})();

const SKIP_PART1 = process.env.BENCH_SKIP_CLASSIFIERS === "1";
const part1 = SKIP_PART1 ? [] : [
  await runClassifier("jev-latest", jevClf, (r) => r.usage.input_tokens * JEV_USD_PER_INPUT_TOKEN),
  await runClassifier(`llm (${AGENT_MODEL})`, llmPool, (r) => llmUsd(r.usage.input_tokens, r.usage.output_tokens)),
];
if (!SKIP_PART1) {
  const casc = cascade({ primary: jevClf, fallback: llmPool, threshold: 0.6 });
  let escalated = 0;
  let jevTokens = 0, llmIn = 0, llmOut = 0;
  const counting: ClassifierAdapter = {
    name: casc.name,
    async classify(req, opts) {
      const r = await casc.classify(req, opts);
      escalated += r.escalated.length;
      jevTokens += r.primary.usage.input_tokens;
      llmIn += r.fallback?.usage.input_tokens ?? 0;
      llmOut += r.fallback?.usage.output_tokens ?? 0;
      return r;
    },
  };
  const row = await runClassifier("cascade (jev → llm below 0.6)", counting, () => jevTokens * JEV_USD_PER_INPUT_TOKEN + llmUsd(llmIn, llmOut));
  part1.push({ ...row, escalatedAnswers: escalated } as typeof row);
  console.log(`  escalated answers: ${escalated} of ${inbox.length * 3}`);
}

// ─── Part 2: agents ──────────────────────────────────────────────────────────

const TASK =
  "Which messages in the support inbox ask for a refund or their money back? List their ids, and say how many of them are urgent. End your answer with a line of the form `URGENT: <number>`.";
const SYSTEM =
  "You are a support-operations assistant. Answer precisely. Always list message ids exactly as given (e.g. em-001). Do not ask questions; finish the task.";

class Meter implements SubscriberAdapter {
  tokensIn = 0;
  tokensOut = 0;
  turns = 0;
  toolCalls = 0;
  contextText = "";
  finalText = "";
  calls: string[] = [];
  async record<T extends SubscriberEvent["type"]>(type: T, data: SubscriberEventDataMap[T]) {
    if (type === "token_consumption") {
      const c = (data as SubscriberEventDataMap["token_consumption"]).consumption;
      this.tokensIn += c.tokens_in ?? 0;
      this.tokensOut += c.tokens_out ?? 0;
    } else if (type === "model_response_complete" || type === "model_response") {
      this.turns++;
      const d = data as SubscriberEventDataMap["model_response"];
      if (d.text) this.finalText = d.text;
      for (const c of d.tool_calls ?? []) this.calls.push(`${c.tool_name} ${JSON.stringify(c.input_args).slice(0, 1500)}`);
    } else if (type === "tool_use_result") {
      this.toolCalls++;
      const r = (data as SubscriberEventDataMap["tool_use_result"]).result;
      this.contextText += JSON.stringify(r.status === "success" ? r.data : r.message);
    }
  }
}

function newGlove(meter: Meter) {
  const glove = new Glove({
    store: new MemoryStore(`bench_${Math.random()}`),
    model: openrouter(2048),
    displayManager: new Displaymanager(),
    systemPrompt: SYSTEM,
    serverMode: true,
    compaction_config: { max_turns: 12, compaction_instructions: "Summarize progress.", compaction_context_limit: 200_000 },
  });
  glove.addSubscriber(meter);
  return glove;
}

const inboxRows = () => inbox.map(({ id, from, subject, body }) => ({ id, from, subject, body }));
const truthRefund = new Set(inbox.filter((e) => e.truth.asksRefund).map((e) => e.id));
const truthUrgent = inbox.filter((e) => e.truth.asksRefund && e.truth.urgent).length;

type Arm = "read" | "source" | "repl";

function buildArm(arm: Arm, meter: Meter) {
  const glove = newGlove(meter);
  if (arm === "read") {
    glove.fold({
      name: "read_inbox",
      description: "Return every message in the support inbox (id, from, subject, body).",
      inputSchema: z.object({}),
      async do() {
        return { status: "success", data: inboxRows() };
      },
    });
    return glove.build();
  }
  if (arm === "source") {
    const runnable = glove.build();
    mountClassifier(runnable, {
      classifier: jevClf,
      sources: {
        inbox: { description: "The support inbox (80 messages).", load: () => inbox.map(toItem) },
      },
    });
    return runnable;
  }
  const runnable = glove.build();
  const session = JsSession.create();
  session.registerAll([
    {
      name: "inbox__list",
      description: "Every message in the support inbox: { id, from, subject, body }[]",
      inputSchema: { type: "object", properties: {} },
      async call() {
        return inboxRows();
      },
    },
    ...classifierFns(jevClf),
  ]);
  mountJs(runnable, { session, discovery: "full" });
  return runnable;
}

function grade(text: string) {
  const ids = new Set(text.match(/em-\d{3}/g) ?? []);
  const tp = [...ids].filter((id) => truthRefund.has(id)).length;
  const precision = ids.size ? tp / ids.size : 0;
  const recall = tp / truthRefund.size;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const urgentClaim = text.match(/URGENT:\s*\**\s*(\d+)/i)?.[1];
  return {
    f1: Math.round(f1 * 100) / 100,
    idsReported: ids.size,
    urgentClaimed: urgentClaim === undefined ? null : Number(urgentClaim),
    urgentAbsError: urgentClaim === undefined ? truthUrgent : Math.abs(Number(urgentClaim) - truthUrgent),
  };
}

console.log(`\n── Part 2: agent (${AGENT_MODEL}), ${RUNS} runs per arm ──`);
console.log(`  ground truth: ${truthRefund.size} refund requests, ${truthUrgent} urgent`);
const part2: Array<Record<string, unknown>> = [];
const ARMS = (process.env.BENCH_ARMS?.split(",") ?? ["read", "source", "repl"]) as Arm[];
for (const arm of ARMS) {
  const runs: Array<ReturnType<typeof grade> & { arm: Arm; run: number; agentTokensIn: number; turns: number; toolCalls: number; canaryInContext: boolean; ms: number; agentUsd: number; answer: string; calls: string[] }> = [];
  for (let r = 0; r < RUNS; r++) {
    const meter = new Meter();
    const agent = buildArm(arm, meter);
    const t0 = performance.now();
    try {
      await agent.processRequest(TASK);
    } catch (err) {
      console.log(`  ${arm} run ${r + 1} failed: ${(err as Error).message}`);
    }
    const ms = performance.now() - t0;
    const agentUsd = llmUsd(meter.tokensIn, meter.tokensOut);
    guard.add(agentUsd, `${arm} run ${r + 1}`);
    const row = {
      arm,
      run: r + 1,
      ...grade(meter.finalText),
      agentTokensIn: meter.tokensIn,
      turns: meter.turns,
      toolCalls: meter.toolCalls,
      canaryInContext: meter.contextText.includes(CANARY_ACCOUNT),
      ms: Math.round(ms),
      agentUsd: +agentUsd.toFixed(5),
      answer: meter.finalText,
      calls: meter.calls,
    };
    console.log(row);
    runs.push(row);
  }
  const avg = (k: keyof (typeof runs)[number], digits = 2) => {
    const f = 10 ** digits;
    return Math.round((runs.reduce((s, x) => s + Number(x[k]), 0) / runs.length) * f) / f;
  };
  part2.push({
    arm,
    runs: runs.length,
    meanF1: avg("f1"),
    meanUrgentAbsError: avg("urgentAbsError"),
    meanAgentTokensIn: Math.round(avg("agentTokensIn")),
    meanTurns: avg("turns"),
    canaryInContext: `${runs.filter((x) => x.canaryInContext).length}/${runs.length}`,
    meanMs: Math.round(avg("ms")),
    meanAgentUsd: avg("agentUsd", 5),
    detail: runs,
  });
}

// ─── Report ──────────────────────────────────────────────────────────────────

const report = {
  date: new Date().toISOString(),
  agentModel: AGENT_MODEL,
  inbox: { messages: inbox.length, refundRequests: truthRefund.size, urgentRefunds: truthUrgent },
  classifiers: part1,
  agents: part2,
  totalSpendUsd: +guard.total.toFixed(4),
};
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
const slug = AGENT_MODEL.replace(/[^a-z0-9.]+/gi, "-");
writeFileSync(new URL(`../results/${slug}.json`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log("\n", JSON.stringify({ classifiers: part1, agents: part2.map(({ detail: _d, ...a }) => a), totalSpendUsd: report.totalSpendUsd }, null, 2));
