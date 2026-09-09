import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import { recordDelivery } from "../../../../../lib/deliveries.js";
import sent from "../events/notification-sent.event.js";

export const sendNotification = {
  id: "notifications:send",
  description: "Deliver a proactive notification",
  account: "none",
  effect: "write",
} as const;

const notification = defineTransmission({
  name: "Notifications",
  description: "Provider-neutral proactive notification delivery",
  capabilities: [sendNotification],
  events: [sent],
  outbound: {
    config: Schema.Struct({ channel: Schema.String }),
    input: Schema.Struct({ subject: Schema.String, text: Schema.String }),
    output: Schema.Struct({ externalMessageId: Schema.String }),
    adapter: {
      deliver: (input, context) => Effect.sync(() => {
        const delivered = recordDelivery(
          context.route.id,
          `${input.subject}: ${input.text}`,
        );
        return { externalMessageId: delivered.id };
      }),
    },
  },
});

export default notification;
