import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
  defineApplication,
} from "glove-foundry";
import {
  BRIEFING_AGENT_ID,
  BRIEFING_CONVERSATION_ID,
  CAMPAIGN_AGENT_ID,
  CAMPAIGN_CONVERSATION_ID,
  LEAD_AGENT_ID,
  LEAD_CONVERSATION_ID,
  WORKSPACE_ID,
} from "./lib/protocol.js";

const lead = createAgentInstance("lead", {
  id: LEAD_AGENT_ID,
  workspaceId: WORKSPACE_ID,
  context: {
    title: "Braind Storm",
    skillPacks: ["marketing"],
    workforce: ["scout", "strategist", "maker", "critic"],
  },
});

const conversation = createConversation(lead, {
  id: LEAD_CONVERSATION_ID,
  title: "The eye of the storm",
  context: { channel: "web", persistent: true },
});

const briefingLine = createAgentInstance("briefing-line", {
  id: BRIEFING_AGENT_ID,
  workspaceId: WORKSPACE_ID,
  context: {
    title: "Mara's briefing line",
    surface: "gemini-live",
    sharesStormWorkspace: true,
  },
});

const briefingConversation = createConversation(briefingLine, {
  id: BRIEFING_CONVERSATION_ID,
  title: "Live briefing line",
  context: { channel: "voice", persistent: true },
});

const campaignOrchestrator = createAgentInstance("campaign-orchestrator", {
  id: CAMPAIGN_AGENT_ID,
  workspaceId: WORKSPACE_ID,
  context: {
    title: "Campaign control room",
    headless: true,
    modes: ["auto", "parallel", "sequential"],
  },
});

const campaignConversation = createConversation(campaignOrchestrator, {
  id: CAMPAIGN_CONVERSATION_ID,
  title: "Campaign batch orchestration",
  context: { channel: "runtime", persistent: true },
});

export const data = new MemoryFoundryDataAdapter({
  identifier: "braind-storm-data",
  agents: [lead, briefingLine, campaignOrchestrator],
  conversations: [conversation, briefingConversation, campaignConversation],
});

export default defineApplication({
  name: "Braind Storm",
  data,
  conversationStore: ({ conversationId }) =>
    import("glove-core").then(({ MemoryStore }) => new MemoryStore(`braind:${conversationId}`)),
});
