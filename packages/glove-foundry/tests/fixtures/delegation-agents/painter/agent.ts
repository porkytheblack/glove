import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log } from "../../delegation-scripted.js";

// Asks, then gives up its run at once: the answer starts a new run.
export default defineAgent({
  description: "Paints",
  answerWaitMs: 0,
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ScriptedModel((last) => {
    if (last.includes("<delegation-reply")) {
      const colour = /<delegation-reply[^>]*>\n([\s\S]*?)\n<\/delegation-reply>/.exec(last)?.[1] ?? "";
      log("painter-resumed", { colour });
      return { say: `painted ${colour}` };
    }
    log("painter-asked");
    return { call: "glove_foundry_ask", input: { question: "Red or blue?" } };
  }, () => "waiting for the colour"),
  systemPrompt: "Fixture worker",
});
