import { createConversation, defineAgentInstance, install } from "glove-foundry";
import releasePlanner from "./agent.js";
import releaseNotes from "./apps/release-notes.app.js";
import releaseClock from "./tools/release-clock.tool.js";
import { supportAccount } from "./topology.js";

export const releasePlannerInstance = defineAgentInstance(releasePlanner, {
  id: "release-planner-example",
  workspaceId: "example",
  context: { role: "release-coordinator" },
  installations: [
    install(releaseClock),
    install(releaseNotes, {
      channel: "release-engineering",
    }, { account: supportAccount }),
  ],
  playbooks: [],
});

export const releasePlannerConversation = createConversation(
  releasePlannerInstance,
  { id: "release-planner-main", title: "Release planning" },
);
