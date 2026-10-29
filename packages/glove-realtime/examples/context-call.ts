import { Displaymanager, Glove, MemoryStore, type StoreAdapter } from "glove-core";
import { z } from "zod";
import { RealtimeSession, realtimeModel, type RealtimeAudioFormat } from "../src/index";

/**
 * Your server's audio relay implements this interface. Subscribe methods
 * return a disposer. PCM must be paced, mono, at the adapter's input rate;
 * keep sending silence. Playback state comes from the actual audio sink.
 */
export interface CallTransport {
  play(pcm: Int16Array, format: RealtimeAudioFormat): void;
  flush(): void;
  captions(fragment: { role: "user" | "assistant"; text: string; startMs: number; endMs: number }): void;
  onPcm(handler: (pcm: Int16Array) => void, format: RealtimeAudioFormat): () => void;
  onUserSpeech(handler: (speaking: boolean) => void): () => void;
  onPlayback(handler: (speaking: boolean) => void): () => void;
  onText(handler: (text: string) => Promise<void>): () => void;
}

/**
 * One call, one agent, one store. From a published installation import
 * RealtimeSession/realtimeModel from "glove-realtime" instead of ../src/index.
 * OPENAI_API_KEY is read on the server. This uses Responses delegation.
 */
export async function startSupportCall(
  transport: CallTransport,
  // MemoryStore is for the demo. Supply a durable StoreAdapter in production.
  store: StoreAdapter = new MemoryStore("support-call"),
) {
  const state = {
    screen: "orders",
    order: { id: "A42", status: "processing" },
    objective: "Help the caller check their order.",
  };

  const agent = new Glove({
    model: realtimeModel({
      provider: "openai-live",
      model: "gpt-live-1",
      voice: "marin",
      voiceInstructions: "You are a concise support assistant. Use the backend for order facts. Never invent results.",
    }),
    store,
    displayManager: new Displaymanager(),
    systemPrompt: "Help the caller with their order. Use lookup_order for its current status.",
    serverMode: true,
    compaction_config: { compaction_instructions: "Keep order facts and unfinished work." },
  }).fold({
    name: "lookup_order",
    description: "Read the current order status from the application.",
    inputSchema: z.object({}),
    async do() {
      // Replace this demo state with an authenticated database/service read.
      // Tool outputs also reach GPT-Live's Responses backend directly.
      return { status: "success", data: { ...state.order } };
    },
  }).build();

  // Current state: read at open, each turn, after tools, and manual refresh.
  // Not written to Glove history. On GPT-Live it APPENDS to provider context.
  agent.addContextProvider(
    () => `Current order: ${JSON.stringify(state.order)}`,
    { delivery: "iteration" },
  );

  // Read at the start of a turn and held fixed through its tool steps.
  agent.addContextProvider(
    () => `Screen at the start of this turn: ${state.screen}`,
    { delivery: "request" },
  );

  // Save a changed value to Glove history at the next turn boundary.
  agent.addContextProvider(
    () => state.objective,
    { delivery: "history", key: "support-objective" },
  );

  const session = new RealtimeSession({ agent, permissions: "deny" });
  session.on("audio", (pcm, format) => transport.play(pcm, format));
  session.on("interrupted", () => transport.flush());
  session.on("transcript", (fragment) => transport.captions(fragment));
  session.on("error", (error) => console.error("Call error:", error.message));
  session.on("context_refreshed", (snapshot) => console.log("Local context snapshot:", snapshot));
  // context_refreshed means submitted locally, not provider acknowledgement.

  // Playback notifications must be wired before the provider can produce audio.
  const offPlayback = transport.onPlayback((playing) => session.notifyPlayback(playing));
  try {
    await session.start();
  } catch (error) {
    offPlayback();
    throw error;
  }
  const detach = [
    offPlayback,
    transport.onPcm((pcm) => session.sendAudio(pcm), session.adapter.inputFormat),
    // Local VAD/application boundaries, NOT gaps between transcript fragments.
    // This schedules context preparation; it does not pause continuous audio.
    transport.onUserSpeech((speaking) => { void session.notifyUserSpeech(speaking); }),
    transport.onText((text) => session.say(text)),
  ];

  return {
    agent,
    session,
    async updateOrder(status: string) {
      state.order.status = status;
      await session.refreshContext(); // refresh iteration; keep request frozen
    },
    setScreen(screen: string) {
      state.screen = screen; // sampled at the NEXT input turn
    },
    setObjective(objective: string) {
      state.objective = objective; // saved at the NEXT input turn
    },
    async shipmentArrived(eventId: string) {
      state.order.status = "shipped";
      // A happening to relay: joins a tool boundary or waits for a quiet pause.
      // Use a stable event ID for Glove's duplicate suppression.
      await agent.emitEvent({
        id: eventId,
        source: "orders-service",
        content: `Order ${state.order.id} has shipped.`,
      });
    },
    async close() {
      try {
        await session.stop(); // GPT-Live final usage; failures reject
      } finally {
        detach.forEach((off) => off());
        transport.flush();
      }
    },
  };
}

// In your server, after adapting its audio connection to CallTransport:
// const call = await startSupportCall(transport, durableStore);
// await call.session.say("Can you check my order?");
// await call.updateOrder("packed");             // silent current-state update
// await call.shipmentArrived("shipment:A42:1"); // event the assistant can relay
// await call.close();
