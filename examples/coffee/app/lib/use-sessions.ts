"use client";

import { useState, useEffect, useCallback } from "react";

export interface SessionInfo {
  sessionId: string;
  name: string;
  createdAt: string;
}

/**
 * Creates a session on the server and returns its ID.
 * This is a standalone function suitable for use as a `getSessionId` callback
 * with `useGlove`, allowing the hook to resolve the session ID asynchronously.
 */
async function createSessionOnServer(): Promise<string> {
  const sessionId = crypto.randomUUID();
  await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return sessionId;
}

export function useSessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Tracks the getSessionId callback for new chats so it can be passed to
  // useGlove. Set when newChat() is called, cleared once a session is selected.
  const [activeGetSessionId, setActiveGetSessionId] = useState<
    (() => Promise<string>) | undefined
  >(undefined);

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

  // Start new chat — provides a getSessionId callback for useGlove.
  // The session is created on the server asynchronously when useGlove calls it.
  // Once resolved, the parent should call selectSession() via onSessionResolved
  // to update tabs and clear the pending getSessionId state.
  const newChat = useCallback(() => {
    const fetcher = () => createSessionOnServer();
    setActiveGetSessionId(() => fetcher);
    setActiveSessionId(null);
  }, []);

  // Select an existing session (sync — no getSessionId needed)
  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveGetSessionId(undefined);
  }, []);

  return {
    sessions,
    activeSessionId,
    activeGetSessionId,
    loaded,
    newChat,
    selectSession,
    nameSession,
    refresh,
  };
}
