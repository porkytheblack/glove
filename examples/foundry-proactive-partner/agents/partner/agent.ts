import { useReadSkill } from "glove-core";
import { composeAgent, defineAgent } from "glove-foundry";
import { connectorTools } from "../../lib/connectors.js";
import { FileStore } from "../../lib/file-store.js";
import { callModel, partnerModel } from "../../lib/models.js";
import { loadSkills } from "../../lib/skills.js";
import { actionTools } from "./actions.js";
import { call, isCall } from "./call.js";
import { notifyTool } from "./notify.js";
import personal from "./personal.memory.js";
import { partnerPrompt } from "./prompt.js";
import { partnerSchedules } from "./schedules.js";

/**
 * A proactive partner. One instance per person and one thread: what they say,
 * the morning brief and every check-in land in the same conversation.
 *
 * This file only assembles. What each part does lives beside it.
 */
export default defineAgent({
  description: "Looks after one person's inbox, calendar and errands, and reaches out before they ask",
  components: composeAgent(personal),

  model: (_agent, context) => (isCall(context) ? callModel() : partnerModel()),
  systemPrompt: (_agent, context) => partnerPrompt(context.agentInstance.context, isCall(context)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [personal],

  tools: (_agent, ctx) => [...connectorTools, ...actionTools(ctx), notifyTool],
  schedules: (_agent, { agentInstance }) => partnerSchedules(agentInstance.context),
  configure: async (agent) => {
    useReadSkill(agent, await loadSkills());
  },

  // Long jobs go to its computer, another agent in the person's workspace,
  // over Glove Mesh. The computer is data too (lib/onboarding.ts).
  mesh: true,

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});
