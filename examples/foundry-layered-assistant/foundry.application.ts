import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import assistant from "./agents/assistant/agent.js";
import { dataPath } from "./lib/paths.js";
import { DEMO_PERSON, assistantFor } from "./lib/team.js";

// Maya's assistant and chat, seeded in her workspace. Seeds are written only
// when the data file has no record with that id. Its coder and researcher are
// created on the first task.
const maya = defineAgentInstance(assistant, assistantFor(DEMO_PERSON));

/** Instances, conversations, delegations and workspaces live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [maya],
  conversations: [createConversation(maya, { id: `${DEMO_PERSON.id}-chat`, title: `Chat with ${DEMO_PERSON.name}` })],
});

export default defineApplication({
  name: "layered-assistant",
  data,
  accounts: [],
  routes: [],
  bindings: [],
});
