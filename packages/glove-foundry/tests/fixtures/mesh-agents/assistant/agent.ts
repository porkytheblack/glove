import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log, meshAttribute, meshBody } from "../../mesh-scripted.js";

// The interactor: messages other agents by id, answers their questions,
// relays their replies. Which agent gets a job is in the message: "build:ada-coder".
export default defineAgent({
  description: "Talks with the user and hands work to other agents",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  mesh: true,
  model: () => new ScriptedModel((last) => {
    if (last.includes('status="replied"')) {
      const result = meshBody(last);
      log("assistant-relayed", { result });
      return { say: `relay: ${result}` };
    }
    if (last.includes('status="failed"')) return { say: `it failed: ${meshBody(last)}` };
    if (last.startsWith("<mesh-message")) {
      log("assistant-answering", { threadId: meshAttribute(last, "thread") });
      return {
        call: "glove_mesh_send_message",
        input: { to: meshAttribute(last, "from"), content: "blue", in_reply_to: meshAttribute(last, "id") },
      };
    }
    const job = /^(\w+):(\S+)/.exec(last);
    if (job) {
      const [, verb, to] = job;
      return { call: "glove_mesh_send_message", input: { to, content: verb === "paint" ? "paint the door" : "write hello" } };
    }
    if (last.startsWith("who")) return { call: "glove_mesh_list_agents", input: {} };
    if (last.startsWith("everyone")) return { call: "glove_mesh_broadcast", input: { content: "write hello" } };
    return { say: "ok" };
  }, (result) => {
    if (result.includes('"agents"')) return result;
    const failed = JSON.parse(result) as { status?: string; message?: string };
    return failed.status === "error" ? `error: ${failed.message}` : "handed off";
  }),
  systemPrompt: "Fixture interactor",
  // "listen:<id>" keeps this run open and takes the reply itself.
  run: async (agent, ctx) => {
    const listen = /^listen:(\S+)/.exec(ctx.messageText);
    if (!listen) return ctx.defaultRun();
    const delivered = new Promise<string>((resolve) => {
      ctx.onMeshMessage((messages) => {
        for (const message of messages) if (message.kind === "reply") resolve(message.content);
      });
    });
    const send = agent.tools.find((tool) => tool.name === "glove_mesh_send_message")!;
    await send.run({ to: listen[1], content: "write hello" });
    return `live: ${await delivered}`;
  },
});
