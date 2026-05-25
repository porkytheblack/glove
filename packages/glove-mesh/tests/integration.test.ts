import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Glove,
  MemoryStore,
  Displaymanager,
  type ModelAdapter,
  type ModelPromptResult,
  type Message,
  type PromptRequest,
  type ToolCall,
  type NotifySubscribersFunction,
} from "glove-core";
import {
  InMemoryMeshAdapter,
  MeshNetwork,
  mountMesh,
  type AgentIdentity,
} from "../src";

// ────────────────────────────────────────────────────────────────────────────
// Mock model adapter
// ────────────────────────────────────────────────────────────────────────────

/**
 * A scripted step. Each entry corresponds to one `prompt()` call from the
 * agent loop. If `tool_calls` is provided the loop will execute the tools
 * and call `prompt()` again — that next call consumes the next script entry.
 *
 * The script-runner appends a synthetic `id` for every tool call so the
 * executor can correlate `tool_call.id` with the `tool_result.call_id`
 * downstream (though we never actually inspect these in this test).
 */
type ScriptStep = {
  text?: string;
  tool_calls?: Array<{ tool_name: string; input_args: unknown }>;
};

interface MockHandle {
  /** Captured prompt() inputs, one entry per turn. */
  promptCalls: Array<PromptRequest>;
  /** When the script is exhausted, future prompt() calls return empty text. */
  exhausted: boolean;
}

function makeMockModel(name: string, script: Array<ScriptStep>): {
  adapter: ModelAdapter;
  handle: MockHandle;
} {
  let cursor = 0;
  let idCursor = 0;
  const handle: MockHandle = { promptCalls: [], exhausted: false };

  let systemPrompt = "";

  const adapter: ModelAdapter = {
    name,
    setSystemPrompt(sp: string) {
      systemPrompt = sp;
    },
    async prompt(
      request: PromptRequest,
      _notify: NotifySubscribersFunction,
      _signal?: AbortSignal,
    ): Promise<ModelPromptResult> {
      // Capture a deep-ish snapshot of the messages the loop just sent us.
      handle.promptCalls.push({
        messages: request.messages.map((m) => ({ ...m })),
        tools: request.tools,
      });

      // Drain script
      const step = script[cursor];
      if (!step) {
        handle.exhausted = true;
        const empty: Message = { sender: "agent", text: "" };
        return { messages: [empty], tokens_in: 0, tokens_out: 0 };
      }
      cursor++;

      const toolCalls: ToolCall[] | undefined = step.tool_calls?.map((tc) => ({
        tool_name: tc.tool_name,
        input_args: tc.input_args,
        id: `mock_call_${name}_${++idCursor}`,
      }));

      const msg: Message = {
        sender: "agent",
        text: step.text ?? "",
      };
      if (toolCalls && toolCalls.length > 0) msg.tool_calls = toolCalls;

      // Silence the never-used warning for setSystemPrompt capture.
      void systemPrompt;

      return { messages: [msg], tokens_in: 0, tokens_out: 0 };
    },
  };

  return { adapter, handle };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers for building real Glove instances mounted on a shared mesh
// ────────────────────────────────────────────────────────────────────────────

function buildAgent(
  id: string,
  script: Array<ScriptStep>,
): {
  glove: Glove;
  store: MemoryStore;
  handle: MockHandle;
} {
  const store = new MemoryStore(id);
  const { adapter: model, handle } = makeMockModel(id, script);

  const glove = new Glove({
    store,
    model,
    displayManager: new Displaymanager(),
    systemPrompt: `you are agent ${id}`,
    compaction_config: {
      compaction_instructions: "summarise",
      max_turns: 50,
    },
  });
  glove.build();

  return { glove, store, handle };
}

async function mountAgent(
  glove: Glove,
  identity: AgentIdentity,
  network: MeshNetwork,
): Promise<void> {
  const adapter = new InMemoryMeshAdapter(network, identity.id);
  await mountMesh(glove, { adapter, identity });
}

// ────────────────────────────────────────────────────────────────────────────
// The integration smoke test
// ────────────────────────────────────────────────────────────────────────────

const ID_A: AgentIdentity = { id: "a", name: "Agent A", description: "first" };
const ID_B: AgentIdentity = { id: "b", name: "Agent B", description: "second" };

describe("glove-mesh end-to-end with real Glove agent loop", () => {
  it("delivers a blocking send -> inbox surfaces it -> ack resolves the sender's pending item, all visible to the models", async () => {
    const network = new MeshNetwork();

    // ── Agent A's script ────────────────────────────────────────────────
    // Turn 1 (response to "Send a hello to B blocking"): emit a
    // glove_mesh_send_message tool call. Then on turn 2 (after tool result), end.
    // After we run "Continue" later, A will be re-prompted; turn 3 just ends
    // — by then the inbox-inject step at the top of ask() should have
    // surfaced B's ack as a resolved item in the message history visible
    // to the model.
    const aScript: Array<ScriptStep> = [
      // turn 1: tool call to send blocking message to B
      {
        text: "Sending hello to B (blocking).",
        tool_calls: [
          {
            tool_name: "glove_mesh_send_message",
            input_args: {
              to: "b",
              content: "hello B",
              blocking: true,
            },
          },
        ],
      },
      // turn 2: end turn (no tool calls)
      { text: "Sent. Waiting for B." },
      // turn 3 (after "Continue"): end turn — the prompt at this point
      // should contain the [Inbox: ... resolved] notification for B's ack.
      { text: "Acknowledged. Done." },
    ];

    // ── Agent B's script ────────────────────────────────────────────────
    // We need B's mock to emit a glove_mesh_acknowledge call referencing the
    // observed message id. We don't know the id at script-construction time
    // — we'll look at B's first prompt() and pull the id out of the inbox
    // notification text. We do this by making the mock model "lazy": the
    // script entry is replaced just before B's first prompt() call.
    const bScript: Array<ScriptStep> = [
      // Placeholder — will be mutated below once we observe the inbound
      // message id in B's message history.
      { text: "Checking inbox..." },
      // turn 2: end turn after ack tool result lands.
      { text: "Done." },
    ];

    const a = buildAgent("a", aScript);
    const b = buildAgent("b", bScript);

    await mountAgent(a.glove, ID_A, network);
    await mountAgent(b.glove, ID_B, network);

    // ─── Step 1: A sends a blocking message to B ─────────────────────────
    await a.glove.processRequest("Send a hello to B blocking");

    // After A's processRequest finishes, A's mock should have been called
    // twice — once with the user message, once after the tool result.
    assert.equal(
      a.handle.promptCalls.length,
      2,
      `expected A mock to be prompted twice (got ${a.handle.promptCalls.length})`,
    );

    // The glove_mesh_send_message tool should have inserted a pending blocking
    // item in A's inbox tagged mesh:waiting:<msg_id>.
    const aInboxAfterSend = await a.store.getInboxItems();
    const pending = aInboxAfterSend.find((i) => i.status === "pending");
    assert.ok(pending, "A should have a pending inbox item after blocking send");
    assert.match(pending.tag, /^mesh:waiting:/);
    const sentMsgId = pending.tag.replace("mesh:waiting:", "");

    // And the message should already have arrived in B's inbox as a
    // resolved item — that's the inbound subscribe handler running
    // synchronously in the in-memory mesh.
    const bInboxAfterSend = await b.store.getInboxItems();
    assert.equal(bInboxAfterSend.length, 1);
    const incoming = bInboxAfterSend[0]!;
    assert.equal(incoming.status, "resolved");
    assert.equal(incoming.tag, "mesh:from:a");
    assert.equal(incoming.response, "hello B");

    // ─── Step 2: B checks inbox ──────────────────────────────────────────
    // Rewrite B's first script step on the fly so its tool call refers to
    // the actual message id (which we now know).
    bScript[0] = {
      text: "Got a message. Acknowledging.",
      tool_calls: [
        {
          tool_name: "glove_mesh_acknowledge",
          input_args: {
            message_id: sentMsgId,
            note: "ack from B",
          },
        },
      ],
    };

    await b.glove.processRequest("Check your inbox");

    // B's mock should have been prompted twice (once at top of ask, once
    // after the ack tool result).
    assert.equal(
      b.handle.promptCalls.length,
      2,
      `expected B mock to be prompted twice (got ${b.handle.promptCalls.length})`,
    );

    // CRITICAL ASSERTION: at the time B's mock model was first prompted,
    // the [Inbox: ... resolved] notification must have been present in the
    // message list it saw. That's the end-to-end proof that
    // injectResolvedInboxItems actually fed mesh-delivered content into the
    // model's view.
    const bFirstPromptMessages = b.handle.promptCalls[0]!.messages;
    const inboxBannerOnB = bFirstPromptMessages.find(
      (m) => m.sender === "user" && m.text.startsWith("[Inbox:"),
    );
    assert.ok(
      inboxBannerOnB,
      "B's first prompt should contain an [Inbox: ...] banner injected from the resolved mesh message",
    );
    assert.match(inboxBannerOnB.text, /\[Inbox: 1 item\(s\) resolved\]/);
    assert.match(inboxBannerOnB.text, /hello B/, "inbox banner should include the message body");
    assert.match(
      inboxBannerOnB.text,
      new RegExp(`mesh:from:a`),
      "inbox banner should include the mesh:from:<sender> tag",
    );

    // After B's ask, the inbox item should be flipped to `consumed` (so
    // it's not re-injected on subsequent turns).
    const bInboxPostAck = await b.store.getInboxItems();
    assert.equal(bInboxPostAck[0]!.status, "consumed");

    // ─── Step 3: A continues — the ack should now be a resolved item ───
    // The ack from B was routed by the in-memory mesh, the mountMesh
    // handler should have flipped A's `mesh:waiting:<msgId>` item from
    // pending to resolved. Confirm BEFORE the next ask().
    const aInboxBeforeContinue = await a.store.getInboxItems();
    const resolvedFromAck = aInboxBeforeContinue.find(
      (i) => i.tag === `mesh:waiting:${sentMsgId}`,
    );
    assert.ok(resolvedFromAck);
    assert.equal(
      resolvedFromAck.status,
      "resolved",
      "A's previously-pending blocking item should be resolved by B's ack",
    );
    assert.equal(
      resolvedFromAck.response,
      "ack from B",
      "the resolution response should carry the ack note",
    );

    await a.glove.processRequest("Continue");

    // A's mock now should have been called a 3rd time. At the start of that
    // ask(), injectResolvedInboxItems should have prepended a banner that
    // includes the ack-resolved item.
    assert.equal(
      a.handle.promptCalls.length,
      3,
      `expected A mock to be prompted three times (got ${a.handle.promptCalls.length})`,
    );
    const aThirdPromptMessages = a.handle.promptCalls[2]!.messages;
    const ackBanner = aThirdPromptMessages.find(
      (m) =>
        m.sender === "user" &&
        m.text.startsWith("[Inbox:") &&
        m.text.includes(`mesh:waiting:${sentMsgId}`),
    );
    assert.ok(
      ackBanner,
      "A's third prompt should contain an [Inbox: ...] banner for the ack-resolved waiting item",
    );
    assert.match(ackBanner.text, /ack from B/);

    // And the waiting item should now be `consumed` (flipped after inject).
    const aInboxFinal = await a.store.getInboxItems();
    const consumedAck = aInboxFinal.find(
      (i) => i.tag === `mesh:waiting:${sentMsgId}`,
    );
    assert.ok(consumedAck);
    assert.equal(consumedAck.status, "consumed");
  });
});
