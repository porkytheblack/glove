import { Effect } from "effect";
import { defineAgentApplication } from "../../../../src/capabilities.js";

export default defineAgentApplication({
  id: "notes",
  description: "Notes",
  install: () => Effect.void,
});
