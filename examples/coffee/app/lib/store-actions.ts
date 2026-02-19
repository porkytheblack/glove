import type { RemoteStoreActions } from "glove-react";

/**
 * Remote store actions that delegate to /api/sessions/[sessionId]/messages.
 * Shared singleton — sessionId is curried in by createRemoteStore.
 */
export const storeActions: RemoteStoreActions = {
  async getMessages(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    if (!res.ok) return [];
    return res.json();
  },

  async appendMessages(sessionId, messages) {
    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  },
};
