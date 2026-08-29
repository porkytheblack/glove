import { Effect } from "effect";
import { defineMemory } from "../../../../src/capabilities.js";

export default defineMemory({
  id: "personal",
  description: "Personal memory",
  mount: () => Effect.void,
});
