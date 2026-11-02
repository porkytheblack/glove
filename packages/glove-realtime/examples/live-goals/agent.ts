import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { defineGoalProgram, InMemoryGoalAdapter, useGoalRunner } from "glove-memory";
import { z } from "zod";
import { RealtimeSession, realtimeModel, type RealtimeAdapter } from "../../src/index";

/** Conversation objectives: the agent decides what to ask next and records
 * evidence through Glove's goal tools. These are not a scripted dialogue. */
export const salesProgram = defineGoalProgram({
  key: "sales-discovery",
  goals: [
    { key: "discover", title: "Understand the customer", objective: "Learn how this business handles appointments and what would make a change worthwhile.", items: [
      { key: "workflow", label: "Understand the current booking workflow" },
      { key: "volume", label: "Learn the monthly appointment volume" },
      { key: "priority", label: "Identify the customer's main problem" },
    ] },
    { key: "recommend", title: "Find a useful fit", objective: "Use current product facts to recommend a suitable plan, or explain why neither fits. Address the customer's questions.", items: [
      { key: "fit", label: "Explain a recommendation grounded in their needs" },
      { key: "questions", label: "Resolve questions or objections" },
    ] },
    { key: "next_step", title: "Agree on a next step", objective: "Ask whether a product demo would be useful. Record their decision, including a decline, without pressure.", items: [
      { key: "decision", label: "Record the customer's decision about a demo" },
    ] },
  ],
});

export async function createSalesDemo() {
  const store = new MemoryStore("live-sales-demo");
  const goalAdapter = new InMemoryGoalAdapter();
  const catalog = {
    product: "Northstar Booking (fictional demo product)", currency: "USD", cadence: "monthly",
    starter: { price: 19, appointments: 100, features: ["Online booking"] },
    growth: { price: 49, appointments: 1000, features: ["Online booking", "Automatic SMS reminders"] },
    pilotOffer: false,
  };
  let decision: "demo" | "decline" | "follow_up" | null = null;
  const instructions = [
    "You are an AI sales assistant for the fictional Northstar Booking product, speaking to a willing test participant. This is a simulated outbound sales call, not a real phone call.",
    "On the first connection, initiate the conversation: introduce yourself as an AI assistant and ask if this is a good time for a short conversation about their booking needs. On a reconnect, continue the existing conversation from its saved goals and history.",
    "Drive the conversation toward the supplied Glove goals. Ask one useful question at a time, listen, and adapt. Never repeat questions already answered in history or completed goals.",
    "Delegate factual work and goal tracking to the backend. Read glove_goal_status, then record actual conversational evidence with glove_goal_update using the current version and a specific reason. Do not complete goals without evidence.",
    "Discovery covers current workflow, monthly volume, and the main problem. Use lookup_plans before recommending anything. Explain the fit briefly and ask about questions or objections.",
    "When a product event arrives, proactively tell the caller what changed, including the new price, without waiting for a question. Reconsider your recommendation if needed.",
    "After addressing their questions, ask if they want a demo. Respect a no. Use record_next_step only after an explicit decision. No purchase or real meeting is scheduled.",
    "After the decision, record the completed or declined goal items and end with a brief recap. Do not manufacture another question to keep the call going.",
  ].join(" ");
  const agent = new Glove({
    model: realtimeModel({ provider: "openai-live", model: "gpt-live-1", voice: "marin", backendModel: "gpt-6-luna", voiceInstructions: instructions }),
    store, displayManager: new Displaymanager(), systemPrompt: instructions, serverMode: true,
    compaction_config: { compaction_instructions: "Retain customer needs, completed goals, recommendations, product updates and consent or refusal." },
  }).build();
  const { runner } = useGoalRunner(agent, goalAdapter, {
    scope: { subject: "demo-prospect", key: "sales-discovery" }, delivery: "history",
    tools: { allow: ["status", "update", "history"] },
  });
  await runner.start(salesProgram);
  agent.fold({
    name: "lookup_plans", description: "Read current fictional plans, capacities, features and prices. Use before making a recommendation or discussing a changed offer.",
    inputSchema: z.object({}),
    async do() { return { status: "success", data: structuredClone(catalog) }; },
  }).fold({
    name: "record_next_step", description: "Record the prospect's explicit decision: demo, decline, or follow_up. Does not place a real order or schedule a real meeting.",
    inputSchema: z.object({ decision: z.enum(["demo", "decline", "follow_up"]), reason: z.string().min(1) }),
    async do(input) {
      decision = input.decision;
      return { status: "success", data: { decision, reason: input.reason, realMeetingScheduled: false } };
    },
  });
  agent.addContextProvider(() => `Current recorded next step: ${decision ?? "not decided"}. Product facts are available through lookup_plans.`, { delivery: "iteration" });
  return {
    agent, runner, store,
    createSession(adapter?: RealtimeAdapter) {
      return new RealtimeSession({ agent, adapter, permissions: "deny", reconnect: false, maxDurationMs: 5 * 60_000 });
    },
    async offer() {
      catalog.growth.price = 39;
      catalog.pilotOffer = true;
      return agent.emitEvent({ id: "pilot-offer:1", source: "product-catalog", content: "A new pilot offer is available: Growth now costs 39 USD per month instead of 49 USD, with the same 1,000 appointment capacity and automatic SMS reminders." });
    },
    async snapshot() {
      const messages = await store.getMessages();
      return { catalog: structuredClone(catalog), decision, goals: await runner.status(),
        history: messages.filter(m => m.context_key === "glove.goals" || m.framework_context === "event")
          .map(m => ({ kind: m.context_key ?? m.framework_context, text: m.text })),
      };
    },
  };
}
