import { defineSubscriber } from "glove-foundry";

/**
 * Subscribers observe without changing behaviour. Everything they see is also
 * in the inspector's event trace; this is the seam for shipping it elsewhere.
 */
const usage = defineSubscriber({
  description: "Report token consumption for each run",
  create: {
    async record(type, data) {
      if (type === "token_consumption") process.stdout.write(`[tokens] ${JSON.stringify(data)}\n`);
    },
  },
});

export default usage;
