import assert from "node:assert/strict";
import { test } from "node:test";
import { Glove, Displaymanager, type ModelAdapter } from "../src/index";

function make(model: ModelAdapter) {
  return new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Stable", compaction_config: { compaction_instructions: "Summarize" } });
}

const echo = (seen: string[]): ModelAdapter => ({
  name: "test",
  setSystemPrompt() {},
  async prompt() { seen.push("model"); return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 }; },
});

test("turn preparers run in order before hooks and the model, every request", async () => {
  const seen: string[] = [];
  const builder = make(echo(seen));
  builder.addTurnPreparer(async () => { seen.push("first"); });
  builder.defineHook("h", async () => { seen.push("hook"); });
  const agent = builder.build();
  agent.addTurnPreparer(() => { seen.push("second"); });
  await agent.processRequest("/h hello");
  assert.deepEqual(seen, ["first", "second", "hook", "model"]);
  seen.length = 0;
  await agent.processRequest("again");
  assert.deepEqual(seen, ["first", "second", "model"]);
});

test("a failing preparer stops the turn before the model; unregistering removes it", async () => {
  const seen: string[] = [];
  const agent = make(echo(seen)).build();
  const remove = agent.addTurnPreparer(() => { throw new Error("goal transition still being handled"); });
  await assert.rejects(agent.processRequest("hi"), /still being handled/);
  assert.deepEqual(seen, []);
  remove();
  await agent.processRequest("hi");
  assert.deepEqual(seen, ["model"]);
});

test("prepareTurn runs preparers without a request, and honours abort", async () => {
  const agent = make(echo([])).build();
  let runs = 0;
  agent.addTurnPreparer((signal) => { assert.ok(signal); runs++; });
  const controller = new AbortController();
  await agent.prepareTurn(controller.signal);
  assert.equal(runs, 1);
  controller.abort();
  await assert.rejects(agent.prepareTurn(controller.signal));
  assert.equal(runs, 1);
});

test("notifySubscribers delivers to the agent's subscribers", async () => {
  const agent = make(echo([])).build();
  const events: Array<[string, unknown]> = [];
  agent.addSubscriber({ async record(type, data) { events.push([type, data]); } });
  await agent.notifySubscribers("text_delta", { text: "hello" });
  await agent.notifySubscribers("tool_use", { id: "c1", name: "lookup", input: {} });
  assert.deepEqual(events, [["text_delta", { text: "hello" }], ["tool_use", { id: "c1", name: "lookup", input: {} }]]);
});

test("holdTurns: events queue for the holder instead of waking, requests wait, release hands the queue back", async () => {
  const seen: string[] = [];
  const agent = make(echo(seen)).build();
  const arrived: string[] = [];
  const hold = await agent.holdTurns({ onEvent: (event) => arrived.push(event.id) });

  assert.equal(await agent.emitEvent({ id: "e1", source: "app", content: "first" }), "queued");
  assert.deepEqual(arrived, ["e1"]);
  assert.deepEqual(seen, [], "no wake while held");

  const message = await hold.takeEvents();
  assert.equal(message?.framework_context, "event");
  assert.match(message!.text, /first/);
  assert.equal(await hold.takeEvents(), null);
  assert.equal(await agent.emitEvent({ id: "e1", source: "app", content: "again" }), "duplicate", "taken counts as delivered");

  let answered = false;
  const request = agent.processRequest("hi").then(() => { answered = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false, "requests wait behind the hold");

  await hold.release();
  await request;
  assert.deepEqual(seen, ["model"]);
  assert.equal(await hold.takeEvents(), null, "a released hold takes nothing");
});

test("holdTurns waits for the running turn, can be aborted while waiting, and saves history context like a request", async () => {
  let finish!: () => void;
  const slow: ModelAdapter = {
    name: "slow",
    setSystemPrompt() {},
    async prompt() {
      await new Promise<void>((resolve) => { finish = resolve; });
      return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 };
    },
  };
  const agent = make(slow).build();
  let plan = "step one";
  agent.addContextProvider(() => plan, { delivery: "history", key: "plan" });
  const turn = agent.processRequest("go");
  await new Promise((resolve) => setImmediate(resolve));

  const controller = new AbortController();
  const aborted = agent.holdTurns({ signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted);

  let held = false;
  const pending = agent.holdTurns().then((hold) => { held = true; return hold; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held, false);
  finish();
  await turn;
  const hold = await pending;

  // The request saved "step one"; only a change is returned.
  assert.deepEqual(await hold.historyContext(), []);
  plan = "step two";
  const saved = await hold.historyContext();
  assert.equal(saved.length, 1);
  assert.match(saved[0].text, /^<context key="plan">\nstep two/);
  await hold.release();
});
