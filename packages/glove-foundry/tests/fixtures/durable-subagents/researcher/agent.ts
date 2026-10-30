import { open } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { defineAgent } from "../../../../src/index.js";
export default defineAgent({
  description: "Long-lived researcher",
  runTimeoutMs: 4 * 60 * 60 * 1000,
  maxConcurrentRuns: 1,
  systemPrompt: "Handle addressed worker events.",
  model: () => ({ name: "event-fixture", setSystemPrompt() {}, async prompt(request) {
    const events = request.messages.filter((message) => message.framework_context === "event");
    return { messages: [{ sender: "agent" as const, text: `events:${events.length}:${events.map((event) => event.text).join("|")}` }], tokens_in: 1, tokens_out: 1 };
  } }),
  run: async (agent, ctx) => {
    if (ctx.messageText === "crash once") {
      const marker = process.env.FOUNDRY_TEST_EVENT_RECOVERY_FILE!;
      try {
        const file = await open(marker, "wx"); await file.close();
        await setTimeout(60_000, undefined, { signal: ctx.signal });
      } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
      return "recovered in-flight event";
    }
    if (ctx.messageText === "drain" || ctx.messageText === "native event") return ctx.defaultRun();
    if (ctx.messageText.includes("hold worker")) await setTimeout(60_000, undefined, { signal: ctx.signal });
    if (ctx.messageText === "ping origin") {
      const replyTo = ctx.events?.[0]?.metadata?.replyTo as { conversationId: string };
      return agent.tools.find((tool) => tool.name === "glove_foundry_message")!.run({ to: "parent", message: "spontaneous finding", delivery: { conversationId: replyTo.conversationId } });
    }
    if (ctx.messageText.includes("ping parent")) {
      const receipt = await agent.tools.find((tool) => tool.name === "glove_foundry_message")!.run({ to: "parent", message: "spontaneous finding" });
      return receipt;
    }
    return "research done";
  },
});
