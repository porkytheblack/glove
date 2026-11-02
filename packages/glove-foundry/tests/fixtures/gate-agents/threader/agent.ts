import { MemoryStore, type Message, type ModelAdapter, type ModelPromptResult, type PromptRequest } from "glove-core";
import { z } from "zod";
import { composeAgent } from "../../../../src/composition.js";
import { defineAgent } from "../../../../src/index.js";
import { log, eventText } from "../../delegation-scripted.js";
import { ticketsApp } from "../../gate-tickets.js";

function reply(message: Message): ModelPromptResult {
  return { messages: [message], tokens_in: 1, tokens_out: 1 };
}

const pause = (): ModelPromptResult =>
  reply({ sender: "agent", text: "", tool_calls: [{ tool_name: "pause", input_args: {}, id: `call-${Date.now()}-${Math.random()}` }] });

// Reads its mode from the run's own message:
// "hold"   keeps working until something joins the turn, then reports what joined;
// "linger" answers after a slow final call, so whatever arrives then misses the turn;
// anything else takes two tool steps and answers.
class ThreaderModel implements ModelAdapter {
  readonly name = "gate-threader";
  setSystemPrompt(): void {}
  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    const inputs = request.messages.filter((message) => message.sender === "user" && !message.tool_results?.length && message.framework_context !== "runtime")
      .flatMap((message) => message.framework_context === "event"
        ? [...message.text.matchAll(/<event [^>]*>\n([\s\S]*?)\n<\/event>/g)].map((match) => eventText({ ...message, text: match[0] }))
        : [message.text]);
    const own = inputs[0] ?? "";
    const joined = inputs.slice(1);
    const steps = request.messages.filter((message) => message.tool_results?.length).length;
    log("threader-call", { runId: process.env.STATION_SIGNAL_RUN_ID, own: own.slice(0, 400), joined: joined.length, steps });
    if (own.includes("hold")) {
      if (joined.length > 0) return reply({ sender: "agent", text: `joined: ${joined.join(" | ")}` });
      return steps > 150 ? reply({ sender: "agent", text: "nothing joined" }) : pause();
    }
    if (own.includes("linger")) {
      log("threader-lingering", { runId: process.env.STATION_SIGNAL_RUN_ID });
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
      return reply({ sender: "agent", text: "lingered" });
    }
    if (steps < 2) return pause();
    return reply({ sender: "agent", text: `done: ${own.slice(0, 2_000)}` });
  }
}

export default defineAgent({
  description: "Works on one thread",
  components: composeAgent(ticketsApp),
  store: ({ conversationId }) => new MemoryStore(conversationId),
  tools: [{
    name: "pause",
    description: "Wait a moment.",
    inputSchema: z.object({}),
    async do() {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      return { status: "success" as const, data: "waited" };
    },
  }],
  model: () => new ThreaderModel(),
  systemPrompt: "Fixture threader",
});
