import { defineAgent } from "../../../../../src/index.js";
import { FoundryEchoModel } from "../../../echo-model.js";
import { FileStore, prepareFromFact } from "../../support.js";

/** A text agent that reads current facts for an event before its turn sees it. */
export default defineAgent({
  description: "Text agent with event preparation",
  store: ({ conversationId }) => new FileStore(conversationId),
  model: () => new FoundryEchoModel(),
  systemPrompt: "Answer briefly.",
  prepareEvent: () => prepareFromFact(),
});
