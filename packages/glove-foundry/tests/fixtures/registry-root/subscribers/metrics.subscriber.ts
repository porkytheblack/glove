import { defineSubscriber } from "../../../../src/index.js";

export default defineSubscriber({
  id: "metrics",
  description: "Test native subscriber",
  create: { async record() {} },
});
