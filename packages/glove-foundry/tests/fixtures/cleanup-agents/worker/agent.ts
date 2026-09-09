import { defineAgent } from "../../../../src/index.js";

export default defineAgent({
  description: "Worker cleanup regression fixture",
  run: async (_agent, context) => {
    // Deliberately leak a live handle: completion must still release the process.
    setInterval(() => {}, 1_000);
    context.emit({ type: "test.worker.started", data: { pid: process.pid } });
    if (context.messageText === "cancel") {
      // A misbehaving library may swallow SIGTERM. Cancellation must escalate.
      process.on("SIGTERM", () => {});
      await new Promise(() => {});
    }
    return { pid: process.pid };
  },
});
