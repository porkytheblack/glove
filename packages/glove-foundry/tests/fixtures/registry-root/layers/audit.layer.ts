import { Effect } from "effect";
import { defineLayer } from "../../../../src/index.js";

export default defineLayer({
  id: "audit",
  description: "Test native layer",
  setup: () => Effect.void,
});
