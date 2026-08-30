import { MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { composePlaybook, defineAgent } from "glove-foundry";
import { DemoModel } from "../../lib/demo-model.js";
import reply from "./actions/reply.action.js";
import calendar from "./apps/calendar.app.js";
import { conciergeComponents } from "./composition.js";
import messageReceived from "./events/message-received.event.js";
import messageSent from "./events/message-sent.event.js";
import tripContext from "./layers/trip-context.layer.js";
import travellerMemory from "./memory/traveller.memory.js";
import mentionsTrip from "./predicates/mentions-trip.predicate.js";
import tripCountdown from "./schedules/trip-countdown.js";
import usage from "./subscribers/usage.subscriber.js";
import { travellerInbound, travellerOutbound, travellerAccount } from "./topology.js";
import messaging from "./transmissions/messaging.transmission.js";
import { conciergeRepl, conciergeWorkspace } from "./workbench.js";

/**
 * The file path is the identity: `agents/concierge/agent.ts` is the agent
 * `concierge`. There is no id to keep in sync.
 *
 * Every field below may be a value or a function. A function is called per
 * run with the request context, which is how one definition serves many
 * instances without branching inside the prompt.
 */

/** Runs with no API key so `pnpm dev` works before you have configured one. */
function model() {
  if (!process.env.OPENROUTER_API_KEY) return new DemoModel();
  return createAdapter({
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
    stream: true,
  });
}

/**
 * When a chat message arrives on the inbound route and mentions a trip, answer
 * it and deliver the reply back to the same thread.
 */
const travellerChat = composePlaybook({
  name: "traveller-chat",
  transmission: messaging,
  match: {
    event: messageReceived,
    routes: [travellerInbound],
    predicate: { definition: mentionsTrip, parameters: { any: ["trip", "flight", "hotel"] } },
  },
  directives: [{
    action: reply,
    instruction: "Answer the traveller's message. Keep it short enough to read on a phone.",
  }],
  applications: [calendar],
  outbound: [{
    route: travellerOutbound,
    application: calendar,
    account: travellerAccount,
    applicationAccount: travellerAccount,
    event: messageSent,
    instruction: "Send the reply back to the traveller's thread.",
  }],
});

export default defineAgent({
  description: "Plans trips: finds flights, checks the calendar, and keeps the traveller updated",
  tags: ["travel", "example"],
  components: conciergeComponents,

  // Persisted context, per conversation.
  memory: [travellerMemory],
  store: ({ conversationId }) => new MemoryStore(`concierge:${conversationId}`),
  model,

  // The prompt is built per run, so it can name what is actually mounted.
  systemPrompt: (_agent, { message, history, installations }) => [
    "You are a travel concierge. You are practical and you never invent bookings.",
    "Use find_flights for availability, and the calendar tools before proposing dates.",
    `Traveller asked: ${message.text}`,
    `Prior messages: ${history.length}.`,
    `Installed for this instance: ${installations.map((item) => `${item.kind}:${item.id}`).join(", ") || "nothing yet"}.`,
  ].join("\n"),

  // The sandbox. `budgetUsd` is read off the instance so two travellers differ.
  workingEnvironment: conciergeWorkspace,
  repl: (_agent, { agentId, agentInstance }) =>
    conciergeRepl(agentId, Number(agentInstance.context.budgetUsd ?? 2_000)),

  // Recurring work. An instance can opt out through its own context.
  schedules: (_agent, { agentInstance }) =>
    agentInstance.context.muteCountdown === true ? [] : [tripCountdown],

  // A playbook can only bind a transmission that an installed application
  // owns, so this one exists only once `calendar` is installed on the
  // instance. That is lazy assembly in one line: the same code adapts to
  // whatever each instance actually has.
  playbooks: (_agent, { installations }) =>
    installations.some((item) => item.kind === "application" && item.id === "calendar")
      ? [travellerChat]
      : [],

  compactionInstructions: () =>
    "Keep the destination, dates, budget, confirmed bookings, and open decisions.",
  layers: [tripContext],
  subscribers: [usage],
});
