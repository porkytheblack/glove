"use client";

import React, { useRef, useEffect } from "react";
import type { SessionInfo } from "../lib/use-sessions";
import { CoffeeIcon } from "./icons";

interface TabBarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
}

export function TabBar({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
}: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!activeSessionId || !scrollRef.current) return;
    const activeTab = scrollRef.current.querySelector(
      `[data-session-id="${activeSessionId}"]`,
    );
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeSessionId]);

  return (
    <div className="top-bar">
      <div className="top-bar-brand">
        <div className="top-bar-logo">
          <CoffeeIcon color="#fefdfb" size={14} />
        </div>
        <span className="top-bar-name">Glove Coffee</span>
      </div>

      <div className="top-bar-tabs" ref={scrollRef}>
        {sessions.map((s) => (
          <button
            key={s.sessionId}
            data-session-id={s.sessionId}
            className={`tab ${s.sessionId === activeSessionId ? "active" : ""}`}
            onClick={() => onSelectSession(s.sessionId)}
            title={s.name || "New conversation"}
          >
            <span className="tab-label">
              {s.name || "New conversation"}
            </span>
          </button>
        ))}
        <button className="tab tab-new" onClick={onNewChat} title="New chat">
          <PlusIcon />
        </button>
      </div>

      <div className="top-bar-right">
        <div className="online-badge">
          <div className="online-dot" />
          <span className="online-text">Online</span>
        </div>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
