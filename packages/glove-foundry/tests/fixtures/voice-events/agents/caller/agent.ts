import { defineAgent } from "../../../../../src/index.js";
import { voiceCall } from "../../../../../src/voice.js";
import { ControlledAdapter, FileStore, controlRoom, crashIf, log, prepareFromFact } from "../../support.js";

/** A voice agent that tells meeting notices from `mez:meetings` at pauses. */
export default defineAgent({
  description: "Voice agent with meeting notices",
  systemPrompt: "You are on a call.",
  store: ({ conversationId }) => new FileStore(conversationId),
  run: voiceCall({
    room: () => controlRoom(),
    realtime: { adapter: new ControlledAdapter() },
    idleMs: 60_000,
    events: {
      accept: (event) => event.source === "mez:meetings",
      prepare: () => prepareFromFact(),
      afterCall: async (event, context) => {
        log({ type: "after-call", eventId: event.id, effectId: context.effectId });
        crashIf("in-after-call");
      },
    },
  }),
});
