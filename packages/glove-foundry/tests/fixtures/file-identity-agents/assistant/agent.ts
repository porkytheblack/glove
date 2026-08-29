import { composeAgent, defineAgent } from "../../../../src/index.js";
import clock from "./tools/time/clock.tool.js";

export default defineAgent({
  description: "File identity fixture",
  components: composeAgent(clock),
  run: () => "ok",
});
