import { MemoryStore } from "glove-core";
import { z } from "zod";
import { defineAgent } from "../../../../src/index.js";
import { FoundryEchoModel } from "../../echo-model.js";

export default defineAgent({
  description: "Test assistant",
  store: ({ conversationId }) => new MemoryStore(`foundry-test:${conversationId}`),
  model: (_agent, { messageText }) => {
    if (!messageText) throw new Error("validated input was not available");
    return new FoundryEchoModel();
  },
  systemPrompt: (_agent, { messageText }) => `Test request: ${messageText}`,
  compactionLimit: (_agent, { messageText }) => messageText.length * 1_000 + 10_000,
  tools: (_agent, { messageText, controls }) => {
    controls.emit({ type: "test.lazy-tools", data: { message: messageText } });
    return messageText.startsWith("tool:")
      ? [
          {
            name: "fixture_tool",
            description: "A conditionally provisioned fixture tool",
            inputSchema: z.object({}),
            async do() {
              return { status: "success" as const, data: messageText };
            },
          },
        ]
      : [];
  },
});
