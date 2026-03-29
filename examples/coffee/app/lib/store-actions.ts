import type { RemoteStoreActions } from "glove-react";

/**
 * Remote store actions that delegate to /api/sessions/[sessionId]/*.
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

  // Inbox
  async getInboxItems(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/inbox`);
    if (!res.ok) return [];
    return res.json();
  },

  async addInboxItem(sessionId, item) {
    await fetch(`/api/sessions/${sessionId}/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
    });
  },

  async updateInboxItem(sessionId, itemId, updates) {
    await fetch(`/api/sessions/${sessionId}/inbox/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, updates }),
    });
  },

  async getResolvedInboxItems(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/inbox/resolved`);
    if (!res.ok) return [];
    return res.json();
  },
};
