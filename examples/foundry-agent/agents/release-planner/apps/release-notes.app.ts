import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import supportListener from "../connections/support-listener.connection.js";
import supportTransmission from "../transmissions/support.transmission.js";

const releaseNotes = defineApp({
  description: "An explicitly installed release-notes capability",
  config: z.object({
    channel: z.string().default("release-engineering"),
  }),
  inbound: [supportTransmission],
  outbound: [supportTransmission],
  connections: [supportListener],
  install: ({ config }) => Effect.succeed({
    tools: [{
      name: "release_notes_channel",
      description: "Return the configured release-notes channel",
      inputSchema: z.object({}),
      async do() {
        return { status: "success" as const, data: config.channel };
      },
    }],
  }),
});

export default releaseNotes;
