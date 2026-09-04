import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import chat from "./messaging/transmissions/chat.transmission.js";
import fileDrop from "./messaging/transmissions/file-drop.transmission.js";
import notification from "./messaging/transmissions/notification.transmission.js";

const messaging = defineApp({
  description: "Dynamically installed chat, notification, and file-delivery surfaces",
  config: z.object({
    provider: z.enum(["local", "telegram", "discord", "slack", "whatsapp", "signal"]).default("local"),
    homeChannel: z.string().default("operator"),
  }),
  inbound: [chat, fileDrop],
  outbound: [chat, notification],
  install: ({ config, withAccountSession }) => Effect.gen(function* () {
    const account = withAccountSession
      ? yield* withAccountSession("messaging:mount", (session) => Effect.succeed(session))
      : null;
    return {
      tools: [{
        name: "hermes_messaging_status",
        description: "Inspect the messaging surface selected for this instance",
        inputSchema: z.object({}),
        async do() {
          return {
            status: "success" as const,
            data: { ...config, accountSelected: account !== null },
          };
        },
      }],
    };
  }),
});

export default messaging;
