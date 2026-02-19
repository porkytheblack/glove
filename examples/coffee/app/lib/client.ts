import { GloveClient, createRemoteStore } from "glove-react";
import { systemPrompt } from "./system-prompt";
import { storeActions } from "./store-actions";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt,
  createStore: (sessionId) => createRemoteStore(sessionId, storeActions),
});
