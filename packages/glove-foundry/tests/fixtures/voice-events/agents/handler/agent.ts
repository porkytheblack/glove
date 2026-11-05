import { setTimeout as sleep } from "node:timers/promises";
import { defineAgent } from "../../../../../src/index.js";
import { FileStore, fact, log } from "../../support.js";

/**
 * Takes addressed events with `onEvent` and acknowledges those whose content
 * starts with "ack"; "slow-ack" is acknowledged after a delay, from a handler
 * call the run never waits on itself. The run stays open while fact.txt says "hold".
 */
export default defineAgent({
  description: "Explicit event acknowledgement",
  store: ({ conversationId }) => new FileStore(conversationId),
  async handler(context) {
    context.onEvent(async (handled) => {
      const content = typeof handled.event.content === "string" ? handled.event.content : "";
      log({ type: "handled", eventId: handled.event.id, initial: handled.initial, runId: context.runId });
      if (content.startsWith("slow-ack")) { await sleep(400); handled.ack(); return; }
      if (content.startsWith("ack")) handled.ack();
    });
    while (fact() === "hold") await sleep(25);
    return "done";
  },
});
