"use client";

import { useState, useEffect, useCallback } from "react";
import { createSessionOnServer } from "./client";

export interface SessionInfo {
  sessionId: string;
  name: string;
  createdAt: string;
}

/**
 * Session list + active-session state for the tab bar.
 *
 * Since glove-react handles session switching reactively (the `sessionId`
 * passed to `useGlove` can change in place), this hook only tracks WHICH
 * session is active — no `getSessionId` threading, no pending state, no
 * "session resolved" callbacks.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Fetch sessions from server
  const refresh = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = (await res.json()) as SessionInfo[];
    setSessions(data);
  }, []);

  // Load sessions on mount
  useEffect(() => {
    refresh().then(() => setLoaded(true));
  }, [refresh]);

  // Rename a session (called after first user message)
  const nameSession = useCallback(
    async (sessionId: string, name: string) => {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refresh();
    },
    [refresh],
  );

  // Start a new chat — create the session on the server, then activate it.
  const newChat = useCallback(async () => {
    const sessionId = await createSessionOnServer();
    setActiveSessionId(sessionId);
    await refresh();
    return sessionId;
  }, [refresh]);

  // Select an existing session
  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  return {
    sessions,
    activeSessionId,
    loaded,
    newChat,
    selectSession,
    nameSession,
    refresh,
  };
}
