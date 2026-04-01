"use client";

import { useCallback, useEffect } from "react";
import Chat from "./components/chat";
import { TabBar } from "./components/tab-bar";
import { useSessions } from "./lib/use-sessions";

export default function Home() {
  const {
    sessions,
    activeSessionId,
    activeGetSessionId,
    loaded,
    newChat,
    selectSession,
    nameSession,
    refresh,
  } = useSessions();

  // Auto-create first session when there are none
  useEffect(() => {
    if (loaded && sessions.length === 0 && !activeSessionId && !activeGetSessionId) {
      newChat();
    }
  }, [loaded, sessions.length, activeSessionId, activeGetSessionId, newChat]);

  // Auto-select most recent session on load if none active
  useEffect(() => {
    if (loaded && sessions.length > 0 && !activeSessionId && !activeGetSessionId) {
      selectSession(sessions[0].sessionId);
    }
  }, [loaded, sessions, activeSessionId, activeGetSessionId, selectSession]);

  const handleFirstMessage = useCallback(
    (sessionId: string, text: string) => {
      nameSession(sessionId, text);
    },
    [nameSession],
  );

  // When Chat resolves its session ID via getSessionId, update the active
  // session so tabs and other UI reflect the new session.
  const handleSessionResolved = useCallback(
    (sessionId: string) => {
      selectSession(sessionId);
      refresh();
    },
    [selectSession, refresh],
  );

  if (!loaded) {
    return (
      <main className="app-layout">
        <div className="loading-state">Loading...</div>
      </main>
    );
  }

  // A chat is renderable when we have either a resolved session ID or a
  // getSessionId callback for useGlove to resolve asynchronously.
  const canRenderChat = activeSessionId || activeGetSessionId;

  return (
    <main className="app-layout">
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={newChat}
        onSelectSession={selectSession}
      />
      <div className="content-area">
        {canRenderChat ? (
          <Chat
            key={activeSessionId ?? "pending"}
            sessionId={activeSessionId ?? undefined}
            getSessionId={activeGetSessionId}
            onFirstMessage={handleFirstMessage}
            onSessionResolved={handleSessionResolved}
          />
        ) : (
          <div className="loading-state">Creating conversation...</div>
        )}
      </div>
    </main>
  );
}
