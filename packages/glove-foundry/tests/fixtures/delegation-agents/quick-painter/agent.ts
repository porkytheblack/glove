import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log } from "../../delegation-scripted.js";

// Asks and waits in the same run for the answer.
export default defineAgent({
  description: "Paints quickly",
  answerWaitMs: 30_000,
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ScriptedModel(() => {
    log("quick-painter-asked");
    return { call: "glove_foundry_ask", input: { question: "Red or blue?" } };
  }, (result) => {
    const answer = /"answer":"([^"]*)"/.exec(result)?.[1] ?? "none";
    log("quick-painter-answered", { answer });
    return `painted ${answer}`;
  }),
  systemPrompt: "Fixture worker",
});
