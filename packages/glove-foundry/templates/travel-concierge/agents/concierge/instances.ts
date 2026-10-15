import { defineAgentInstance, defineBinding, install } from "glove-foundry";
import concierge from "./agent.js";
import calendar from "./apps/calendar.app.js";
import convertCurrency from "./tools/convert-currency.tool.js";
import { travellerAccount, travellerOutbound } from "./topology.js";
import messaging, { sendMessage } from "./transmissions/messaging.transmission.js";

/**
 * A ready-made instance, seeded into the data adapter on first start
 * (foundry.application.ts). It has what a new instance created from the
 * inspector does not: installed capabilities and permission to reply.
 *
 * Choose `concierge-demo` in the inspector's run drawer or WebChat to use it.
 */
export const conciergeDemo = defineAgentInstance(concierge, {
  id: "concierge-demo",
  workspaceId: "demo",
  context: { budgetUsd: 2_500 },
  installations: [
    install(convertCurrency, { home: "EUR" }),
    install(calendar, { calendarId: "primary", timezone: "Europe/Lisbon" }, { account: travellerAccount }),
  ],
  // Filled in by agent.ts's `playbooks` resolver on this instance's first run.
  playbooks: [],
});

/**
 * Outbound messages need a binding: the runtime's record that this instance
 * may send through this route. Without one, a reply fails with
 * "agent has no enabled bindings".
 */
export const conciergeDemoReplies = defineBinding({
  id: "concierge-demo-replies",
  agent: conciergeDemo,
  application: calendar,
  transmission: messaging,
  account: travellerAccount,
  route: travellerOutbound,
  capabilities: [sendMessage],
  reply: { mode: "route", route: travellerOutbound },
  enabled: true,
});
