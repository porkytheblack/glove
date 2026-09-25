/**
 * The program an agent would write, run directly: pull the inbox, judge
 * every message in one parallel call, return only what matters.
 *
 *   pnpm repl        (needs TYPESAFE_API_KEY; no LLM involved)
 *
 * `classifier.many` is registered from `classifierFns(jev())`, exactly as it
 * would be for an agent mounted with `mountJs`. Only the program's final
 * value would enter the agent's context.
 */
import { JsSession } from "glove-js";
import { classifierFns, jev, newClassifierUsage } from "glove-classifier";
import { buildInbox } from "./inbox";

const inbox = buildInbox();
const usage = newClassifierUsage();
const session = JsSession.create();
session.registerAll([
  {
    name: "inbox__list",
    description: "Every message in the support inbox: { id, from, subject, body }[]",
    inputSchema: { type: "object", properties: {} },
    async call() {
      return inbox.map(({ id, from, subject, body }) => ({ id, from, subject, body }));
    },
  },
  ...classifierFns(jev(), { usage }),
]);

const program = `
const messages = inbox.list();
const judged = classifier.many({
  items: messages.map(m => ({ id: m.id, label: m.subject, state: { from: m.from, subject: m.subject, body: m.body } })),
  questions: {
    refund: "Does the sender ask for a refund, a chargeback reversal, or their money back?",
    urgent: "Does the sender need this handled today or say it is urgent?",
  },
  where: { question: "refund" },
});
({
  refunds: judged.map(j => j.id),
  urgent: judged.filter(j => j.answers.urgent > 0.5).map(j => j.id + " — " + j.label),
})
`;

const t0 = performance.now();
const result = await session.execute(program);
console.log(program.trim(), "\n\n→", JSON.stringify(result.value, null, 2));
const inboxChars = inbox.reduce((n, e) => n + e.subject.length + e.body.length, 0);
console.log(
  `\n${usage.calls} judgements in ${Math.round(performance.now() - t0)} ms · ` +
    `${usage.input_tokens} classifier input tokens (≈ $${((usage.input_tokens * 0.042) / 1e6).toFixed(4)}) · ` +
    `returned ${JSON.stringify(result.value).length} chars instead of ${inboxChars}`,
);
