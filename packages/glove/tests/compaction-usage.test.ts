import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Context,
  MemoryStore,
  Observer,
  PromptMachine,
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
