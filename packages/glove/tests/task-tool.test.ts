import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Glove, MemoryStore, Displaymanager, type ModelAdapter, type StoreAdapter } from "../src/index";

const todo = { content: "Run tests", activeForm: "Running tests", status: "in_progress" };
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
    systemPrompt: "Manage tasks",
    compaction_config: { compaction_instructions: "Summarize" },
  });
}

function withoutTaskMethod(method: "getTasks" | "addTasks"): StoreAdapter {
  const store: StoreAdapter = new MemoryStore("unsupported");
  store[method] = undefined;
  return store;
}

describe("built-in task tool", () => {
  it("exposes tasks to the model and persists agent updates with the default store", async () => {
    let calls = 0;
    const glove = createGlove(undefined, {
      ...model,
      async prompt(request) {
        assert.equal(request.tools?.filter((tool) => tool.name === "glove_update_tasks").length, 1);
        return {
          messages: [{
            sender: "agent",
            text: "",
            ...(calls++ === 0 ? { tool_calls: [{ id: "tasks", tool_name: "glove_update_tasks", input_args: { todos: [todo] } }] } : {}),
          }],
          tokens_in: 0,
          tokens_out: 0,
        };
      },
    }).build();
    await glove.processRequest("Track the work");
    assert.equal(calls, 2);
    const tasks = await glove.store.getTasks!();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].content, todo.content);
  });

  it("exposes the tool before build and writes to a constructor-supplied store", async () => {
    const store = new MemoryStore("constructor");
    const glove = createGlove(store);
    const tool = glove.tools.find((tool) => tool.name === "glove_update_tasks")!;
    await tool.run({ todos: [todo] });
    const [task] = await store.getTasks();
    await tool.run({ todos: [{ ...todo, status: "completed" }] });
    assert.equal((await store.getTasks())[0].id, task.id);
    assert.equal((await store.getTasks())[0].status, "completed");
    await tool.run({ todos: [] });
    assert.deepEqual(await store.getTasks(), []);
  });

  it("rebinds tasks to the build store without dropping folded tools or duplicating tasks", async () => {
    const glove = createGlove();
    const initialStore = glove.store;
    glove.fold({ name: "custom", description: "Custom", jsonSchema: { type: "object" }, async do() { return { status: "success", data: {} }; } });
    const store = new MemoryStore("build");
    glove.build(store).rebuild();
    assert.deepEqual(glove.tools.map((tool) => tool.name), ["glove_update_tasks", "custom"]);
    await glove.tools[0].run({ todos: [todo] });
    assert.equal((await store.getTasks()).length, 1);
    assert.deepEqual(await initialStore.getTasks!(), []);
  });

  for (const method of ["getTasks", "addTasks"] as const) {
    it(`omits tasks when the constructor or build store lacks ${method}`, () => {
      const hasTaskTool = (glove: Glove) => glove.tools.some((tool) => tool.name === "glove_update_tasks");
      assert.equal(hasTaskTool(createGlove(withoutTaskMethod(method))), false);
      const glove = createGlove();
      glove.build(withoutTaskMethod(method));
      assert.equal(hasTaskTool(glove), false);
    });
  }
});
