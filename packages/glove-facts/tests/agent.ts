import { Glove, Displaymanager, type IGloveRunnable, type SubscriberAdapter } from "glove-core";

/** Real Glove runtime with a deterministic provider, including a post-tool turn. */
export function preparationAgent(infer: (data: any, signal?: AbortSignal) => unknown | Promise<unknown>, subscriber?: SubscriberAdapter): IGloveRunnable {
  const agent = new Glove({
    model: {
      name: "preparation-test",
      setSystemPrompt() {},
      async prompt(request, notify, signal) {
        if (request.messages.at(-1)?.tool_results) {
          return { messages: [{ sender: "agent", text: "Preparation submitted." }], tokens_in: 1, tokens_out: 1 };
        }
        const data = JSON.parse(request.messages.at(-1)!.text!.split("\n\nDATA:\n")[1]);
        const output = await infer(data, signal) as { proposals: unknown[] };
        const call = { id: crypto.randomUUID(), tool_name: "submit_preparation", input_args: { ...output, requestId: data.requestId } };
        await notify("tool_use", { id: call.id, name: call.tool_name, input: call.input_args });
        await notify("model_response_complete", { text: "", tool_calls: [call] });
        return { messages: [{ sender: "agent", text: "", tool_calls: [call] }], tokens_in: 10, tokens_out: 2 };
      },
    },
    displayManager: new Displaymanager(),
    systemPrompt: "Prepare workflow evidence.",
    compaction_config: { compaction_instructions: "Summarize", max_turns: 4 },
  }).build();
  if (subscriber) agent.addSubscriber(subscriber);
  return agent;
}
