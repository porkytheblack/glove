import { appendFileSync } from "node:fs";
import { defineAgent, defineSchedule } from "../../../../src/index.js";

// Every instance ticks once a second. "hold" keeps a run busy for a while.
export default defineAgent({
  description: "Ticks on a schedule",
  schedules: [defineSchedule({ name: "tick", timing: { kind: "every", interval: "1s" }, message: "tick" })],
  run: async (_agent, ctx) => {
    if (ctx.messageText === "hold") {
      await new Promise((resolveWait) => setTimeout(resolveWait, 6_000));
      return "held";
    }
    const file = process.env.FOUNDRY_TEST_OVERLAP_LOG;
    if (file && ctx.request.source?.kind === "activation") {
      appendFileSync(file, `${JSON.stringify({ agentId: ctx.agentId, t: Date.now() })}\n`);
    }
    return "tick";
  },
});
