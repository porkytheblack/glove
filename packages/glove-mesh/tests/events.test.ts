import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Glove, MemoryStore, Displaymanager, type Message, type ModelAdapter, type ModelPromptResult, type ToolCall } from "glove-core";
import { InMemoryMeshAdapter, MeshNetwork, mountMesh, type AgentIdentity } from "../src";

type Step = (messages: Message[]) => { text?: string; tool_calls?: ToolCall[] };

/** A scripted model; resolves `until(n)` once it has been called n times. */
function scripted(steps: Step[]) {
  const seen: Message[][] = [];
  const waiters: Array<{ n: number; resolve: () => void }> = [];
  const model: ModelAdapter = { name: "scripted", setSystemPrompt() {}, async prompt(request): Promise<ModelPromptResult> {
    seen.push(structuredClone(request.messages));
    const step = steps[Math.min(seen.length - 1, steps.length - 1)](request.messages);
    for (const w of waiters.filter((w) => seen.length >= w.n)) w.resolve();
    return { messages: [{ sender: "agent", text: step.text ?? "", ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }], tokens_in: 1, tokens_out: 1 };
  } };
  return { model, seen, until: (n: number) => seen.length >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve })) };
}

function agent(id: string, model: ModelAdapter) {
  return new Glove({ store: new MemoryStore(id), model, displayManager: new Displaymanager(), systemPrompt: `you are ${id}`, compaction_config: { compaction_instructions: "summarise" } }).build();
}

const A: AgentIdentity = { id: "a", name: "Agent A", description: "first" };
const B: AgentIdentity = { id: "b", name: "Agent B", description: "second" };
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("glove-mesh event delivery", () => {
  it("wakes an idle recipient, shows a blocking wait as runtime context, and the ack ends it", async () => {
    const net = new MeshNetwork();
    const a = scripted([
      () => ({ tool_calls: [{ id: "s", tool_name: "glove_mesh_send_message", input_args: { to: "b", content: "Can you take ticket 42?", blocking: true } }] }),
      () => ({ text: "Sent, waiting on B." }),
      () => ({ text: "B has it." }),
    ]);
    const b = scripted([
      (messages) => {
        const event = messages.at(-1)!;
        const id = /message id (\S+)\./.exec(event.text)![1];
        return { tool_calls: [{ id: "ack", tool_name: "glove_mesh_acknowledge", input_args: { message_id: id, note: "on it" } }] };
      },
      () => ({ text: "Acknowledged." }),
    ]);
    const gloveA = agent("a", a.model);
    const gloveB = agent("b", b.model);
    await mountMesh(gloveA, { adapter: new InMemoryMeshAdapter(net, "a"), identity: A, delivery: "events" });
    await mountMesh(gloveB, { adapter: new InMemoryMeshAdapter(net, "b"), identity: B, delivery: "events" });

    await gloveA.processRequest("Hand ticket 42 to B and wait for confirmation.");
    // The tool step after the send shows the wait.
    assert.match(a.seen[1].at(-1)!.text, /<mesh_waiting[\s\S]*Waiting for response from "Agent B"/);

    // B was idle: the message woke it, as an escaped external event.
    await b.until(1);
    const delivered = b.seen[0].at(-1)!;
    assert.equal(delivered.framework_context, "event");
    assert.match(delivered.text, /<event id="msg_a_[^"]+" source="mesh:a" kind="direct"/);
    assert.match(delivered.text, /Can you take ticket 42\?/);

    // B's ack resolved A's wait and woke A with it.
    await a.until(3);
    const ack = a.seen[2].at(-1)!;
    assert.equal(ack.framework_context, "event");
    assert.match(ack.text, /kind="ack"[\s\S]*acknowledged your message msg_a_[^:]+: on it/);
    assert.ok(!a.seen[2].some((m) => m.text.includes("<mesh_waiting")), "the wait is gone once acknowledged");
    await settle();
  });

  it("joins a running loop at the next tool step and needs no inbox in the store", async () => {
    const net = new MeshNetwork();
    let gloveB!: ReturnType<typeof agent>;
    const b = scripted([
      () => ({ tool_calls: [{ id: "l", tool_name: "glove_mesh_list_agents", input_args: {} }] }),
      () => ({ text: "done" }),
    ]);
    const a = scripted([() => ({ text: "ok" })]);
    // A store without inbox methods is fine in event mode.
    const bare = new MemoryStore("b") as MemoryStore & Record<string, unknown>;
    for (const method of ["getInboxItems", "addInboxItem", "updateInboxItem", "getResolvedInboxItems"]) bare[method] = undefined;
    gloveB = new Glove({ store: bare, model: b.model, displayManager: new Displaymanager(), systemPrompt: "b", compaction_config: { compaction_instructions: "s" } }).build();
    const gloveA = agent("a", a.model);
    const adapterA = new InMemoryMeshAdapter(net, "a");
    await mountMesh(gloveA, { adapter: adapterA, identity: A, delivery: "events" });
    await mountMesh(gloveB, { adapter: new InMemoryMeshAdapter(net, "b"), identity: B, delivery: "events" });

    // Send from A while B is mid-loop (inside its first tool step).
    const tools = gloveB.tools.find((t) => t.name === "glove_mesh_list_agents")!;
    const original = tools.run.bind(tools);
    tools.run = async (input, handOver, signal) => {
      await adapterA.send({ id: "msg_live", from: "a", to: "b", content: "FYI: deploy is frozen", created_at: new Date().toISOString() });
      return original(input, handOver, signal);
    };
    await gloveB.processRequest("Who is around?");
    const second = b.seen[1];
    const toolResult = second.findIndex((m) => m.tool_results?.length);
    assert.match(second[toolResult + 1].text, /<event id="msg_live" source="mesh:a"[\s\S]*deploy is frozen/);
    assert.equal(b.seen.length, 2, "delivered inside the running turn, no extra wake");
    await settle();
  });

  it("defaults to inbox delivery, and refuses events on a runnable without them", async () => {
    const store = new MemoryStore("x");
    const folded: string[] = [];
    const target = { store, fold: (t: { name: string }) => { folded.push(t.name); return target; } };
    await mountMesh(target as never, { adapter: new InMemoryMeshAdapter(new MeshNetwork(), "x"), identity: A });
    assert.equal(folded.length, 4);
    await assert.rejects(
      mountMesh(target as never, { adapter: new InMemoryMeshAdapter(new MeshNetwork(), "y"), identity: B, delivery: "events" }),
      /event delivery needs/,
    );
  });
});
