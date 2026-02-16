import { useEffect, useState, useCallback, useMemo } from "react";
import type { SessionStatus } from "../hooks/useAgentPool";

interface SessionInfo {
  sessionId: string;
  name: string;
  createdAt: string;
  workingDir: string;
}

export function SessionSidebar({
  serverHttpUrl,
  activeSessionId,
  sessionStatuses,
  onSelect,
  onNewSession,
}: {
  serverHttpUrl: string;
  activeSessionId: string | null;
  /** Live connection status for sessions that have an active WebSocket */
  sessionStatuses?: Map<string, SessionStatus>;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchSessions = useCallback(() => {
    fetch(`${serverHttpUrl}/sessions`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: SessionInfo[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [serverHttpUrl]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Group sessions by relative date
  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(q) ||
        s.sessionId.toLowerCase().includes(q) ||
        (s.workingDir || "").toLowerCase().includes(q),
    );
  }, [sessions, search]);

  const groupedSessions = useMemo(() => {
    const now = new Date();
    const groups: { label: string; sessions: SessionInfo[] }[] = [];
    const today: SessionInfo[] = [];
    const yesterday: SessionInfo[] = [];
    const thisWeek: SessionInfo[] = [];
    const older: SessionInfo[] = [];

    for (const s of filteredSessions) {
      const d = new Date(s.createdAt + "Z");
      const diff = now.getTime() - d.getTime();
      const days = Math.floor(diff / 86400000);

      if (days < 1) today.push(s);
      else if (days < 2) yesterday.push(s);
      else if (days < 7) thisWeek.push(s);
      else older.push(s);
    }

    if (today.length > 0) groups.push({ label: "Today", sessions: today });
    if (yesterday.length > 0) groups.push({ label: "Yesterday", sessions: yesterday });
    if (thisWeek.length > 0) groups.push({ label: "This week", sessions: thisWeek });
    if (older.length > 0) groups.push({ label: "Older", sessions: older });

    return groups;
  }, [filteredSessions]);

  function formatTime(iso: string) {
    const d = new Date(iso + "Z");
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  /** Extract short directory name from full path */
  function shortDir(dir: string) {
    if (!dir) return "";
    const parts = dir.split("/").filter(Boolean);
    return parts[parts.length - 1] || dir;
  }

  return (
    <aside className="sidebar" role="complementary" aria-label="Session sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--accent)" style={{ marginRight: 6, verticalAlign: -2 }}>
            <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v1A2.5 2.5 0 0 0 8 7a2.5 2.5 0 0 0 2.5-2.5v-1A2.5 2.5 0 0 0 8 1zM4 8.5A1.5 1.5 0 0 0 2.5 10v1.5c0 .69.56 1.25 1.25 1.25h.75v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h1v1.75a.5.5 0 0 0 1 0v-1.75h.75c.69 0 1.25-.56 1.25-1.25V10A1.5 1.5 0 0 0 12 8.5H4z" />
          </svg>
          Agent
        </h1>
        <button
          className="sidebar-new-btn"
          onClick={onNewSession}
          title="New session"
          aria-label="Start new session"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="sidebar-search">
        <svg className="sidebar-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="6" cy="6" r="4" />
          <line x1="9" y1="9" x2="13" y2="13" />
        </svg>
        <input
          className="sidebar-search-input"
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="sidebar-search-clear"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3.05 3.05a.5.5 0 0 1 .7 0L6 5.29l2.25-2.24a.5.5 0 0 1 .7.7L6.71 6l2.24 2.25a.5.5 0 0 1-.7.7L6 6.71 3.75 8.95a.5.5 0 0 1-.7-.7L5.29 6 3.05 3.75a.5.5 0 0 1 0-.7z" />
            </svg>
          </button>
        )}
      </div>

      <div className="sidebar-sessions">
        {loading && (
          <div className="sidebar-loading dim">
            <span className="spinner small" /> Loading...
          </div>
        )}

        {!loading && filteredSessions.length === 0 && (
          <div className="sidebar-empty">
            {search ? (
              <>
                <div className="sidebar-empty-icon dim">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <span className="dim">No sessions match "{search}"</span>
              </>
            ) : (
              <>
                <div className="sidebar-empty-icon dim">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <span className="dim">No sessions yet</span>
                <span className="dim" style={{ fontSize: 11 }}>
                  Click + to start a new session
                </span>
              </>
            )}
          </div>
        )}

        {groupedSessions.map((group) => (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {group.sessions.map((s) => {
              const status = sessionStatuses?.get(s.sessionId);
              const isBusy = status?.busy ?? false;
              const isConnected = status?.connected ?? false;

              return (
                <button
                  key={s.sessionId}
                  className={`sidebar-session${s.sessionId === activeSessionId ? " sidebar-session-active" : ""}`}
                  onClick={() => onSelect(s.sessionId)}
                  title={s.workingDir || s.sessionId}
                >
                  <div className="sidebar-session-info">
                    <span className="sidebar-session-name">
                      {s.name || s.sessionId.slice(0, 8)}
                    </span>
                    {s.workingDir && (
                      <span className="sidebar-session-dir">
                        {shortDir(s.workingDir)}
                      </span>
                    )}
                  </div>
                  <div className="sidebar-session-trailing">
                    {/* Live status indicator: pulsing for busy, dot for connected */}
                    {isConnected && (
                      <span
                        className={`sidebar-session-status${isBusy ? " sidebar-session-status-busy" : " sidebar-session-status-idle"}`}
                        title={isBusy ? "Processing..." : "Connected"}
                        aria-label={isBusy ? "Session is processing" : "Session is connected"}
                      />
                    )}
                    <span className="sidebar-session-meta dim">
                      {formatTime(s.createdAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
