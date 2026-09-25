/**
 * Compare classifier models on the labelled inbox — any mix of hosted and
 * self-hosted, over the same 80 messages × 3 questions.
 *
 *   pnpm compare                     # every classifier whose env is set
 *
 *   TYPESAFE_API_KEY                 → jev()
 *   LAYA_BASE_URL / KEV_BASE_URL / VON_BASE_URL / RIZZO_BASE_URL / DECIDER_BASE_URL
 *                                    → the matching open-model preset
 *   HF_TOKEN                         → huggingfaceZeroShot() (facebook/bart-large-mnli)
 *   GLICLASS_BASE_URL                → gliclass()
 *
 * No agent and no LLM: this measures the classifiers alone.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  choice,
  classifyMany,
  decider,
  gliclass,
  huggingfaceZeroShot,
  jev,
  kev,
  laya,
  noul,
  rizzo,
  von,
  type ClassifierAdapter,
  type ClassifyManyResult,
} from "glove-classifier";
import { buildInbox } from "./inbox";
import { JEV_USD_PER_INPUT_TOKEN } from "./shared";

const inbox = buildInbox();
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

const candidates: Array<{ label: string; make: () => ClassifierAdapter; concurrency: number; usd?: (tokens: number) => number }> = [];
if (process.env.TYPESAFE_API_KEY) candidates.push({ label: "jev (hosted)", make: () => jev(), concurrency: 8, usd: (t) => t * JEV_USD_PER_INPUT_TOKEN });
if (process.env.LAYA_BASE_URL) candidates.push({ label: "laya (self-hosted)", make: () => laya(), concurrency: 2 });
if (process.env.KEV_BASE_URL) candidates.push({ label: "kev (self-hosted)", make: () => kev(), concurrency: 2 });
if (process.env.VON_BASE_URL) candidates.push({ label: "von (self-hosted)", make: () => von(), concurrency: 2 });
if (process.env.RIZZO_BASE_URL) candidates.push({ label: "rizzo (self-hosted)", make: () => rizzo(), concurrency: 1 });
if (process.env.DECIDER_BASE_URL) candidates.push({ label: "decider (self-hosted)", make: () => decider(), concurrency: 2 });
if (process.env.HF_TOKEN) candidates.push({ label: "bart-large-mnli (HF zero-shot)", make: () => huggingfaceZeroShot(), concurrency: 4 });
if (process.env.GLICLASS_BASE_URL) candidates.push({ label: "gliclass (self-hosted)", make: () => gliclass(), concurrency: 2 });
if (candidates.length === 0) throw new Error("no classifier configured — see the header of src/compare.ts");

function score(res: ClassifyManyResult<typeof questions>) {
  let refund = 0, urgent = 0, kind = 0, answered = 0;
  for (const item of res.items) {
    if (!item.answers) continue;
    answered++;
    const truth = inbox.find((e) => e.id === item.id)!.truth;
    if (item.answers.refund.noul >= 0.5 === truth.asksRefund) refund++;
    if (item.answers.urgent.noul >= 0.5 === truth.urgent) urgent++;
    if (item.answers.kind.choice === truth.kind) kind++;
  }
  const pct = (x: number) => Math.round((1000 * x) / inbox.length) / 10;
  return { answered, refundAcc: pct(refund), urgentAcc: pct(urgent), kindAcc: pct(kind) };
}

const rows = [];
for (const c of candidates) {
  const clf = c.make();
  const t0 = performance.now();
  const res = await classifyMany(
    clf,
    inbox.map((e) => ({ id: e.id, state: { from: e.from, subject: e.subject, body: e.body } })),
    questions,
    { concurrency: c.concurrency },
  );
  const ms = performance.now() - t0;
  const errors = res.items.filter((i) => i.error).map((i) => i.error);
  const row = {
    classifier: c.label,
    models: res.models,
    ...score(res),
    wallMs: Math.round(ms),
    msPerMessage: Math.round(ms / inbox.length),
    inputTokens: res.usage.input_tokens,
    ...(c.usd && { costUsd: +c.usd(res.usage.input_tokens).toFixed(5) }),
    ...(errors.length && { errors: errors.length, firstError: errors[0] }),
  };
  console.log(row);
  rows.push(row);
}

mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../results/classifiers.json", import.meta.url),
  JSON.stringify({ date: new Date().toISOString(), messages: inbox.length, hardware: process.env.BENCH_HARDWARE ?? null, rows }, null, 2) + "\n",
);
