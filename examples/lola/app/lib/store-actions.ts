import type { RemoteStoreActions } from "glove-react";

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
