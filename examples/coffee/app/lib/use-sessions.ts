"use client";

import { useState, useEffect, useCallback } from "react";

export interface SessionInfo {
  sessionId: string;
  name: string;
  createdAt: string;
}

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

  // Create a new session
  const createSession = useCallback(async (): Promise<string> => {
    const sessionId = crypto.randomUUID();
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    await refresh();
    setActiveSessionId(sessionId);
    return sessionId;
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

  // Start new chat
  const newChat = useCallback(async () => {
    return createSession();
  }, [createSession]);

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
