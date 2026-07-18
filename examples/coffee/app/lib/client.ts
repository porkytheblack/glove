import { GloveClient, createRemoteStore, generateSessionId } from "glove-react";
import { systemPrompt } from "./system-prompt";
import { storeActions } from "./store-actions";

/**
 * Creates a session row on the server and returns its ID. Wired into
 * `GloveClient.createSessionId` so `useGlove().newConversation()` mints
 * server-backed sessions automatically.
 */
export async function createSessionOnServer(): Promise<string> {
  const sessionId = generateSessionId();
  await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return sessionId;
}

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt,
  createStore: (sessionId) => createRemoteStore(sessionId, storeActions),
  createSessionId: createSessionOnServer,
});
