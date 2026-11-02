import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  Context,
  Displaymanager,
  Glove,
  MemoryStore,
  Observer,
  PromptMachine,
  type Message,
  type ModelAdapter,
  type ModelPromptResult,
  type SubscriberEvent,
} from "../src/index";

describe("Observer compaction usage", () => {
  it("reports the compaction request's exact usage without retaining its prompt in the context counter", async () => {
    const store = new MemoryStore("compaction-usage");
    await store.appendMessages([{ sender: "user", text: "Earlier context" }]);
    await store.addTokens({ tokens_in: 150_000, tokens_out: 4_000 });

    const result: ModelPromptResult = {
      messages: [{ sender: "agent", text: "A compact summary" }],
      tokens_in: 41_000,
      tokens_out: 2_000,
      cache_read_input_tokens: 32_000,
      cache_creation_input_tokens: 1_500,
    };
    const model: ModelAdapter = {
      name: "test-model",
      setSystemPrompt() {},
      async prompt() {
        return result;
      },
    };
    const context = new Context(store);
    const prompt = new PromptMachine(model, context, "system");
    const observer = new Observer(store, context, prompt, "Summarize");
    const events: SubscriberEvent[] = [];
    observer.addSubscriber({
      async record(type, data) {
        events.push({ type, ...data } as SubscriberEvent);
      },
    });

    await observer.runCompactionNow();

    const start = events.find((event) => event.type === "compaction_start");
    assert.deepEqual(start, {
      type: "compaction_start",
      current_token_consumption: 154_000,
    });

    const end = events.find((event) => event.type === "compaction_end");
    assert.ok(end?.type === "compaction_end");
    assert.deepEqual(end.consumption, {
      tokens_in: 41_000,
      tokens_out: 2_000,
      cache_read_input_tokens: 32_000,
      cache_creation_input_tokens: 1_500,
    });

    // Compaction resets context growth and retains only the summary size. Its
    // full provider usage is an accounting event, not future prompt context.
    assert.deepEqual(await store.getTokenConsumption(), {
      tokens_in: 0,
      tokens_out: 2_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});

describe("Compaction partway through a request", () => {
  it("keeps the request word for word, so the model still knows what it was asked", async () => {
    const store = new MemoryStore("compaction-request");
    await store.appendMessages([{ sender: "user", text: "What's on Friday?" }, { sender: "agent", text: "Dinner with Leo at 7." }]);
    // Near the limit already: compaction runs after the first answer, before its tool does, and only once.
    await store.addTokens({ tokens_in: 95, tokens_out: 0 });
    const request = "New mail from Leo Martin: Dinner Friday. Can we move it to 8?";
    const seen: Message[][] = [];
    let calls = 0;
    const model: ModelAdapter = {
      name: "test",
      setSystemPrompt() {},
      async prompt({ messages }) {
        if (messages.at(-1)?.is_compaction_request) return { messages: [{ sender: "agent", text: "Rosa has dinner with Leo on Friday." }], tokens_in: 1, tokens_out: 1 };
        seen.push(structuredClone(messages));
        // The first answer reads mail.
        if (calls++ === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "read", tool_name: "read_mail", input_args: {} }] }], tokens_in: 95, tokens_out: 0 };
        return { messages: [{ sender: "agent", text: "Leo wants 8. Shall I say yes?" }], tokens_in: 1, tokens_out: 1 };
      },
    };
    const builder = new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "You help Rosa.", compaction_config: { compaction_instructions: "Summarize", compaction_context_limit: 100 } });
    builder.fold({ name: "read_mail", description: "Read mail", inputSchema: z.object({}), do: async () => ({ status: "success", data: "Leo: can we do 8?" }) });
    const agent = builder.build(store);

    await agent.processRequest(request);

    assert.equal(seen.length, 2);
    const [summary, ...rest] = seen[1]!;
    assert.ok(summary?.is_compaction, "the model sees the summary first");
    assert.match(summary.text, /Rosa has dinner with Leo on Friday\./);
    assert.ok(summary.text.includes(`[The request being worked on, word for word]\n${request}`));
    assert.ok(rest.some((message) => message.tool_results?.length), "then the tool call and its result");
    // The request is stored once; the copy lives in the summary, which displays skip.
    assert.equal((await store.getMessages()).filter((message) => message.text === request).length, 1);
  });

  it("adds nothing when compaction runs between requests", async () => {
    const store = new MemoryStore("compaction-between");
    await store.appendMessages([{ sender: "user", text: "Earlier" }]);
    const model: ModelAdapter = { name: "test", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "Summary" }], tokens_in: 1, tokens_out: 1 }; } };
    const context = new Context(store);
    await new Observer(store, context, new PromptMachine(model, context, "system"), "Summarize").runCompactionNow();
    const [summary] = await context.getMessages();
    assert.equal(summary?.text, "[Conversation summary from compaction]\n\nSummary\n\n[End of summary - the conversation continues from here]");
  });
});
