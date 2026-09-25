/**
 * A support agent that finds the right messages without reading the inbox.
 *
 *   pnpm agent "Which messages ask for a refund, and which of those are urgent?"
 *
 * The inbox is a classifier *source*: the agent can ask typed questions about
 * every message and gets back ids, subjects and answers. It opens a message
 * with `open_message` only when it needs the full text.
 */
import { Glove, Displaymanager, MemoryStore } from "glove-core";
import { jev, mountClassifier, noul, choice } from "glove-classifier";
import { z } from "zod";
import { buildInbox } from "./inbox";
import { openrouter } from "./shared";

const inbox = buildInbox();
const request = process.argv.slice(2).join(" ") || "Which messages ask for a refund, and which of those are urgent?";

const glove = new Glove({
  store: new MemoryStore("classifier-inbox"),
  model: openrouter(2048),
  displayManager: new Displaymanager(),
  systemPrompt:
    "You are a support-operations assistant. Use the classifier tools to find relevant messages; open a message only when you need its full text. Cite message ids.",
  serverMode: true,
  compaction_config: { max_turns: 12, compaction_instructions: "Summarize progress.", compaction_context_limit: 100_000 },
});

glove.fold({
  name: "open_message",
  description: "Read one message in full by id.",
  inputSchema: z.object({ id: z.string() }),
  async do({ id }) {
    const email = inbox.find((e) => e.id === id);
    return email
      ? { status: "success", data: { id: email.id, from: email.from, subject: email.subject, body: email.body } }
      : { status: "error", data: null, message: `no message ${id}` };
  },
});

let tokensIn = 0;
glove.addSubscriber({
  async record(type, data) {
    if (type === "model_response_complete" || type === "model_response") {
      for (const call of (data as { tool_calls?: Array<{ tool_name: string; input_args: unknown }> }).tool_calls ?? []) {
        console.log(`→ ${call.tool_name} ${JSON.stringify(call.input_args).slice(0, 200)}`);
      }
    }
    if (type === "token_consumption") tokensIn += (data as { consumption: { tokens_in?: number } }).consumption.tokens_in ?? 0;
  },
});

const agent = glove.build();
const classifiers = mountClassifier(agent, {
  classifier: jev(),
  presets: {
    triage: {
      description: "Refund, urgency and message kind",
      questions: {
        refund: noul("Does the sender ask for a refund, a chargeback reversal, or their money back?"),
        urgent: noul("Does the sender need this handled today or say it is urgent?"),
        kind: choice("What kind of message is this?", ["refund", "bug", "sales", "spam", "other"]),
      },
    },
  },
  sources: {
    inbox: {
      description: `The support inbox (${inbox.length} messages)`,
      load: () => inbox.map((e) => ({ id: e.id, label: e.subject, state: { from: e.from, subject: e.subject, body: e.body } })),
    },
  },
});

console.log(`> ${request}\n`);
const result = await agent.processRequest(request);
const text = "messages" in result ? result.messages.at(-1)?.text : result.text;
console.log(`\n${text}\n`);
const usage = classifiers.usage();
console.log(`agent context: ${tokensIn} tokens · classifier: ${usage.calls} judgements, ${usage.input_tokens} input tokens`);
