"use client";

import { useCallback, useEffect } from "react";
import { Lola } from "./components/lola";
import { useSessions } from "./lib/use-sessions";

export default function Home() {
  const {
    sessions,
    activeSessionId,
    loaded,
    newChat,
    selectSession,
    nameSession,
  } = useSessions();

  // Auto-create first session when there are none
  useEffect(() => {
    if (loaded && sessions.length === 0 && !activeSessionId) {
      newChat();
    }
  }, [loaded, sessions.length, activeSessionId, newChat]);

  // Auto-select most recent session on load if none active
  useEffect(() => {
    if (loaded && sessions.length > 0 && !activeSessionId) {
      selectSession(sessions[0].sessionId);
    }
  }, [loaded, sessions, activeSessionId, selectSession]);

  const handleFirstMessage = useCallback(
    (sessionId: string, text: string) => {
      nameSession(sessionId, text);
    },
    [nameSession],
  );

  if (!loaded) {
    return (
      <div className="loading-state" style={{ height: "100dvh" }}>
        <div className="loading-state__bar" />
        <span className="loading-state__text">Loading</span>
      </div>
    );
  }

  if (!activeSessionId) {
    return (
      <div className="loading-state" style={{ height: "100dvh" }}>
        <div className="loading-state__bar" />
        <span className="loading-state__text">Starting session</span>
      </div>
    );
  }

  return (
    <Lola
      key={activeSessionId}
      sessionId={activeSessionId}
      onFirstMessage={handleFirstMessage}
    />
  );
}
