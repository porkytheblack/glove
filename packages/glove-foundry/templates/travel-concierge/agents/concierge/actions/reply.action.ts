import { definePlaybookAction } from "glove-foundry";

/** What the playbook asks the agent to do when a traveller message matches. */
export default definePlaybookAction({
  description: "Draft a reply to the traveller's message.",
});
