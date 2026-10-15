import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { fileURLToPath } from "node:url";
import { FileContextAdapter } from "../../../lib/file-context.js";

/**
 * Ambient context the concierge carries between conversations: seat
 * preference, home airport, who is travelling. One file per agent instance, so
 * two travellers never share a profile. The model reads it every turn and can
 * update it with the context tools.
 */
const directory = new URL("../../../.data/memory/", import.meta.url);

const travellerMemory = defineMemory({
  description: "What we already know about this traveller",
  context: {
    adapter: ({ agentId }) =>
      Effect.promise(() =>
        FileContextAdapter.open(fileURLToPath(new URL(`${encodeURIComponent(agentId)}.json`, directory))),
      ),
  },
});

export default travellerMemory;
