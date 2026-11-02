import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, delegationIdIn, log } from "../../delegation-scripted.js";

// The interactor: hands work off, answers questions, relays results.
export default defineAgent({
  description: "Talks with the user and hands work to the others",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  delegates: [
    { agent: "coder", description: "Writes code." },
    { agent: "painter", description: "Paints, and asks which colour." },
    { agent: "quick-painter", description: "Paints, and waits for the colour." },
  ],
  model: () => new ScriptedModel((last) => {
    if (last.includes('status="completed"')) {
      const result = /Result:\n([\s\S]*?)\n<\/delegation>/.exec(last)?.[1] ?? "";
      log("assistant-relayed", { result });
      return { say: `relay: ${result}` };
    }
    if (last.includes('status="question"')) {
      log("assistant-answering", { delegationId: delegationIdIn(last) });
      return { call: "glove_foundry_reply", input: { delegationId: delegationIdIn(last), message: "blue" } };
    }
    if (last.includes('status="failed"')) return { say: "it failed" };
    if (last.startsWith("paint slowly")) {
      return { call: "glove_foundry_delegate", input: { to: "painter", task: "paint the door" } };
    }
    if (last.startsWith("paint quickly")) {
      return { call: "glove_foundry_delegate", input: { to: "quick-painter", task: "paint the gate" } };
    }
    if (last.startsWith("build")) {
      return { call: "glove_foundry_delegate", input: { to: "coder", task: "write hello" } };
    }
    return { say: "ok" };
  }, () => "handed off"),
  systemPrompt: "Fixture interactor",
  // "listen" keeps this run open and takes the result itself.
  run: async (agent, ctx) => {
    if (!ctx.messageText.startsWith("listen")) return ctx.defaultRun();
    const delivered = new Promise<string>((resolve) => {
      ctx.onDelegationUpdate((updates) => {
        for (const update of updates) if (update.kind === "result") resolve(update.result);
      });
    });
    const delegate = agent.tools.find((tool) => tool.name === "glove_foundry_delegate")!;
    await delegate.run({ to: "coder", task: "write hello" });
    return `live: ${await delivered}`;
  },
});
