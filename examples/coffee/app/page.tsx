"use client";

import { useCallback, useEffect } from "react";
import Chat from "./components/chat";
import { TabBar } from "./components/tab-bar";
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
      <main className="app-layout">
        <div className="loading-state">Loading...</div>
      </main>
    );
  }

  return (
    <main className="app-layout">
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={newChat}
        onSelectSession={selectSession}
      />
      <div className="content-area">
        {activeSessionId ? (
          <Chat
            key={activeSessionId}
            sessionId={activeSessionId}
            onFirstMessage={handleFirstMessage}
          />
        ) : (
          <div className="loading-state">Creating conversation...</div>
        )}
      </div>
    </main>
  );
}
