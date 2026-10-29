import { FileFoundryDataAdapter, defineApplication } from "../../src/index.js";

const file = process.env.FOUNDRY_TEST_APPROVAL_DATA;
if (!file) throw new Error("FOUNDRY_TEST_APPROVAL_DATA is required.");

/** Loaded inside each agent run so the run and the control process share one file. */
export default defineApplication({
  name: "Approval durability",
  data: new FileFoundryDataAdapter({ file }),
});
