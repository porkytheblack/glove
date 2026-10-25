import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import assistant from "./agents/assistant/agent.js";
import coder from "./agents/coder/agent.js";
import researcher from "./agents/researcher/agent.js";
import { dataPath } from "./lib/paths.js";
import { DEMO_PERSON, teamFor } from "./lib/team.js";

// Maya's team, seeded: three instances of three definitions, in her workspace.
// Seeds are written only when the data file has no record with that id.
const team = teamFor(DEMO_PERSON);
const maya = defineAgentInstance(assistant, team.assistant);

/** Instances, conversations and mesh threads live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [maya, defineAgentInstance(coder, team.coder), defineAgentInstance(researcher, team.researcher)],
  conversations: [createConversation(maya, { id: `${DEMO_PERSON.id}-chat`, title: `Chat with ${DEMO_PERSON.name}` })],
});

export default defineApplication({
  name: "layered-assistant",
  data,
  accounts: [],
  routes: [],
  bindings: [],
});
