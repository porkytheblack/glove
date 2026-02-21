"use client";

import React, { useState, useEffect, useRef } from "react";
import type { SessionInfo } from "../lib/use-sessions";
import { CoffeeIcon, ChatListIcon } from "./icons";

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
  const [showPicker, setShowPicker] = useState(false);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const activeLabel = activeSession?.name || "New conversation";

  function handleSelect(id: string) {
    onSelectSession(id);
    setShowPicker(false);
  }

  function handleNewChat() {
    onNewChat();
    setShowPicker(false);
  }

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-brand">
          <div className="top-bar-logo">
            <CoffeeIcon color="#fefdfb" size={14} />
          </div>
          <span className="top-bar-name">Glove Coffee</span>
        </div>

        <div className="top-bar-center">
          <span className="top-bar-session-name">{activeLabel}</span>
        </div>

        <div className="top-bar-right">
          <button
            className="top-bar-history-btn"
            onClick={() => setShowPicker(true)}
            title="Chat history"
          >
            <ChatListIcon color="var(--sage-400)" size={16} />
          </button>
        </div>
      </div>

      {showPicker && (
        <SessionPicker
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelect}
          onNewChat={handleNewChat}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

// ─── Session picker modal ──────────────────────────────────────────────────

interface SessionPickerProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

function SessionPicker({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onClose,
}: SessionPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on click outside the panel
  function handleBackdropClick(e: React.MouseEvent) {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose();
    }
  }

  return (
    <div className="session-picker-backdrop" onClick={handleBackdropClick}>
      <div className="session-picker" ref={panelRef}>
        <div className="session-picker-header">
          <span className="session-picker-title">Conversations</span>
          <button className="session-picker-new" onClick={onNewChat}>
            <PlusIcon /> New chat
          </button>
        </div>
        <div className="session-picker-list">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              className={`session-picker-item ${s.sessionId === activeSessionId ? "active" : ""}`}
              onClick={() => onSelect(s.sessionId)}
            >
              <span className="session-picker-item-name">
                {s.name || "New conversation"}
              </span>
              <span className="session-picker-item-date">
                {formatDate(s.createdAt)}
              </span>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="session-picker-empty">No conversations yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
