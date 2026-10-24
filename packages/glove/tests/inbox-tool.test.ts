import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Glove, MemoryStore, Displaymanager, type ModelAdapter, type StoreAdapter } from "../src/index";

const model: ModelAdapter = {
  name: "test",
  setSystemPrompt() {},
  async prompt() {
    return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 0, tokens_out: 0 };
  },
};

function createGlove(store?: StoreAdapter, adapter = model) {
  return new Glove({
    store,
    model: adapter,
    displayManager: new Displaymanager(),
    systemPrompt: "Track async work",
    compaction_config: { compaction_instructions: "Summarize" },
  });
}

describe("built-in inbox tool", () => {
  it("is offered to the model, posts to the store, and injects the resolution next turn", async () => {
    let calls = 0;
    let injected = "";
    const glove = createGlove(undefined, {
      ...model,
      async prompt(request) {
        calls++;
        if (calls === 1) {
          assert.equal(request.tools?.filter((tool) => tool.name === "glove_post_to_inbox").length, 1);
          return {
            messages: [{
              sender: "agent",
              text: "",
              tool_calls: [{ id: "post", tool_name: "glove_post_to_inbox", input_args: { tag: "ci", request: "Tell me when main is green", blocking: true } }],
            }],
            tokens_in: 0,
            tokens_out: 0,
          };
        }
        injected = request.messages.filter((message) => message.framework_context === "inbox").map((message) => message.text).join("\n");
        return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 0, tokens_out: 0 };
      },
    }).build();

    await glove.processRequest("Tag once CI is green");
    const [item] = await glove.store.getInboxItems!();
    assert.equal(item.status, "pending");
    assert.equal(item.blocking, true);
    assert.equal(item.tag, "ci");

    await glove.store.updateInboxItem!(item.id, { status: "resolved", response: "green at 9f3c2a1", resolved_at: new Date().toISOString() });
    await glove.processRequest("CI finished");
    assert.match(injected, /green at 9f3c2a1/);
    assert.equal((await glove.store.getInboxItems!())[0].status, "consumed");
  });

  it("rebinds to the build store", async () => {
    const glove = createGlove();
    const store = new MemoryStore("build");
    glove.build(store);
    const tool = glove.tools.find((tool) => tool.name === "glove_post_to_inbox")!;
    await tool.run({ tag: "t", request: "r", blocking: false });
    assert.equal((await store.getInboxItems()).length, 1);
    assert.equal(glove.tools.filter((tool) => tool.name === "glove_post_to_inbox").length, 1);
  });

  for (const method of ["getInboxItems", "addInboxItem", "updateInboxItem", "getResolvedInboxItems"] as const) {
    it(`is not registered when the store lacks ${method}`, () => {
      const store: StoreAdapter = new MemoryStore("partial");
      store[method] = undefined;
      assert.equal(createGlove(store).tools.some((tool) => tool.name === "glove_post_to_inbox"), false);
    });
  }
});
